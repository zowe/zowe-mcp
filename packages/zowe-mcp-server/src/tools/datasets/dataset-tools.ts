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
import { buildDsUri, DsnError, resolveDsn } from '../../zos/dsn.js';
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
 * without first calling `set_system`, no context (userId / dsnPrefix)
 * exists yet. This helper lazily initialises the context using the
 * credential provider, mirroring what `set_system` does.
 */
async function ensureContext(deps: DatasetToolDeps, systemId: string): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const creds = await deps.credentialProvider.getCredentials(systemId);
  deps.sessionState.setActiveSystem(systemId, creds.user);
}

/**
 * Helper to resolve a dataset name and system from tool input.
 * Returns the resolved system ID, dsn, and optional member.
 *
 * Lazily initialises the system context if it doesn't exist yet.
 */
async function resolveInput(
  deps: DatasetToolDeps,
  dataset: string,
  member: string | undefined,
  system: string | undefined,
  log: Logger
) {
  const systemId = deps.sessionState.requireSystem(system);
  await ensureContext(deps, systemId);
  const prefix = deps.sessionState.getDsnPrefix(systemId);
  const resolved = resolveDsn(dataset, prefix, member);
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
  // list_datasets
  // -----------------------------------------------------------------------
  server.registerTool(
    'list_datasets',
    {
      description:
        'List datasets matching a pattern. Returns the first page of results (default 500, max 1000). ' +
        'Use offset and limit to page through large result sets. ' +
        'The pattern is resolved against the current DSN prefix. ' +
        "Use single quotes for absolute patterns (e.g. 'IBMUSER.*').",
      annotations: { readOnlyHint: true },
      inputSchema: {
        pattern: z
          .string()
          .describe(
            'Dataset name pattern (e.g. "SRC.*" for relative, or "\'IBMUSER.*\'" for absolute). ' +
              'Use * to match within a qualifier, ** to match across qualifiers.'
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
    async ({ pattern, system, volser, offset, limit }) => {
      log.info('list_datasets called', { pattern, system, volser, offset, limit });

      try {
        const systemId = deps.sessionState.requireSystem(system);
        await ensureContext(deps, systemId);
        const prefix = deps.sessionState.getDsnPrefix(systemId);

        // Resolve the pattern using DSN prefix
        let resolvedPattern: string;
        let wasAbsolute = false;
        const trimmed = pattern.trim();
        if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
          resolvedPattern = trimmed.slice(1, -1).toUpperCase();
          wasAbsolute = true;
        } else if (prefix) {
          resolvedPattern = `${prefix.toUpperCase()}.${trimmed.toUpperCase()}`;
        } else {
          resolvedPattern = trimmed.toUpperCase();
          log.warning(
            'No DSN prefix set — relative pattern used as-is. ' +
              'Use set_system or set_dsn_prefix first, or use an absolute pattern (single-quoted).',
            { pattern: resolvedPattern }
          );
        }

        log.debug('list_datasets resolved', {
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

        return wrapResponse(ctx, meta, data);
      } catch (err) {
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // list_members
  // -----------------------------------------------------------------------
  server.registerTool(
    'list_members',
    {
      description:
        'List members of a PDS/PDSE dataset. Returns the first page of results (default 500, max 1000). ' +
        'Use offset and limit to page through large result sets. ' +
        'The dataset name is resolved against the current DSN prefix. ' +
        'Use single quotes for absolute dataset names.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'PDS/PDSE dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
          ),
        pattern: z
          .string()
          .optional()
          .describe('Optional member name filter pattern (e.g. "CUST*").'),
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
    async ({ dataset, pattern, system, offset, limit }) => {
      log.info('list_members called', { dataset, pattern, system, offset, limit });

      try {
        const { systemId, dsn, wasAbsolute } = await resolveInput(
          deps,
          dataset,
          undefined,
          system,
          log
        );
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const members = await deps.backend.listMembers(systemId, dsn, pattern);

        // Paginate
        const { data, meta } = paginateList(members, offset ?? 0, limit ?? DEFAULT_LIST_LIMIT);

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(dsn),
        });

        return wrapResponse(ctx, meta, data);
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // get_dataset_attributes
  // -----------------------------------------------------------------------
  server.registerTool(
    'get_dataset_attributes',
    {
      description:
        'Get detailed attributes of a dataset: organization, record format, ' +
        'record length, block size, volume, SMS classes, dates, and more.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'Dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
          ),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dataset, system }) => {
      log.info('get_dataset_attributes called', { dataset, system });

      try {
        const { systemId, dsn, wasAbsolute } = await resolveInput(
          deps,
          dataset,
          undefined,
          system,
          log
        );
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const attrs = await deps.backend.getAttributes(systemId, dsn);

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(dsn),
        });

        return wrapResponse(ctx, undefined, attrs);
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // read_dataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'read_dataset',
    {
      description:
        'Read the content of a sequential dataset or PDS/PDSE member. ' +
        'Large files are automatically truncated to the first 2000 lines. ' +
        'Use startLine and lineCount to read specific sections. ' +
        'Returns UTF-8 text, an ETag for optimistic locking, and the source codepage. ' +
        'Pass the ETag to write_dataset to prevent overwriting concurrent changes.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'Dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
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
    async ({ dataset, member, system, codepage, startLine, lineCount }) => {
      log.info('read_dataset called', { dataset, member, system, codepage, startLine, lineCount });

      try {
        const resolved = await resolveInput(deps, dataset, member, system, log);
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

        return wrapResponse(ctx, windowed.meta, {
          text: windowed.text,
          etag: result.etag,
          codepage: result.codepage,
        });
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // write_dataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'write_dataset',
    {
      description:
        'Write UTF-8 content to a sequential dataset or PDS/PDSE member. ' +
        'If an ETag is provided (from a previous read_dataset call), the write ' +
        'fails if the dataset was modified since the read — preventing overwrites. ' +
        'Returns a new ETag for the written content.',
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'Dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
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
          .describe('ETag from a previous read_dataset call for optimistic locking.'),
        codepage: z
          .string()
          .optional()
          .describe('Target codepage for UTF-8-to-EBCDIC conversion (default: "IBM-1047").'),
      },
    },
    async ({ dataset, content, member, system, etag, codepage }) => {
      log.info('write_dataset called', { dataset, member, system, hasEtag: !!etag, codepage });

      try {
        const resolved = await resolveInput(deps, dataset, member, system, log);
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
        return wrapResponse(ctx, mutationMeta, { etag: result.etag });
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // create_dataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'create_dataset',
    {
      description:
        'Create a new sequential or partitioned dataset. Specify the type ' +
        '(PS for sequential, PO for PDS, PO-E for PDSE) and optional attributes.',
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'Dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
          ),
        type: z
          .enum(['PS', 'PO', 'PO-E'])
          .describe('Dataset type: PS (sequential), PO (PDS), or PO-E (PDSE).'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
        recfm: z.string().optional().describe('Record format (e.g. "FB", "VB"). Default: "FB".'),
        lrecl: z.number().optional().describe('Logical record length. Default: 80.'),
        blksz: z.number().optional().describe('Block size. Default: 27920.'),
        primary: z.number().optional().describe('Primary space allocation in tracks.'),
        secondary: z.number().optional().describe('Secondary space allocation in tracks.'),
        dirblk: z.number().optional().describe('Directory blocks (PDS only).'),
      },
    },
    async ({ dataset, type, system, recfm, lrecl, blksz, primary, secondary, dirblk }) => {
      log.info('create_dataset called', { dataset, type, system });

      try {
        const { systemId, dsn, wasAbsolute } = await resolveInput(
          deps,
          dataset,
          undefined,
          system,
          log
        );
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        await deps.backend.createDataset(systemId, dsn, {
          type,
          recfm: recfm as CreateDatasetOptions['recfm'],
          lrecl,
          blksz,
          primary,
          secondary,
          dirblk,
        });

        const ctx = buildContext(systemId, wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(dsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(ctx, mutationMeta, { dsn, type });
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // delete_dataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'delete_dataset',
    {
      description:
        'Delete a dataset or a specific PDS/PDSE member. ' +
        'This is a destructive operation that cannot be undone.',
      annotations: { destructiveHint: true },
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'Dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
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
    async ({ dataset, member, system }) => {
      log.info('delete_dataset called', { dataset, member, system });

      try {
        const resolved = await resolveInput(deps, dataset, member, system, log);
        const prefix = deps.sessionState.getDsnPrefix(resolved.systemId);
        await deps.backend.deleteDataset(resolved.systemId, resolved.dsn, resolved.member);

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;

        const ctx = buildContext(resolved.systemId, resolved.wasAbsolute ? undefined : prefix, {
          resolvedDsn: formatResolved(fullDsn),
        });

        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(ctx, mutationMeta, {
          deleted: fullDsn,
        });
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // copy_dataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'copy_dataset',
    {
      description: 'Copy a dataset or PDS/PDSE member within a single z/OS system.',
      inputSchema: {
        source: z
          .string()
          .describe(
            'Source dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
          ),
        target: z
          .string()
          .describe(
            'Target dataset name. Relative names (e.g. "SRC.BACKUP") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.BACKUP\'").'
          ),
        member: z
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
    async ({ source, target, member, targetMember, system }) => {
      log.info('copy_dataset called', { source, target, member, targetMember, system });

      try {
        const systemId = deps.sessionState.requireSystem(system);
        await ensureContext(deps, systemId);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const resolvedSource = resolveDsn(source, prefix, member);
        const resolvedTarget = resolveDsn(target, prefix, targetMember);
        log.debug('copy_dataset resolved', {
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
        return wrapResponse(ctx, mutationMeta, {
          source: resolvedSource.dsn,
          target: resolvedTarget.dsn,
        });
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // rename_dataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'rename_dataset',
    {
      description: 'Rename a dataset or PDS/PDSE member.',
      inputSchema: {
        dataset: z
          .string()
          .describe(
            'Current dataset name. Relative names (e.g. "SRC.COBOL") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.COBOL\'").'
          ),
        newName: z
          .string()
          .describe(
            'New dataset name. Relative names (e.g. "SRC.NEW") are prefixed with the active DSN prefix. ' +
              'Absolute names must be single-quoted (e.g. "\'IBMUSER.SRC.NEW\'").'
          ),
        member: z
          .string()
          .optional()
          .describe('Current member name (for renaming a member within a PDS/PDSE).'),
        newMemberName: z.string().optional().describe('New member name.'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dataset, newName, member, newMemberName, system }) => {
      log.info('rename_dataset called', { dataset, newName, member, newMemberName, system });

      try {
        const systemId = deps.sessionState.requireSystem(system);
        await ensureContext(deps, systemId);
        const prefix = deps.sessionState.getDsnPrefix(systemId);
        const resolvedOld = resolveDsn(dataset, prefix, member);
        const resolvedNew = resolveDsn(newName, prefix, newMemberName);
        log.debug('rename_dataset resolved', {
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
        return wrapResponse(ctx, mutationMeta, {
          oldName: resolvedOld.dsn,
          newName: resolvedNew.dsn,
        });
      } catch (err) {
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );
}

// Re-export the type for use in create_dataset
import type { CreateDatasetOptions } from '../../zos/backend.js';
