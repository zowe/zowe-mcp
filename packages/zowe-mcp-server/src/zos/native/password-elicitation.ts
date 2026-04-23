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
 * MCP elicitation for connection passwords (standalone / no VS Code pipe).
 * Per MCP spec (2025-11-25+), servers MUST NOT use form mode for secrets; URL mode keeps the
 * password out of the client/LLM. Default {@link PasswordElicitMode} is **auto**: try URL mode
 * first, then form only as a fallback for legacy clients (with a notice log).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { randomUUID } from 'node:crypto';
import type { Logger } from '../../log.js';
import { isVisualStudioCodeMcpClient } from '../../mcp-client-hints.js';
import { getCurrentMcpServer } from '../../mcp-tool-context.js';
import type { CreateServerResult } from '../../server.js';
import { getServer } from '../../server.js';
import {
  registerPasswordUrlPending,
  takePasswordUrlPending,
} from './password-url-elicit-registry.js';

export type PasswordElicitMode = 'form' | 'url' | 'auto';

function elicitModeFromEnv(): PasswordElicitMode {
  const m = (process.env.ZOWE_MCP_PASSWORD_ELICIT_MODE ?? 'auto').trim().toLowerCase();
  if (m === 'url' || m === 'auto' || m === 'form') {
    return m;
  }
  return 'auto';
}

/** Matches MCP SDK getSupportedElicitationModes (form defaults when neither declared). */
function supportsFormElicitation(
  elicitation: { form?: unknown; url?: unknown } | undefined
): boolean {
  if (!elicitation) {
    return false;
  }
  const hasFormCapability = elicitation.form !== undefined;
  const hasUrlCapability = elicitation.url !== undefined;
  return hasFormCapability || (!hasFormCapability && !hasUrlCapability);
}

function supportsUrlElicitation(
  elicitation: { form?: unknown; url?: unknown } | undefined
): boolean {
  return elicitation?.url !== undefined;
}

async function tryFormElicit(
  mcpServer: McpServer,
  user: string,
  host: string,
  port: number,
  log: Logger
): Promise<string | undefined> {
  const elicitation = mcpServer.server.getClientCapabilities()?.elicitation;
  if (!supportsFormElicitation(elicitation)) {
    return undefined;
  }
  const vsCode = isVisualStudioCodeMcpClient(mcpServer.server.getClientVersion()?.name);
  const message = vsCode
    ? port === 22
      ? `Enter your password for ${user}@${host}.`
      : `Enter your password for ${user}@${host}:${port}.`
    : port === 22
      ? `Enter password for connection ${user}@${host}`
      : `Enter password for connection ${user}@${host}:${port}`;
  const passwordDescription = vsCode
    ? `Password for ${user}@${host}`
    : `Password for ${user}@${host} (z/OS SSH, Db2, or other tools using this user@host)`;
  try {
    const result = await mcpServer.server.elicitInput({
      mode: 'form',
      message,
      requestedSchema: {
        type: 'object',
        properties: {
          password: {
            type: 'string',
            title: 'Password',
            description: passwordDescription,
          },
        },
        required: ['password'],
      },
    });
    if (
      result.action === 'accept' &&
      result.content &&
      typeof result.content.password === 'string'
    ) {
      return result.content.password;
    }
  } catch (err) {
    log.debug('Form elicitation failed', {
      user,
      host,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return undefined;
}

async function tryUrlElicit(
  mcpServer: McpServer,
  user: string,
  host: string,
  port: number,
  getPublicBaseUrl: () => string,
  log: Logger
): Promise<string | undefined> {
  const elicitation = mcpServer.server.getClientCapabilities()?.elicitation;
  if (!supportsUrlElicitation(elicitation)) {
    return undefined;
  }
  const base = getPublicBaseUrl().trim().replace(/\/$/, '');
  if (!base.startsWith('http://') && !base.startsWith('https://')) {
    log.warning(
      'URL password elicitation skipped: set ZOWE_MCP_PUBLIC_BASE_URL (or HTTP listen URL after start) to an absolute http(s) URL'
    );
    return undefined;
  }
  const elicitationId = randomUUID();
  const url = `${base}/zowe-mcp/password-elicit/${elicitationId}`;
  const clientVersion = mcpServer.server.getClientVersion();
  const vsCode = isVisualStudioCodeMcpClient(clientVersion?.name);
  const message = vsCode
    ? port === 22
      ? `Open this link in your browser to enter your password for ${user}@${host}.`
      : `Open this link in your browser to enter your password for ${user}@${host}:${port}.`
    : port === 22
      ? `Open the page to enter the password for connection ${user}@${host}.`
      : `Open the page to enter the password for connection ${user}@${host}:${port}.`;

  const pwCtl: {
    resolve?: (value: string) => void;
    reject?: (reason: Error) => void;
  } = {};
  const passwordPromise = new Promise<string>((resolve, reject) => {
    pwCtl.resolve = resolve;
    pwCtl.reject = reject;
  });

  const timeoutMs = Number(process.env.ZOWE_MCP_PASSWORD_ELICIT_URL_TIMEOUT_MS ?? 300_000);
  const timer = setTimeout(
    () => {
      takePasswordUrlPending(elicitationId);
      pwCtl.reject?.(new Error('Password URL elicitation timed out'));
    },
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 300_000
  );

  registerPasswordUrlPending(elicitationId, {
    resolve: (pw: string) => {
      clearTimeout(timer);
      pwCtl.resolve?.(pw);
    },
    reject: (e: Error) => {
      clearTimeout(timer);
      pwCtl.reject?.(e);
    },
    mcpServer,
    user,
    host,
    port,
    mcpClientName: clientVersion?.name,
    mcpClientVersion: clientVersion?.version,
  });

  try {
    await mcpServer.server.elicitInput({
      mode: 'url',
      message,
      elicitationId,
      url,
    });
  } catch (err) {
    takePasswordUrlPending(elicitationId);
    log.debug('URL elicitation request failed', {
      user,
      host,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  try {
    const password = await passwordPromise;
    await mcpServer.server.createElicitationCompletionNotifier(elicitationId)();
    return password;
  } catch (err) {
    log.debug('URL elicitation wait failed', {
      user,
      host,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

export interface StandalonePasswordElicitationOptions {
  serverRef?: { current: CreateServerResult | null };
  getPublicBaseUrl: () => string;
  log: Logger;
}

/**
 * Resolves the MCP server for the current tool call (HTTP sessions) or stdio ({@link serverRef}).
 */
export function resolveMcpServerForElicitation(serverRef?: {
  current: CreateServerResult | null;
}): McpServer | undefined {
  return getCurrentMcpServer() ?? (serverRef?.current ? getServer(serverRef.current) : undefined);
}

/**
 * Callback suitable for {@link NativeCredentialProviderOptions.requestPasswordViaElicitation}
 * when the VS Code extension pipe is not used.
 */
export function createStandalonePasswordElicitation(
  options: StandalonePasswordElicitationOptions
): (user: string, host: string, port?: number) => Promise<string | undefined> {
  const { serverRef, getPublicBaseUrl, log } = options;
  return async (user: string, host: string, port?: number) => {
    const mcpServer = resolveMcpServerForElicitation(serverRef);
    if (!mcpServer) {
      return undefined;
    }
    const portNum = port ?? 22;
    const mode = elicitModeFromEnv();
    if (mode === 'form') {
      return tryFormElicit(mcpServer, user, host, portNum, log);
    }
    if (mode === 'url') {
      return tryUrlElicit(mcpServer, user, host, portNum, getPublicBaseUrl, log);
    }
    // auto: URL first (spec-compliant for secrets), then form for clients without url capability / no HTTP base
    const urlPw = await tryUrlElicit(mcpServer, user, host, portNum, getPublicBaseUrl, log);
    if (urlPw !== undefined && urlPw !== '') {
      return urlPw;
    }
    const formPw = await tryFormElicit(mcpServer, user, host, portNum, log);
    if (formPw !== undefined && formPw !== '') {
      log.notice(
        'Connection password was collected via form elicitation; MCP spec recommends URL mode for secrets. Prefer HTTP transport with a client that declares elicitation.url (opens /zowe-mcp/password-elicit/…), or set ZOWE_MCP_PASSWORD_ELICIT_MODE=url with ZOWE_MCP_PUBLIC_BASE_URL when needed.',
        { user, host }
      );
      return formPw;
    }
    return undefined;
  };
}
