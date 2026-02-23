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
 * USS (UNIX System Services) tools for the Zowe MCP Server.
 *
 * List, read, write, create, delete, chmod, chown, chtag, run safe command,
 * and temp file/directory operations on z/OS USS.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import type { EncodingOptions } from '../../zos/encoding.js';
import { resolveDatasetEncoding } from '../../zos/encoding.js';
import type { ResponseCache } from '../../zos/response-cache.js';
import { buildCacheKey, buildScopeSystem } from '../../zos/response-cache.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { relativizeForDisplay, resolveUssPath } from '../../zos/uss-path.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  DEFAULT_LIST_LIMIT,
  getListMessages,
  getReadMessages,
  paginateList,
  sanitizeTextForDisplay,
  windowContent,
  wrapResponse,
} from '../response.js';
import { validateCommand, validateReadPath } from './command-validation.js';

async function ensureContext(
  deps: { sessionState: SessionState; credentialProvider: CredentialProvider },
  systemId: string
): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

function errorResult(message: string): { content: { type: 'text'; text: string }[] } {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
  };
}

/** Typical USS base paths to probe when echo $HOME is unavailable (e.g. ZNP unixCommand not implemented). */
const USS_HOME_PROBE_BASES = ['/u', '/a', '/z', '/u/users', '/u/users/group/product'] as const;

/**
 * When getUssHome and echo $HOME are unavailable (e.g. ZNP unixCommand not implemented),
 * probe typical USS base paths for a directory matching the user ID (case-insensitive).
 * Returns the first existing path or '' if none found.
 */
async function probeUssHomeFromBases(
  backend: ZosBackend,
  systemId: string,
  userId: string,
  log: Logger
): Promise<string> {
  const lower = userId.toLowerCase();
  for (const base of USS_HOME_PROBE_BASES) {
    try {
      const entries = await backend.listUssFiles(systemId, base, { includeHidden: true }, userId);
      const entry = entries.find(
        e => (e.name === userId || e.name === lower) && e.isDirectory !== false
      );
      if (entry) {
        const path = `${base}/${entry.name}`;
        log.info('getUssHome resolved USS home via directory check', {
          systemId,
          path,
        });
        return path;
      }
      const fallback = entries.find(e => e.name === userId || e.name === lower);
      if (fallback) {
        const path = `${base}/${fallback.name}`;
        log.info('getUssHome resolved USS home via directory check', {
          systemId,
          path,
        });
        return path;
      }
    } catch {
      // Base path may not exist or be listable; skip
    }
  }
  return '';
}

export interface UssToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  responseCache?: ResponseCache;
  encodingOptions: EncodingOptions;
}

export function registerUssTools(server: McpServer, deps: UssToolDeps, logger: Logger): void {
  const log = logger.child('uss');

  // -----------------------------------------------------------------------
  // getUssHome
  // -----------------------------------------------------------------------
  server.registerTool(
    'getUssHome',
    {
      description:
        "Return the current user's USS home directory for the active (or specified) system. ",
      annotations: { readOnlyHint: true },
      inputSchema: {
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
      },
    },
    async ({ system }, extra) => {
      const progress = createToolProgress(extra, 'Get USS home directory');
      await progress.start();
      log.info('getUssHome called', { system });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);

        const ctx = deps.sessionState.getContext(systemId);
        if (ctx?.ussHome) {
          log.debug('getUssHome returning cached path', { systemId, path: ctx.ussHome });
          await progress.complete('done');
          return wrapResponse(
            buildContext(systemId, {}),
            { success: true },
            { path: ctx.ussHome }
          );
        }

        const userId = ctx?.userId;
        let home: string;
        try {
          log.debug('getUssHome calling backend.getUssHome', { systemId, userId });
          home = await deps.backend.getUssHome(systemId, userId);
          log.debug('getUssHome backend.getUssHome returned', { systemId, path: home });
        } catch (backendErr) {
          log.info('getUssHome backend.getUssHome failed, falling back to echo $HOME', {
            systemId,
            error: (backendErr as Error).message,
          });
          try {
            const out = await deps.backend.runUnixCommand(
              systemId,
              'echo $HOME',
              userId,
              extra._meta?.progressToken ? (msg: string) => void progress.step(msg) : undefined
            );
            home = (out ?? '').trim().split('\n')[0]?.trim() ?? '';
            log.debug('getUssHome echo $HOME result', {
              systemId,
              rawLength: (out ?? '').length,
              home,
            });
          } catch (echoErr) {
            log.info('getUssHome echo $HOME failed, probing typical home bases', {
              systemId,
              error: (echoErr as Error).message,
            });
            if (userId) {
              const probed = await probeUssHomeFromBases(deps.backend, systemId, userId, log);
              if (probed) {
                home = probed;
              } else {
                home = `/u/${userId.toLowerCase()}`;
                log.warning(
                  'getUssHome no home directory found under typical bases; defaulting to /u/<userid>',
                  { systemId, path: home }
                );
              }
            } else {
              throw echoErr;
            }
          }
        }
        if (home && ctx) {
          ctx.ussHome = home;
          log.debug('getUssHome cached ussHome in session context', { systemId, path: home });
        }
        await progress.complete('done');
        return wrapResponse(buildContext(systemId, {}), { success: true }, { path: home });
      } catch (err) {
        log.warning('getUssHome failed', { system: system, error: (err as Error).message });
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // changeUssDirectory
  // -----------------------------------------------------------------------
  server.registerTool(
    'changeUssDirectory',
    {
      description:
        'Set the USS current working directory for the active (or specified) system. ' +
        'Path can be absolute (starts with /) or relative to the current working directory. ' +
        'The new cwd is used to resolve relative paths in other USS tools and is shown in getContext as ussCwd.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'Directory path to set as current working directory (absolute or relative to current cwd).'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
      },
    },
    async ({ path: pathArg, system }, extra) => {
      const progress = createToolProgress(extra, 'Change USS directory');
      await progress.start();
      log.info('changeUssDirectory called', { path: pathArg, system });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);

        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);

        await deps.backend.listUssFiles(
          systemId,
          resolvedPath,
          { includeHidden: true },
          ctx?.userId
        );
        if (ctx) {
          ctx.ussCwd = resolvedPath;
        }
        const displayPath = relativizeForDisplay(resolvedPath, effectiveCwd);
        await progress.complete('done');
        return wrapResponse(
          buildContext(systemId, { currentDirectory: displayPath }),
          { success: true },
          { path: resolvedPath }
        );
      } catch (err) {
        log.warning('changeUssDirectory failed', {
          path: pathArg,
          system: system,
          error: (err as Error).message,
        });
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // listUssFiles
  // -----------------------------------------------------------------------
  server.registerTool(
    'listUssFiles',
    {
      description:
        'List files and directories in a USS path. Results are paginated (default 500, max 1000 per page). ' +
        'When _result.hasMore is true, call again with offset and limit to get the next page. ' +
        'Do not answer using only the first page; fetch all pages until _result.hasMore is false.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS directory path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
        includeHidden: z
          .boolean()
          .optional()
          .default(false)
          .describe('Include hidden files (names starting with .).'),
        longFormat: z
          .boolean()
          .optional()
          .default(false)
          .describe('Return long format (mode, size, mtime, name).'),
        offset: z.number().int().min(0).optional().describe('0-based offset. Default: 0.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(1000)
          .optional()
          .describe('Max items per page. Default: 500. Max: 1000.'),
      },
    },
    async ({ path: pathArg, system, includeHidden, longFormat, offset, limit }, extra) => {
      const progress = createToolProgress(extra, `List USS files in ${pathArg}`);
      await progress.start();
      log.info('listUssFiles called', { path: pathArg, system });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);

        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;

        const items = deps.responseCache
          ? await deps.responseCache.getOrFetch(
              buildCacheKey('listUssFiles', {
                systemId,
                path: resolvedPath,
                userId: userId ?? '',
                includeHidden: String(includeHidden ?? false),
                longFormat: String(longFormat ?? false),
              }),
              () =>
                deps.backend.listUssFiles(
                  systemId,
                  resolvedPath,
                  { includeHidden, longFormat },
                  userId,
                  progressCb
                ),
              [buildScopeSystem(systemId)]
            )
          : await deps.backend.listUssFiles(
              systemId,
              resolvedPath,
              { includeHidden, longFormat },
              userId,
              progressCb
            );

        const { data: pageItems, meta } = paginateList(
          items,
          offset ?? 0,
          limit ?? DEFAULT_LIST_LIMIT
        );
        const listedDirDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : resolvedPath;
        const dataWithPaths = pageItems.map(entry => {
          const fullPath = resolvedPath.replace(/\/+$/, '') + '/' + entry.name;
          const pathDisplay = relativizeForDisplay(fullPath, effectiveCwd);
          return { ...entry, path: pathDisplay };
        });

        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? listedDirDisplay : undefined,
          currentDirectory: currentDirDisplay,
          listedDirectory: listedDirDisplay,
        });

        await progress.complete(`${meta.count} items`);
        return wrapResponse(responseCtx, meta, dataWithPaths, getListMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // readUssFile
  // -----------------------------------------------------------------------
  server.registerTool(
    'readUssFile',
    {
      description:
        'Read the content of a USS file. Results may be line-windowed; when _result.hasMore is true, call again with startLine and lineCount to get the next lines. ' +
        'Do not answer using only the first window; fetch until _result.hasMore is false.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).'
          ),
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
            'Mainframe (EBCDIC) encoding for the file. Omit to use system default or file tag.'
          ),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based first line to return. Default: 1.'),
        lineCount: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Number of lines to return. Omit for default window size.'),
      },
    },
    async ({ path: pathArg, system, encoding, startLine, lineCount }, extra) => {
      const progress = createToolProgress(extra, `Read USS file ${pathArg}`);
      await progress.start();
      log.info('readUssFile called', { path: pathArg, system });

      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);

        const sessionCtx = deps.sessionState.getContext(systemId);
        const effectiveCwd = sessionCtx?.ussCwd ?? sessionCtx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const ussHome = sessionCtx?.ussHome;
        const pathValidation = validateReadPath(resolvedPath, ussHome);
        if (pathValidation.action === 'block') {
          const msg = pathValidation.pattern?.message ?? 'Access to this path is not allowed.';
          await progress.complete(msg);
          return errorResult(msg);
        }
        if (pathValidation.action === 'warn' || pathValidation.action === 'elicit') {
          await progress.complete('Path requires user confirmation; elicitation not available.');
          return errorResult(
            'Path requires user confirmation (sensitive or unknown path). Elicitation is not available; access denied.'
          );
        }

        const enc = resolveDatasetEncoding(
          encoding,
          sessionCtx?.mainframeUssEncoding,
          deps.encodingOptions.defaultMainframeUssEncoding
        );
        const userId = sessionCtx?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;

        const result = deps.responseCache
          ? await deps.responseCache.getOrFetch(
              buildCacheKey('readUssFile', {
                systemId,
                path: resolvedPath,
                encoding: enc,
                userId: userId ?? '',
              }),
              () => deps.backend.readUssFile(systemId, resolvedPath, enc, userId, progressCb),
              [buildScopeSystem(systemId)]
            )
          : await deps.backend.readUssFile(systemId, resolvedPath, enc, userId, progressCb);

        const sanitized = sanitizeTextForDisplay(result.text);
        const { text, meta, mimeType } = windowContent(sanitized, startLine, lineCount);

        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });

        await progress.complete(`${meta.returnedLines} lines`);
        return wrapResponse(
          responseCtx,
          meta,
          { text, etag: result.etag, mimeType },
          getReadMessages(meta)
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // runSafeUssCommand
  // -----------------------------------------------------------------------
  server.registerTool(
    'runSafeUssCommand',
    {
      description:
        'Run a Unix command on z/OS USS. Only allowlisted (safe) commands run automatically. ' +
        'Unknown commands require user confirmation (elicitation); if the client does not support elicitation, execution is denied. ' +
        'Output is paginated by line; when _result.hasMore is true, call again with startLine and lineCount to get the next lines.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        commandText: z
          .string()
          .describe('The Unix command line to execute (e.g. ls -la /tmp, whoami, pwd).'),
        system: z
          .string()
          .optional()
          .describe(
            'Target z/OS system: fully qualified or unqualified hostname. Defaults to the active system.'
          ),
        startLine: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('1-based first line of output to return. Default: 1.'),
        lineCount: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Number of lines to return. Omit for default window size.'),
      },
    },
    async ({ commandText, system, startLine, lineCount }, extra) => {
      const progress = createToolProgress(extra, `Run USS command`);
      await progress.start();
      log.info('runSafeUssCommand called', { commandText: commandText.slice(0, 80), system });

      try {
        const validation = validateCommand(commandText);
        if (validation.action === 'block') {
          const msg =
            validation.pattern?.message ?? 'This command is not allowed for security reasons.';
          await progress.complete(msg);
          return errorResult(msg);
        }
        if (validation.action === 'elicit') {
          await progress.complete(
            'Command requires user confirmation; elicitation not available.'
          );
          return errorResult(
            'Command requires user confirmation (unknown command). Elicitation is not available; execution denied.'
          );
        }

        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);

        const userId = deps.sessionState.getContext(systemId)?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;

        const output = await deps.backend.runUnixCommand(
          systemId,
          commandText,
          userId,
          progressCb
        );

        const sanitized = sanitizeTextForDisplay(output);
        const { text, meta, mimeType } = windowContent(sanitized, startLine, lineCount);

        const ctx = buildContext(systemId, {});

        await progress.complete(`${meta.returnedLines} lines`);
        return wrapResponse(ctx, meta, { text, mimeType }, getReadMessages(meta));
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'writeUssFile',
    {
      description: 'Write or overwrite a USS file. Creates the file if it does not exist.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).'
          ),
        content: z.string().describe('UTF-8 text content to write.'),
        system: z.string().optional().describe('Target z/OS system. Defaults to active system.'),
        etag: z.string().optional().describe('ETag for optimistic locking.'),
        encoding: z.string().optional().describe('Mainframe encoding. Omit for default.'),
      },
    },
    async ({ path: pathArg, content, system, etag, encoding }, extra) => {
      const progress = createToolProgress(extra, `Write USS file ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const enc = resolveDatasetEncoding(
          encoding,
          ctx?.mainframeUssEncoding,
          deps.encodingOptions.defaultMainframeUssEncoding
        );
        const userId = ctx?.userId;
        const result = await deps.backend.writeUssFile(
          systemId,
          resolvedPath,
          content,
          etag,
          enc,
          userId
        );
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(
          responseCtx,
          { success: true },
          { etag: result.etag, created: result.created }
        );
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'createUssFile',
    {
      description: 'Create a USS file or directory.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path to create: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        isDirectory: z.boolean().describe('True to create a directory, false for a regular file.'),
        system: z.string().optional().describe('Target z/OS system.'),
        permissions: z.string().optional().describe('Octal permissions (e.g. 755).'),
      },
    },
    async ({ path: pathArg, isDirectory, system, permissions }, extra) => {
      const progress = createToolProgress(
        extra,
        `Create USS ${isDirectory ? 'directory' : 'file'} ${pathArg}`
      );
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.createUssFile(
          systemId,
          resolvedPath,
          { isDirectory, permissions },
          userId
        );
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'deleteUssFile',
    {
      description: 'Delete a USS file or directory. Use recursive for directories.',
      annotations: { destructiveHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path to delete: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe('Target z/OS system.'),
        recursive: z
          .boolean()
          .optional()
          .default(false)
          .describe('If true, delete directory and contents.'),
      },
    },
    async ({ path: pathArg, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Delete USS ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.deleteUssFile(systemId, resolvedPath, recursive, userId);
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { deleted: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'chmodUssFile',
    {
      description: 'Change permissions of a USS file or directory.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        mode: z.string().describe('Octal mode (e.g. 755).'),
        system: z.string().optional().describe('Target z/OS system.'),
        recursive: z.boolean().optional().default(false).describe('Apply recursively.'),
      },
    },
    async ({ path: pathArg, mode, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Chmod USS ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.chmodUssFile(systemId, resolvedPath, mode, recursive, userId);
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'chownUssFile',
    {
      description: 'Change owner of a USS file or directory.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        owner: z.string().describe('New owner.'),
        system: z.string().optional().describe('Target z/OS system.'),
        recursive: z.boolean().optional().default(false).describe('Apply recursively.'),
      },
    },
    async ({ path: pathArg, owner, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Chown USS ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.chownUssFile(systemId, resolvedPath, owner, recursive, userId);
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'chtagUssFile',
    {
      description: 'Set the z/OS file tag (encoding/type) for a USS file or directory.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        tag: z.string().describe('Tag (e.g. ISO8859-1).'),
        system: z.string().optional().describe('Target z/OS system.'),
        recursive: z.boolean().optional().default(false).describe('Apply recursively.'),
      },
    },
    async ({ path: pathArg, tag, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Chtag USS ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.chtagUssFile(systemId, resolvedPath, tag, recursive, userId);
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  // -----------------------------------------------------------------------
  // USS temp tools (safety: path must contain "tmp" and min depth for delete)
  // -----------------------------------------------------------------------
  const USS_TEMP_SAFETY_SEGMENT = 'tmp';
  const MIN_USS_PATH_SEGMENTS_FOR_DELETE = 3;

  server.registerTool(
    'getUssTempDir',
    {
      description:
        'Return a unique USS directory path under the given base path (e.g. $HOME/tmp or /tmp) for temporary use. ' +
        'The path is verified not to exist. Use createUssFile with isDirectory true to create it.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        basePath: z
          .string()
          .describe(
            'Base directory: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe('Target z/OS system.'),
      },
    },
    async ({ basePath, system }, extra) => {
      const progress = createToolProgress(extra, 'Get USS temp dir');
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolved = resolveUssPath(basePath, effectiveCwd);
        const userId = ctx?.userId;
        const dir = await deps.backend.getUssTempDir(systemId, resolved, userId);
        const pathDisplay = relativizeForDisplay(dir, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'getUssTempPath',
    {
      description:
        'Return a unique USS file path under the given directory (e.g. from getUssTempDir). ' +
        'The path is verified not to exist. Use writeUssFile or createUssFile to create the file.',
      annotations: { readOnlyHint: true },
      inputSchema: {
        dirPath: z
          .string()
          .describe(
            'Parent directory: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        prefix: z.string().optional().describe('Optional filename prefix.'),
        system: z.string().optional().describe('Target z/OS system.'),
      },
    },
    async ({ dirPath, prefix, system }, extra) => {
      const progress = createToolProgress(extra, 'Get USS temp path');
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolved = resolveUssPath(dirPath, effectiveCwd);
        const userId = ctx?.userId;
        const filePath = await deps.backend.getUssTempPath(systemId, resolved, prefix, userId);
        const pathDisplay = relativizeForDisplay(filePath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'createTempUssDir',
    {
      description:
        'Create a temporary USS directory. Typically use a path from getUssTempDir. ' +
        'Creates the directory and any missing parents.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS directory path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe('Target z/OS system.'),
        permissions: z.string().optional().describe('Octal permissions (e.g. 755).'),
      },
    },
    async ({ path: pathArg, system, permissions }, extra) => {
      const progress = createToolProgress(extra, `Create temp USS dir ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.createUssFile(
          systemId,
          resolvedPath,
          { isDirectory: true, permissions },
          userId
        );
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'createTempUssFile',
    {
      description:
        'Create an empty USS file at the given path (e.g. from getUssTempPath). ' +
        'Creates parent directories if needed.',
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS file path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe('Target z/OS system.'),
      },
    },
    async ({ path: pathArg, system }, extra) => {
      const progress = createToolProgress(extra, `Create temp USS file ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.createUssFile(systemId, resolvedPath, { isDirectory: false }, userId);
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(responseCtx, { success: true }, { path: pathDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );

  server.registerTool(
    'deleteUssTempUnderDir',
    {
      description:
        'Delete all files and directories under the given USS path (the path itself is removed). ' +
        'Safety: path must contain the segment "tmp" (or "TMP") and have at least 3 path segments (e.g. /u/myuser/tmp/xyz).',
      annotations: { destructiveHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path to delete recursively: absolute or relative to current working directory (see getContext.ussCwd); must contain "tmp" and min depth.'
          ),
        system: z.string().optional().describe('Target z/OS system.'),
      },
    },
    async ({ path: pathArg, system }, extra) => {
      const progress = createToolProgress(extra, `Delete USS temp under ${pathArg}`);
      await progress.start();
      try {
        const systemId = resolveSystemForTool(deps.systemRegistry, deps.sessionState, system);
        await ensureContext(deps, systemId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const segments = resolvedPath.split('/').filter(s => s.length > 0);
        if (segments.length < MIN_USS_PATH_SEGMENTS_FOR_DELETE) {
          await progress.complete('Safety: path too short');
          return errorResult(
            `deleteUssTempUnderDir requires at least ${MIN_USS_PATH_SEGMENTS_FOR_DELETE} path segments (e.g. /u/myuser/tmp/xyz). Got: "${pathArg}"`
          );
        }
        if (!segments.some(s => s.toLowerCase() === USS_TEMP_SAFETY_SEGMENT)) {
          await progress.complete('Safety: path must contain tmp');
          return errorResult(
            `deleteUssTempUnderDir requires the path to contain the segment "${USS_TEMP_SAFETY_SEGMENT}" (e.g. /u/myuser/tmp/...). Got: "${pathArg}"`
          );
        }
        const userId = ctx?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const { deleted } = await deps.backend.deleteUssUnderPath(
          systemId,
          resolvedPath,
          userId,
          progressCb
        );
        const pathDisplay = relativizeForDisplay(resolvedPath, effectiveCwd);
        const deletedDisplay = deleted.map(p => relativizeForDisplay(p, effectiveCwd));
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          resolvedPath: resolvedPath !== pathArg.trim() ? pathDisplay : undefined,
          currentDirectory: currentDirDisplay,
        });
        await progress.complete(`${deleted.length} deleted`);
        return wrapResponse(responseCtx, { success: true }, { deleted: deletedDisplay });
      } catch (err) {
        await progress.complete((err as Error).message);
        return errorResult((err as Error).message);
      }
    }
  );
}
