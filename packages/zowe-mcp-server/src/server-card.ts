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
 * MCP Server Card — types, constants, and utilities for building a server card
 * document aligned with SEP-2127 (draft) (MCP Server Cards / `GET /mcp/server-card`).
 *
 * SEP-2127 is an unaccepted draft maintained in the `experimental-ext-server-card`
 * repository; its shape may still change before (or instead of) acceptance into the
 * MCP specification. Track https://github.com/modelcontextprotocol/modelcontextprotocol/pull/2127
 * for status.
 *
 * The card itself is identity-and-transport-only, per SEP-2127: it deliberately
 * excludes tool/prompt/resource listings, which remain subject to runtime listing
 * via the protocol's list methods. Zowe-specific fields (capabilityTier) and the
 * tool/prompt/resourceTemplate listings exported by the `server-card` CLI command
 * live in the `_meta` extension namespace, and only in the CLI's file output — never
 * in the card served over HTTP.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CapabilityTier } from './capability-level.js';
import { createServer, getServer, SERVER_VERSION } from './server.js';

/** Reverse-DNS registry name for this server (matches the MCP registry server.json format). */
export const SERVER_CARD_NAME = 'io.zowe/mcp-server';
export const SERVER_CARD_TITLE = 'Zowe MCP Server';
export const SERVER_CARD_DESCRIPTION = 'MCP server providing tools for z/OS';
export const SERVER_CARD_WEBSITE_URL = 'https://github.com/zowe/zowe-mcp';
export const SERVER_CARD_REPOSITORY: Repository = {
  url: 'https://github.com/zowe/zowe-mcp',
  source: 'github',
  subfolder: 'packages/zowe-mcp-server',
};

/**
 * A user-supplied or pre-set input value, used for {@link Remote} URL variables.
 *
 * Simplified subset of the SEP-2127 `Input` type — omits `isSecret`, `default`,
 * `placeholder`, `value`, and `choices`, which this server does not need.
 */
export interface Input {
  /** Human-readable explanation of the input. */
  description?: string;
  /** Whether the input must be supplied for the connection to succeed. */
  isRequired?: boolean;
  /** Specifies the input format. */
  format?: 'string' | 'number' | 'boolean' | 'filepath';
}

/**
 * Metadata for connecting to a remote (HTTP-based) MCP server endpoint.
 *
 * Simplified subset of the SEP-2127 `Remote` type — omits `headers`, which this
 * server does not need.
 */
export interface Remote {
  /** The transport type for this remote endpoint. */
  type: 'streamable-http' | 'sse';
  /** URL (or `{template-variable}` URL) for the remote endpoint. */
  url: string;
  /** Configuration variables referenced as `{curly_braces}` placeholders in `url`. */
  variables?: Record<string, Input>;
  /** MCP protocol versions actively supported by this remote endpoint. */
  supportedProtocolVersions?: string[];
}

/**
 * Repository metadata for the MCP server source code.
 *
 * Simplified subset of the SEP-2127 `Repository` type — omits `id`, which this
 * server does not need.
 */
export interface Repository {
  /** Repository URL for browsing source code. */
  url: string;
  /** Repository hosting service identifier (e.g. `"github"`). */
  source: string;
  /** Relative path from repository root to the server location within a monorepo. */
  subfolder?: string;
}

/**
 * MCP Server Card document (SEP-2127, draft).
 *
 * Identity-and-transport-only, per the draft spec: no tool/prompt/resource
 * listings. Simplified subset of the SEP-2127 `ServerCard` type — omits `icons`,
 * which this server does not need.
 */
export interface ServerCard {
  /** The Server Card JSON Schema URI that this document conforms to. */
  $schema: string;
  /** Server name in reverse-DNS format, e.g. "io.zowe/mcp-server". */
  name: string;
  /** Version string for this server. */
  version: string;
  /** Clear human-readable explanation of server functionality. */
  description: string;
  /** Optional human-readable title or display name for the MCP server. */
  title?: string;
  /** Optional URL to the server's homepage, documentation, or project website. */
  websiteUrl?: string;
  /** Optional repository metadata for the MCP server source code. */
  repository?: Repository;
  /** Metadata helpful for making HTTP-based connections to this MCP server. */
  remotes?: Remote[];
  /**
   * Extension metadata using reverse-DNS namespacing for vendor-specific data.
   * Follows the protocol's standard `_meta` convention.
   */
  _meta?: Record<string, unknown>;
}

/**
 * Builds a SEP-2127 `Remote` entry for this server's Streamable HTTP endpoint.
 *
 * When `baseUrl` is known (e.g. at request time on a live HTTP server), the
 * remote's `url` is a concrete, connectable URL. Otherwise (e.g. when generating
 * static docs ahead of deployment) the remote declares a `{baseUrl}` template
 * variable for the client/operator to fill in.
 */
export function buildServerCardRemote(baseUrl?: string): Remote {
  if (baseUrl) {
    return {
      type: 'streamable-http',
      url: `${baseUrl.replace(/\/$/, '')}/mcp`,
      supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
    };
  }
  return {
    type: 'streamable-http',
    url: '{baseUrl}/mcp',
    variables: {
      baseUrl: {
        description: 'Base URL where this MCP server is deployed (e.g. https://mcp.example.com)',
        isRequired: true,
        format: 'string',
      },
    },
    supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
  };
}

export interface AssembleServerCardOptions {
  capabilityTier?: CapabilityTier;
  remotes?: Remote[];
  /**
   * Tool/prompt/resourceTemplate listings and a generation notice, exported ONLY into the
   * io.zowe/mcp-server _meta namespace of the CLI docs export (docs/mcp-server-card.json).
   * SEP-2127 deliberately excludes primitives (tools/prompts/resources) from the Server Card
   * proper — they remain subject to runtime listing via the protocol's list methods — so this
   * PR's documentation-export purpose is preserved only as a vendor extension, never in the
   * card served over HTTP.
   */
  docsExtras?: {
    generated: string;
    tools: unknown[];
    prompts: unknown[];
    resourceTemplates: unknown[];
  };
}

/** Assembles a server card. Pure, no I/O. */
export function assembleServerCard(opts: AssembleServerCardOptions = {}): ServerCard {
  const vendorMeta: Record<string, unknown> = {};
  if (opts.capabilityTier !== undefined) {
    vendorMeta.capabilityTier = opts.capabilityTier;
  }
  if (opts.docsExtras) {
    vendorMeta.generated = opts.docsExtras.generated;
    vendorMeta.tools = opts.docsExtras.tools;
    vendorMeta.prompts = opts.docsExtras.prompts;
    vendorMeta.resourceTemplates = opts.docsExtras.resourceTemplates;
  }
  return {
    $schema: 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json',
    name: SERVER_CARD_NAME,
    version: SERVER_VERSION,
    description: SERVER_CARD_DESCRIPTION,
    title: SERVER_CARD_TITLE,
    websiteUrl: SERVER_CARD_WEBSITE_URL,
    repository: SERVER_CARD_REPOSITORY,
    ...(opts.remotes ? { remotes: opts.remotes } : {}),
    ...(Object.keys(vendorMeta).length > 0 ? { _meta: { [SERVER_CARD_NAME]: vendorMeta } } : {}),
  };
}

/**
 * Spins up an in-memory probe server to list all capabilities and returns
 * an assembled server card, used only by the `server-card` CLI docs export.
 * Uses a minimal mock backend (tool registration is backend-independent; the
 * backend is only used when tools are invoked).
 *
 * @param indexJsPath - Absolute path to the compiled index.js entry point,
 *   used to invoke `init-mock` as a subprocess.
 * @param capabilityTier - Tier to register. Determines which tools appear.
 */
export async function buildServerCard(
  indexJsPath: string,
  capabilityTier: CapabilityTier,
  generated?: string
): Promise<ServerCard> {
  const tmpDir = mkdtempSync(join(tmpdir(), 'zowe-mcp-card-'));
  try {
    const init = spawnSync(
      process.execPath,
      [indexJsPath, 'init-mock', '--output', tmpDir, '--preset', 'minimal'],
      { encoding: 'utf-8' }
    );
    if (init.status !== 0) {
      throw new Error(`init-mock failed: ${init.stderr ?? init.stdout}`);
    }

    const { loadMock } = await import('./zos/mock/load-mock.js');
    const mock = await loadMock(tmpDir);
    const created = createServer({
      backend: mock.backend,
      systemRegistry: mock.systemRegistry,
      credentialProvider: mock.credentialProvider,
      capabilityTier,
      addTenantNativeConnection: async () => {
        /* probe only */
      },
      removeTenantNativeConnection: async () => {
        /* probe only */
      },
    });
    const server = getServer(created);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'server-card-probe', version: '1.0.0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);

    try {
      const [toolsResult, promptsResult, templatesResult] = await Promise.all([
        client.listTools(),
        client.listPrompts(),
        client.listResourceTemplates(),
      ]);
      return assembleServerCard({
        capabilityTier,
        remotes: [buildServerCardRemote()],
        docsExtras: {
          generated: generated ?? '',
          tools: toolsResult.tools,
          prompts: promptsResult.prompts,
          resourceTemplates: templatesResult.resourceTemplates,
        },
      });
    } finally {
      await client.close();
      await server.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
