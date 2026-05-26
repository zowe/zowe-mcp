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
 * Runtime layer for the MCP-host-compat notice.
 *
 * On activation, surfaces a one-time information message for each detected
 * host environment that does NOT consume the extension's MCP-provider
 * registration ({@link ./host-compat-profiles.ts}). Each host has its own
 * dismissal key so the user can silence them independently.
 *
 * Also registers the `zowe-mcp.generateHostMcpSnippet` command, which writes
 * (or merges) an `mcp.json` entry for the active host using the current
 * `zoweMCP.*` settings.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as vscode from 'vscode';
import {
  HostCompatProfile,
  HostScope,
  ServerSpec,
  findHostCompatProfile,
  getActiveHostCompatProfiles,
} from './host-compat-profiles';

const DISMISS_KEY_PREFIX = 'zoweMCP.hostCompatNoticeDismissed.';
const COMMAND_GENERATE_SNIPPET = 'zowe-mcp.generateHostMcpSnippet';

const GENERATE_LABEL = 'Generate mcp.json snippet';
const OPEN_DOCS_LABEL = 'Open docs';
const DISMISS_LABEL = "Don't show again";

// ---------------------------------------------------------------------------
// Activation entry point
// ---------------------------------------------------------------------------

/**
 * Wire host-compat into the extension. Shows a one-time notice per active
 * host where the provider API is not honored, and registers the snippet
 * generator command.
 */
export function activateHostCompat(
  context: vscode.ExtensionContext,
  serverModule: string,
  log: vscode.LogOutputChannel
): void {
  context.subscriptions.push(
    vscode.commands.registerCommand(COMMAND_GENERATE_SNIPPET, (preselectedProfileId?: string) =>
      generateHostMcpSnippet(serverModule, preselectedProfileId, log)
    )
  );

  showHostCompatNoticesIfNeeded(context, log);
}

function showHostCompatNoticesIfNeeded(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel
): void {
  const active = getActiveHostCompatProfiles();
  if (active.length === 0) return;

  for (const profile of active) {
    const dismissKey = DISMISS_KEY_PREFIX + profile.id;
    if (context.globalState.get<boolean>(dismissKey)) continue;
    log.info(`Showing MCP-host-compat notice`, { host: profile.id });
    // Don't await — each notice is independent and shouldn't gate the others.
    void showNotice(context, profile, dismissKey, log);
  }
}

async function showNotice(
  context: vscode.ExtensionContext,
  profile: HostCompatProfile,
  dismissKey: string,
  log: vscode.LogOutputChannel
): Promise<void> {
  const message =
    `Zowe MCP is installed, but ${profile.displayName} does not connect to MCP servers contributed by VS Code extensions. ` +
    `To use Zowe tools in ${profile.displayName}, add a server entry to ${profile.displayName}'s mcp.json.`;
  const choice = await vscode.window.showInformationMessage(
    message,
    GENERATE_LABEL,
    OPEN_DOCS_LABEL,
    DISMISS_LABEL
  );
  if (choice === GENERATE_LABEL) {
    await vscode.commands.executeCommand(COMMAND_GENERATE_SNIPPET, profile.id);
  } else if (choice === OPEN_DOCS_LABEL) {
    void vscode.env.openExternal(vscode.Uri.parse(profile.docsUrl));
  } else if (choice === DISMISS_LABEL) {
    await context.globalState.update(dismissKey, true);
    log.info(`User dismissed MCP-host-compat notice`, { host: profile.id });
  }
}

// ---------------------------------------------------------------------------
// Snippet generator command
// ---------------------------------------------------------------------------

async function generateHostMcpSnippet(
  serverModule: string,
  preselectedProfileId: string | undefined,
  log: vscode.LogOutputChannel
): Promise<void> {
  const profile = await resolveTargetProfile(preselectedProfileId);
  if (!profile) return;

  const target = await pickScopeOrClipboard(profile);
  if (!target) return; // user cancelled

  const spec = buildServerSpec(serverModule);
  const entry = profile.buildMcpJsonEntry(spec);

  if (target === 'clipboard') {
    const fullBlock = { mcpServers: { zowe: entry } };
    await vscode.env.clipboard.writeText(JSON.stringify(fullBlock, null, 2));
    void vscode.window.showInformationMessage(
      `Zowe MCP snippet copied to clipboard. Paste under "mcpServers" in ${profile.displayName}'s mcp.json.`
    );
    log.info(`Generated mcp.json snippet to clipboard`, { host: profile.id });
    return;
  }

  const targetPath = target.resolvePath();
  if (!targetPath) {
    void vscode.window.showWarningMessage(
      `Could not resolve a path for ${target.label} scope. Open a workspace folder first, or use "Copy to clipboard".`
    );
    return;
  }

  const result = await mergeOrCreateMcpJson(targetPath, entry);
  const doc = await vscode.workspace.openTextDocument(targetPath);
  await vscode.window.showTextDocument(doc);

  const verb = result === 'created' ? 'Created' : result === 'merged' ? 'Updated' : 'Overwrote';
  void vscode.window.showInformationMessage(
    `${verb} ${path.basename(targetPath)} with the Zowe MCP server entry. Review and reload ${profile.displayName}.`
  );
  log.info(`Generated mcp.json snippet`, {
    host: profile.id,
    scope: target.id,
    path: targetPath,
    result,
  });
}

async function resolveTargetProfile(
  preselectedProfileId: string | undefined
): Promise<HostCompatProfile | undefined> {
  if (preselectedProfileId) {
    const explicit = findHostCompatProfile(preselectedProfileId);
    if (explicit) return explicit;
    void vscode.window.showWarningMessage(`Unknown host id: ${preselectedProfileId}`);
    return undefined;
  }
  const active = getActiveHostCompatProfiles();
  if (active.length === 0) {
    void vscode.window.showInformationMessage(
      'No supported host detected. The Zowe MCP server is already available via the VS Code MCP-provider API; no mcp.json snippet is needed.'
    );
    return undefined;
  }
  if (active.length === 1) return active[0];
  const picked = await vscode.window.showQuickPick(
    active.map(p => ({ label: p.displayName, description: p.docsUrl, profile: p })),
    { placeHolder: 'Generate the mcp.json snippet for which host?' }
  );
  return picked?.profile;
}

interface ScopeItem extends vscode.QuickPickItem {
  target: 'scope';
  scope: HostScope;
}
interface ClipboardItem extends vscode.QuickPickItem {
  target: 'clipboard';
}
type ScopePickItem = ScopeItem | ClipboardItem;

async function pickScopeOrClipboard(
  profile: HostCompatProfile
): Promise<HostScope | 'clipboard' | undefined> {
  const scopeItems: ScopePickItem[] = profile.scopes.map((scope): ScopeItem => {
    const resolved = scope.resolvePath();
    return {
      label: scope.label,
      description: scope.description,
      detail: resolved ?? '(unavailable — no workspace open)',
      target: 'scope',
      scope,
    };
  });
  const items: ScopePickItem[] = [
    ...scopeItems,
    {
      label: 'Copy to clipboard',
      description: 'Paste wherever you want',
      target: 'clipboard',
    },
  ];
  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: `Where should the ${profile.displayName} mcp.json snippet go?`,
    matchOnDescription: true,
    matchOnDetail: true,
  });
  if (!picked) return undefined;
  if (picked.target === 'clipboard') return 'clipboard';
  if (!picked.scope.resolvePath()) {
    void vscode.window.showWarningMessage(
      `${picked.label} scope is not available right now. Open a workspace folder first.`
    );
    return undefined;
  }
  return picked.scope;
}

// ---------------------------------------------------------------------------
// Server-spec construction (reads current zoweMCP.* settings)
// ---------------------------------------------------------------------------

function buildServerSpec(serverModule: string): ServerSpec {
  const cfg = vscode.workspace.getConfiguration('zoweMCP');
  const backend = (cfg.get<string>('backend') ?? 'mock').toLowerCase();
  const tier = cfg.get<string>('capabilityTier') ?? 'read';

  const args: string[] = ['--stdio'];

  if (backend === 'mock') {
    const dir = cfg.get<string>('mockDataDirectory');
    args.push('--mock', dir && dir.length > 0 ? dir : '/path/to/zowe-mcp-mock-data');
  } else {
    // zowex / native — point at a placeholder system the user will edit.
    args.push('--zowex', '--system', 'USERID@zos.example.com');
  }
  args.push('--capability-tier', tier);

  const env =
    backend === 'mock'
      ? undefined
      : {
          ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM: '${ZOWE_MCP_PASSWORD_USERID_ZOS_EXAMPLE_COM}',
        };

  return {
    command: serverModule,
    args,
    env,
    // Conservative default: only safe read-only ops auto-approved.
    autoApproveTools: ['listSystems', 'getContext', 'listDatasets'],
  };
}

// ---------------------------------------------------------------------------
// File I/O — create or merge mcp.json
// ---------------------------------------------------------------------------

type MergeResult = 'created' | 'merged' | 'overwrote';

async function mergeOrCreateMcpJson(
  filePath: string,
  zoweEntry: Record<string, unknown>
): Promise<MergeResult> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  let existing: { mcpServers?: Record<string, unknown>; [k: string]: unknown } | undefined;
  let fileExisted = false;
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    fileExisted = true;
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      existing = { mcpServers: {} };
    } else {
      // Tolerate JSONC line comments — strip them before parsing.
      const stripped = raw.replace(/^\s*\/\/.*$/gm, '');
      try {
        const parsed = JSON.parse(stripped) as unknown;
        existing =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as { mcpServers?: Record<string, unknown>; [k: string]: unknown })
            : undefined;
      } catch {
        // Unparseable existing file: don't clobber silently — caller surfaces a "overwrote" verb.
        existing = undefined;
      }
    }
  } catch {
    // File doesn't exist yet.
  }

  if (!existing || typeof existing !== 'object') {
    const fresh = { mcpServers: { zowe: zoweEntry } };
    await fs.writeFile(filePath, JSON.stringify(fresh, null, 2) + '\n', 'utf8');
    return fileExisted ? 'overwrote' : 'created';
  }

  if (!existing.mcpServers || typeof existing.mcpServers !== 'object') {
    existing.mcpServers = {};
  }
  existing.mcpServers.zowe = zoweEntry;
  await fs.writeFile(filePath, JSON.stringify(existing, null, 2) + '\n', 'utf8');
  return fileExisted ? 'merged' : 'created';
}
