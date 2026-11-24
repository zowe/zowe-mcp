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

import type { Extension } from 'vscode';

/** Profile lookup used by Zowe Explorer when opening resources. */
interface ProfileInfo {
  getDefaultProfile(profileType: string): { profName: string } | null;
  getAllProfiles(profileType: string): { profName: string }[];
  mergeArgsForProfile(profile: { profName: string }): {
    knownArgs?: { argName: string; argValue?: string }[];
  };
}

export interface ExplorerProfileApi {
  getExplorerExtenderApi(): {
    getProfilesCache(): { getProfileInfo(): Promise<ProfileInfo> };
  };
}

/** Uses Explorer's own profile cache, including its workspace team configuration. */
export async function getExplorerProfileInfo(
  extension: Pick<Extension<ExplorerProfileApi>, 'activate'>
): Promise<ProfileInfo | null> {
  try {
    const api = await extension.activate();
    return await api.getExplorerExtenderApi().getProfilesCache().getProfileInfo();
  } catch {
    // Older or unavailable Explorer APIs leave manual profile entry available.
    return null;
  }
}

/** Parsed MCP system (user@host or user@host:port). */
interface ParsedSystem {
  user: string;
  host: string;
  port?: number;
}

/**
 * Parses an MCP system string (e.g. user@host or user@host:port) into user, host, and optional port.
 */
function parseSystem(system: string): ParsedSystem | null {
  const trimmed = system.trim();
  if (trimmed.length === 0) return null;
  const atIndex = trimmed.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === trimmed.length - 1) return null;
  const user = trimmed.slice(0, atIndex).trim();
  const hostPort = trimmed.slice(atIndex + 1).trim();
  if (!hostPort) return null;
  const colonIndex = hostPort.indexOf(':');
  if (colonIndex < 0) {
    return { user, host: hostPort };
  }
  const host = hostPort.slice(0, colonIndex).trim();
  const portStr = hostPort.slice(colonIndex + 1).trim();
  const port = portStr ? parseInt(portStr, 10) : undefined;
  if (port !== undefined && (Number.isNaN(port) || port < 1 || port > 65535)) {
    return { user, host };
  }
  return { user, host, port };
}

/** Returns the default zosmf profile name, if configured. */
export function getDefaultZosmfProfileName(profileInfo: ProfileInfo | null): string | null {
  try {
    const name = profileInfo?.getDefaultProfile('zosmf')?.profName;
    if (!name) return null;
    return name;
  } catch {
    return null;
  }
}

/** Returns the configured zosmf profile names for the profile picker. */
export function getAllZosmfProfileNames(profileInfo: ProfileInfo | null): string[] {
  try {
    return (profileInfo?.getAllProfiles('zosmf') ?? []).map(p => p.profName).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Finds a Zowe profile (zosmf or ssh) whose host and user match the given MCP system.
 * When preferSsh is true and both zosmf and ssh match, returns the ssh profile name.
 */
export function resolveProfileFromSystem(
  profileInfo: ProfileInfo | null,
  system: string,
  preferSsh?: boolean
): string | null {
  const parsed = parseSystem(system);
  if (!parsed || !profileInfo) return null;
  const { user, host } = parsed;
  const hostLower = host.toLowerCase();

  try {
    interface ProfWithName {
      profName: string;
      host?: string;
      user?: string;
    }
    const getMerged = (prof: { profName: string }): ProfWithName => {
      try {
        const merged = profileInfo.mergeArgsForProfile(prof);
        const known = merged?.knownArgs;
        if (!Array.isArray(known)) return { profName: prof.profName };
        let h: string | undefined;
        let u: string | undefined;
        for (const a of known) {
          const val = a.argValue !== undefined ? String(a.argValue).trim() : '';
          if (a.argName === 'host') h = val || undefined;
          if (a.argName === 'user') u = val || undefined;
        }
        return { profName: prof.profName, host: h, user: u };
      } catch {
        return { profName: prof.profName };
      }
    };

    const matches = (p: ProfWithName): boolean =>
      (p.host?.toLowerCase() ?? '') === hostLower && (p.user ?? '').trim() === user.trim();

    const zosmfProfiles = profileInfo.getAllProfiles('zosmf');
    const sshProfiles = profileInfo.getAllProfiles('ssh');

    const zosmfMatch = zosmfProfiles.map(getMerged).find(matches);
    const sshMatch = sshProfiles.map(getMerged).find(matches);

    if (preferSsh && sshMatch) return sshMatch.profName;
    if (zosmfMatch) return zosmfMatch.profName;
    if (sshMatch) return sshMatch.profName;
    return null;
  } catch {
    return null;
  }
}
