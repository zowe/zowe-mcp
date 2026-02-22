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
 * All dataset names are fully qualified (e.g. USER.SRC.COBOL).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { DatasetEntry, MemberEntry, ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import {
  buildDsUri,
  DsnError,
  resolveDsn,
  resolvePattern,
  validateListPattern,
} from '../../zos/dsn.js';
import { type EncodingOptions, resolveDatasetEncoding } from '../../zos/encoding.js';
import { buildCacheKey, type ResponseCache } from '../../zos/response-cache.js';
import type { SearchCommentType } from '../../zos/search-options.js';
import { buildParmsFromOptions, SEARCH_COMMENT_TYPES } from '../../zos/search-options.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import {
  createToolProgress,
  formatListProgressRange,
  formatReadProgressRange,
} from '../progress.js';
import type { MutationResultMeta } from '../response.js';
import {
  buildContext,
  DEFAULT_LIST_LIMIT,
  formatResolved,
  getListMessages,
  getReadMessages,
  MAX_LIST_LIMIT,
  paginateList,
  paginateSearchResult,
  resolvedOnlyIfDifferent,
  sanitizeTextForDisplay,
  windowContent,
  wrapResponse,
} from '../response.js';

const RESOURCES_DSLEVEL_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'resources',
  'dslevel-pattern.txt'
);

/** Fallback when the packaged resource file is missing (e.g. tests or incomplete build). */
const DSLEVEL_FALLBACK =
  'DSLEVEL pattern: first qualifier literal, max 44 chars. Wildcards: % (one char), * (one qualifier), ** (across qualifiers). No leading wildcard.';

/**
 * DSLEVEL pattern description for dataset list operations (listDatasets).
 * Loaded from the packaged resource file at runtime.
 */
export function getDslevelPatternDescription(): string {
  try {
    return readFileSync(RESOURCES_DSLEVEL_PATH, 'utf-8').trim();
  } catch {
    return DSLEVEL_FALLBACK;
  }
}

/** Dependencies injected into dataset tool registration. */
export interface DatasetToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  /** When set, listDatasets and listMembers use it to cache backend results (avoids repeated backend calls when paginating). */
  responseCache?: ResponseCache;
  /** Default mainframe encodings (MVS datasets, USS). Used when no per-system or per-operation override. */
  encodingOptions: EncodingOptions;
}

/**
 * Ensure a system context exists for the given system ID.
 *
 * When the LLM passes an explicit `system` parameter to a dataset tool
 * without first calling `setSystem`, no context (userId) exists yet.
 * This helper lazily initializes the context using the credential
 * provider, mirroring what `setSystem` does.
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
  const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
  await ensureContext(deps, systemId);
  const resolved = resolveDsn(dsn, member);
  log.debug('resolved input', {
    systemId,
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
  const dslevelDescription = getDslevelPatternDescription();
  server.registerTool(
    'listDatasets',
    {
      description:
        'List datasets matching a DSLEVEL pattern. Results are paginated (default 500, max 1000 per page). ' +
        'When _result.hasMore is true, more items exist—you must call this tool again with offset and limit to get the next page (offset = current offset + _result.count, same limit). ' +
        'Do not answer using only the first page; fetch all pages until _result.hasMore is false. Parameters: offset (0-based), limit (items per page). ' +
        'Set attributes to false for names-only (default true includes dsorg, recfm, lrecl, etc.). ' +
        dslevelDescription,
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsnPattern: z
          .string()
          .describe(
            `Fully qualified dataset list pattern (e.g. USER.* or USER.**). ${dslevelDescription}`
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
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
        attributes: z
          .boolean()
          .optional()
          .default(true)
          .describe(
            'When true (default), include dataset attributes (dsorg, recfm, lrecl, blksz, volser, creationDate). When false, return only dataset names.'
          ),
      },
    },
    async ({ dsnPattern, system, volser, offset, limit, attributes }, extra) => {
      const range = formatListProgressRange(offset, limit, DEFAULT_LIST_LIMIT);
      const title = range
        ? `List datasets matching ${dsnPattern} ${range}`
        : `List datasets matching ${dsnPattern}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      const wantAttrs = attributes ?? true;
      log.info('listDatasets called', { dsnPattern, system, volser, offset, limit, attributes });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);

        const resolvedPattern = resolvePattern(dsnPattern);
        validateListPattern(resolvedPattern);

        log.debug('listDatasets resolved', { systemId, resolvedPattern });

        const userId = deps.sessionState.getContext(systemId)?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => progress.step(msg)
          : undefined;
        const datasets = deps.responseCache
          ? await deps.responseCache.getOrFetch(
              buildCacheKey('listDatasets', {
                systemId,
                userId: userId ?? '',
                pattern: resolvedPattern,
                volser: volser ?? '',
                attributes: wantAttrs ? 'true' : 'false',
              }),
              () =>
                deps.backend.listDatasets(
                  systemId,
                  resolvedPattern,
                  volser,
                  userId,
                  wantAttrs,
                  progressCb
                )
            )
          : await deps.backend.listDatasets(
              systemId,
              resolvedPattern,
              volser,
              userId,
              wantAttrs,
              progressCb
            );

        // Add resource links; output DSN as fully qualified (no quotes)
        const enriched = datasets.map((ds: DatasetEntry) => ({
          ...ds,
          dsn: formatResolved(ds.dsn),
          resourceLink: buildDsUri(systemId, ds.dsn, undefined, ds.volser),
        }));

        // Paginate
        const { data, meta } = paginateList(enriched, offset ?? 0, limit ?? DEFAULT_LIST_LIMIT);

        const ctx = buildContext(systemId, {
          resolvedPattern: resolvedOnlyIfDifferent(resolvedPattern, dsnPattern),
        });

        await progress.complete(`${meta.count} datasets`);
        return wrapResponse(ctx, meta, data, getListMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
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
        'List members of a PDS/PDSE dataset. Results are paginated (default 500, max 1000 per page). ' +
        'When _result.hasMore is true, more members exist—you must call this tool again with offset and limit to get the next page (offset = current offset + _result.count, same limit). ' +
        'Do not answer using only the first page; fetch all pages until _result.hasMore is false. Parameters: offset (0-based), limit (members per page).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        memberPattern: z
          .string()
          .optional()
          .describe(
            'Optional member name filter. Wildcards: * (zero or more characters), % (one character). E.g. "ABC*", "A%C".'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
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
    async ({ dsn, memberPattern, system, offset, limit }, extra) => {
      const range = formatListProgressRange(offset, limit, DEFAULT_LIST_LIMIT);
      const title = range ? `List members of ${dsn} ${range}` : `List members of ${dsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('listMembers called', { dsn, memberPattern, system, offset, limit });

      try {
        const { systemId, dsn: resolvedDsn } = await resolveInput(
          deps,
          dsn,
          undefined,
          system,
          log
        );
        const userId = deps.sessionState.getContext(systemId)?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const members = deps.responseCache
          ? await deps.responseCache.getOrFetch(
              buildCacheKey('listMembers', {
                systemId,
                userId: userId ?? '',
                dsn: resolvedDsn,
                memberPattern: memberPattern ?? '',
              }),
              () => deps.backend.listMembers(systemId, resolvedDsn, memberPattern, progressCb)
            )
          : await deps.backend.listMembers(systemId, resolvedDsn, memberPattern, progressCb);

        // Paginate and map name -> member for response
        const { data: rawData, meta } = paginateList(
          members.map((m: MemberEntry) => ({ member: m.name })),
          offset ?? 0,
          limit ?? DEFAULT_LIST_LIMIT
        );

        const ctx = buildContext(systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(resolvedDsn, dsn),
        });

        await progress.complete(`${meta.count} members found`);
        return wrapResponse(ctx, meta, rawData, getListMessages(meta));
      } catch (err) {
        await progress.complete(err instanceof Error ? err.message : String(err));
        if (err instanceof DsnError) {
          return errorResult(err.message);
        }
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // searchInDataset
  // -----------------------------------------------------------------------
  const searchCommentEnum = z.enum(SEARCH_COMMENT_TYPES as unknown as [string, ...string[]]);
  server.registerTool(
    'searchInDataset',
    {
      description:
        'Search for a string in a sequential dataset or in a PDS/PDSE (all members or one member). ' +
        'Returns matching lines with line numbers and a summary. ' +
        'Results are paginated by member (offset/limit); when _result.hasMore is true, call again with the next offset and limit. ' +
        'Full result is cached so paging does not re-run the search. ' +
        'Options: caseSensitive (default false), cobol (ignore cols 1–6), ignoreSequenceNumbers, doNotProcessComments (asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada).',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z
          .string()
          .describe('Fully qualified dataset name (e.g. USER.SRC.COBOL or SYS1.SAMPLIB).'),
        string: z.string().describe('Search string (literal) to find in the dataset or members.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
        encoding: z
          .string()
          .optional()
          .describe(
            'Mainframe encoding (EBCDIC) for reading dataset content. Overrides system and server default when set.'
          ),
        member: z
          .string()
          .optional()
          .describe(
            'For PDS/PDSE only, limit search to this member (e.g. IEANTCOB). Omit to search all members or a sequential dataset.'
          ),
        offset: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('0-based offset into the member list. Default: 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(MAX_LIST_LIMIT)
          .optional()
          .describe(
            `Number of members to return per page. Default: ${DEFAULT_LIST_LIMIT}. Max: ${MAX_LIST_LIMIT}.`
          ),
        caseSensitive: z
          .boolean()
          .optional()
          .describe('When true, match exact case. Default false (case-insensitive).'),
        cobol: z
          .boolean()
          .optional()
          .describe('When true, ignore columns 1–6 (COBOL sequence numbers). Default: false.'),
        ignoreSequenceNumbers: z
          .boolean()
          .optional()
          .describe(
            'When true (default), ignore cols 73–80 as sequence numbers. When false, treat as data.'
          ),
        doNotProcessComments: z
          .array(searchCommentEnum)
          .optional()
          .describe(
            'Comment types to exclude from search: asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada.'
          ),
      },
    },
    async (
      {
        dsn,
        string: searchString,
        system,
        encoding,
        member,
        offset,
        limit,
        caseSensitive,
        cobol,
        ignoreSequenceNumbers,
        doNotProcessComments,
      },
      extra
    ) => {
      const range = formatListProgressRange(offset, limit, DEFAULT_LIST_LIMIT);
      const title = range ? `Search in ${dsn} ${range}` : `Search in ${dsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('searchInDataset called', {
        dsn,
        string: searchString,
        system,
        encoding,
        member,
        offset,
        limit,
      });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const systemCtx = deps.sessionState.getContext(resolved.systemId);
        const resolvedEncoding = resolveDatasetEncoding(
          encoding,
          systemCtx?.mainframeMvsEncoding,
          deps.encodingOptions.defaultMainframeMvsEncoding
        );
        const parms = buildParmsFromOptions({
          caseSensitive,
          cobol,
          ignoreSequenceNumbers,
          doNotProcessComments: doNotProcessComments as SearchCommentType[] | undefined,
        });

        const searchOptions = {
          string: searchString,
          member: resolved.member,
          parms,
          encoding: resolvedEncoding,
        };

        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const fullResult = deps.responseCache
          ? await deps.responseCache.getOrFetch(
              buildCacheKey('searchInDataset', {
                systemId: resolved.systemId,
                dsn: resolved.dsn,
                member: resolved.member ?? '',
                string: searchString,
                parms,
                encoding: resolvedEncoding,
              }),
              () =>
                deps.backend.searchInDataset(
                  resolved.systemId,
                  resolved.dsn,
                  searchOptions,
                  progressCb
                )
            )
          : await deps.backend.searchInDataset(
              resolved.systemId,
              resolved.dsn,
              searchOptions,
              progressCb
            );

        const { members: slicedMembers, meta } = paginateSearchResult(
          fullResult,
          offset ?? 0,
          limit ?? DEFAULT_LIST_LIMIT
        );

        // Sanitize match content just before returning (single point for unprintable → '.')
        const sanitizedMembers = slicedMembers.map(m => ({
          name: m.name,
          matches: m.matches.map(mat => ({
            lineNumber: mat.lineNumber,
            content: sanitizeTextForDisplay(mat.content),
          })),
        }));

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;
        const rawInputDsn = member ? `${dsn.trim()}(${member.trim()})` : dsn.trim();
        const responseCtx = buildContext(resolved.systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(fullDsn, rawInputDsn),
        });

        const matchCount = fullResult.summary.linesFound;
        await progress.complete(`${matchCount} matches`);
        return wrapResponse(
          responseCtx,
          meta,
          {
            dataset: fullResult.dataset,
            members: sanitizedMembers,
            summary: fullResult.summary,
          },
          getListMessages(meta)
        );
      } catch (err) {
        await progress.complete(err instanceof Error ? err.message : String(err));
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
        'record length, block size, volume, SMS classes, dates, and more.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
      },
    },
    async ({ dsn, system }, extra) => {
      const title = `Get attributes of ${dsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('getDatasetAttributes called', { dsn, system });

      try {
        const { systemId, dsn: resolvedDsn } = await resolveInput(
          deps,
          dsn,
          undefined,
          system,
          log
        );
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const attrs = await deps.backend.getAttributes(systemId, resolvedDsn, progressCb);

        const ctx = buildContext(systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(resolvedDsn, dsn),
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

        await progress.complete('done');
        return wrapResponse(ctx, undefined, data, []);
      } catch (err) {
        await progress.complete(err instanceof Error ? err.message : String(err));
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
        'Results are paginated by lines. When _result.hasMore is true, more lines exist—you must call this tool again with startLine and lineCount to get the next page. ' +
        'Do not answer using only the first page; fetch until _result.hasMore is false. ' +
        'Large files are automatically truncated to the first 2000 lines when no window is requested. ' +
        'Returns UTF-8 text, an ETag for optimistic locking, and the source encoding. ' +
        'Pass the ETag to writeDataset to prevent overwriting concurrent changes.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        member: z.string().optional().describe('Member name for PDS/PDSE datasets.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
        encoding: z
          .string()
          .optional()
          .describe(
            'Mainframe encoding (EBCDIC) for this read. Overrides system and server default when set. Default: from system or MCP server default.'
          ),
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
    async ({ dsn, member, system, encoding, startLine, lineCount }, extra) => {
      const displayDsn = member ? `${dsn}(${member})` : dsn;
      const range = formatReadProgressRange(startLine, lineCount);
      const title = range ? `Read ${displayDsn} ${range}` : `Read ${displayDsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('readDataset called', {
        dsn,
        member,
        system,
        encoding,
        startLine,
        lineCount,
      });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const systemCtx = deps.sessionState.getContext(resolved.systemId);
        const userId = systemCtx?.userId ?? '';
        const resolvedEncoding = resolveDatasetEncoding(
          encoding,
          systemCtx?.mainframeMvsEncoding,
          deps.encodingOptions.defaultMainframeMvsEncoding
        );

        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = deps.responseCache
          ? await deps.responseCache.getOrFetch(
              buildCacheKey('readDataset', {
                systemId: resolved.systemId,
                userId,
                dsn: resolved.dsn,
                member: resolved.member ?? '',
                encoding: resolvedEncoding,
              }),
              () =>
                deps.backend.readDataset(
                  resolved.systemId,
                  resolved.dsn,
                  resolved.member,
                  resolvedEncoding,
                  progressCb
                )
            )
          : await deps.backend.readDataset(
              resolved.systemId,
              resolved.dsn,
              resolved.member,
              resolvedEncoding,
              progressCb
            );

        const sanitized = sanitizeTextForDisplay(result.text);
        const windowed = windowContent(sanitized, startLine, lineCount);

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;
        const rawInputDsn = member ? `${dsn.trim()}(${member.trim()})` : dsn.trim();

        const responseCtx = buildContext(resolved.systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(fullDsn, rawInputDsn),
        });

        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { startLine: s, returnedLines: r, totalLines: total } = windowed.meta;
        await progress.complete(`${r} records`);
        return wrapResponse(
          responseCtx,
          windowed.meta,
          {
            text: windowed.text,
            etag: result.etag,
            encoding: result.encoding,
          },
          getReadMessages(windowed.meta)
        );
      } catch (err) {
        await progress.complete(err instanceof Error ? err.message : String(err));
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
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        content: z.string().describe('UTF-8 text content to write.'),
        member: z.string().optional().describe('Member name for PDS/PDSE datasets.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
        etag: z
          .string()
          .optional()
          .describe('ETag from a previous readDataset call for optimistic locking.'),
        encoding: z
          .string()
          .optional()
          .describe(
            'Mainframe encoding (EBCDIC) for this write. Overrides system and server default when set. Default: from system or MCP server default.'
          ),
      },
    },
    async ({ dsn, content, member, system, etag, encoding }, extra) => {
      const displayDsn = member ? `${dsn}(${member})` : dsn;
      const title = `Write to ${displayDsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('writeDataset called', {
        dsn,
        member,
        system,
        hasEtag: !!etag,
        encoding,
      });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const systemCtx = deps.sessionState.getContext(resolved.systemId);
        const resolvedEncoding = resolveDatasetEncoding(
          encoding,
          systemCtx?.mainframeMvsEncoding,
          deps.encodingOptions.defaultMainframeMvsEncoding
        );
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.writeDataset(
          resolved.systemId,
          resolved.dsn,
          content,
          resolved.member,
          etag,
          resolvedEncoding,
          progressCb
        );

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;
        const rawInputDsn = member ? `${dsn.trim()}(${member.trim()})` : dsn.trim();

        const responseCtx = buildContext(resolved.systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(fullDsn, rawInputDsn),
        });

        await progress.complete('written');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(responseCtx, mutationMeta, { etag: result.etag }, []);
      } catch (err) {
        await progress.complete(err instanceof Error ? err.message : String(err));
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
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        type: z
          .enum(['PS', 'PO', 'PO-E', 'SEQUENTIAL', 'PDS', 'PDSE', 'LIBRARY'])
          .describe(
            'Dataset type: PS or SEQUENTIAL (sequential), PO or PDS (PDS), PO-E or PDSE or LIBRARY (PDSE).'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
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
    async ({ dsn, type, system, recfm, lrecl, blksz, primary, secondary, dirblk }, extra) => {
      const title = `Create dataset ${dsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
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
        const { systemId, dsn: resolvedDsn } = await resolveInput(
          deps,
          dsn,
          undefined,
          system,
          log
        );
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.createDataset(
          systemId,
          resolvedDsn,
          {
            type: canonicalType,
            recfm: recfm as CreateDatasetOptions['recfm'],
            lrecl,
            blksz,
            primary,
            secondary,
            dirblk,
          },
          progressCb
        );

        const ctx = buildContext(systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(resolvedDsn, dsn),
        });

        await progress.complete('created');
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
        await progress.complete(err instanceof Error ? err.message : String(err));
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
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        member: z
          .string()
          .optional()
          .describe('Member name to delete (if omitting, the entire dataset is deleted).'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
      },
    },
    async ({ dsn, member, system }, extra) => {
      const displayDsn = member ? `${dsn}(${member})` : dsn;
      const title = `Delete ${displayDsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('deleteDataset called', { dsn, member, system });

      try {
        const resolved = await resolveInput(deps, dsn, member, system, log);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        await deps.backend.deleteDataset(
          resolved.systemId,
          resolved.dsn,
          resolved.member,
          progressCb
        );

        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;
        const rawInputDsn = member ? `${dsn.trim()}(${member.trim()})` : dsn.trim();

        const ctx = buildContext(resolved.systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(fullDsn, rawInputDsn),
        });

        await progress.complete('deleted');
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
        await progress.complete(err instanceof Error ? err.message : String(err));
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
          .describe('Fully qualified source dataset name (e.g. USER.SRC.COBOL).'),
        targetDsn: z
          .string()
          .describe('Fully qualified target dataset name (e.g. USER.SRC.BACKUP).'),
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
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
      },
    },
    async ({ sourceDsn, targetDsn, sourceMember, targetMember, system }, extra) => {
      const title = `Copy ${sourceDsn} to ${targetDsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('copyDataset called', {
        sourceDsn,
        targetDsn,
        sourceMember,
        targetMember,
        system,
      });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const resolvedSource = resolveDsn(sourceDsn, sourceMember);
        const resolvedTarget = resolveDsn(targetDsn, targetMember);
        log.debug('copyDataset resolved', {
          systemId,
          source: resolvedSource.dsn,
          target: resolvedTarget.dsn,
          sourceMember: resolvedSource.member,
          targetMember: resolvedTarget.member,
        });

        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        await deps.backend.copyDataset(
          systemId,
          resolvedSource.dsn,
          resolvedTarget.dsn,
          resolvedSource.member,
          resolvedTarget.member,
          progressCb
        );

        const rawSource = sourceMember
          ? `${sourceDsn.trim()}(${sourceMember.trim()})`
          : sourceDsn.trim();
        const rawTarget = targetMember
          ? `${targetDsn.trim()}(${targetMember.trim()})`
          : targetDsn.trim();
        const sourceFull =
          resolvedSource.member !== undefined
            ? `${resolvedSource.dsn}(${resolvedSource.member})`
            : resolvedSource.dsn;
        const targetFull =
          resolvedTarget.member !== undefined
            ? `${resolvedTarget.dsn}(${resolvedTarget.member})`
            : resolvedTarget.dsn;

        const ctx = buildContext(systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(sourceFull, rawSource),
          resolvedTargetDsn: resolvedOnlyIfDifferent(targetFull, rawTarget),
        });

        await progress.complete('copied');
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
        await progress.complete(err instanceof Error ? err.message : String(err));
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
        dsn: z.string().describe('Fully qualified dataset name (e.g. USER.SRC.COBOL).'),
        newDsn: z.string().describe('Fully qualified new dataset name (e.g. USER.SRC.NEW).'),
        member: z
          .string()
          .optional()
          .describe('Current member name (for renaming a member within a PDS/PDSE).'),
        newMember: z.string().optional().describe('New member name.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname (e.g. sys1.example.com or sys1 when unambiguous). Defaults to the active system.'
          ),
      },
    },
    async ({ dsn, newDsn, member, newMember, system }, extra) => {
      const title = `Rename ${dsn} to ${newDsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('renameDataset called', { dsn, newDsn, member, newMember, system });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const resolvedOld = resolveDsn(dsn, member);
        const resolvedNew = resolveDsn(newDsn, newMember);
        log.debug('renameDataset resolved', {
          systemId,
          oldDsn: resolvedOld.dsn,
          newDsn: resolvedNew.dsn,
          oldMember: resolvedOld.member,
          newMember: resolvedNew.member,
        });

        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        await deps.backend.renameDataset(
          systemId,
          resolvedOld.dsn,
          resolvedNew.dsn,
          resolvedOld.member,
          resolvedNew.member,
          progressCb
        );

        const rawOld = member ? `${dsn.trim()}(${member.trim()})` : dsn.trim();
        const rawNew = newMember ? `${newDsn.trim()}(${newMember.trim()})` : newDsn.trim();
        const oldFull =
          resolvedOld.member !== undefined
            ? `${resolvedOld.dsn}(${resolvedOld.member})`
            : resolvedOld.dsn;
        const newFull =
          resolvedNew.member !== undefined
            ? `${resolvedNew.dsn}(${resolvedNew.member})`
            : resolvedNew.dsn;

        const ctx = buildContext(systemId, {
          resolvedDsn: resolvedOnlyIfDifferent(oldFull, rawOld),
          resolvedTargetDsn: resolvedOnlyIfDifferent(newFull, rawNew),
        });

        await progress.complete('renamed');
        const mutationMeta: MutationResultMeta = { success: true };
        const oldDisplay = resolvedOld.member
          ? `${resolvedOld.dsn}(${resolvedOld.member})`
          : resolvedOld.dsn;
        const newDisplay = resolvedNew.member
          ? `${resolvedNew.dsn}(${resolvedNew.member})`
          : resolvedNew.dsn;
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            oldName: formatResolved(oldDisplay),
            newName: formatResolved(newDisplay),
          },
          []
        );
      } catch (err) {
        await progress.complete(err instanceof Error ? err.message : String(err));
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
