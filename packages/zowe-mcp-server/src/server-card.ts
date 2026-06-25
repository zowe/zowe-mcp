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
 * document aligned with SEP-1649 (MCP Server Cards / .well-known/mcp/server-card.json).
 *
 * The card format is a subset of the MCP registry server.json schema, extended
 * with static tool/prompt/resource listings from the live MCP protocol list methods.
 * Zowe-specific fields (capabilityTier) live in the _meta extension namespace.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
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

/**
 * MCP Server Card document.
 *
 * Aligned with SEP-1649 (.well-known/mcp/server-card.json) and the MCP registry
 * server.json schema. The `tools`, `prompts`, `resources`, and `resourceTemplates`
 * fields contain static listings from the server's MCP list methods.
 */
export interface McpServerCard {
  /** Auto-generation notice. Present in file output; omitted from live HTTP endpoint. */
  _generated?: string;
  /** MCP protocol version this server implements (e.g. "2025-11-25"). */
  protocolVersion: string;
  /** Server identity fields — a subset of the MCP registry server.json envelope. */
  serverInfo: {
    /** Reverse-DNS registry name, e.g. "io.zowe/mcp-server". */
    name: string;
    /** Human-readable display name. */
    title: string;
    description: string;
    version: string;
  };
  /**
   * Vendor-specific extensions using reverse-DNS namespacing,
   * following the MCP registry _meta convention.
   */
  _meta?: Record<string, Record<string, unknown>>;
  tools: unknown[];
  prompts: unknown[];
  resources: unknown[];
  /**
   * URI-template resources (RFC 6570). Distinct from static resources in the
   * MCP protocol (`resources/templates/list`). Not yet in the server card spec
   * but preserved here as the MCP protocol itself distinguishes them.
   */
  resourceTemplates: unknown[];
}

/** Assembles a server card from already-fetched capability lists. Pure, no I/O. */
export function assembleServerCard(opts: {
  tools: unknown[];
  prompts: unknown[];
  resources: unknown[];
  resourceTemplates: unknown[];
  capabilityTier?: CapabilityTier;
  generated?: string;
}): McpServerCard {
  return {
    ...(opts.generated !== undefined ? { _generated: opts.generated } : {}),
    protocolVersion: LATEST_PROTOCOL_VERSION,
    serverInfo: {
      name: SERVER_CARD_NAME,
      title: SERVER_CARD_TITLE,
      description: SERVER_CARD_DESCRIPTION,
      version: SERVER_VERSION,
    },
    ...(opts.capabilityTier !== undefined
      ? { _meta: { [SERVER_CARD_NAME]: { capabilityTier: opts.capabilityTier } } }
      : {}),
    tools: opts.tools,
    prompts: opts.prompts,
    resources: opts.resources,
    resourceTemplates: opts.resourceTemplates,
  };
}

/**
 * Spins up an in-memory probe server to list all capabilities and returns
 * an assembled server card. Uses a minimal mock backend (tool registration
 * is backend-independent; the backend is only used when tools are invoked).
 *
 * @param indexJsPath - Absolute path to the compiled index.js entry point,
 *   used to invoke `init-mock` as a subprocess.
 * @param capabilityTier - Tier to register. Determines which tools appear.
 */
export async function buildServerCard(
  indexJsPath: string,
  capabilityTier: CapabilityTier,
  generated?: string
): Promise<McpServerCard> {
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
      const [toolsResult, promptsResult, resourcesResult, templatesResult] = await Promise.all([
        client.listTools(),
        client.listPrompts(),
        client.listResources(),
        client.listResourceTemplates(),
      ]);
      return assembleServerCard({
        tools: toolsResult.tools,
        prompts: promptsResult.prompts,
        resources: resourcesResult.resources,
        resourceTemplates: templatesResult.resourceTemplates,
        capabilityTier,
        generated,
      });
    } finally {
      await client.close();
      await server.close();
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}
