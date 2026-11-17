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

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

/** One explicitly selected transport per system. Secrets never belong in this configuration. */
const connectionSchema = z
  .object({
    url: z.string().url(),
    user: z
      .string()
      .regex(/^[A-Za-z0-9@#$]+$/)
      .max(8),
    deployment: z.enum(['auto', 'direct', 'apiml']).default('auto'),
    serviceId: z
      .string()
      .regex(/^[a-zA-Z0-9_-]+$/)
      .default('zo'),
    rejectUnauthorized: z.boolean().default(true),
    caFile: z.string().min(1).optional(),
    timeoutSeconds: z.number().int().min(1).max(3600).default(60),
    sessionLogin: z
      .object({
        url: z.string().min(1),
        method: z.enum(['basic', 'json']).default('json'),
        cookieName: z
          .string()
          .regex(/^[A-Za-z0-9_-]+$/)
          .optional(),
        tokenField: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type RestConnection = z.infer<typeof connectionSchema>;

export interface RestConfig {
  systems: RestConnection[];
  jobCards?: Record<string, string | string[]>;
}

export function parseRestConnections(input: unknown): RestConnection[] {
  const parsed = z.array(connectionSchema).min(1).safeParse(input);
  if (!parsed.success) {
    // Zod messages contain paths and validation rules, never the supplied value (which may be a secret).
    throw new Error(
      `Invalid zo-rest connections: ${parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    );
  }
  const hosts = new Set<string>();
  return parsed.data.map(connection => {
    const url = new URL(connection.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(
        'zo-rest URL must use HTTPS and must not contain credentials, a query, or a fragment.'
      );
    }
    if (hosts.has(url.hostname)) {
      throw new Error(
        `Only one zo-rest connection per system (${url.hostname}) is supported. Use separate MCP server configurations for alternate endpoints or users.`
      );
    }
    hosts.add(url.hostname);
    let sessionLogin = connection.sessionLogin;
    if (sessionLogin) {
      const loginUrl = new URL(sessionLogin.url, url);
      if (
        loginUrl.protocol !== 'https:' ||
        loginUrl.username ||
        loginUrl.password ||
        loginUrl.search ||
        loginUrl.hash
      )
        throw new Error(
          'Session login URL must use HTTPS without credentials, query, or fragment.'
        );
      sessionLogin = { ...sessionLogin, url: loginUrl.href };
    }
    return {
      ...connection,
      ...(sessionLogin ? { sessionLogin } : {}),
      url: url.href.replace(/\/$/, ''),
      user: connection.user.toUpperCase(),
    };
  });
}

export function loadRestConfig(configPath: string): RestConfig {
  const raw: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
  const parsed = z
    .object({
      systems: z.unknown(),
      jobCards: z.record(z.string(), z.union([z.string(), z.array(z.string())])).optional(),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success)
    throw new Error('zo-rest config must contain a systems array and optional jobCards.');
  return {
    systems: parseRestConnections(parsed.data.systems).map(connection => ({
      ...connection,
      ...(connection.caFile ? { caFile: resolve(dirname(configPath), connection.caFile) } : {}),
    })),
    jobCards: parsed.data.jobCards,
  };
}
