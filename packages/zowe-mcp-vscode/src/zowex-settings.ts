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
 * Reads Zowe Remote SSH (zowex) VS Code settings with silent migration from legacy keys:
 * `nativeConnections`, `nativeSystems`, `installZoweNativeServerAutomatically`, `zoweNativeServerPath`,
 * `nativeResponseTimeout`, and `backend: "native"`.
 *
 * `nativeConnections` / `nativeSystems` are not declared in package.json (hidden from the Settings UI)
 * but are still read from `settings.json` when present, then copied into `zoweMCP.zowexConnections`.
 */

import * as vscode from 'vscode';

const ZOWEX_CONNECTIONS_KEY = 'zowexConnections';
const LEGACY_NATIVE_CONNECTIONS_KEY = 'nativeConnections';
const LEGACY_NATIVE_SYSTEMS_KEY = 'nativeSystems';

function filterConnectionSpecs(list: unknown[]): string[] {
  return list.filter((s): s is string => typeof s === 'string' && s.trim().length > 0);
}

/**
 * SSH connection specs for Zowe Remote SSH, migrating legacy `nativeConnections` /
 * `nativeSystems` into `zoweMCP.zowexConnections` once when only legacy values exist.
 */
export function getZowexConnectionsWithMigration(config: vscode.WorkspaceConfiguration): string[] {
  const primary = config.get<string[]>(ZOWEX_CONNECTIONS_KEY, []) ?? [];
  const fromPrimary = filterConnectionSpecs(primary);
  if (fromPrimary.length > 0) {
    return fromPrimary;
  }

  const legacyConnections = config.get<string[]>(LEGACY_NATIVE_CONNECTIONS_KEY, []) ?? [];
  const fromLegacyConn = filterConnectionSpecs(legacyConnections);
  if (fromLegacyConn.length > 0) {
    void config.update(ZOWEX_CONNECTIONS_KEY, fromLegacyConn, vscode.ConfigurationTarget.Global);
    return fromLegacyConn;
  }

  const legacySystems = config.get<string[]>(LEGACY_NATIVE_SYSTEMS_KEY, []) ?? [];
  const fromSystems = filterConnectionSpecs(legacySystems);
  if (fromSystems.length > 0) {
    void config.update(ZOWEX_CONNECTIONS_KEY, fromSystems, vscode.ConfigurationTarget.Global);
    return fromSystems;
  }

  return [];
}

/** Backend kind for the MCP server: `zowex` (SSH / Zowe Remote SSH) or `mock`. Migrates stored `native` → `zowex`. */
export function getZowexBackendWithMigration(
  config: vscode.WorkspaceConfiguration,
  zowexConnections: string[],
  log?: { info: (m: string) => void }
): 'zowex' | 'mock' {
  const inspection = config.inspect<string>('backend');
  const hasUserBackend =
    inspection?.globalValue !== undefined ||
    inspection?.workspaceValue !== undefined ||
    inspection?.workspaceFolderValue !== undefined;

  if (!hasUserBackend) {
    const mockDataDirectory = config.get<string>('mockDataDirectory', '').trim();
    if (mockDataDirectory && zowexConnections.length === 0) {
      log?.info(
        'Auto-migrating backend setting to "mock" (mockDataDirectory is set, no zowex connections)'
      );
      void config.update('backend', 'mock', vscode.ConfigurationTarget.Global);
      return 'mock';
    }
  }

  let b = config.get<string>('backend', 'zowex');
  if (b === 'native') {
    if (inspection?.workspaceFolderValue === 'native') {
      void config.update('backend', 'zowex', vscode.ConfigurationTarget.WorkspaceFolder);
    } else if (inspection?.workspaceValue === 'native') {
      void config.update('backend', 'zowex', vscode.ConfigurationTarget.Workspace);
    } else if (inspection?.globalValue === 'native') {
      void config.update('backend', 'zowex', vscode.ConfigurationTarget.Global);
    } else {
      void config.update('backend', 'zowex', vscode.ConfigurationTarget.Global);
    }
    log?.info('Migrated zoweMCP.backend from "native" to "zowex"');
    b = 'zowex';
  }
  if (b === 'mock') return 'mock';
  return 'zowex';
}

function hasExplicitZowexSetting(
  insp: ReturnType<vscode.WorkspaceConfiguration['inspect']> | undefined
): boolean {
  return (
    insp?.globalValue !== undefined ||
    insp?.workspaceValue !== undefined ||
    insp?.workspaceFolderValue !== undefined
  );
}

export function getZowexServerAutoInstall(config: vscode.WorkspaceConfiguration): boolean {
  const insp = config.inspect<boolean>('zowexServerAutoInstall');
  if (hasExplicitZowexSetting(insp)) {
    return config.get<boolean>('zowexServerAutoInstall', true);
  }
  return config.get<boolean>('installZoweNativeServerAutomatically', true);
}

export function getZowexServerPath(config: vscode.WorkspaceConfiguration): string {
  const insp = config.inspect<string>('zowexServerPath');
  if (hasExplicitZowexSetting(insp)) {
    return config.get<string>('zowexServerPath', '~/.zowe-server');
  }
  return config.get<string>('zoweNativeServerPath', '~/.zowe-server');
}

export function getZowexResponseTimeout(config: vscode.WorkspaceConfiguration): number {
  const insp = config.inspect<number>('zowexResponseTimeout');
  if (hasExplicitZowexSetting(insp)) {
    return config.get<number>('zowexResponseTimeout', 60);
  }
  return config.get<number>('nativeResponseTimeout', 60);
}
