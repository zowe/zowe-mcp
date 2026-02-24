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
 * Resolves Zowe Explorer profile names from Zowe team config (ProfileInfo API or CLI).
 * Used when opening data sets in the editor so the extension can build zowe-ds URIs.
 */

import * as childProcess from 'child_process';
import * as util from 'util';

const execAsync = util.promisify(childProcess.exec);

/** Minimal ProfileInfo interface for profile resolution (from @zowe/imperative). */
interface IProfileInfo {
  readProfilesFromDisk(): Promise<void>;
  getDefaultProfile(profileType: string): { profName: string } | null;
  getAllProfiles(profileType: string): { profName: string }[];
  mergeArgsForProfile(profile: { profName: string }): {
    knownArgs?: { argName: string; argValue?: string }[];
  };
}

let profileInfoClass: (new (app: string) => IProfileInfo) | null | undefined = undefined;

/**
 * Returns the ProfileInfo constructor from @zowe/imperative, or null if the package is not installed.
 * Lazy-loaded so the extension can activate when the dependency is not bundled (e.g. VSIX --no-dependencies).
 */
function getProfileInfoClass(): (new (app: string) => IProfileInfo) | null {
  if (profileInfoClass !== undefined) return profileInfoClass;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const imperative = require('@zowe/imperative') as {
      ProfileInfo: new (app: string) => IProfileInfo;
    };
    profileInfoClass = imperative?.ProfileInfo ?? null;
  } catch {
    profileInfoClass = null;
  }
  return profileInfoClass;
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

/**
 * Returns the default zosmf profile name from Zowe team config, or null if none or on error.
 * Returns null if @zowe/imperative is not installed (e.g. extension packaged with --no-dependencies).
 */
export async function getDefaultZosmfProfileName(): Promise<string | null> {
  const ProfileInfoClass = getProfileInfoClass();
  if (!ProfileInfoClass) return null;
  try {
    const profInfo = new ProfileInfoClass('zowe');
    await profInfo.readProfilesFromDisk();
    const defaultProf = profInfo.getDefaultProfile('zosmf');
    if (!defaultProf?.profName) return null;
    return defaultProf.profName;
  } catch {
    return null;
  }
}

/**
 * Returns all zosmf profile names from Zowe team config for use in a profile picker.
 * Tries ProfileInfo first, then falls back to `zowe config list --rfj`.
 * Pass workspaceDir so the CLI uses project-local zowe.config.json (e.g. workspace/zowe.config.json).
 */
export async function getAllZosmfProfileNames(workspaceDir?: string): Promise<string[]> {
  const fromImperative = await getAllZosmfProfileNamesFromImperative();
  if (fromImperative.length > 0) return fromImperative;
  const fromCli = await getZosmfProfilesFromZoweCli(workspaceDir);
  return fromCli.names;
}

/**
 * Returns zosmf profile names from @zowe/imperative ProfileInfo only.
 */
async function getAllZosmfProfileNamesFromImperative(): Promise<string[]> {
  const ProfileInfoClass = getProfileInfoClass();
  if (!ProfileInfoClass) return [];
  try {
    const profInfo = new ProfileInfoClass('zowe');
    await profInfo.readProfilesFromDisk();
    const profiles = (profInfo.getAllProfiles?.('zosmf') ?? []) as { profName: string }[];
    return profiles.map(p => p.profName).filter(Boolean);
  } catch {
    return [];
  }
}

/** Result of running `zowe config list --rfj`: zosmf profile names and default. */
export interface ZoweCliProfilesResult {
  names: string[];
  defaultName: string | null;
}

/**
 * Runs `zowe config list --rfj` and parses zosmf profile names and default.
 * Uses workspace directory as cwd when provided so project-local zowe.config.json is found.
 * Returns { names: [], defaultName: null } on any error (CLI not found, non-zero exit, parse error).
 */
export async function getZosmfProfilesFromZoweCli(
  workspaceDir?: string
): Promise<ZoweCliProfilesResult> {
  const cwd = workspaceDir?.trim() ? workspaceDir.trim() : undefined;
  try {
    const { stdout } = await execAsync('zowe config list --rfj', {
      cwd,
      maxBuffer: 2 * 1024 * 1024,
      encoding: 'utf8',
    });
    const json = JSON.parse(stdout) as {
      success?: boolean;
      data?: {
        profiles?: Record<string, { type?: string }>;
        defaults?: { zosmf?: string };
      };
    };
    const profiles = json?.data?.profiles;
    const defaults = json?.data?.defaults;
    if (!profiles || typeof profiles !== 'object') {
      return { names: [], defaultName: null };
    }
    const names = Object.keys(profiles).filter(
      key => (profiles[key]?.type ?? '').toLowerCase() === 'zosmf'
    );
    const defaultName =
      typeof defaults?.zosmf === 'string' && defaults.zosmf.trim() !== ''
        ? defaults.zosmf.trim()
        : null;
    return { names, defaultName };
  } catch {
    return { names: [], defaultName: null };
  }
}

/**
 * Finds a Zowe profile (zosmf or ssh) whose host and user match the given MCP system.
 * When preferSsh is true and both zosmf and ssh match, returns the ssh profile name.
 */
export async function resolveProfileFromSystem(
  system: string,
  preferSsh?: boolean
): Promise<string | null> {
  const parsed = parseSystem(system);
  if (!parsed) return null;
  const { user, host } = parsed;
  const hostLower = host.toLowerCase();

  const ProfileInfoClass = getProfileInfoClass();
  if (!ProfileInfoClass) return null;
  try {
    const profInfo = new ProfileInfoClass('zowe');
    await profInfo.readProfilesFromDisk();

    interface ProfWithName {
      profName: string;
      host?: string;
      user?: string;
    }
    const getMerged = (prof: { profName: string }): ProfWithName => {
      try {
        const merged = profInfo.mergeArgsForProfile(prof);
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

    const zosmfProfiles = (profInfo.getAllProfiles?.('zosmf') ?? []) as { profName: string }[];
    const sshProfiles = (profInfo.getAllProfiles?.('ssh') ?? []) as { profName: string }[];

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
