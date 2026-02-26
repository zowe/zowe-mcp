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
 * Data set tools for the Zowe MCP Server.
 *
 * Provides tools for listing, reading, writing, creating, deleting,
 * copying, and renaming z/OS data sets and PDS/PDSE members.
 *
 * All data set names are fully qualified (e.g. USER.SRC.COBOL).
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
  parseDsnAndMember,
  resolveDsn,
  resolvePattern,
  validateListPattern,
} from '../../zos/dsn.js';
import { resolveDatasetEncoding, type EncodingOptions } from '../../zos/encoding.js';
import {
  buildCacheKey,
  buildScopeDsn,
  buildScopeMember,
  buildScopeSystem,
  type ResponseCache,
} from '../../zos/response-cache.js';
import { buildParmsFromOptions, SEARCH_COMMENT_TYPES } from '../../zos/search-options.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import {
  deleteDatasetsUnderPrefix as deleteDatasetsUnderPrefixInternal,
  ensureUniqueDsn,
  ensureUniquePrefix,
  REQUIRED_SAFETY_QUALIFIER,
} from '../../zos/temp-dsn.js';
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
  linesToText,
  MAX_LIST_LIMIT,
  paginateList,
  paginateSearchResult,
  resolvedOnlyIfDifferent,
  sanitizeTextForDisplay,
  textToLines,
  windowContent,
  wrapResponse,
} from '../response.js';
import { datasetTypeSchema, enumInsensitiveLower, recfmSchema } from '../schema-utils.js';
import { applyCacheAfterMutation } from './dataset-cache.js';
import {
  copyDatasetOutputSchema,
  createDatasetOutputSchema,
  createTempDatasetOutputSchema,
  deleteDatasetOutputSchema,
  deleteDatasetsUnderPrefixOutputSchema,
  getDatasetAttributesOutputSchema,
  getTempDatasetNameOutputSchema,
  getTempDatasetPrefixOutputSchema,
  listDatasetsOutputSchema,
  listMembersOutputSchema,
  readDatasetOutputSchema,
  renameDatasetOutputSchema,
  searchInDatasetOutputSchema,
  writeDatasetOutputSchema,
} from './dataset-output-schemas.js';

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
 * DSLEVEL pattern description for data set list operations (listDatasets).
 * Loaded from the packaged resource file at runtime.
 */
export function getDslevelPatternDescription(): string {
  try {
    return readFileSync(RESOURCES_DSLEVEL_PATH, 'utf-8').trim();
  } catch {
    return DSLEVEL_FALLBACK;
  }
}

/** Dependencies injected into data set tool registration. */
export interface DatasetToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  /** When set, listDatasets and listMembers use it to cache backend results (avoids repeated backend calls when paginating). */
  responseCache?: ResponseCache;
  /** Default mainframe encodings (MVS data sets, USS). Used when no per-system or per-operation override. */
  encodingOptions: EncodingOptions;
}

/**
 * Ensure a system context exists for the given system ID.
 *
 * When the LLM passes an explicit `system` parameter to a data set tool
 * without first calling `setSystem`, no context (userId) exists yet.
 * This helper lazily initializes the context using the credential
 * provider, mirroring what `setSystem` does.
 */
async function ensureContext(
  deps: DatasetToolDeps,
  systemId: string,
  userId?: string
): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId, userId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

/**
 * Helper to resolve a data set name and system from tool input.
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
  const resolvedSystem = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
  await ensureContext(deps, resolvedSystem.systemId, resolvedSystem.userId);
  const parsed = parseDsnAndMember(dsn);
  const hasExplicitMember = member !== undefined && member.trim().length > 0;
  const effectiveDsn = parsed.dsn;
  const effectiveMember = hasExplicitMember ? member : parsed.member;
  const resolved = resolveDsn(effectiveDsn, effectiveMember);
  log.debug('resolved input', {
    systemId: resolvedSystem.systemId,
    dsn: resolved.dsn,
    member: resolved.member,
  });
  return { systemId: resolvedSystem.systemId, ...resolved };
}

/** Format an error for LLM consumption. */
function errorResult(message: string) {
  return {
    content: [{ type: 'text' as const, text: message }],
    isError: true,
  };
}

/**
 * Registers all data set tools on the given MCP server.
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
        'List data sets matching a DSLEVEL pattern. Results are paginated (default 500, max 1000 per page). ' +
        'When _result.hasMore is true, more items exist—you must call this tool again with offset and limit to get the next page (offset = current offset + _result.count, same limit). ' +
        'Do not answer using only the first page; fetch all pages until _result.hasMore is false. Parameters: offset (0-based), limit (items per page). ' +
        'Set attributes to false for names-only (default true includes dsorg, recfm, lrecl, etc.). ' +
        dslevelDescription,
      annotations: { readOnlyHint: true },
      outputSchema: listDatasetsOutputSchema,
      inputSchema: {
        dsnPattern: z
          .string()
          .describe(
            `Fully qualified data set list pattern (e.g. USER.* or USER.**). ${dslevelDescription}`
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
          ),
        volser: z.string().optional().describe('Volume serial for uncataloged data sets.'),
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
            'When true (default), include data set attributes (dsorg, recfm, lrecl, blksz, volser, creationDate). When false, return only data set names.'
          ),
      },
    },
    async ({ dsnPattern, system, volser, offset, limit, attributes }, extra) => {
      const range = formatListProgressRange(offset, limit, DEFAULT_LIST_LIMIT);
      const title = range
        ? `List data sets matching ${dsnPattern} ${range}`
        : `List data sets matching ${dsnPattern}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      const wantAttrs = attributes ?? true;
      log.info('listDatasets called', { dsnPattern, system, volser, offset, limit, attributes });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const resolvedPattern = resolvePattern(dsnPattern);
        validateListPattern(resolvedPattern);

        log.debug('listDatasets resolved', { systemId, resolvedPattern });

        const userId = deps.sessionState.getContext(systemId)?.userId ?? resolvedUserId ?? '';
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
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
                ),
              [buildScopeSystem(systemId)]
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

        await progress.complete(`${meta.count} data sets`);
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
        'List members of a PDS/PDSE data set. Results are paginated (default 500, max 1000 per page). ' +
        'When _result.hasMore is true, more members exist—you must call this tool again with offset and limit to get the next page (offset = current offset + _result.count, same limit). ' +
        'Do not answer using only the first page; fetch all pages until _result.hasMore is false. Parameters: offset (0-based), limit (members per page).',
      annotations: { readOnlyHint: true },
      outputSchema: listMembersOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
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
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
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
        const userId = deps.sessionState.getContext(systemId)?.userId ?? '';
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
              () => deps.backend.listMembers(systemId, resolvedDsn, memberPattern, progressCb),
              [buildScopeDsn(systemId, resolvedDsn)]
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
  const searchCommentSchema = enumInsensitiveLower(SEARCH_COMMENT_TYPES);
  server.registerTool(
    'searchInDataset',
    {
      description:
        'When the response has _result.hasMore true, you must call again with offset and limit (e.g. offset=500, limit=500) before giving a final count or answer—do not answer with only the first page. ' +
        'Search for a string in a sequential data set or in a PDS/PDSE (all members or one member). ' +
        'Returns matching lines with line numbers and a summary. ' +
        'Results are paginated by member (offset/limit); when _result.hasMore is true, call again with the next offset and limit. ' +
        'Options: caseSensitive (default false), cobol (ignore cols 1–6), ignoreSequenceNumbers, doNotProcessComments (asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada). ' +
        'You may pass dsn as USER.LIB(MEM) and omit member.',
      annotations: { readOnlyHint: true },
      outputSchema: searchInDatasetOutputSchema,
      inputSchema: {
        dsn: z
          .string()
          .describe('Fully qualified data set name (e.g. USER.SRC.COBOL or SYS1.SAMPLIB).'),
        string: z.string().describe('Search string (literal) to find in the data set or members.'),
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
            'Mainframe encoding (EBCDIC) for reading data set content. Overrides system and server default when set.'
          ),
        member: z
          .string()
          .optional()
          .describe(
            'For PDS/PDSE only, limit search to this member (e.g. IEANTCOB). Omit to search all members or a sequential data set.'
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
          .array(searchCommentSchema)
          .optional()
          .describe(
            'Comment types to exclude from search: asterisk, cobolComment, fortran, cpp, pli, pascal, pcAssembly, ada (case-insensitive).'
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
          doNotProcessComments: doNotProcessComments,
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
                ),
              [buildScopeDsn(resolved.systemId, resolved.dsn)]
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
        'Get detailed attributes of a data set: organization, record format, ' +
        'record length, block size, volume, SMS classes, dates, and more. ' +
        'You may pass dsn as USER.LIB(MEM) and omit member.',
      annotations: { readOnlyHint: true },
      outputSchema: getDatasetAttributesOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
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
        'Read the content of a sequential data set or PDS/PDSE member. ' +
        'Results are paginated by lines. When _result.hasMore is true, more lines exist—you must call this tool again with startLine and lineCount to get the next page. ' +
        'Do not answer using only the first page; fetch until _result.hasMore is false. ' +
        'Large files are automatically truncated to the first 2000 lines when no window is requested. ' +
        'Returns UTF-8 text, an ETag for optimistic locking, and the source encoding. ' +
        'Pass the ETag to writeDataset to prevent overwriting concurrent changes. ' +
        'You may pass dsn as USER.LIB(MEM) and omit member.',
      annotations: { readOnlyHint: true },
      outputSchema: readDatasetOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        member: z.string().optional().describe('Member name for PDS/PDSE data sets.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
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
                ),
              [
                buildScopeDsn(resolved.systemId, resolved.dsn),
                buildScopeMember(resolved.systemId, resolved.dsn, resolved.member ?? ''),
              ]
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
        const lines = textToLines(windowed.text);
        return wrapResponse(
          responseCtx,
          windowed.meta,
          {
            lines,
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
        'Write UTF-8 content to a sequential data set or PDS/PDSE member. ' +
        'When startLine and endLine are provided, the block of records from startLine to endLine (inclusive) is replaced by the given lines; the number of lines need not match (data set can grow or shrink). ' +
        'When only startLine is provided, the same number of lines as in the lines array are replaced starting at startLine. ' +
        'When both are omitted, the entire data set or member is replaced. ' +
        'If an ETag is provided (from a previous readDataset call), the write ' +
        'fails if the data set was modified since the read — preventing overwrites. ' +
        'Returns a new ETag for the written content. ' +
        'You may pass dsn as USER.LIB(MEM) and omit member.',
      outputSchema: writeDatasetOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        lines: z
          .array(z.string())
          .describe('UTF-8 content to write as an array of lines (one string per record).'),
        member: z.string().optional().describe('Member name for PDS/PDSE data sets.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
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
        startLine: z
          .number()
          .optional()
          .describe(
            '1-based first line of the block to replace; use with endLine to replace a range (content line count can differ).'
          ),
        endLine: z
          .number()
          .optional()
          .describe(
            '1-based last line of the block to replace (inclusive). When provided with startLine, the replaced block can grow or shrink to match the number of lines in the lines array.'
          ),
      },
    },
    async ({ dsn, lines, member, system, etag, encoding, startLine, endLine }, extra) => {
      const content = linesToText(lines ?? []);
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
          startLine,
          endLine,
          progressCb
        );

        if (deps.responseCache) {
          const userId = deps.sessionState.getContext(resolved.systemId)?.userId ?? '';
          const partialReplace = startLine != null || endLine != null;
          applyCacheAfterMutation(deps.responseCache, 'write', {
            systemId: resolved.systemId,
            userId,
            dsn: resolved.dsn,
            member: resolved.member,
            content: partialReplace ? undefined : content,
            encoding: resolvedEncoding,
            etag: result.etag,
            partialReplace,
          });
        }

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
  // getTempDatasetPrefix
  // -----------------------------------------------------------------------
  server.registerTool(
    'getTempDatasetPrefix',
    {
      description:
        'For automation and testing. Returns a unique DSN prefix (HLQ) under which temporary data sets can be created. ' +
        `The prefix is verified not to exist on the system. Default is current user + .${REQUIRED_SAFETY_QUALIFIER} (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}.XXXXXXXX.YYYYYYYY); configurable via parameters.`,
      annotations: { readOnlyHint: true },
      outputSchema: getTempDatasetPrefixOutputSchema,
      inputSchema: {
        prefix: z
          .string()
          .optional()
          .describe(
            `HLQ for temp names (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}). Default: current user on the target system + .${REQUIRED_SAFETY_QUALIFIER}.`
          ),
        suffix: z
          .string()
          .optional()
          .describe('Optional suffix qualifier (last part of the generated prefix).'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
      },
    },
    async ({ prefix, suffix, system }, extra) => {
      const title = 'Get temp data set prefix';
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('getTempDatasetPrefix called', { prefix, suffix, system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const userId = deps.sessionState.getContext(systemId)?.userId ?? resolvedUserId ?? '';
        const effectivePrefix = prefix?.trim()
          ? prefix.trim().toUpperCase()
          : `${userId}.${REQUIRED_SAFETY_QUALIFIER}`;
        if (!userId && !prefix?.trim()) {
          throw new Error(
            'No active user for system; set system first or pass prefix explicitly.'
          );
        }
        const resultPrefix = await ensureUniquePrefix(
          deps.backend,
          systemId,
          effectivePrefix,
          userId
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('prefix ready');
        return wrapResponse(ctx, { success: true }, { tempDsnPrefix: resultPrefix }, []);
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
  // getTempDatasetName
  // -----------------------------------------------------------------------
  server.registerTool(
    'getTempDatasetName',
    {
      description:
        'Returns a single unique full temporary data set name (for one data set). ' +
        'The DSN is verified not to exist on the system. Same prefix/suffix defaults as getTempDatasetPrefix.',
      annotations: { readOnlyHint: true },
      outputSchema: getTempDatasetNameOutputSchema,
      inputSchema: {
        prefix: z
          .string()
          .optional()
          .describe(
            `HLQ for temp names (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}). Default: current user on the target system + .${REQUIRED_SAFETY_QUALIFIER}.`
          ),
        suffix: z
          .string()
          .optional()
          .describe('Optional suffix qualifier for the generated prefix.'),
        qualifier: z
          .string()
          .optional()
          .describe(
            'Last qualifier for the DSN (e.g. DATA, 1–8 chars). If omitted, a unique qualifier is generated.'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
      },
    },
    async ({ prefix, suffix: _suffix, qualifier, system }, extra) => {
      const title = 'Get temp data set name';
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('getTempDatasetName called', { prefix, qualifier, system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const userId = deps.sessionState.getContext(systemId)?.userId ?? resolvedUserId ?? '';
        const effectivePrefix = prefix?.trim()
          ? prefix.trim().toUpperCase()
          : `${userId}.${REQUIRED_SAFETY_QUALIFIER}`;
        if (!userId && !prefix?.trim()) {
          throw new Error(
            'No active user for system; set system first or pass prefix explicitly.'
          );
        }
        const dsn = await ensureUniqueDsn(
          deps.backend,
          systemId,
          effectivePrefix,
          qualifier?.trim() ?? undefined
        );
        const ctx = buildContext(systemId, {});
        await progress.complete('DSN ready');
        return wrapResponse(ctx, { success: true }, { tempDsn: formatResolved(dsn) }, []);
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
        'Create a new sequential or partitioned data set. Specify the type ' +
        '(PS/SEQUENTIAL, PO/PDS, PO-E/PDSE/LIBRARY) and optional attributes. ' +
        'Use primarySpace, secondarySpace, blockSize (Zowe CLI naming). Type and recfm are case-insensitive.',
      outputSchema: createDatasetOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        type: datasetTypeSchema.describe(
          'Dataset type: PS or SEQUENTIAL (sequential), PO or PDS (PDS), PO-E or PDSE or LIBRARY (PDSE). Case-insensitive.'
        ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
          ),
        recfm: recfmSchema
          .optional()
          .describe(
            'Record format. Supported: F, FB, V, VB, U, FBA, VBA. Default: FB. Case-insensitive.'
          ),
        lrecl: z.number().optional().describe('Logical record length. Default: 80.'),
        blockSize: z.number().optional().describe('Block size. Default: 27920.'),
        primarySpace: z.number().optional().describe('Primary space allocation.'),
        secondarySpace: z.number().optional().describe('Secondary space allocation.'),
        dirblk: z.number().optional().describe('Directory blocks (PDS only).'),
      },
    },
    async (
      { dsn, type, system, recfm, lrecl, blockSize, primarySpace, secondarySpace, dirblk },
      extra
    ) => {
      const title = `Create data set ${dsn}`;
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
            blksz: blockSize,
            primary: primarySpace,
            secondary: secondarySpace,
            dirblk,
          },
          progressCb
        );

        if (deps.responseCache) {
          const userId = deps.sessionState.getContext(systemId)?.userId ?? '';
          applyCacheAfterMutation(deps.responseCache, 'create', {
            systemId,
            userId,
            dsn: resolvedDsn,
          });
        }

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
  // createTempDataset
  // -----------------------------------------------------------------------
  server.registerTool(
    'createTempDataset',
    {
      description:
        'Creates a new data set with a unique temporary name in a single call. ' +
        `Returns the created DSN for subsequent steps or cleanup. Same creation options as createDataset; optional prefix/suffix/qualifier for naming. Default prefix: current user + .${REQUIRED_SAFETY_QUALIFIER}. ` +
        'Use primarySpace, secondarySpace, blockSize (Zowe CLI naming). Type and recfm are case-insensitive.',
      outputSchema: createTempDatasetOutputSchema,
      inputSchema: {
        type: datasetTypeSchema.describe(
          'Dataset type: PS or SEQUENTIAL (sequential), PO or PDS (PDS), PO-E or PDSE or LIBRARY (PDSE). Case-insensitive.'
        ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
        prefix: z
          .string()
          .optional()
          .describe(
            `HLQ for temp name (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}). Default: current user + .${REQUIRED_SAFETY_QUALIFIER}.`
          ),
        suffix: z
          .string()
          .optional()
          .describe('Optional suffix qualifier for the generated prefix.'),
        qualifier: z
          .string()
          .optional()
          .describe(
            'Last qualifier for the DSN (1–8 chars). If omitted, a unique qualifier is generated.'
          ),
        recfm: recfmSchema
          .optional()
          .describe(
            'Record format. Supported: F, FB, V, VB, U, FBA, VBA. Default: FB. Case-insensitive.'
          ),
        lrecl: z.number().optional().describe('Logical record length. Default: 80.'),
        blockSize: z.number().optional().describe('Block size. Default: 27920.'),
        primarySpace: z.number().optional().describe('Primary space allocation.'),
        secondarySpace: z.number().optional().describe('Secondary space allocation.'),
        dirblk: z.number().optional().describe('Directory blocks (PDS only).'),
      },
    },
    async (
      {
        type,
        system,
        prefix,
        suffix: _suffix,
        qualifier,
        recfm,
        lrecl,
        blockSize,
        primarySpace,
        secondarySpace,
        dirblk,
      },
      extra
    ) => {
      const title = 'Create temp data set';
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('createTempDataset called', { type, system, prefix });

      const canonicalType: CreateDatasetOptions['type'] =
        type === 'SEQUENTIAL'
          ? 'PS'
          : type === 'PDS'
            ? 'PO'
            : type === 'PDSE' || type === 'LIBRARY'
              ? 'PO-E'
              : type;

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const userId = deps.sessionState.getContext(systemId)?.userId ?? resolvedUserId ?? '';
        const effectivePrefix = prefix?.trim()
          ? prefix.trim().toUpperCase()
          : `${userId}.${REQUIRED_SAFETY_QUALIFIER}`;
        if (!userId && !prefix?.trim()) {
          throw new Error(
            'No active user for system; set system first or pass prefix explicitly.'
          );
        }
        const dsn = await ensureUniqueDsn(
          deps.backend,
          systemId,
          effectivePrefix,
          qualifier?.trim() ?? undefined
        );
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.createDataset(
          systemId,
          dsn,
          {
            type: canonicalType,
            recfm: recfm as CreateDatasetOptions['recfm'],
            lrecl,
            blksz: blockSize,
            primary: primarySpace,
            secondary: secondarySpace,
            dirblk,
          },
          progressCb
        );

        if (deps.responseCache) {
          applyCacheAfterMutation(deps.responseCache, 'create', {
            systemId,
            userId,
            dsn,
          });
        }

        const ctx = buildContext(systemId, {});
        await progress.complete('created');
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(
          ctx,
          mutationMeta,
          {
            dsn: formatResolved(dsn),
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
        'Delete a data set or a specific PDS/PDSE member. ' +
        'This is a destructive operation that cannot be undone. ' +
        'You may pass dsn as USER.LIB(MEM) and omit member.',
      annotations: { destructiveHint: true },
      outputSchema: deleteDatasetOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        member: z
          .string()
          .optional()
          .describe('Member name to delete (if omitting, the entire data set is deleted).'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
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

        if (deps.responseCache) {
          const userId = deps.sessionState.getContext(resolved.systemId)?.userId ?? '';
          applyCacheAfterMutation(deps.responseCache, 'delete', {
            systemId: resolved.systemId,
            userId,
            dsn: resolved.dsn,
            member: resolved.member,
          });
        }

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
  // deleteDatasetsUnderPrefix
  // -----------------------------------------------------------------------
  server.registerTool(
    'deleteDatasetsUnderPrefix',
    {
      description:
        'Destructive. Deletes all data sets whose names start with the given prefix (e.g. tempDsnPrefix returned by getTempDatasetPrefix). ' +
        `For automation: create temp data sets under one prefix, then call this once to clean up. Prefix must have at least 3 qualifiers and contain ${REQUIRED_SAFETY_QUALIFIER} (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}.XXXXXXXX.YYYYYYYY).`,
      annotations: { destructiveHint: true },
      outputSchema: deleteDatasetsUnderPrefixOutputSchema,
      inputSchema: {
        dsnPrefix: z
          .string()
          .describe(
            `Fully qualified prefix (e.g. USER.${REQUIRED_SAFETY_QUALIFIER}.A1B2C3D4.E5F6G7H8). All data sets matching this prefix will be deleted. Must have at least 3 qualifiers and contain ${REQUIRED_SAFETY_QUALIFIER}.`
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
      },
    },
    async ({ dsnPrefix, system }, extra) => {
      const title = `Delete data sets under ${dsnPrefix}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('deleteDatasetsUnderPrefix called', { dsnPrefix, system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const userId = deps.sessionState.getContext(systemId)?.userId ?? resolvedUserId ?? '';
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const { deleted } = await deleteDatasetsUnderPrefixInternal(
          deps.backend,
          systemId,
          dsnPrefix,
          userId,
          progressCb
        );
        if (deps.responseCache) {
          for (const dsn of deleted) {
            applyCacheAfterMutation(deps.responseCache, 'delete', {
              systemId,
              userId,
              dsn,
            });
          }
        }
        const ctx = buildContext(systemId, {});
        await progress.complete(`${deleted.length} deleted`);
        const mutationMeta: MutationResultMeta = { success: true };
        return wrapResponse(ctx, mutationMeta, { deleted, count: deleted.length }, []);
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
      description:
        'Copy a data set or PDS/PDSE member within a single z/OS system. ' +
        'You may pass source or target dsn as USER.LIB(MEM) and omit the corresponding member.',
      outputSchema: copyDatasetOutputSchema,
      inputSchema: {
        sourceDsn: z
          .string()
          .describe('Fully qualified source data set name (e.g. USER.SRC.COBOL).'),
        targetDsn: z
          .string()
          .describe('Fully qualified target data set name (e.g. USER.SRC.BACKUP).'),
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
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
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
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      description:
        'Rename a data set or PDS/PDSE member. ' +
        'You may pass dsn as USER.LIB(MEM) and omit member.',
      outputSchema: renameDatasetOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        newDsn: z.string().describe('Fully qualified new data set name (e.g. USER.SRC.NEW).'),
        member: z
          .string()
          .optional()
          .describe('Current member name (for renaming a member within a PDS/PDSE).'),
        newMember: z.string().optional().describe('New member name.'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: host (e.g. sys1.example.com) or connection spec (user@host) when multiple connections exist for that host. Defaults to active system.'
          ),
      },
    },
    async ({ dsn, newDsn, member, newMember, system }, extra) => {
      const title = `Rename ${dsn} to ${newDsn}`;
      const progress = createToolProgress(extra, title);
      await progress.start();
      log.info('renameDataset called', { dsn, newDsn, member, newMember, system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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

        if (deps.responseCache) {
          const userId = deps.sessionState.getContext(systemId)?.userId ?? resolvedUserId ?? '';
          applyCacheAfterMutation(deps.responseCache, 'rename', {
            systemId,
            userId,
            dsn: resolvedOld.dsn,
            member: resolvedOld.member,
            newDsn: resolvedNew.dsn,
            newMember: resolvedNew.member,
          });
        }

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
