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
 * Status bar item showing the current (or last) active Zowe MCP connection.
 * Read-only; updated when the MCP server sends active-connection-changed events.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const STATUS_BAR_PRIORITY = 50;
const GLOBAL_STATE_KEY_LAST_CONNECTION = 'zoweMcpLastActiveConnection';

let statusBarItem: vscode.StatusBarItem | undefined;
let statusBarContext: vscode.ExtensionContext | undefined;

/** Snapshot of active profiles for one CLI plugin. */
interface PluginActiveProfiles {
  /** Active named profile ID per type key (e.g. { connection: "mock-cowboys" }). */
  activeProfiles: Record<string, string>;
  /** Active virtual context fields per type key (e.g. { location: { environment: "DEV", system: "BANKING" } }). */
  activeContext: Record<string, Record<string, string>>;
}

/** Stores the latest active profile snapshot per plugin name. */
const cliPluginActiveProfiles = new Map<string, PluginActiveProfiles>();

/**
 * Builds a tooltip MarkdownString that includes the backend type, system names,
 * and active CLI plugin profiles when available.
 */
function buildTooltip(backend: 'native' | 'mock', systems: string[]): vscode.MarkdownString {
  const examples =
    systems.length > 0
      ? systems.length === 1
        ? `"set active system to ${systems[0]}"`
        : `"set active system to ${systems[0]}" or "switch to ${systems[1]}"`
      : '"set active system to SYS1" or "switch to USER@SYS1"';

  const source =
    backend === 'native'
      ? 'Connections are added in Settings (`zoweMCP.nativeConnections`).'
      : 'Systems are defined in the mock data directory.';

  const md = new vscode.MarkdownString();
  md.appendMarkdown(
    `**Zowe MCP** active connection (${backend})  \n${source} Active system set via Chat (e.g. *${examples}*).`
  );

  if (cliPluginActiveProfiles.size > 0) {
    md.appendMarkdown('\n\n**CLI Plugins:**');
    for (const [pluginName, snapshot] of cliPluginActiveProfiles) {
      const label = pluginName.charAt(0).toUpperCase() + pluginName.slice(1);
      for (const [typeKey, id] of Object.entries(snapshot.activeProfiles)) {
        md.appendMarkdown(`\n- ${label} ${typeKey}: \`${id}\``);
      }
      for (const [typeKey, ctx] of Object.entries(snapshot.activeContext)) {
        const fields = Object.entries(ctx)
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => `${k}=${v}`)
          .join(' ');
        if (fields) md.appendMarkdown(`\n- ${label} ${typeKey}: \`${fields}\``);
      }
    }
  }

  return md;
}

/**
 * Reads system/connection names from the current configuration.
 * For native: returns connection specs from settings.
 * For mock: reads host names from systems.json (best-effort, sync).
 */
function getConfiguredSystems(backend: 'native' | 'mock'): string[] {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  if (backend === 'native') {
    const connections = config.get<string[]>('nativeConnections', []) ?? [];
    return connections.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
  }
  const mockDir = config.get<string>('mockDataDirectory', '').trim();
  if (!mockDir) return [];
  try {
    const systemsPath = path.join(mockDir, 'systems.json');
    const raw = fs.readFileSync(systemsPath, 'utf-8');
    const parsed = JSON.parse(raw) as { systems?: { host?: string }[] };
    return (parsed.systems ?? []).map(s => s.host ?? '').filter(h => h.length > 0);
  } catch {
    return [];
  }
}

function getCurrentBackend(): 'native' | 'mock' {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  return config.get<string>('backend', 'native') === 'mock' ? 'mock' : 'native';
}

/**
 * Initializes the Zowe MCP status bar item. Call once from extension activation.
 * Restores the last active connection from global state if present (e.g. when MCP server is not started yet).
 */
export function initZoweMcpStatusBar(context: vscode.ExtensionContext): void {
  statusBarContext = context;
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    STATUS_BAR_PRIORITY
  );
  context.subscriptions.push(statusBarItem);

  const lastConnection = context.globalState.get<string>(GLOBAL_STATE_KEY_LAST_CONNECTION);
  if (lastConnection) {
    const backend = getCurrentBackend();
    const systems = getConfiguredSystems(backend);
    statusBarItem.text = `$(server-environment) ${lastConnection}`;
    statusBarItem.tooltip = buildTooltip(backend, systems);
    statusBarItem.show();
  }
}

/**
 * Updates the status bar with the current active connection from the MCP server.
 * Call when receiving an active-connection-changed event.
 * When connection is null or empty, the status bar is hidden and last connection is cleared.
 */
export function updateZoweMcpStatusBar(
  connection: string | null,
  context: vscode.ExtensionContext
): void {
  if (!statusBarItem) return;

  const trimmed = connection?.trim();
  const value = trimmed === '' || trimmed === undefined ? null : trimmed;
  if (!value) {
    statusBarItem.hide();
    void context.globalState.update(GLOBAL_STATE_KEY_LAST_CONNECTION, undefined);
    return;
  }

  const backend = getCurrentBackend();
  const systems = getConfiguredSystems(backend);
  statusBarItem.text = `$(server-environment) ${value}`;
  statusBarItem.tooltip = buildTooltip(backend, systems);
  statusBarItem.show();
  void context.globalState.update(GLOBAL_STATE_KEY_LAST_CONNECTION, value);
}

/**
 * Updates the active CLI plugin profiles snapshot and refreshes the status bar tooltip.
 * Call when receiving a cli-plugin-active-profiles-changed event from the MCP server.
 */
export function updateCliPluginActiveProfiles(
  pluginName: string,
  activeProfiles: Record<string, string>,
  activeContext: Record<string, Record<string, string>>
): void {
  cliPluginActiveProfiles.set(pluginName, { activeProfiles, activeContext });
  if (!statusBarItem || !statusBarContext) return;
  const backend = getCurrentBackend();
  const systems = getConfiguredSystems(backend);
  statusBarItem.tooltip = buildTooltip(backend, systems);
}
