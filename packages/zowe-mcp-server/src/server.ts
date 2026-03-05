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
 * Zowe MCP Server factory.
 *
 * Creates a transport-agnostic McpServer instance with all tools,
 * resources, and prompts registered.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createRequire } from 'node:module';
import type {
  OpenDatasetInEditorEventData,
  OpenJobInEditorEventData,
  OpenUssFileInEditorEventData,
} from './events.js';
import { Logger } from './log.js';
import { registerDatasetPrompts } from './prompts/dataset-prompts.js';
import { registerImprovementPrompts } from './prompts/improvement-prompts.js';
import { registerDatasetResources } from './resources/dataset-resources.js';
import { installToolCallLogging } from './tool-call-logging.js';
import { registerContextTools } from './tools/context/context-tools.js';
import { registerCoreTools } from './tools/core/zowe-info.js';
import { registerDatasetTools } from './tools/datasets/dataset-tools.js';
import { registerJobTools } from './tools/jobs/jobs-tools.js';
import { registerTsoTools } from './tools/tso/tso-tools.js';
import { registerUssTools } from './tools/uss/uss-tools.js';
import { registerZoweExplorerTools } from './tools/zowe-explorer/open-in-editor.js';
import type { ZosBackend } from './zos/backend.js';
import type { CredentialProvider } from './zos/credentials.js';
import {
  DEFAULT_MAINFRAME_MVS_ENCODING,
  DEFAULT_MAINFRAME_USS_ENCODING,
  type EncodingOptions,
} from './zos/encoding.js';
import { createJobCardStore, type JobCardStore } from './zos/job-cards.js';
import {
  createResponseCache,
  type ResponseCache,
  type ResponseCacheOptions,
} from './zos/response-cache.js';
import { SessionState } from './zos/session.js';
import { SystemRegistry } from './zos/system.js';

const require = createRequire(import.meta.url);
const packageJson: { version: string } = require('../package.json') as {
  version: string;
};

/** The server version from package.json. */
export const SERVER_VERSION: string = packageJson.version;

/**
 * MCP server instructions sent to clients during initialization.
 * Clients may add this to the system prompt so the LLM knows the pagination protocol.
 */
export const SERVER_INSTRUCTIONS = `Zowe MCP Server — Pagination Protocol

Many tools return paginated results. The response envelope contains a _result object with a hasMore boolean.

List pagination (listDatasets, listMembers, searchInDataset, listUssFiles, listJobs, listJobFiles, getJobOutput, searchJobOutput):
- When _result.hasMore is true, call the tool again with offset = current offset + _result.count and the same limit.

Line-windowed pagination (readDataset, readUssFile, readJobFile, runSafeUssCommand, runSafeTsoCommand):
- When _result.hasMore is true, call the tool again with startLine = _result.startLine + _result.returnedLines and the same lineCount.

If the task requires more data, do not answer with only the first page/window; keep calling you have the desired amount of data.
The response messages array contains the exact parameters for the next call when more data is available.`;

/** Shared root logger for the MCP server process. */
let rootLogger: Logger | undefined;

/**
 * Returns the root {@link Logger} instance, creating it on first call.
 *
 * The logger is a singleton so that all modules (server, transports, tools)
 * share the same configuration and MCP server attachment.
 */
export function getLogger(): Logger {
  rootLogger ??= new Logger({ name: 'server' });
  return rootLogger;
}

/**
 * Prefixes of environment variable names that are relevant to the MCP server.
 * Variables matching these prefixes are included in the startup log.
 * Anything containing "SECRET", "TOKEN", "PASSWORD", or "KEY" is redacted.
 */
const ENV_PREFIXES = ['ZOWE_', 'MCP_', 'NODE_', 'VSCODE_'];

/** Substrings that indicate a variable contains sensitive data. */
const SENSITIVE_SUBSTRINGS = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'CREDENTIAL'];

/**
 * Returns a filtered snapshot of environment variables relevant to the server.
 * Sensitive values are redacted to avoid leaking credentials into logs.
 */
function getRelevantEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    const upper = name.toUpperCase();
    if (!ENV_PREFIXES.some(prefix => upper.startsWith(prefix))) continue;
    const isSensitive = SENSITIVE_SUBSTRINGS.some(s => upper.includes(s));
    result[name] = isSensitive ? '***' : value;
  }
  return result;
}

/** Options for creating the MCP server. */
export interface CreateServerOptions {
  /** z/OS backend implementation (mock or real). */
  backend?: ZosBackend;
  /** System registry with known z/OS systems. */
  systemRegistry?: SystemRegistry;
  /** Credential provider for resolving user identities. */
  credentialProvider?: CredentialProvider;
  /**
   * Response cache for backend results (e.g. listDatasets, listMembers). If undefined, a new in-memory cache is created with defaults (10 min TTL, 1 GB max).
   * If false, cache is disabled and tools call the backend directly on every request.
   * If a ResponseCache instance is passed (e.g. from createResponseCache()), that instance is used so tests can inject a fresh empty cache or share one.
   */
  responseCache?: ResponseCacheOptions | ResponseCache | false;
  /**
   * Default mainframe encodings. When not provided, uses IBM-037 for MVS data sets and IBM-1047 for USS.
   * Can be a mutable ref so runtime updates (e.g. encoding-options-update from VS Code) can change defaults without recreating the server.
   */
  encodingOptions?: EncodingOptions | { current: EncodingOptions };
  /**
   * Store for JCL job cards per connection spec (used by submitJob when JCL has no job card).
   * When not provided but a backend is present, a new empty store is used so job tools can register.
   */
  jobCardStore?: JobCardStore;
  /**
   * When true, every tool call is logged with full input and full response (and backend type).
   * When false or omitted, no tool-call logging. Can be overridden by env ZOWE_MCP_LOG_TOOL_CALLS=1 or true.
   */
  logToolCalls?: boolean;
  /**
   * When provided (and Zowe Explorer is available), registers open-in-editor tools
   * that send events to the VS Code extension (data set, USS file, job/spool).
   */
  openInZoweEditor?: (payload: OpenDatasetInEditorEventData) => void;
  openUssFileInZoweEditor?: (payload: OpenUssFileInEditorEventData) => void;
  openJobInZoweEditor?: (payload: OpenJobInEditorEventData) => void;
  /**
   * When provided, called whenever the active z/OS connection changes (e.g. after setSystem or single-system auto-activation).
   * Receives the connection spec (e.g. user@host) or null when there is no active system.
   */
  onActiveConnectionChanged?: (activeConnection: string | null) => void;
}

/** Callbacks required to register Zowe Explorer open-in-editor tools (e.g. for late registration). */
export interface ZoweExplorerCallbacks {
  openInZoweEditor: (payload: OpenDatasetInEditorEventData) => void;
  openUssFileInZoweEditor: (payload: OpenUssFileInEditorEventData) => void;
  openJobInZoweEditor: (payload: OpenJobInEditorEventData) => void;
}

/** Result of createServer: server only, or server plus late Zowe Explorer tool registration. */
export type CreateServerResult =
  | McpServer
  | {
      server: McpServer;
      registerZoweExplorerTools: (callbacks: ZoweExplorerCallbacks) => void;
    };

/** Returns the McpServer from a CreateServerResult (for callers that only need the server). */
export function getServer(result: CreateServerResult): McpServer {
  const s = 'server' in result ? result.server : result;
  return s as McpServer;
}

/** Known backend kind names for the info tool. */
const BACKEND_KIND_NAMES: Record<string, string> = {
  FilesystemMockBackend: 'mock',
  NativeBackend: 'native',
};

function getBackendKind(backend: ZosBackend): string {
  const name = backend.constructor.name;
  return BACKEND_KIND_NAMES[name] ?? name;
}

/**
 * Creates and returns a fully configured McpServer with all tools,
 * resources, and prompts registered.
 *
 * The server is transport-agnostic — connect it to any transport after creation.
 *
 * The logging capability is declared so that `sendLoggingMessage()` can
 * forward structured log messages to the connected MCP client.
 *
 * When a backend is configured, returns { server, registerZoweExplorerTools } so
 * callers can register the open-in-editor tools later (e.g. when Zowe Explorer
 * becomes available via a pipe event).
 */
export function createServer(options?: CreateServerOptions): CreateServerResult {
  const logger = getLogger();

  logger.info('Creating Zowe MCP Server', {
    version: SERVER_VERSION,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    env: getRelevantEnv(),
    mockMode: !!options?.backend,
  });

  const server: McpServer = new McpServer(
    {
      name: 'zowe-mcp-server',
      version: SERVER_VERSION,
    },
    {
      capabilities: {
        logging: {},
      },
      instructions: SERVER_INSTRUCTIONS,
    }
  );

  logger.attach(server);

  // Log when a client completes initialization
  server.server.oninitialized = () => {
    const clientInfo = server.server.getClientVersion();
    const clientCaps = server.server.getClientCapabilities();
    logger.info('Client connected', {
      clientName: clientInfo?.name,
      clientVersion: clientInfo?.version,
      capabilities: clientCaps ? Object.keys(clientCaps) : [],
    });
  };

  const hasBackend = !!(options?.backend && options.credentialProvider);
  const backendKind = hasBackend ? getBackendKind(options.backend!) : null;
  const logToolCalls =
    options?.logToolCalls ??
    (process.env.ZOWE_MCP_LOG_TOOL_CALLS === '1' ||
      process.env.ZOWE_MCP_LOG_TOOL_CALLS === 'true');
  let sessionStateForZe: SessionState | undefined;
  let backendKindForZe: string | null = null;

  if (logToolCalls) {
    installToolCallLogging(server, logger, backendKind);
  }

  // Register core tools (info) — always available
  registerCoreTools(server, SERVER_VERSION, logger, { backend: backendKind });

  // Register improvement prompts (for repos that use Zowe MCP) — always available
  registerImprovementPrompts(server, logger);

  // Register z/OS tools, resources, and prompts if a backend is provided
  if (hasBackend) {
    const backend = options.backend!;
    const systemRegistry = options.systemRegistry ?? new SystemRegistry();
    const credentialProvider = options.credentialProvider!;
    const sessionState = new SessionState();
    sessionStateForZe = sessionState;
    backendKindForZe = getBackendKind(backend);
    const encodingOpt = options.encodingOptions;
    const encodingOptions: EncodingOptions =
      encodingOpt === undefined
        ? {
            defaultMainframeMvsEncoding: DEFAULT_MAINFRAME_MVS_ENCODING,
            defaultMainframeUssEncoding: DEFAULT_MAINFRAME_USS_ENCODING,
          }
        : 'current' in encodingOpt
          ? encodingOpt.current
          : encodingOpt;
    const responseCacheOpt = options.responseCache;
    const responseCache: ResponseCache | undefined =
      responseCacheOpt === false
        ? undefined
        : typeof responseCacheOpt === 'object' &&
            responseCacheOpt !== null &&
            'getOrFetch' in responseCacheOpt
          ? responseCacheOpt
          : createResponseCache(
              typeof responseCacheOpt === 'object' ? responseCacheOpt : undefined
            );

    const jobCardStore = options.jobCardStore ?? createJobCardStore();

    registerContextTools(
      server,
      {
        systemRegistry,
        sessionState,
        credentialProvider,
        jobCardStore,
        onActiveConnectionChanged: options.onActiveConnectionChanged,
      },
      logger
    );
    registerDatasetTools(
      server,
      {
        backend,
        systemRegistry,
        sessionState,
        credentialProvider,
        responseCache,
        encodingOptions,
      },
      logger
    );
    registerUssTools(
      server,
      {
        backend,
        systemRegistry,
        sessionState,
        credentialProvider,
        responseCache: responseCache ?? undefined,
        encodingOptions,
        mcpServer: server,
      },
      logger
    );
    registerTsoTools(
      server,
      {
        backend,
        systemRegistry,
        sessionState,
        credentialProvider,
        responseCache: responseCache ?? undefined,
        mcpServer: server,
      },
      logger
    );
    registerJobTools(
      server,
      {
        backend,
        systemRegistry,
        sessionState,
        credentialProvider,
        jobCardStore,
      },
      logger
    );
    // Console tools disabled: ZNP does not yet support console.issueCmd.
    // Re-enable when the SDK adds support.
    // registerConsoleTools(
    //   server,
    //   {
    //     backend,
    //     systemRegistry,
    //     sessionState,
    //     credentialProvider,
    //     mcpServer: server,
    //   },
    //   logger
    // );
    registerDatasetResources(server, { backend }, logger);
    registerDatasetPrompts(server, { backend, systemRegistry, sessionState }, logger);

    // Auto-activate the system when there is exactly one configured
    const systems = systemRegistry.list();
    if (systems.length === 1) {
      const singleSystem = systems[0];
      const onActiveConnectionChanged = options.onActiveConnectionChanged;
      void credentialProvider.getCredentials(singleSystem).then(credentials => {
        sessionState.setActiveSystem(singleSystem, credentials.user);
        logger.info('Auto-activated single system', {
          system: singleSystem,
          userId: credentials.user,
        });
        const connectionSpec = `${credentials.user}@${singleSystem}`;
        onActiveConnectionChanged?.(connectionSpec);
      });
    }

    logger.info('z/OS data set tools, resources, and prompts registered', {
      systems,
    });
  } else {
    logger.warning(
      'No z/OS backend configured — only the "info" tool is available. ' +
        'To enable all z/OS tools: in VS Code run "Zowe MCP: Generate Mock Data" from the Command Palette, ' +
        'or use --mock <dir> / ZOWE_MCP_MOCK_DIR for standalone mode.'
    );
  }

  if (
    options?.openInZoweEditor ||
    options?.openUssFileInZoweEditor ||
    options?.openJobInZoweEditor
  ) {
    registerZoweExplorerTools(
      server,
      {
        openInZoweEditor: options.openInZoweEditor,
        openUssFileInZoweEditor: options.openUssFileInZoweEditor,
        openJobInZoweEditor: options.openJobInZoweEditor,
        sessionState: sessionStateForZe,
        backendKind: backendKindForZe,
      },
      logger
    );
  }

  logger.info('Server created, tools registered');

  if (hasBackend) {
    const registerLater = (callbacks: ZoweExplorerCallbacks): void => {
      registerZoweExplorerTools(
        server,
        {
          ...callbacks,
          sessionState: sessionStateForZe,
          backendKind: backendKindForZe,
        },
        logger
      );
    };
    return { server, registerZoweExplorerTools: registerLater };
  }
  return server;
}
