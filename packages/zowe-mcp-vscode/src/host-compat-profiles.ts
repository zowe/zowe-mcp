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
 * each one, and where the setup guide for each one lives. The runtime layer
 * ({@link ./host-compat.ts}) consumes this registry to surface a one-time
 * notice with a link to that guide.
 *
 * To add a new host, append a `HostCompatProfile` to {@link hostCompatProfiles}.
 * Do NOT add a host that DOES consume the provider API — those need no warning.
 */

import * as vscode from 'vscode';

export interface HostCompatProfile {
  /** Stable id; used in globalState dismissal keys. */
  id: string;
  /** Display name for UI strings. */
  displayName: string;
  /** Setup-guide URL for this host (full HTTPS URL). */
  docsUrl: string;
  /** True when this host is active in the current VS Code session. */
  isActive(): boolean;
}

// ---------------------------------------------------------------------------
// Kiro — identifies itself via vscode.env.appName.
// ---------------------------------------------------------------------------

export const kiroProfile: HostCompatProfile = {
  id: 'kiro',
  displayName: 'Kiro',
  docsUrl: 'https://github.com/zowe/zowe-mcp/blob/main/docs/kiro-mcp.md',
  isActive: () => vscode.env.appName === 'Kiro',
};

// ---------------------------------------------------------------------------
// Roo Code — a VS Code extension that loads MCP servers only from its own
// configuration (.roo/mcp.json or globalStorage mcp_settings.json). Detect
// it by presence of any of the known extension ids across rebrands.
// ---------------------------------------------------------------------------

const ROO_EXTENSION_IDS = [
  'RooVeterinaryInc.roo-cline',
  'rooveterinaryinc.roo-cline',
  'RooVeterinaryInc.roo-code',
  'rooveterinaryinc.roo-code',
];

export const rooProfile: HostCompatProfile = {
  id: 'roo',
  displayName: 'Roo Code',
  docsUrl: 'https://github.com/zowe/zowe-mcp/blob/main/docs/roo-or-standalone-mcp.md',
  isActive: () => ROO_EXTENSION_IDS.some(id => vscode.extensions.getExtension(id) !== undefined),
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const hostCompatProfiles: HostCompatProfile[] = [kiroProfile, rooProfile];

export function getActiveHostCompatProfiles(): HostCompatProfile[] {
  return hostCompatProfiles.filter(p => p.isActive());
}
