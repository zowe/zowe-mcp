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
 * Dataset tools for the Zowe MCP Server.
 *
 * Provides tools for listing, reading, writing, creating, deleting,
 * copying, and renaming z/OS datasets and PDS/PDSE members.
 *
 * All dataset names follow the z/OS single-quote convention:
 * - Unquoted names are relative to the current DSN prefix
 * - Single-quoted names (e.g. `'SYS1.PROCLIB'`) are absolute
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import { buildDsUri, DsnError, resolveDsn, resolveWithPrefix } from '../../zos/dsn.js';
import type { SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import type { MutationResultMeta } from '../response.js';
import {
  buildContext,
  DEFAULT_LIST_LIMIT,
  formatResolved,
  paginateList,
  windowContent,
  wrapResponse,
} from '../response.js';

/** Dependencies injected into dataset tool registration. */
export interface DatasetToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
}

/**
 * Ensure a system context exists for the given system ID.
 *
 * When the LLM passes an explicit `system` parameter to a dataset tool
 * without first calling `setSystem`, no context (userId / dsnPrefix)
 * exists yet. This helper lazily initializes the context using the
 * credential provider, mirroring what `setSystem` does.
 */
async function ensureContext(deps: DatasetToolDeps, systemId: string): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

/**
 * Helper to resolve a dataset name and system from tool input.
 * Returns the resolved system ID, dsn, and optional member.
 *
 * Lazily initializes the system context if it doesn't exist yet.
 */
async function resolveInput(
  deps: DatasetToolDeps,
  dsn: string,
  member: string | undefined,
  system: string | undefined,
  log: Logger
) {
  const systemId = deps.sessionState.requireSystem(system);
  await ensureContext(deps, systemId);
  const prefix = deps.sessionState.getDsnPrefix(systemId);
  const resolved = resolveDsn(dsn, prefix, member);
  log.debug('resolved input', {
    systemId,
    prefix,
    dsn: resolved.dsn,
    member: resolved.member,
  });
  return { systemId, ...resolved };
}

/** Format an error for LLM consumption. */
function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

/**
 * Registers all dataset tools on the given MCP server.
 */
export function registerDatasetTools(
  server: McpServer,
  deps: DatasetToolDeps,
  logger: Logger
): void {
  const log = logger.child('datasets');

  // -----------------------------------------------------------------------
  // listDatasets
  // -----------------------------------------------------------------------
  server.registerTool(
    'listDatasets',
    {
      description:
        'List datasets matching a pattern. Returns the first page of results (default 500, max 1000). ' +
        'Use offset and limit to page through large result sets. ' +
        "Pattern: if in single quotes (e.g. 'USER.*'), it is absolute; otherwise relative and the DSN prefix is prepended with a trailing dot. Use * within a qualifier and ** across qualifiers.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsnPattern: z
          .string()
          .describe(
            "Dataset name pattern (required). If in single quotes (e.g. 'USER.*'), it is absolute; otherwise relative and the DSN prefix is prepended with a trailing dot. Use * within a qualifier and ** across qualifiers."
          ),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
        volser: z.string().optional().describe('Volume serial for uncataloged datasets.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based offset into the result set. Default: 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Maximum number of items to return. Default: 500. Max: 1000.'),
      },
    },
    async ({ dsnPattern, system, volser, offset, limit }) => {
      log.info('listDatasets called', { dsnPattern, system, volser, offset, limit });

      try {
        const systemId = deps.sessionState.requireSystem(system);
        await ensureContext(deps, systemId);
        const prefix = deps.sessionState.getDsnPrefix(systemId);

        const { resolved: resolvedPattern, wasAbsolute } = resolveWithPrefix(dsnPattern, prefix);

        log.debug('listDatasets resolved', {
          systemId,
          prefix,
          resolvedPattern,
        });

        const datasets = await deps.backend.listDatasets(systemId, resolvedPattern, volser);

        // Add resource links
        const enriched = datasets.map(ds => ({
          ...ds,
          resourceLink: buildDsUri(systemId, ds.dsn, undefined, ds.volser),
        }));

        // Paginate
        const { data, meta } = paginateList(enriched, offset ?? 0, limit ?? DEFAULT_LIST_LIMIT);

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedPattern: formatResolved(resolvedPattern),
        });

        return wrapResponse(ctx, meta, data, []);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // listMembers
  // -----------------------------------------------------------------------
  server.registerTool(
    'listMembers',
    {
      description:
        'List members of a PDS/PDSE dataset. Returns the first page of results (default 500, max 1000). ' +
        'Use offset and limit to page through large result sets. ' +
        "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        pattern: z
          .string()
          .optional()
          .describe('Optional member name filter pattern (e.g. "ABC*").'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based offset into the result set. Default: 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Maximum number of items to return. Default: 500. Max: 1000.'),
      },
    },
    async ({ dsn, pattern, system, offset, limit }) => {
      log.info('listMembers called', { dsn, pattern, system, offset, limit });

      try {
        const {
          systemId,
          dsn: resolvedDsn,
          wasAbsolute,
        } = await resolveInput(deps, dsn, undefined, system, log);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const members = await deps.backend.listMembers(systemId, resolvedDsn, pattern);

        // Paginate and map name -> member for response
        const { data: rawData, meta } = paginateList(
          members.map(m => ({ member: m.name })),
          offset ?? 0,
          limit ?? DEFAULT_LIST_LIMIT
        );

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(resolvedDsn),
        });

        return wrapResponse(ctx, meta, rawData, []);
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // getDatasetAttributes
  // -----------------------------------------------------------------------
  server.registerTool(
    'getDatasetAttributes',
    {
      description:
        'Get detailed attributes of a dataset: organization, record format, ' +
        'record length, block size, volume, SMS classes, dates, and more. ' +
        "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix.",
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dsn, system }) => {
      log.info('getDatasetAttributes called', { dsn, system });

      try {
        const {
          systemId,
          dsn: resolvedDsn,
          wasAbsolute,
        } = await resolveInput(deps, dsn, undefined, system, log);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const attrs = await deps.backend.getAttributes(systemId, resolvedDsn);

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(resolvedDsn),
        });

        const createCompatibleType =
          attrs.dsorg === 'PS' || attrs.dsorg === 'PO' || attrs.dsorg === 'PO-E'
            ? attrs.dsorg
            : undefined;
        const data = {
          dsn: formatResolved(attrs.dsn),
          ...(createCompatibleType !== undefined && { type: createCompatibleType }),
          recfm: attrs.recfm,
          lrecl: attrs.lrecl,
          blksz: attrs.blksz,
          volser: attrs.volser,
          creationDate: attrs.creationDate,
          referenceDate: attrs.referenceDate,
          smsClass: attrs.smsClass,
          usedTracks: attrs.usedTracks,
          usedExtents: attrs.usedExtents,
        };

        return wrapResponse(ctx, undefined, data, []);
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // readDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'readDataset',
    {
      description:
        'Read the content of a sequential dataset or PDS/PDSE member. ' +
        'Large files are automatically truncated to the first 2000 lines. ' +
        'Use startLine and lineCount to read specific sections. ' +
        'Returns UTF-8 text, an ETag for optimistic locking, and the source codepage. ' +
        'Pass the ETag to writeDataset to prevent overwriting concurrent changes.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        member: z.string().optional().describe('Member name for PDS/PDSE datasets.'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
        codepage: z
          .string()
          .optional()
          .describe('Source codepage for EBCDIC-to-UTF-8 conversion (default: "IBM-1047").'),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based starting line number. Default: 1 (beginning of file).'),
        lineCount: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe(
            'Number of lines to return. Default: all remaining lines up to the auto-truncation limit.'
          ),
      },
    },
    async ({ dsn, member, system, codepage, startLine, lineCount }) => {
      log.info('readDataset called', { dsn, member, system, codepage, startLine, lineCount });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const prefix = deps.sessionState.getDsnPrefix(resolved.systemId);
        const result = await deps.backend.readDataset(
          resolved.systemId,
          resolved.dsn,
          resolved.member,
          codepage
        );

        // Apply line windowing
        const windowed = windowContent(result.text, startLine, lineCount);

        // Build the resolved DSN with member if applicable
        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;

        const ctx = buildContext(resolved.systemId, resolved.wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(fullDsn),
        });

        return wrapResponse(
          ctx,
          windowed.meta,
          {
            text: windowed.text,
            etag: result.etag,
            codepage: result.codepage,
          },
          []
        );
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // writeDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'writeDataset',
    {
      description:
        'Write UTF-8 content to a sequential dataset or PDS/PDSE member. ' +
        'If an ETag is provided (from a previous readDataset call), the write ' +
        'fails if the dataset was modified since the read — preventing overwrites. ' +
        'Returns a new ETag for the written content.',
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        content: z.string().describe('UTF-8 text content to write.'),
        member: z.string().optional().describe('Member name for PDS/PDSE datasets.'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
        etag: z
          .string()
          .optional()
          .describe('ETag from a previous readDataset call for optimistic locking.'),
        codepage: z
          .string()
          .optional()
          .describe('Target codepage for UTF-8-to-EBCDIC conversion (default: "IBM-1047").'),
      },
    },
    async ({ dsn, content, member, system, etag, codepage }) => {
      log.info('writeDataset called', { dsn, member, system, hasEtag: !!etag, codepage });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const prefix = deps.sessionState.getDsnPrefix(resolved.systemId);
        const result = await deps.backend.writeDataset(
          resolved.systemId,
          resolved.dsn,
          content,
          resolved.member,
          etag,
          codepage
        );

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;

        const ctx = buildContext(resolved.systemId, resolved.wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(fullDsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(ctx, mutationMeta, { etag: result.etag }, []);
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // createDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'createDataset',
    {
      description:
        'Create a new sequential or partitioned dataset. Specify the type ' +
        '(PS/SEQUENTIAL, PO/PDS, PO-E/PDSE/LIBRARY) and optional attributes.',
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        type: z
          .enum(['PS', 'PO', 'PO-E', 'SEQUENTIAL', 'PDS', 'PDSE', 'LIBRARY'])
          .describe(
            'Dataset type: PS or SEQUENTIAL (sequential), PO or PDS (PDS), PO-E or PDSE or LIBRARY (PDSE).'
          ),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
        recfm: z
          .string()
          .optional()
          .describe('Record format. Supported: F, FB, V, VB, U, FBA, VBA. Default: FB.'),
        lrecl: z.number().optional().describe('Logical record length. Default: 80.'),
        blksz: z.number().optional().describe('Block size. Default: 27920.'),
        primary: z.number().optional().describe('Primary space allocation in tracks.'),
        secondary: z.number().optional().describe('Secondary space allocation in tracks.'),
        dirblk: z.number().optional().describe('Directory blocks (PDS only).'),
      },
    },
    async ({ dsn, type, system, recfm, lrecl, blksz, primary, secondary, dirblk }) => {
      log.info('createDataset called', { dsn, type, system });

      const canonicalType: CreateDatasetOptions['type'] =
        type === 'SEQUENTIAL'
          ? 'PS'
          : type === 'PDS'
            ? 'PO'
            : type === 'PDSE' || type === 'LIBRARY'
              ? 'PO-E'
              : type;

      try {
        const {
          systemId,
          dsn: resolvedDsn,
          wasAbsolute,
        } = await resolveInput(deps, dsn, undefined, system, log);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const result = await deps.backend.createDataset(systemId, resolvedDsn, {
          type: canonicalType,
          recfm: recfm as CreateDatasetOptions['recfm'],
          lrecl,
          blksz,
          primary,
          secondary,
          dirblk,
        });

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(resolvedDsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            dsn: formatResolved(resolvedDsn),
            type: canonicalType,
            allocation: {
              applied: result.applied,
              messages: result.messages,
            },
          },
          result.messages
        );
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // deleteDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'deleteDataset',
    {
      description:
        'Delete a dataset or a specific PDS/PDSE member. ' +
        'This is a destructive operation that cannot be undone.',
      annotations: { destructiveHint: true },
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        member: z
          .string()
          .optional()
          .describe('Member name to delete (if omitting, the entire dataset is deleted).'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dsn, member, system }) => {
      log.info('deleteDataset called', { dsn, member, system });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const prefix = deps.sessionState.getDsnPrefix(resolved.systemId);
        await deps.backend.deleteDataset(resolved.systemId, resolved.dsn, resolved.member);

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;

        const ctx = buildContext(resolved.systemId, resolved.wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(fullDsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            deletedDsn: formatResolved(fullDsn),
          },
          []
        );
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // copyDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'copyDataset',
    {
      description: 'Copy a dataset or PDS/PDSE member within a single z/OS system.',
      inputSchema: {
        sourceDsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        targetDsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.BACKUP), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        sourceMember: z
          .string()
          .optional()
          .describe('Source member name (for copying a single member).'),
        targetMember: z
          .string()
          .optional()
          .describe('Target member name (defaults to source member name).'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ sourceDsn, targetDsn, sourceMember, targetMember, system }) => {
      log.info('copyDataset called', {
        sourceDsn,
        targetDsn,
        sourceMember,
        targetMember,
        system,
      });

      try {
        const systemId = deps.sessionState.requireSystem(system);
        await ensureContext(deps, systemId);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const resolvedSource = resolveDsn(sourceDsn, prefix, sourceMember);
        const resolvedTarget = resolveDsn(targetDsn, prefix, targetMember);
        log.debug('copyDataset resolved', {
          systemId,
          prefix,
          source: resolvedSource.dsn,
          target: resolvedTarget.dsn,
          sourceMember: resolvedSource.member,
          targetMember: resolvedTarget.member,
        });

        await deps.backend.copyDataset(
          systemId,
          resolvedSource.dsn,
          resolvedTarget.dsn,
          resolvedSource.member,
          resolvedTarget.member
        );

        // Determine dsnPrefix inclusion: include if either input was relative
        const showPrefix =
          !resolvedSource.wasAbsolute || !resolvedTarget.wasAbsolute ? prefix : undefined;

        const ctx = buildContext(systemId, showPrefix, {
          resolvedDsn: formatResolved(resolvedSource.dsn),
          resolvedTargetDsn: formatResolved(resolvedTarget.dsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            sourceDsn: formatResolved(resolvedSource.dsn),
            targetDsn: formatResolved(resolvedTarget.dsn),
          },
          []
        );
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // renameDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'renameDataset',
    {
      description: 'Rename a dataset or PDS/PDSE member.',
      inputSchema: {
        dsn: z
          .string()
          .describe(
            "Dataset name: use a relative name (e.g. SRC.COBOL), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        newDsn: z
          .string()
          .describe(
            "New dataset name: use a relative name (e.g. SRC.NEW), or an absolute name in single quotes (e.g. 'SYS1.PROCLIB'). Relative names are prefixed with the current DSN prefix."
          ),
        member: z
          .string()
          .optional()
          .describe('Current member name (for renaming a member within a PDS/PDSE).'),
        newMember: z.string().optional().describe('New member name.'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dsn, newDsn, member, newMember, system }) => {
      log.info('renameDataset called', { dsn, newDsn, member, newMember, system });

      try {
        const systemId = deps.sessionState.requireSystem(system);
        await ensureContext(deps, systemId);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const resolvedOld = resolveDsn(dsn, prefix, member);
        const resolvedNew = resolveDsn(newDsn, prefix, newMember);
        log.debug('renameDataset resolved', {
          systemId,
          prefix,
          oldDsn: resolvedOld.dsn,
          newDsn: resolvedNew.dsn,
          oldMember: resolvedOld.member,
          newMember: resolvedNew.member,
        });

        await deps.backend.renameDataset(
          systemId,
          resolvedOld.dsn,
          resolvedNew.dsn,
          resolvedOld.member,
          resolvedNew.member
        );

        // Determine dsnPrefix inclusion: include if either input was relative
        const showPrefix =
          !resolvedOld.wasAbsolute || !resolvedNew.wasAbsolute ? prefix : undefined;

        const ctx = buildContext(systemId, showPrefix, {
          resolvedDsn: formatResolved(resolvedOld.dsn),
          resolvedTargetDsn: formatResolved(resolvedNew.dsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            oldName: resolvedOld.dsn,
            newName: resolvedNew.dsn,
          },
          []
        );
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );
}

// Re-export the type for use in createDataset
import type { CreateDatasetOptions } from '../../zos/backend.js';
