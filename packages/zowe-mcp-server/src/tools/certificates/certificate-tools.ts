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
 * z/OS certificate / key ring tools for the Zowe MCP Server.
 *
 * Operations on the z/OS security database (RACF, ACF2, or Top Secret via
 * the standard SAF interface, R_datalib):
 * - showCertificate: detailed info for a certificate in a key ring (read-only)
 * - connectCertificate, importCertificate: add a certificate to a key ring
 * - deleteCertificate: disconnect a certificate from a ring, or delete it entirely
 * - exportCertificate: export a certificate (PEM) or certificate+key (PKCS#12)
 * - setDefaultCertificate, trustCertificate, renameCertificate: change certificate attributes
 * - refreshCertificateClass: refresh the DIGTCERT class so changes take effect
 *
 * Backed by the Zowe Remote SSH SDK `client.certificates` RPCs (SDK 0.6.1+).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ResourceEffect } from '../../capability-level.js';
import type { Logger } from '../../log.js';
import type { CertActionResult, ImportCertificateResult, ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { createToolProgress } from '../progress.js';
import type { MutationResultMeta } from '../response.js';
import { buildContext, SYSTEM_PARAM_DESCRIPTION, wrapResponse } from '../response.js';
import { ensureContext, errorResult } from '../tool-utils.js';
import {
  connectCertificateOutputSchema,
  deleteCertificateOutputSchema,
  exportCertificateOutputSchema,
  importCertificateOutputSchema,
  refreshCertificateClassOutputSchema,
  renameCertificateOutputSchema,
  setDefaultCertificateOutputSchema,
  showCertificateOutputSchema,
  trustCertificateOutputSchema,
} from './certificate-output-schemas.js';

export interface CertificateToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
}

const ownerParam = z.string().describe('Certificate/key ring owner (user ID).');
const keyringParam = z.string().describe('Key ring name.');
const labelParam = z.string().describe('Certificate label.');

/**
 * Detects the security product reporting that only the automatic post-action DIGTCERT
 * refresh failed. The primary mutation (delete/import) has already committed at that
 * point, so surfacing the whole call as failed would be a false failure signal —
 * a caller could retry a destructive action that already went through.
 * Exported for tests.
 */
export function refreshFailureWarning(err: unknown): string | undefined {
  const msg = err instanceof Error ? err.message : String(err);
  if (!/\bREFRESH failed\b/i.test(msg)) return undefined;
  return (
    `The certificate change was applied, but the automatic DIGTCERT class refresh failed (${msg}). ` +
    'Run refreshCertificateClass so the change takes effect everywhere, or verify with showCertificate.'
  );
}

/** Common trailing fields (warning/safReturnCodes/gskReturnCode) surfaced by every certificate action. */
function certActionFields(result: CertActionResult) {
  return {
    ...(result.warning !== undefined && { warning: result.warning }),
    ...(result.safReturnCodes !== undefined && { safReturnCodes: result.safReturnCodes }),
    ...(result.gskReturnCode !== undefined && { gskReturnCode: result.gskReturnCode }),
  };
}

export function registerCertificateTools(
  server: McpServer,
  deps: CertificateToolDeps,
  logger: Logger
): void {
  const log = logger.child('certificates');

  /** Resolve the active/target system and ensure its context is initialised. */
  async function resolveAndEnsure(
    system: string | undefined
  ): Promise<{ systemId: string; userId?: string }> {
    const { systemId, userId: resolvedUserId } = resolveSystemForTool(
      deps.systemRegistry,
      deps.sessionState,
      system
    );
    await ensureContext(deps, systemId, resolvedUserId);
    return { systemId, userId: deps.sessionState.getContext(systemId)?.userId };
  }

  // -----------------------------------------------------------------------
  // showCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'showCertificate',
    {
      outputSchema: showCertificateOutputSchema,
      description:
        "Show a certificate's owner, usage, trust status, default flag, key size, serial number, " +
        'and validity dates. Validity and serial come from decoding the certificate.',
      _meta: { resourceEffectLevel: ResourceEffect.READ },
      inputSchema: {
        owner: ownerParam,
        keyring: keyringParam,
        label: labelParam,
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, keyring, label, system }, extra) => {
      const progress = createToolProgress(extra, `Show certificate ${label}`);
      await progress.start();
      log.info('showCertificate called', { owner, keyring, label, system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.showCertificate(
          systemId,
          { owner, keyring, label },
          userId,
          progressCb
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('done');
        return wrapResponse(ctx, undefined, result, []);
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // connectCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'connectCertificate',
    {
      outputSchema: connectCertificateOutputSchema,
      description:
        'Connect a certificate to a key ring. The underlying SAF call requires the certificate bytes, ' +
        'so the certificate is read from a ring it is already on (fromRing) or from the security ' +
        'database (fromDatabase) and reconnected to the target ring.',
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        owner: ownerParam,
        keyring: z.string().describe('Target key ring name.'),
        label: labelParam,
        fromRing: z
          .string()
          .optional()
          .describe(
            'Source key ring the certificate is already on. Mutually exclusive with fromDatabase; exactly one is required.'
          ),
        fromDatabase: z
          .boolean()
          .optional()
          .describe(
            'Read the certificate from the security database instead of a ring. Mutually exclusive with fromRing; exactly one is required.'
          ),
        usage: z
          .enum(['PERSONAL', 'CERTAUTH'])
          .optional()
          .describe("Certificate usage (default: the certificate's current usage)."),
        default: z
          .boolean()
          .optional()
          .describe("Set this certificate as the target ring's default."),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async (
      { owner, keyring, label, fromRing, fromDatabase, usage, default: isDefault, system },
      extra
    ) => {
      const progress = createToolProgress(extra, `Connect certificate ${label} to ${keyring}`);
      await progress.start();
      log.info('connectCertificate called', {
        owner,
        keyring,
        label,
        fromRing,
        fromDatabase,
        system,
      });
      try {
        if (!fromRing === !fromDatabase) {
          const msg = 'Provide exactly one of fromRing or fromDatabase.';
          await progress.complete(msg);
          return errorResult(msg);
        }
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.connectCertificate(
          systemId,
          { owner, keyring, label, fromRing, fromDatabase, usage, isDefault },
          userId,
          progressCb
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('connected');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          { owner, keyring, label, ...certActionFields(result) },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // deleteCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'deleteCertificate',
    {
      outputSchema: deleteCertificateOutputSchema,
      description:
        'Disconnect a certificate from a key ring, or delete it from the security database with ' +
        'database (which removes it entirely, not just from one ring). When the security product ' +
        'reports that the DIGTCERT class must be refreshed for the change to take effect, the refresh ' +
        'is issued automatically unless skipRefresh is set.',
      _meta: { resourceEffectLevel: ResourceEffect.DELETE },
      inputSchema: {
        owner: ownerParam,
        label: labelParam,
        keyring: z
          .string()
          .optional()
          .describe(
            'Key ring to disconnect the certificate from. Mutually exclusive with database; exactly one is required.'
          ),
        database: z
          .boolean()
          .optional()
          .describe(
            'Delete the certificate from the security database entirely. Mutually exclusive with keyring; exactly one is required.'
          ),
        skipRefresh: z
          .boolean()
          .optional()
          .describe(
            'Do not automatically refresh the DIGTCERT class if the security product reports it is required.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, label, keyring, database, skipRefresh, system }, extra) => {
      const progress = createToolProgress(extra, `Delete certificate ${label}`);
      await progress.start();
      log.info('deleteCertificate called', { owner, label, keyring, database, system });
      try {
        if (!keyring === !database) {
          const msg = 'Provide exactly one of keyring or database.';
          await progress.complete(msg);
          return errorResult(msg);
        }
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        let result: CertActionResult;
        try {
          result = await deps.backend.deleteCertificate(
            systemId,
            { owner, label, keyring, database, skipRefresh },
            userId,
            progressCb
          );
        } catch (err) {
          const warning = refreshFailureWarning(err);
          if (warning === undefined) throw err;
          result = { warning };
        }
        const ctx = buildContext(systemId, {});
        await progress.complete('deleted');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          { owner, label, keyring, database, ...certActionFields(result) },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // exportCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'exportCertificate',
    {
      outputSchema: exportCertificateOutputSchema,
      description:
        'Export a certificate from a key ring in PEM (certificate only) or PKCS#12 (certificate plus ' +
        'private key) format. With file, the certificate is written on z/OS; PEM without file is ' +
        'returned inline. The private key is only available in the p12 format, which requires file.',
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        owner: ownerParam,
        keyring: keyringParam,
        label: labelParam,
        format: z
          .enum(['pem', 'p12'])
          .optional()
          .describe(
            'Export format: "pem" (certificate) or "p12" (certificate + private key). Default "pem".'
          ),
        file: z
          .string()
          .optional()
          .describe(
            'Output file path on z/OS. Required for p12; PEM is returned inline if omitted.'
          ),
        password: z.string().optional().describe('PKCS#12 passphrase (used with format p12).'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, keyring, label, format, file, password, system }, extra) => {
      const progress = createToolProgress(extra, `Export certificate ${label}`);
      await progress.start();
      log.info('exportCertificate called', { owner, keyring, label, format, file, system });
      try {
        if ((format ?? 'pem') === 'p12' && !file) {
          const msg = 'file is required when format is "p12".';
          await progress.complete(msg);
          return errorResult(msg);
        }
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.exportCertificate(
          systemId,
          { owner, keyring, label, format, file, password },
          userId,
          progressCb
        );
        const ctx = buildContext(systemId, {});
        await progress.complete(result.file ? `written to ${result.file}` : 'exported');
        return wrapResponse(
          ctx,
          undefined,
          {
            label: result.label,
            owner: result.owner,
            keyring: result.keyring,
            format: result.format,
            file: result.file,
            bytesWritten: result.bytesWritten,
            content: result.data,
          },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // importCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'importCertificate',
    {
      outputSchema: importCertificateOutputSchema,
      description:
        'Import a certificate (and its private key, when present) into a key ring from a PKCS#12 ' +
        'file that already resides on z/OS. If the certificate content already exists in the security ' +
        'database, the existing record is connected to the ring and keeps its original label.',
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        owner: ownerParam,
        keyring: keyringParam,
        label: z
          .string()
          .describe(
            'Certificate label to assign (used only when the certificate is new to the security database).'
          ),
        usage: z.enum(['PERSONAL', 'CERTAUTH']).describe('Certificate usage.'),
        file: z.string().describe('Path to the source PKCS#12 file on z/OS.'),
        password: z.string().describe('PKCS#12 passphrase.'),
        skipRefresh: z
          .boolean()
          .optional()
          .describe(
            'Do not automatically refresh the DIGTCERT class if the security product reports it is required.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, keyring, label, usage, file, password, skipRefresh, system }, extra) => {
      const progress = createToolProgress(extra, `Import certificate ${label} into ${keyring}`);
      await progress.start();
      log.info('importCertificate called', { owner, keyring, label, usage, file, system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        let result: ImportCertificateResult;
        try {
          result = await deps.backend.importCertificate(
            systemId,
            { owner, keyring, label, usage, file, password, skipRefresh },
            userId,
            progressCb
          );
        } catch (err) {
          const warning = refreshFailureWarning(err);
          if (warning === undefined) throw err;
          result = { warning, label, owner, keyring };
        }
        const ctx = buildContext(systemId, {});
        await progress.complete('imported');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            label: result.label,
            owner: result.owner,
            keyring: result.keyring,
            ...certActionFields(result),
          },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // setDefaultCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'setDefaultCertificate',
    {
      outputSchema: setDefaultCertificateOutputSchema,
      description:
        "Set a certificate that is already connected to a key ring as that ring's default certificate.",
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        owner: ownerParam,
        keyring: keyringParam,
        label: labelParam,
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, keyring, label, system }, extra) => {
      const progress = createToolProgress(extra, `Set ${label} as default for ${keyring}`);
      await progress.start();
      log.info('setDefaultCertificate called', { owner, keyring, label, system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.setDefaultCertificate(
          systemId,
          { owner, keyring, label },
          userId,
          progressCb
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('done');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          { owner, keyring, label, ...certActionFields(result) },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // trustCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'trustCertificate',
    {
      outputSchema: trustCertificateOutputSchema,
      description:
        "Change a certificate's trust status. A key ring is not required; the certificate is " +
        'identified by owner and label. HIGHTRUST is honored only for CERTAUTH certificates.',
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        owner: ownerParam,
        label: labelParam,
        status: z.enum(['TRUST', 'HIGHTRUST', 'NOTRUST']).describe('The new trust status.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, label, status, system }, extra) => {
      const progress = createToolProgress(extra, `Set trust status of ${label} to ${status}`);
      await progress.start();
      log.info('trustCertificate called', { owner, label, status, system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.trustCertificate(
          systemId,
          { owner, label, status },
          userId,
          progressCb
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('done');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          { owner, label, status, ...certActionFields(result) },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // renameCertificate
  // -----------------------------------------------------------------------
  server.registerTool(
    'renameCertificate',
    {
      outputSchema: renameCertificateOutputSchema,
      description:
        "Change a certificate's label. A key ring is not required; the certificate is identified by " +
        'owner and current label.',
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        owner: ownerParam,
        label: z.string().describe('The current certificate label.'),
        newLabel: z.string().describe('The new certificate label.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ owner, label, newLabel, system }, extra) => {
      const progress = createToolProgress(extra, `Rename certificate ${label} to ${newLabel}`);
      await progress.start();
      log.info('renameCertificate called', { owner, label, newLabel, system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.renameCertificate(
          systemId,
          { owner, label, newLabel },
          userId,
          progressCb
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('renamed');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          { owner, label, newLabel, ...certActionFields(result) },
          []
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // refreshCertificateClass
  // -----------------------------------------------------------------------
  server.registerTool(
    'refreshCertificateClass',
    {
      outputSchema: refreshCertificateClassOutputSchema,
      description:
        'Refresh the DIGTCERT class so that certificate and key ring changes take effect.',
      _meta: { resourceEffectLevel: ResourceEffect.UPDATE },
      inputSchema: {
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ system }, extra) => {
      const progress = createToolProgress(extra, 'Refresh DIGTCERT class');
      await progress.start();
      log.info('refreshCertificateClass called', { system });
      try {
        const { systemId, userId } = await resolveAndEnsure(system);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.refreshCertificateClass(systemId, userId, progressCb);
        const ctx = buildContext(systemId, {});
        await progress.complete('refreshed');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(ctx, mutationMeta, certActionFields(result), []);
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );
}
