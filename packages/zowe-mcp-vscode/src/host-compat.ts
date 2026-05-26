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
 * The notice has two actions: open the host's setup guide on GitHub, or
 * dismiss permanently. We deliberately do not auto-generate `mcp.json` here:
 * each host has subtle differences (executable resolution, schema field
 * names, scope paths) that are better explained once in the guide than
 * embedded in an ever-stale code path.
 */

import * as vscode from 'vscode';
import { HostCompatProfile, getActiveHostCompatProfiles } from './host-compat-profiles';

const DISMISS_KEY_PREFIX = 'zoweMCP.hostCompatNoticeDismissed.';

const OPEN_DOCS_LABEL = 'Open setup guide';
const DISMISS_LABEL = "Don't show again";

/**
 * Wire host-compat into the extension. Shows a one-time notice per active
 * host where the provider API is not honored. No-op when no such host is
 * active or when the user has dismissed the notice.
 */
export function activateHostCompat(
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
    `To use Zowe tools in ${profile.displayName}, configure ${profile.displayName}'s mcp.json — see the setup guide.`;
  const choice = await vscode.window.showInformationMessage(
    message,
    OPEN_DOCS_LABEL,
    DISMISS_LABEL
  );
  if (choice === OPEN_DOCS_LABEL) {
    void vscode.env.openExternal(vscode.Uri.parse(profile.docsUrl));
    log.info(`Opened MCP-host-compat setup guide`, { host: profile.id, url: profile.docsUrl });
  } else if (choice === DISMISS_LABEL) {
    await context.globalState.update(dismissKey, true);
    log.info(`User dismissed MCP-host-compat notice`, { host: profile.id });
  }
}
