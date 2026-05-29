/*
 * This program and the accompanying materials are made available under the terms of the
 * Eclipse Public License v2.0 which accompanies this distribution, and is available at
 * https://www.eclipse.org/legal/epl-v20.html
 *
 * SPDX-License-Identifier: EPL-2.0
 *
 * Copyright Contributors to the Zowe Project.
 *
 */

/**
 * Stand up the z/OSMF HTTP listener for the mock daemon.
 *
 * Imported lazily by server.ts so daemons launched without --http-port don't
 * pull Express into memory.
 *
 * Endpoints in this iteration:
 *   POST   /zosmf/services/authenticate    (login)
 *   DELETE /zosmf/services/authenticate    (logout)
 *   GET    /zosmf/info                     (token verify + system metadata)
 *   GET    /zosmf/restfiles/ds             (list data sets by DSLEVEL)
 */

import express, { type NextFunction, type Request, type Response } from 'express';
import { createServer, type Server } from 'node:http';
import type { MockHostStore } from '../store.js';
import type { MockUser } from '../users.js';
import { buildZosmfInfoPayload, type ZosmfVersion } from './info-payload.js';
import { accessLog } from './middleware/access-log.js';
import { txidMiddleware } from './middleware/txid.js';
import { registerAuthenticateRoute } from './routes/authenticate.js';
import { registerInfoRoute } from './routes/info.js';
import { registerRestfilesDsReadRoute } from './routes/restfiles-ds-read.js';
import { registerRestfilesDsRoute } from './routes/restfiles-ds.js';
import { TokenStore } from './token-store.js';

export interface StartZosmfHttpOptions {
  host: string;
  port: number;
  mockDir: string;
  users: MockUser[];
  /** Default systemId used when an authenticated user has no `systemId` of their own. */
  defaultSystemId: string;
  /** Shared MockHostStore (datasets/USS/jobs) used by the data-oriented routes. */
  store: MockHostStore;
  /** Logger callback. Severity hints follow the daemon's existing levels. */
  log: (lvl: 'error' | 'warn' | 'info' | 'debug' | 'trace', msg: string) => void;
  /**
   * When true, the access-log middleware dumps full request + response
   * details (headers — with Authorization/Cookie redacted — and bodies)
   * alongside the nginx-style summary line.
   */
  verbose?: boolean;
  /**
   * z/OSMF version to advertise in `GET /zosmf/info`. Defaults to `'5.30'`.
   * Controls `zos_version`, `zosmf_version`, and `zosmf_full_version` fields.
   */
  zosmfVersion?: ZosmfVersion;
}

export interface ZosmfHttpHandle {
  host: string;
  port: number;
  close: () => Promise<void>;
}

export async function startZosmfHttpServer(opts: StartZosmfHttpOptions): Promise<ZosmfHttpHandle> {
  const tokens = new TokenStore();
  const routeLog: Parameters<typeof registerInfoRoute>[0]['log'] = (lvl, msg) =>
    opts.log(lvl, msg);

  const app = express();
  app.disable('x-powered-by');

  // X-IBM-Txid on every response — real z/OSMF always returns this header.
  app.use(txidMiddleware);

  // Access log first — emits an info-level stderr line + appends to
  // <mockDir>/_ssh/last_http.json on res.on('finish'). With `verbose: true`
  // it also dumps full request/response traces for debugging.
  app.use(accessLog(opts.mockDir, opts.log, { verbose: opts.verbose }));

  // We don't need a JSON body parser for any current route, but mount it
  // tolerantly so future routes can rely on `req.body`.
  app.use(express.json({ limit: '256kb' }));

  app.use(
    registerAuthenticateRoute({
      users: opts.users,
      tokens,
      mockDir: opts.mockDir,
      log: routeLog,
    })
  );
  // Build the info payload early so we can mutate zosmf_port after an ephemeral
  // port is resolved (the info route captures the object reference, not a snapshot,
  // so JSON.stringify(payload) on each request picks up the updated port).
  const infoPayload = buildZosmfInfoPayload({ version: opts.zosmfVersion, port: opts.port });
  app.use(
    registerInfoRoute({
      users: opts.users,
      tokens,
      defaultSystemId: opts.defaultSystemId,
      payload: infoPayload,
      log: routeLog,
    })
  );
  app.use(
    registerRestfilesDsRoute({
      users: opts.users,
      tokens,
      store: opts.store,
      defaultSystemId: opts.defaultSystemId,
      log: routeLog,
    })
  );
  // Read endpoints — registered after the list route so Express resolves
  // `/zosmf/restfiles/ds` (list) before falling through to `/ds/:dsname`.
  app.use(
    registerRestfilesDsReadRoute({
      users: opts.users,
      tokens,
      store: opts.store,
      defaultSystemId: opts.defaultSystemId,
      log: routeLog,
    })
  );

  // 404 — return a small z/OSMF-shaped error so client-side parsers don't
  // choke. (Real z/OSMF returns an HTML page for unknown paths; the mock's
  // surface is small enough that returning JSON is fine.)
  app.use((_req: Request, res: Response) => {
    res
      .status(404)
      .set('Content-Type', 'application/json; charset=UTF-8')
      .send(
        JSON.stringify({
          rc: 4,
          reason: 0,
          category: 1,
          message: 'IZUG1099E: The requested resource was not found in this mock.',
        })
      );
  });

  // Express 5 routes Promise rejections through this 4-arg handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const msg = err instanceof Error ? err.message : String(err);
    opts.log('error', `unhandled error: ${msg}`);
    if (res.headersSent) return;
    res
      .status(500)
      .set('Content-Type', 'application/json; charset=UTF-8')
      .send(
        JSON.stringify({
          rc: 16,
          reason: 0,
          category: 1,
          message: `IZUG1900E: Internal mock error: ${msg}`,
        })
      );
  });

  const server: Server = createServer(app);
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(opts.port, opts.host, () => resolve());
  });

  const addr = server.address();
  const resolvedPort = typeof addr === 'object' && addr ? addr.port : opts.port;

  // When the configured port was 0 (ephemeral), update the info payload so that
  // GET /zosmf/info advertises the real bound port. The route serializes the
  // payload object on every request, so this mutation takes effect immediately.
  if (opts.port === 0 && infoPayload) {
    infoPayload.zosmf_port = String(resolvedPort);
  }

  return {
    host: opts.host,
    port: resolvedPort,
    close: async () => {
      tokens.dispose();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
