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
import { buildCacheKey, buildScopeSystem, withCache } from '../../zos/response-cache.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { relativizeForDisplay, resolveUssPath } from '../../zos/uss-path.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  DEFAULT_LIST_LIMIT,
  getListMessages,
  getReadMessages,
  linesToText,
  paginateList,
  PAGINATION_NOTE_LINES,
  PAGINATION_NOTE_LIST,
  sanitizeTextForDisplay,
  SYSTEM_PARAM_DESCRIPTION,
  textToLines,
  windowContent,
  withPaginationNote,
  wrapResponse,
} from '../response.js';
import { validateCommand, validateReadPath } from './command-validation.js';
import {
  changeUssDirectoryOutputSchema,
  chmodUssFileOutputSchema,
  chownUssFileOutputSchema,
  chtagUssFileOutputSchema,
  copyUssFileOutputSchema,
  createTempUssDirOutputSchema,
  createTempUssFileOutputSchema,
  createUssFileOutputSchema,
  deleteUssFileOutputSchema,
  deleteUssTempUnderDirOutputSchema,
  getUssHomeOutputSchema,
  getUssTempDirOutputSchema,
  getUssTempPathOutputSchema,
  listUssFilesOutputSchema,
  readUssFileOutputSchema,
  runSafeUssCommandOutputSchema,
  writeUssFileOutputSchema,
} from './uss-output-schemas.js';

async function ensureContext(
  deps: { sessionState: SessionState; credentialProvider: CredentialProvider },
  systemId: string,
  userId?: string
): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId, userId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

function errorResult(message: string): {
  content: { type: 'text'; text: string }[];
  isError: true;
} {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

export interface UssToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  responseCache?: ResponseCache;
  encodingOptions: EncodingOptions;
  /** MCP server instance for elicitation (confirm unknown commands or sensitive paths). */
  mcpServer: McpServer;
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
      outputSchema: getUssHomeOutputSchema,
      inputSchema: {
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ system }, extra) => {
      const progress = createToolProgress(extra, 'Get USS home directory');
      await progress.start();
      log.info('getUssHome called', { system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);

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
        log.debug('getUssHome calling backend.getUssHome', { systemId, userId });
        const home = await deps.backend.getUssHome(systemId, userId);
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
      outputSchema: changeUssDirectoryOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'Directory path to set as current working directory (absolute or relative to current cwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ path: pathArg, system }, extra) => {
      const progress = createToolProgress(extra, 'Change USS directory');
      await progress.start();
      log.info('changeUssDirectory called', { path: pathArg, system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);

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
      outputSchema: listUssFilesOutputSchema,
      description: withPaginationNote(
        'List files and directories in a USS path',
        PAGINATION_NOTE_LIST
      ),
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS directory path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);

        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedPath = resolveUssPath(pathArg, effectiveCwd);
        const userId = ctx?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;

        const items = await withCache(
          deps.responseCache,
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
      outputSchema: readUssFileOutputSchema,
      description: withPaginationNote('Read the content of a USS file', PAGINATION_NOTE_LINES),
      annotations: { readOnlyHint: true },
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);

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
          const caps = deps.mcpServer.server.getClientCapabilities();
          // Per MCP spec, empty elicitation object defaults to form mode
          if (!caps?.elicitation) {
            await progress.complete('Path requires user confirmation; elicitation not available.');
            return errorResult(
              'Path requires user confirmation (sensitive or unknown path). Elicitation is not available; access denied.'
            );
          }
          try {
            const result = await deps.mcpServer.server.elicitInput({
              mode: 'form',
              message:
                'Path requires user confirmation (sensitive or unknown path). Do you want to read this file?',
              requestedSchema: {
                type: 'object',
                properties: {
                  confirm: {
                    type: 'boolean',
                    title: 'Read file',
                    description: resolvedPath,
                  },
                },
                required: ['confirm'],
              },
            });
            if (result.action !== 'accept' || result.content?.confirm !== true) {
              const declined =
                result.action === 'decline'
                  ? 'User declined.'
                  : result.action === 'cancel'
                    ? 'Cancelled.'
                    : 'Confirmation required.';
              await progress.complete(declined);
              return errorResult(declined);
            }
          } catch (err) {
            log.debug('Elicitation failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            await progress.complete('User confirmation failed.');
            return errorResult(
              'Path requires user confirmation (sensitive or unknown path). Elicitation failed; access denied.'
            );
          }
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

        const result = await withCache(
          deps.responseCache,
          buildCacheKey('readUssFile', {
            systemId,
            path: resolvedPath,
            encoding: enc,
            userId: userId ?? '',
          }),
          () => deps.backend.readUssFile(systemId, resolvedPath, enc, userId, progressCb),
          [buildScopeSystem(systemId)]
        );

        const sanitized = sanitizeTextForDisplay(result.text);
        const { text, meta, mimeType } = windowContent(sanitized, startLine, lineCount);
        const lines = textToLines(text);

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
          { lines, etag: result.etag, mimeType },
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
      outputSchema: runSafeUssCommandOutputSchema,
      description: withPaginationNote(
        'Run a Unix command on z/OS USS. Only allowlisted (safe) commands run automatically; ' +
          'unknown commands require user confirmation via elicitation',
        PAGINATION_NOTE_LINES
      ),
      annotations: { readOnlyHint: true },
      inputSchema: {
        commandText: z
          .string()
          .describe('The Unix command line to execute (e.g. ls -la /tmp, whoami, pwd).'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
          const caps = deps.mcpServer.server.getClientCapabilities();
          // Per MCP spec, empty elicitation object defaults to form mode
          if (!caps?.elicitation) {
            await progress.complete(
              'Command requires user confirmation; elicitation not available.'
            );
            return errorResult(
              'Command requires user confirmation (unknown command). Elicitation is not available; execution denied.'
            );
          }
          try {
            let systemLabel: string;
            try {
              const { systemId } = resolveSystemForTool(
                deps.systemRegistry,
                deps.sessionState,
                system
              );
              systemLabel = systemId;
            } catch {
              systemLabel = system != null ? String(system) : 'active system';
            }
            const cmdDisplay = commandText.trim();
            const cmdPreview =
              cmdDisplay.length > 120 ? `${cmdDisplay.slice(0, 120)}…` : cmdDisplay;
            const result = await deps.mcpServer.server.elicitInput({
              mode: 'form',
              message: `Command requires user confirmation (unknown command): "${cmdPreview}" on system "${systemLabel}". Do you want to run this USS command?`,
              requestedSchema: {
                type: 'object',
                properties: {
                  confirm: {
                    type: 'boolean',
                    title: 'Run command',
                    description: cmdDisplay,
                  },
                },
                required: ['confirm'],
              },
            });
            if (result.action !== 'accept' || result.content?.confirm !== true) {
              const declined =
                result.action === 'decline'
                  ? 'User declined.'
                  : result.action === 'cancel'
                    ? 'Cancelled.'
                    : 'Confirmation required.';
              await progress.complete(declined);
              return errorResult(declined);
            }
          } catch (err) {
            log.debug('Elicitation failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            await progress.complete('User confirmation failed.');
            return errorResult(
              'Command requires user confirmation (unknown command). Elicitation failed; execution denied.'
            );
          }
        }

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);

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
        const lines = textToLines(text);

        const ctx = buildContext(systemId, {});

        await progress.complete(`${meta.returnedLines} lines`);
        return wrapResponse(ctx, meta, { lines, mimeType }, getReadMessages(meta));
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
      outputSchema: writeUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS file path: absolute (starts with /) or relative to current working directory (see getContext.ussCwd).'
          ),
        lines: z
          .array(z.string())
          .describe('UTF-8 content to write as an array of lines (one string per line).'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        etag: z.string().optional().describe('ETag for optimistic locking.'),
        encoding: z.string().optional().describe('Mainframe encoding. Omit for default.'),
      },
    },
    async ({ path: pathArg, lines, system, etag, encoding }, extra) => {
      const content = linesToText(lines ?? []);
      const progress = createToolProgress(extra, `Write USS file ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: createUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path to create: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        isDirectory: z.boolean().describe('True to create a directory, false for a regular file.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: deleteUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path to delete: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
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
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: chmodUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        mode: z.string().describe('Octal mode (e.g. 755).'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        recursive: z.boolean().optional().default(false).describe('Apply recursively.'),
      },
    },
    async ({ path: pathArg, mode, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Chmod USS ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: chownUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        owner: z.string().describe('New owner.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        recursive: z.boolean().optional().default(false).describe('Apply recursively.'),
      },
    },
    async ({ path: pathArg, owner, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Chown USS ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: chtagUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        tag: z
          .string()
          .describe(
            'File tag value: a coded character set identifier (CCSID) name or number. Common values: ISO8859-1, IBM-1047 (EBCDIC), UTF-8, binary. Use "binary" for non-text files.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        recursive: z.boolean().optional().default(false).describe('Apply recursively.'),
      },
    },
    async ({ path: pathArg, tag, system, recursive }, extra) => {
      const progress = createToolProgress(extra, `Chtag USS ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
  // copyUssFile
  // -----------------------------------------------------------------------
  server.registerTool(
    'copyUssFile',
    {
      description:
        'Copy a USS file or directory within the same z/OS system. ' +
        'For directories, set recursive to true. ' +
        'Paths can be absolute (starting with /) or relative to the current working directory (see getContext.ussCwd).',
      outputSchema: copyUssFileOutputSchema,
      inputSchema: {
        sourcePath: z
          .string()
          .describe(
            'Source USS path: absolute (starts with /) or relative to current working directory.'
          ),
        targetPath: z
          .string()
          .describe(
            'Destination USS path: absolute (starts with /) or relative to current working directory.'
          ),
        recursive: z.boolean().optional().default(false).describe('Copy directories recursively.'),
        followSymlinks: z
          .boolean()
          .optional()
          .default(false)
          .describe('Follow symlinks when copying recursively.'),
        preserveAttributes: z
          .boolean()
          .optional()
          .default(false)
          .describe('Preserve permissions and ownership.'),
        force: z
          .boolean()
          .optional()
          .default(false)
          .describe('Replace files that cannot be opened (like cp -f).'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async (
      { sourcePath, targetPath, recursive, followSymlinks, preserveAttributes, force, system },
      extra
    ) => {
      const progress = createToolProgress(extra, `Copy USS ${sourcePath} to ${targetPath}`);
      await progress.start();
      log.info('copyUssFile called', { sourcePath, targetPath, recursive, system });

      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const ctx = deps.sessionState.getContext(systemId);
        const effectiveCwd = ctx?.ussCwd ?? ctx?.ussHome;
        const resolvedSource = resolveUssPath(sourcePath, effectiveCwd);
        const resolvedTarget = resolveUssPath(targetPath, effectiveCwd);
        const userId = ctx?.userId;
        await deps.backend.copyUssFile(
          systemId,
          resolvedSource,
          resolvedTarget,
          { recursive, followSymlinks, preserveAttributes, force },
          userId
        );
        const sourceDisplay = relativizeForDisplay(resolvedSource, effectiveCwd);
        const targetDisplay = relativizeForDisplay(resolvedTarget, effectiveCwd);
        const currentDirDisplay = effectiveCwd
          ? relativizeForDisplay(effectiveCwd, effectiveCwd)
          : undefined;
        const responseCtx = buildContext(systemId, {
          currentDirectory: currentDirDisplay,
        });
        await progress.complete('done');
        return wrapResponse(
          responseCtx,
          { success: true },
          { sourcePath: sourceDisplay, targetPath: targetDisplay }
        );
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
        'Generate a unique USS temporary directory path as a subdirectory of the given base path (e.g. /tmp or the user home). ' +
        'The path is verified not to exist on the system. Use createTempUssDir to create it, or createUssFile with isDirectory true.',
      annotations: { readOnlyHint: true },
      outputSchema: getUssTempDirOutputSchema,
      inputSchema: {
        basePath: z
          .string()
          .describe(
            'Base directory: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ basePath, system }, extra) => {
      const progress = createToolProgress(extra, 'Get USS temp dir');
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
        'Return a unique USS temporary file path under the given directory. ' +
        'The path is verified not to exist; use writeUssFile or createUssFile to create the file.',
      annotations: { readOnlyHint: true },
      outputSchema: getUssTempPathOutputSchema,
      inputSchema: {
        dirPath: z
          .string()
          .describe(
            'Parent directory: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        prefix: z.string().optional().describe('Optional filename prefix.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ dirPath, prefix, system }, extra) => {
      const progress = createToolProgress(extra, 'Get USS temp path');
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: createTempUssDirOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS directory path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        permissions: z.string().optional().describe('Octal permissions (e.g. 755).'),
      },
    },
    async ({ path: pathArg, system, permissions }, extra) => {
      const progress = createToolProgress(extra, `Create temp USS dir ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
        'Create an empty temporary USS file at the given path, creating parent directories if needed.',
      outputSchema: createTempUssFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS file path: absolute or relative to current working directory (see getContext.ussCwd).'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ path: pathArg, system }, extra) => {
      const progress = createToolProgress(extra, `Create temp USS file ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
      outputSchema: deleteUssTempUnderDirOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe(
            'USS path to delete recursively: absolute or relative to current working directory (see getContext.ussCwd); must contain "tmp" and min depth.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
      },
    },
    async ({ path: pathArg, system }, extra) => {
      const progress = createToolProgress(extra, `Delete USS temp under ${pathArg}`);
      await progress.start();
      try {
        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
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
