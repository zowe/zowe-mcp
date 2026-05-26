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
 * Profiles for MCP-host environments where the Zowe MCP VS Code extension's
 * `vscode.lm.registerMcpServerDefinitionProvider` registration is NOT consumed —
 * the agent reads MCP servers only from its own JSON config file. In those
 * hosts, installing this extension alone is not enough to give the agent
 * access to Zowe tools; the user has to write an `mcp.json` entry as well.
 *
 * This module is the data layer: it lists known hosts, knows how to detect
 * each one, and knows the shape of each host's `mcp.json` schema. The
 * runtime layer (`host-compat.ts`) consumes this registry.
 *
 * To add a new host, append a `HostCompatProfile` to {@link hostCompatProfiles}.
 * Do NOT add a host that DOES consume the provider API — those need no warning.
 */

import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

/** Inputs the snippet builder works from, in a host-agnostic shape. */
export interface ServerSpec {
  /** Absolute path to the `zowe-mcp-server` binary (or wrapper). */
  command: string;
  /** Command-line args (`--stdio`, backend selection, etc.). */
  args: string[];
  /** Optional env-var pass-through block. */
  env?: Record<string, string>;
  /** Tool names to skip per-call confirmation for. Translated to each host's field name. */
  autoApproveTools?: string[];
}

export interface HostScope {
  id: 'user' | 'workspace';
  label: string;
  description: string;
  /**
   * Absolute path where the host expects `mcp.json` at this scope, or `undefined`
   * if the scope is not currently usable (e.g. workspace scope with no workspace open).
   */
  resolvePath(): string | undefined;
}

export interface HostCompatProfile {
  /** Stable id; used in globalState keys and command arguments. */
  id: string;
  /** Display name for UI strings. */
  displayName: string;
  /** External docs URL for this host's MCP config. */
  docsUrl: string;
  /** True when this host is active in the current VS Code session. */
  isActive(): boolean;
  /** Config-file scopes this host supports, in recommended order. */
  scopes: HostScope[];
  /** Build the per-server JSON object for this host's mcp.json schema. */
  buildMcpJsonEntry(spec: ServerSpec): Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Kiro
// ---------------------------------------------------------------------------

const kiroUserScope: HostScope = {
  id: 'user',
  label: 'User',
  description: '~/.kiro/settings/mcp.json — applies to every workspace',
  resolvePath: () => path.join(os.homedir(), '.kiro', 'settings', 'mcp.json'),
};

const kiroWorkspaceScope: HostScope = {
  id: 'workspace',
  label: 'Workspace',
  description: '<workspace>/.kiro/settings/mcp.json — pinned to this workspace',
  resolvePath: () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? path.join(folder.uri.fsPath, '.kiro', 'settings', 'mcp.json') : undefined;
  },
};

export const kiroProfile: HostCompatProfile = {
  id: 'kiro',
  displayName: 'Kiro',
  docsUrl: 'https://kiro.dev/docs/mcp/configuration/',
  isActive: () => vscode.env.appName === 'Kiro',
  scopes: [kiroUserScope, kiroWorkspaceScope],
  buildMcpJsonEntry: spec => ({
    command: spec.command,
    args: spec.args,
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.autoApproveTools?.length ? { autoApprove: spec.autoApproveTools } : {}),
  }),
};

// ---------------------------------------------------------------------------
// Roo Code (extension that runs *inside* a VS Code-based host)
//
// Roo loads MCP servers only from its own configuration (.roo/mcp.json or
// its globalStorage `mcp_settings.json`). The Zowe MCP extension's provider
// registration is invisible to Roo. The user-scope file lives in opaque
// globalStorage, so we offer workspace scope only.
// ---------------------------------------------------------------------------

const rooWorkspaceScope: HostScope = {
  id: 'workspace',
  label: 'Workspace',
  description: '<workspace>/.roo/mcp.json — pinned to this workspace',
  resolvePath: () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? path.join(folder.uri.fsPath, '.roo', 'mcp.json') : undefined;
  },
};

/**
 * Roo has been published under a few extension ids across rebrands. Match any
 * of the known forms (VS Code looks these up case-insensitively).
 */
const ROO_EXTENSION_IDS = [
  'RooVeterinaryInc.roo-cline',
  'rooveterinaryinc.roo-cline',
  'RooVeterinaryInc.roo-code',
  'rooveterinaryinc.roo-code',
];

export const rooProfile: HostCompatProfile = {
  id: 'roo',
  displayName: 'Roo Code',
  docsUrl: 'https://docs.roocode.com/features/mcp/using-mcp-in-roo',
  isActive: () => ROO_EXTENSION_IDS.some(id => vscode.extensions.getExtension(id) !== undefined),
  scopes: [rooWorkspaceScope],
  buildMcpJsonEntry: spec => ({
    type: 'stdio',
    command: spec.command,
    args: spec.args,
    ...(spec.env ? { env: spec.env } : {}),
    ...(spec.autoApproveTools?.length ? { alwaysAllow: spec.autoApproveTools } : {}),
    timeout: 60,
  }),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const hostCompatProfiles: HostCompatProfile[] = [kiroProfile, rooProfile];

export function getActiveHostCompatProfiles(): HostCompatProfile[] {
  return hostCompatProfiles.filter(p => p.isActive());
}

export function findHostCompatProfile(id: string): HostCompatProfile | undefined {
  return hostCompatProfiles.find(p => p.id === id);
}
