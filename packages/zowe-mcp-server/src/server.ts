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
import { getOrCreateTenantResponseCache, tenantKeyFromSub } from './auth/tenant-resources.js';
import type {
  OpenDatasetInEditorEventData,
  OpenJobInEditorEventData,
  OpenUssFileInEditorEventData,
} from './events.js';
import { Logger } from './log.js';
import { installMcpServerInvocationContext } from './mcp-tool-context.js';
import { registerDatasetPrompts } from './prompts/dataset-prompts.js';
import { registerImprovementPrompts } from './prompts/improvement-prompts.js';
import { registerDatasetResources } from './resources/dataset-resources.js';
import { installToolCallLogging } from './tool-call-logging.js';
import { registerContextTools } from './tools/context/context-tools.js';
import { registerDatasetTools } from './tools/datasets/dataset-tools.js';
import { registerJobTools } from './tools/jobs/jobs-tools.js';
import { registerLocalFileTools } from './tools/local-files/local-file-tools.js';
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
The response messages array contains the exact parameters for the next call when more data is available.

z/OS Terminology

- Data set: A z/OS file. Always two words ("data set", not "dataset"). Fully qualified names use dot-separated qualifiers (e.g. USER.SRC.COBOL), max 44 characters.
- PDS (Partitioned Data Set): A data set containing named members (like a directory of files). DSORG=PO.
- PDS/E (Partitioned Data Set Extended): Modern replacement for PDS. Also called LIBRARY. DSORG=PO-E or DSNTYPE=LIBRARY. Preferred over PDS for new data sets. Accepted input aliases: PDSE, LIBRARY, PO-E.
- Member: A named entry within a PDS or PDS/E (up to 8 characters, uppercase).
- Sequential data set: A flat file (no members). Also called PS (Physical Sequential). DSORG=PS.
- DSN: Data Set Name — the fully qualified name of a data set.
- USS (UNIX System Services): The POSIX-compatible file system and shell environment on z/OS. Paths use forward slashes (e.g. /u/user).
- TSO (Time Sharing Option): Interactive command-line environment on z/OS for running commands and utilities.
- JCL (Job Control Language): The scripting language used to define and submit batch jobs on z/OS.
- RECFM (Record Format): How records are structured (e.g. FB=Fixed Block, VB=Variable Block).
- LRECL (Logical Record Length): Maximum length of a single record in bytes.
- VSAM (Virtual Storage Access Method): A high-performance file access method on z/OS. DSORG=VS.
- HSM/DFHSM: Hierarchical Storage Manager — migrates infrequently used data sets to cheaper storage. Use restoreDataset to recall.
- EBCDIC: The character encoding used on z/OS mainframes (e.g. IBM-037 for data sets, IBM-1047 for USS).
- HLQ (High-Level Qualifier): The first qualifier in a data set name, typically the user ID or project name.

Job card templates (submitJob): When the configured job card text contains placeholders, the server substitutes them before prepending JCL: literal substrings {jobname} (case-insensitive) and {programmer} in the stored template become the job name (default user ID plus A, max 8 characters) and programmer field (max 19 characters). Elicited or pasted full JOB statements are used as literal text without placeholder substitution.

CRITICAL — Non-retryable errors

When ANY tool response contains "stop": true, a fatal configuration error has occurred.
MANDATORY: Do NOT call any more tools. Do NOT retry. Do NOT attempt workarounds.
Show the exact text of the "suggestion" field to the user and wait for them to fix the configuration.`;

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
  /**
   * Directories allowed for upload/download tools when MCP roots/list is empty or unavailable.
   * From ZOWE_MCP_WORKSPACE_DIR, ZOWE_MCP_LOCAL_FILES_ROOT, and --local-files-root.
   */
  localFilesFallbackDirectories?: string[];
  /**
   * OIDC subject when HTTP is protected with Bearer JWT — enables shared per-user response cache
   * and CLI plugin state across MCP sessions for that user.
   */
  tenantSub?: string;
  /** Optional email claim when using JWT-backed HTTP. */
  tenantEmail?: string;
  /**
   * When set (HTTP + JWT + `ZOWE_MCP_TENANT_STORE_DIR`), registers `addZosConnection` to append
   * a `user@host` spec to the tenant file and refresh the in-memory connection list.
   */
  addTenantNativeConnection?: (spec: string) => Promise<void>;
  /**
   * When set together with `addTenantNativeConnection`, registers `removeZosConnection` to remove a
   * spec from the tenant file (not from server `--config`/`--system` bootstrap list).
   */
  removeTenantNativeConnection?: (spec: string) => Promise<void>;
  /**
   * Native SSH: formats `user@host` or `user@host:port` for job card keys (matches config / VS Code).
   */
  resolveJobCardConnectionSpec?: (systemId: string, userId: string) => string;
  /**
   * When set, called to obtain a job card if none is configured (e.g. extension prompt or MCP elicitation).
   */
  elicitJobCard?: (params: {
    connectionSpec: string;
    user: string;
    host: string;
    port: number;
  }) => Promise<string | undefined>;
  /**
   * After a successful elicitation, persist the card (e.g. tenant file or `--config` JSON).
   */
  persistJobCard?: (connectionSpec: string, jobCard: string) => void;
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
  const s = 'registerZoweExplorerTools' in result ? result.server : result;
  return s;
}

/** Known backend kind names for the getContext tool. */
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
  installMcpServerInvocationContext(server);

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
    const cacheOpts: ResponseCacheOptions | undefined =
      typeof responseCacheOpt === 'object' &&
      responseCacheOpt !== null &&
      !('getOrFetch' in responseCacheOpt)
        ? responseCacheOpt
        : undefined;
    const tenantSub = options.tenantSub?.trim();
    const responseCache: ResponseCache | undefined =
      responseCacheOpt === false
        ? undefined
        : typeof responseCacheOpt === 'object' &&
            responseCacheOpt !== null &&
            'getOrFetch' in responseCacheOpt
          ? responseCacheOpt
          : tenantSub
            ? getOrCreateTenantResponseCache(tenantKeyFromSub(tenantSub), cacheOpts)
            : createResponseCache(cacheOpts);

    const jobCardStore = options.jobCardStore ?? createJobCardStore();

    registerContextTools(
      server,
      {
        serverVersion: SERVER_VERSION,
        backendKind,
        systemRegistry,
        sessionState,
        credentialProvider,
        jobCardStore,
        onActiveConnectionChanged: options.onActiveConnectionChanged,
        encodingOptions,
        addTenantNativeConnection: options.addTenantNativeConnection,
        removeTenantNativeConnection: options.removeTenantNativeConnection,
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
        resolveJobCardConnectionSpec: options.resolveJobCardConnectionSpec,
        elicitJobCard: options.elicitJobCard,
        persistJobCard: options.persistJobCard,
        mcpServer: server,
      },
      logger
    );
    registerLocalFileTools(
      server,
      {
        backend,
        systemRegistry,
        sessionState,
        credentialProvider,
        responseCache: responseCache ?? undefined,
        encodingOptions,
        mcpServer: server,
        localFilesFallbackDirectories: options?.localFilesFallbackDirectories ?? [],
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
      void credentialProvider
        .getCredentials(singleSystem)
        .then(credentials => {
          sessionState.setActiveSystem(singleSystem, credentials.user);
          logger.info('Auto-activated single system', {
            system: singleSystem,
            userId: credentials.user,
          });
          const connectionSpec = `${credentials.user}@${singleSystem}`;
          onActiveConnectionChanged?.(connectionSpec);
        })
        .catch(err => {
          logger.debug('Auto-activation deferred (credentials not yet available)', {
            system: singleSystem,
            reason: err instanceof Error ? err.message : String(err),
          });
        });
    }

    logger.info('z/OS data set tools, resources, and prompts registered', {
      systems,
    });
  } else {
    // No backend — register getContext only (no listSystems/setSystem or z/OS tools)
    registerContextTools(
      server,
      {
        serverVersion: SERVER_VERSION,
        backendKind: null,
      },
      logger
    );
    logger.warning(
      'No z/OS backend configured — only the "getContext" tool is available. ' +
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
