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
 * Upload/download tools: transfer between z/OS (data sets, USS, job spool) and local workspace files.
 * Local paths are validated against MCP roots/list or configured fallback directories.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { Logger } from '../../log.js';
import type { ZosBackend } from '../../zos/backend.js';
import type { CredentialProvider } from '../../zos/credentials.js';
import { DsnError, parseDsnAndMember, resolveDsn } from '../../zos/dsn.js';
import { resolveDatasetEncoding, type EncodingOptions } from '../../zos/encoding.js';
import type { ResponseCache } from '../../zos/response-cache.js';
import { resolveSystemForTool, type SessionState } from '../../zos/session.js';
import type { SystemRegistry } from '../../zos/system.js';
import { relativizeForDisplay, resolveUssPath } from '../../zos/uss-path.js';
import { applyCacheAfterMutation } from '../datasets/dataset-cache.js';
import { createToolProgress } from '../progress.js';
import {
  buildContext,
  sanitizeTextForDisplay,
  SYSTEM_PARAM_DESCRIPTION,
  wrapResponse,
  type ResponseContext,
} from '../response.js';
import {
  downloadDatasetToFileOutputSchema,
  downloadJobFileToFileOutputSchema,
  downloadUssFileToFileOutputSchema,
  uploadFileToDatasetOutputSchema,
  uploadFileToUssFileOutputSchema,
} from './local-file-output-schemas.js';
import type { McpRoot } from './path-under-roots.js';
import { LocalPathResolutionError, resolveLocalPathUnderRoots } from './path-under-roots.js';

export interface LocalFileToolDeps {
  backend: ZosBackend;
  systemRegistry: SystemRegistry;
  sessionState: SessionState;
  credentialProvider: CredentialProvider;
  encodingOptions: EncodingOptions;
  responseCache?: ResponseCache;
  mcpServer: McpServer;
  /** Directories allowed when MCP roots are missing (env / CLI). */
  localFilesFallbackDirectories: string[];
}

async function ensureContext(
  deps: Pick<LocalFileToolDeps, 'sessionState' | 'credentialProvider'>,
  systemId: string,
  userId?: string
): Promise<void> {
  if (deps.sessionState.getContext(systemId)) return;
  const credentials = await deps.credentialProvider.getCredentials(systemId, userId);
  deps.sessionState.setActiveSystem(systemId, credentials.user);
}

async function resolveDatasetToolInput(
  deps: LocalFileToolDeps,
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
  log.debug('local file dataset resolve', {
    systemId: resolvedSystem.systemId,
    dsn: resolved.dsn,
    member: resolved.member,
  });
  return { systemId: resolvedSystem.systemId, ...resolved };
}

async function getMcpRoots(mcpServer: McpServer): Promise<McpRoot[]> {
  try {
    const caps = mcpServer.server.getClientCapabilities();
    if (!caps?.roots) return [];
    const res = await mcpServer.server.listRoots();
    return (res.roots ?? []).map(r => ({ uri: r.uri, name: r.name }));
  } catch {
    return [];
  }
}

async function resolveLocalPathForTool(
  deps: LocalFileToolDeps,
  localPath: string
): Promise<{ absolutePath: string; rootUri: string; source: 'mcp' | 'fallback' }> {
  const mcpRoots = await getMcpRoots(deps.mcpServer);
  return resolveLocalPathUnderRoots({
    mcpRoots,
    fallbackDirectories: deps.localFilesFallbackDirectories,
    localPath,
    allowFallbackForRelative: deps.localFilesFallbackDirectories.length > 0,
  });
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

function localFileContext(
  systemId: string,
  resolved: { absolutePath: string; rootUri: string; source: 'mcp' | 'fallback' }
): ResponseContext {
  return {
    system: systemId,
    resolvedLocalPath: resolved.absolutePath,
    rootUri: resolved.rootUri,
    rootsSource: resolved.source,
  } as ResponseContext;
}

export function registerLocalFileTools(
  server: McpServer,
  deps: LocalFileToolDeps,
  logger: Logger
): void {
  const log = logger.child('local-files');

  server.registerTool(
    'downloadDatasetToFile',
    {
      description:
        'Download a sequential data set or PDS/E member from z/OS to a file under the workspace. ' +
        'Writes UTF-8 text. Requires a local path under an MCP root or configured workspace directory. ' +
        'Missing parent directories for the destination file are created automatically.',
      annotations: { readOnlyHint: true },
      outputSchema: downloadDatasetToFileOutputSchema,
      inputSchema: {
        dsn: z.string().describe('Fully qualified data set name (e.g. USER.SRC.COBOL).'),
        member: z.string().optional().describe('Member name for PDS or PDS/E data sets.'),
        localPath: z
          .string()
          .describe(
            'Destination file path: absolute, or relative to the first workspace root when using roots/fallback. ' +
              'Parent directories are created automatically if missing.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        encoding: z.string().optional().describe('Mainframe (EBCDIC) encoding for the read.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Allow overwriting an existing local file (default false).'),
      },
    },
    async ({ dsn, member, localPath, system, encoding, overwrite }, extra) => {
      const progress = createToolProgress(extra, `Download data set to ${localPath}`);
      await progress.start();
      try {
        const localResolved = await resolveLocalPathForTool(deps, localPath);
        try {
          await fs.access(localResolved.absolutePath);
          if (!overwrite) {
            await progress.complete('File exists');
            return errorResult(
              'Local file already exists. Pass overwrite: true to replace it, or choose a different localPath.'
            );
          }
        } catch {
          // does not exist — ok
        }

        const resolved = await resolveDatasetToolInput(deps, dsn, member, system, log);
        const systemCtx = deps.sessionState.getContext(resolved.systemId);
        const resolvedEncoding = resolveDatasetEncoding(
          encoding,
          systemCtx?.mainframeMvsEncoding,
          deps.encodingOptions.defaultMainframeMvsEncoding
        );
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.readDataset(
          resolved.systemId,
          resolved.dsn,
          resolved.member,
          resolvedEncoding,
          progressCb
        );
        const text = sanitizeTextForDisplay(result.text);
        await fs.mkdir(path.dirname(localResolved.absolutePath), { recursive: true });
        await fs.writeFile(localResolved.absolutePath, text, 'utf-8');
        const bytesWritten = Buffer.byteLength(text, 'utf-8');

        const ctx = localFileContext(resolved.systemId, localResolved);
        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;
        await progress.complete(`Wrote ${bytesWritten} bytes`);
        return wrapResponse(ctx, undefined, {
          bytesWritten,
          etag: result.etag,
          dsn: fullDsn,
          member: resolved.member,
        });
      } catch (err) {
        const message =
          err instanceof LocalPathResolutionError || err instanceof DsnError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        await progress.complete(message);
        return errorResult(message);
      }
    }
  );

  server.registerTool(
    'uploadFileToDataset',
    {
      description:
        'Upload a UTF-8 text file from the workspace to a sequential data set or PDS/E member on z/OS. ' +
        'Replaces the entire member or data set unless using etag for optimistic locking.',
      annotations: { destructiveHint: true },
      outputSchema: uploadFileToDatasetOutputSchema,
      inputSchema: {
        localPath: z
          .string()
          .describe('Source file path under an MCP root or configured workspace directory.'),
        dsn: z.string().describe('Fully qualified data set name.'),
        member: z.string().optional().describe('Member name for PDS or PDS/E data sets.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        etag: z.string().optional().describe('ETag from a previous read for optimistic locking.'),
        encoding: z.string().optional().describe('Mainframe (EBCDIC) encoding for the write.'),
      },
    },
    async ({ localPath, dsn, member, system, etag, encoding }, extra) => {
      const progress = createToolProgress(extra, `Upload file to data set ${dsn}`);
      await progress.start();
      try {
        const localResolved = await resolveLocalPathForTool(deps, localPath);
        const content = await fs.readFile(localResolved.absolutePath, 'utf-8');

        const resolved = await resolveDatasetToolInput(deps, dsn, member, system, log);
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
          undefined,
          undefined,
          progressCb
        );

        if (deps.responseCache) {
          const userId = deps.sessionState.getContext(resolved.systemId)?.userId ?? '';
          applyCacheAfterMutation(deps.responseCache, 'write', {
            systemId: resolved.systemId,
            userId,
            dsn: resolved.dsn,
            member: resolved.member,
            content,
            encoding: resolvedEncoding,
            etag: result.etag,
            partialReplace: false,
          });
        }

        const ctx = localFileContext(resolved.systemId, localResolved);
        const fullDsn = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;
        const bytesRead = Buffer.byteLength(content, 'utf-8');
        await progress.complete('Uploaded');
        return wrapResponse(ctx, undefined, {
          bytesRead,
          etag: result.etag,
          dsn: fullDsn,
          member: resolved.member,
        });
      } catch (err) {
        const message =
          err instanceof LocalPathResolutionError || err instanceof DsnError
            ? err.message
            : err instanceof Error
              ? err.message
              : String(err);
        await progress.complete(message);
        return errorResult(message);
      }
    }
  );

  server.registerTool(
    'downloadUssFileToFile',
    {
      description:
        'Download a z/OS USS file to a local workspace file as UTF-8 text. ' +
        'Path must be under an MCP root or configured workspace directory. ' +
        'Missing parent directories for the destination file are created automatically.',
      annotations: { readOnlyHint: true },
      outputSchema: downloadUssFileToFileOutputSchema,
      inputSchema: {
        path: z
          .string()
          .describe('USS file path on z/OS (absolute or relative to USS cwd; see getContext).'),
        localPath: z
          .string()
          .describe(
            'Destination path under workspace roots or fallback directory. ' +
              'Parent directories are created automatically if missing.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        encoding: z.string().optional().describe('Mainframe encoding for the file read.'),
        overwrite: z
          .boolean()
          .optional()
          .describe('Allow overwriting an existing local file (default false).'),
      },
    },
    async ({ path: pathArg, localPath, system, encoding, overwrite }, extra) => {
      const progress = createToolProgress(extra, `Download USS file to ${localPath}`);
      await progress.start();
      try {
        const localResolved = await resolveLocalPathForTool(deps, localPath);
        try {
          await fs.access(localResolved.absolutePath);
          if (!overwrite) {
            await progress.complete('File exists');
            return errorResult(
              'Local file already exists. Pass overwrite: true to replace it, or choose a different localPath.'
            );
          }
        } catch {
          // ok
        }

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const sessionCtx = deps.sessionState.getContext(systemId);
        const effectiveCwd = sessionCtx?.ussCwd ?? sessionCtx?.ussHome;
        const resolvedUssPath = resolveUssPath(pathArg, effectiveCwd);
        const enc = resolveDatasetEncoding(
          encoding,
          sessionCtx?.mainframeUssEncoding,
          deps.encodingOptions.defaultMainframeUssEncoding
        );
        const userId = sessionCtx?.userId;
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.readUssFile(
          systemId,
          resolvedUssPath,
          enc,
          userId,
          progressCb
        );
        const text = sanitizeTextForDisplay(result.text);
        await fs.mkdir(path.dirname(localResolved.absolutePath), { recursive: true });
        await fs.writeFile(localResolved.absolutePath, text, 'utf-8');
        const bytesWritten = Buffer.byteLength(text, 'utf-8');

        const pathDisplay = relativizeForDisplay(resolvedUssPath, effectiveCwd);
        const baseCtx = buildContext(systemId, {
          resolvedPath: resolvedUssPath !== pathArg.trim() ? pathDisplay : undefined,
        });
        const ctx = {
          ...baseCtx,
          resolvedLocalPath: localResolved.absolutePath,
          rootUri: localResolved.rootUri,
          rootsSource: localResolved.source,
        } as ResponseContext;

        await progress.complete(`Wrote ${bytesWritten} bytes`);
        return wrapResponse(ctx, undefined, {
          bytesWritten,
          etag: result.etag,
          ussPath: resolvedUssPath,
        });
      } catch (err) {
        const message =
          err instanceof LocalPathResolutionError ? err.message : (err as Error).message;
        await progress.complete(message);
        return errorResult(message);
      }
    }
  );

  server.registerTool(
    'uploadFileToUssFile',
    {
      description:
        'Upload a UTF-8 workspace file to a z/OS USS path. Creates or overwrites the remote file.',
      annotations: { destructiveHint: true },
      outputSchema: uploadFileToUssFileOutputSchema,
      inputSchema: {
        localPath: z.string().describe('Source file under workspace roots or fallback directory.'),
        path: z.string().describe('Target USS path on z/OS.'),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        etag: z.string().optional().describe('ETag for optimistic locking.'),
        encoding: z.string().optional().describe('Mainframe encoding for the write.'),
      },
    },
    async ({ localPath, path: pathArg, system, etag, encoding }, extra) => {
      const progress = createToolProgress(extra, `Upload file to USS ${pathArg}`);
      await progress.start();
      try {
        const localResolved = await resolveLocalPathForTool(deps, localPath);
        const content = await fs.readFile(localResolved.absolutePath, 'utf-8');

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const sessionCtx = deps.sessionState.getContext(systemId);
        const effectiveCwd = sessionCtx?.ussCwd ?? sessionCtx?.ussHome;
        const resolvedUssPath = resolveUssPath(pathArg, effectiveCwd);
        const enc = resolveDatasetEncoding(
          encoding,
          sessionCtx?.mainframeUssEncoding,
          deps.encodingOptions.defaultMainframeUssEncoding
        );
        const userId = sessionCtx?.userId;
        const result = await deps.backend.writeUssFile(
          systemId,
          resolvedUssPath,
          content,
          etag,
          enc,
          userId
        );

        const pathDisplay = relativizeForDisplay(resolvedUssPath, effectiveCwd);
        const baseCtx = buildContext(systemId, {
          resolvedPath: resolvedUssPath !== pathArg.trim() ? pathDisplay : undefined,
        });
        const outCtx = {
          ...baseCtx,
          resolvedLocalPath: localResolved.absolutePath,
          rootUri: localResolved.rootUri,
          rootsSource: localResolved.source,
        } as ResponseContext;

        const bytesRead = Buffer.byteLength(content, 'utf-8');
        await progress.complete('Uploaded');
        return wrapResponse(outCtx, undefined, {
          bytesRead,
          etag: result.etag,
          ussPath: resolvedUssPath,
        });
      } catch (err) {
        const message =
          err instanceof LocalPathResolutionError ? err.message : (err as Error).message;
        await progress.complete(message);
        return errorResult(message);
      }
    }
  );

  server.registerTool(
    'downloadJobFileToFile',
    {
      description:
        'Download one job spool file from z/OS to a local workspace file as UTF-8 text. ' +
        'Use listJobFiles to obtain jobFileId. ' +
        'Missing parent directories for the destination file are created automatically.',
      annotations: { readOnlyHint: true },
      outputSchema: downloadJobFileToFileOutputSchema,
      inputSchema: {
        jobId: z.string().describe('Job ID (e.g. JOB00123).'),
        jobFileId: z.number().int().describe('Spool file ID from listJobFiles.'),
        localPath: z
          .string()
          .describe(
            'Destination path under workspace roots or fallback directory. ' +
              'Parent directories are created automatically if missing.'
          ),
        system: z.string().optional().describe(SYSTEM_PARAM_DESCRIPTION),
        overwrite: z
          .boolean()
          .optional()
          .describe('Allow overwriting an existing local file (default false).'),
      },
    },
    async ({ jobId, jobFileId, localPath, system, overwrite }, extra) => {
      const progress = createToolProgress(extra, `Download job file ${jobFileId} to ${localPath}`);
      await progress.start();
      try {
        const localResolved = await resolveLocalPathForTool(deps, localPath);
        try {
          await fs.access(localResolved.absolutePath);
          if (!overwrite) {
            await progress.complete('File exists');
            return errorResult(
              'Local file already exists. Pass overwrite: true to replace it, or choose a different localPath.'
            );
          }
        } catch {
          // ok
        }

        const { systemId, userId: resolvedUserId } = resolveSystemForTool(
          deps.systemRegistry,
          deps.sessionState,
          system
        );
        await ensureContext(deps, systemId, resolvedUserId);
        const progressCb = extra._meta?.progressToken
          ? (msg: string) => void progress.step(msg)
          : undefined;
        const result = await deps.backend.readJobFile(systemId, jobId, jobFileId, progressCb);
        const text = sanitizeTextForDisplay(result.text);
        await fs.mkdir(path.dirname(localResolved.absolutePath), { recursive: true });
        await fs.writeFile(localResolved.absolutePath, text, 'utf-8');
        const bytesWritten = Buffer.byteLength(text, 'utf-8');

        const ctx = localFileContext(systemId, localResolved);
        await progress.complete(`Wrote ${bytesWritten} bytes`);
        return wrapResponse(ctx, undefined, {
          bytesWritten,
          jobId: jobId.toUpperCase(),
          jobFileId,
        });
      } catch (err) {
        const message =
          err instanceof LocalPathResolutionError ? err.message : (err as Error).message;
        await progress.complete(message);
        return errorResult(message);
      }
    }
  );

  log.info(
    'Local file tools registered: downloadDatasetToFile, uploadFileToDataset, downloadUssFileToFile, uploadFileToUssFile, downloadJobFileToFile'
  );
}
