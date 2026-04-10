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
 * Dispatches incoming MCP server events to the appropriate VS Code APIs.
 *
 * Handles:
 * - `log` events → VS Code LogOutputChannel
 * - `notification` events → VS Code information/warning/error message dialogs
 * - `ceedump-collected` → info message with reason/ZNP/MCP context, "Open Dump" button, and output channel line with full path
 * - `request-password` → get from SecretStorage or prompt, send password event
 * - `password-invalid` → delete secret for that user@host
 * - `store-password` → store password in SecretStorage (e.g. after successful use of elicited password)
 * - `store-cli-plugin-profiles` → merge CLI plugin profiles into `zoweMCP.cliPluginConfiguration` and mirror JSON to globalStorage
 * - `request-job-card` → input box, persist to `zoweMCP.jobCards`, send `job-card`
 */

import type {
  ExtensionToServerEvent,
  ServerToExtensionEvent,
} from '@zowe/mcp-server/dist/events.js';
import * as crypto from 'crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getNativePasswordKey } from './secrets';
import { updateCliPluginActiveProfiles, updateZoweMcpStatusBar } from './status-bar';
import {
  getAllZosmfProfileNames,
  getDefaultZosmfProfileName,
  getZosmfProfilesFromZoweCli,
  resolveProfileFromSystem,
} from './zowe-profile';

/** Matches server job-card key: `user@host` when port is 22, else `user@host:port`. */
export function jobCardConnectionSpec(user: string, host: string, port?: number): string {
  const portNum = port ?? 22;
  return portNum === 22 ? `${user}@${host}` : `${user}@${host}:${portNum}`;
}

/**
 * Turns pasted or typed job card text into newline-separated lines. Splits on whitespace
 * (space, tab, newline) before a JCL line start (`//` or `/*`) so one-line or multi-line paste works.
 */
function normalizeJobCardInput(raw: string): string {
  const t = raw.trim();
  if (t === '') {
    return '';
  }
  return t
    .split(/\s+(?=\/\/|\/\*)/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .join('\n');
}

async function persistJobCardToSettings(connectionSpec: string, jobCard: string): Promise<void> {
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const current = config.get<Record<string, string | string[]>>('jobCards', {}) ?? {};
  await config.update(
    'jobCards',
    { ...current, [connectionSpec]: jobCard },
    vscode.ConfigurationTarget.Global
  );
}

function emitJobCardEvent(
  send: (event: ExtensionToServerEvent) => void,
  user: string,
  host: string,
  port: number | undefined,
  jobCard: string,
  log: vscode.LogOutputChannel
): void {
  send({
    type: 'job-card',
    data: { user, host, port: port === 22 || port === undefined ? undefined : port, jobCard },
    timestamp: Date.now(),
  });
  log.info(`Sent job card for ${user}@${host} to MCP server`);
}

/** Session cache: profile name per system key (empty string = default). Cleared when extension deactivates. */
const sessionProfileBySystem = new Map<string, string>();

/**
 * Resolves Zowe profile for opening a resource in Zowe Explorer.
 * Returns profile name or null if user cancelled. Uses session cache, team config default, CLI default, system match, or prompts (quick pick / input).
 */
async function resolveProfileForZoweEditor(
  log: vscode.LogOutputChannel,
  logLabel: string,
  workspaceDir: string | undefined,
  sessionKey: string,
  systemId: string | undefined,
  connectionKind: 'native' | 'zosmf' | undefined
): Promise<string | null> {
  let profile: string | undefined;

  if (sessionProfileBySystem.has(sessionKey)) {
    profile = sessionProfileBySystem.get(sessionKey)!;
    log.info(`${logLabel}: using session profile for system`, {
      system: sessionKey === '' ? '(default)' : sessionKey,
      profile,
    });
  }
  if (!profile) {
    profile = (await getDefaultZosmfProfileName()) ?? undefined;
    if (profile) {
      sessionProfileBySystem.set(sessionKey, profile);
      log.info(`${logLabel}: using default zosmf profile from team config`, { profile });
    }
  }
  if (!profile) {
    const cliResult = await getZosmfProfilesFromZoweCli(workspaceDir);
    if (cliResult.defaultName) {
      profile = cliResult.defaultName;
      sessionProfileBySystem.set(sessionKey, profile);
      log.info(`${logLabel}: using default zosmf profile from zowe config list`, { profile });
    }
  }
  if (!profile && (systemId ?? '').trim()) {
    const resolved = await resolveProfileFromSystem(systemId!, connectionKind === 'native');
    profile = resolved ?? undefined;
    if (profile) {
      sessionProfileBySystem.set(sessionKey, profile);
      log.info(`${logLabel}: resolved profile from system`, { system: systemId, profile });
    }
  }
  if (!profile) {
    log.info(`${logLabel}: no profile found; listing profiles or prompting for name`);
    const names = await getAllZosmfProfileNames(workspaceDir);
    if (names.length > 0) {
      const picked = await vscode.window.showQuickPick(names, {
        title: 'Choose Zowe Explorer profile for this session',
        placeHolder: 'Select a profile to open the resource',
        matchOnDescription: false,
        matchOnDetail: false,
      });
      if (picked == null) return null;
      profile = picked;
    } else {
      const entered = await vscode.window.showInputBox({
        title: 'Zowe Explorer profile',
        prompt:
          'Enter the zosmf profile name (e.g. zosmf). Used when config is project-local or not detected.',
        placeHolder: 'e.g. zosmf',
        validateInput: value => {
          const t = value?.trim() ?? '';
          return t.length === 0 ? 'Profile name is required' : null;
        },
      });
      if (entered == null || entered.trim() === '') return null;
      profile = entered.trim();
    }
    sessionProfileBySystem.set(sessionKey, profile);
    log.info(`${logLabel}: user selected profile, remembered for session`, {
      system: sessionKey === '' ? '(default)' : sessionKey,
      profile,
    });
  }
  return profile ?? null;
}

/**
 * Stats a Zowe URI with fetch=true then opens it in the editor (preview: false).
 */
async function openZoweUriInEditor(
  log: vscode.LogOutputChannel,
  uri: vscode.Uri,
  logLabel: string,
  pathDisplay: string
): Promise<void> {
  const uriWithFetch = uri.with({ query: 'fetch=true' });
  try {
    await vscode.workspace.fs.stat(uriWithFetch);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`${logLabel}: stat failed for ${pathDisplay}`, { message });
    void vscode.window.showErrorMessage(`Could not open in Zowe Explorer: ${message}`);
    return;
  }
  const uriToOpen = uriWithFetch.with({ query: '' });
  try {
    const doc = await vscode.workspace.openTextDocument(uriToOpen);
    await vscode.window.showTextDocument(doc, { preview: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`${logLabel}: openTextDocument failed`, { pathDisplay, message });
    void vscode.window.showErrorMessage(`Could not open in editor: ${message}`);
  }
}

/** Hash of password for log correlation only; never log the plain password. */
function passwordHash(password: string): string {
  if (password === '') return '<empty>';
  return crypto.createHash('sha256').update(password, 'utf8').digest('hex').slice(0, 16);
}

/**
 * Maps RFC 5424 syslog levels to VS Code LogOutputChannel methods.
 *
 * VS Code provides: trace, debug, info, warn, error.
 * RFC 5424 provides: debug, info, notice, warning, error, critical, alert, emergency.
 */
function logToOutputChannel(log: vscode.LogOutputChannel, event: ServerToExtensionEvent): void {
  if (event.type !== 'log') return;

  const { level, logger, message, data } = event.data;
  const prefix = logger ? `[${logger}] ` : '';
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  const formatted = `${prefix}${message}${suffix}`;

  switch (level) {
    case 'debug':
      log.debug(formatted);
      break;
    case 'info':
    case 'notice':
      log.info(formatted);
      break;
    case 'warning':
      log.warn(formatted);
      break;
    case 'error':
    case 'critical':
    case 'alert':
    case 'emergency':
      log.error(formatted);
      break;
    default:
      log.info(formatted);
  }
}

/**
 * Shows a VS Code notification message dialog based on the event severity.
 *
 * Offers "Generate Mock Data" and "Open Settings" buttons so the user
 * can quickly resolve the missing backend configuration.
 */
function showNotification(event: ServerToExtensionEvent): void {
  if (event.type !== 'notification') return;

  const { severity, message, settingsKey } = event.data;
  const openSettings = 'Open Settings';

  const showFn =
    severity === 'error'
      ? vscode.window.showErrorMessage
      : severity === 'warning'
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;

  if (settingsKey) {
    // Targeted notification: only offer "Open Settings" for the specified key.
    void showFn(message, openSettings).then(choice => {
      if (choice === openSettings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', settingsKey);
      }
    });
  } else {
    // Generic notification: offer both "Generate Mock Data" and "Open Settings".
    const generateMock = 'Generate Mock Data';
    void showFn(message, generateMock, openSettings).then(choice => {
      if (choice === generateMock) {
        void vscode.commands.executeCommand('zowe-mcp.initMockData');
      } else if (choice === openSettings) {
        void vscode.commands.executeCommand('workbench.action.openSettings', 'zoweMCP.backend');
      }
    });
  }
}

/**
 * Shows a message that a CEEDUMP was collected after a ZNP abend, with reason,
 * ZNP operation, MCP tool, and an "Open Dump" button. Also logs to the Zowe MCP
 * output channel with the full dump path.
 */
function showCeedumpCollected(log: vscode.LogOutputChannel, event: ServerToExtensionEvent): void {
  if (event.type !== 'ceedump-collected') return;

  const { path: filePath, reason, znpOperation, mcpTool } = event.data;
  const reasonPart = reason ? ` ${reason.endsWith('.') ? reason.trimEnd() : reason}.` : '';
  const znpPart = znpOperation ? ` Zowe Native operation: ${znpOperation}.` : '';
  const mcpPart = mcpTool && mcpTool !== 'unknown' ? ` MCP tool: ${mcpTool}.` : '';
  const notificationMessage = `Zowe MCP: CEEDUMP collected after ZNP abend.${reasonPart}${znpPart}${mcpPart} Saved to: ${filePath}`;
  const openLabel = 'Open Dump';

  log.error(
    `CEEDUMP collected after ZNP abend.${reasonPart}${znpPart}${mcpPart} Full path: ${filePath}`
  );

  void vscode.window.showInformationMessage(notificationMessage, openLabel).then(choice => {
    if (choice === openLabel) {
      void vscode.window.showTextDocument(vscode.Uri.file(filePath), {
        preview: false,
      });
    }
  });
}

/** Options for native (SSH) credential handling. */
export interface NativeSecretsOptions {
  context: vscode.ExtensionContext;
  sendEventToServers: (event: ExtensionToServerEvent) => void;
}

/**
 * Handles request-password: read from SecretStorage or prompt, then send password event.
 */
async function handleRequestPassword(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  options: NativeSecretsOptions
): Promise<void> {
  if (event.type !== 'request-password') return;
  const { user, host, port } = event.data;
  const portNum = port ?? 22;
  const key = getNativePasswordKey(user, host);
  let password = await options.context.secrets.get(key);
  const hadStoredSecret = !!password;
  log.debug(
    `SSH password requested: user=${user} host=${host} port=${portNum} key=${key} hadStoredSecret=${hadStoredSecret}`
  );
  if (!password) {
    password = await vscode.window.showInputBox({
      title: `Zowe MCP: Password for ${user}@${host}`,
      prompt: `Enter password for ${user}@${host}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) {
      log.warn(`User cancelled password input for ${user}@${host}`);
      return;
    }
    await options.context.secrets.store(key, password);
  }
  log.debug(
    `SSH password sending to server: user=${user} host=${host} port=${portNum} passwordHash=${passwordHash(password)}`
  );
  options.sendEventToServers({
    type: 'password',
    data: { user, host, port, password },
    timestamp: Date.now(),
  });
}

/**
 * Handles password-invalid: delete the secret so it is not reused.
 */
async function handlePasswordInvalid(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  options: NativeSecretsOptions
): Promise<void> {
  if (event.type !== 'password-invalid') return;
  const { user, host, port } = event.data;
  const key = getNativePasswordKey(user, host);
  log.info(
    `SSH password-invalid: deleting stored secret user=${user} host=${host} port=${port ?? 22} key=${key}`
  );
  await options.context.secrets.delete(key);
}

/**
 * Handles store-password: persist the password in SecretStorage (e.g. after successful use of an elicited password).
 */
async function handleStorePassword(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  options: NativeSecretsOptions
): Promise<void> {
  if (event.type !== 'store-password') return;
  const { user, host, password } = event.data;
  const key = getNativePasswordKey(user, host);
  await options.context.secrets.store(key, password);
  log.info(`Stored SSH password for ${user}@${host} in SecretStorage`);
}

/**
 * Handles request-job-card: input box, persist to `zoweMCP.jobCards`, then send `job-card`.
 */
async function handleRequestJobCard(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  options: NativeSecretsOptions
): Promise<void> {
  if (event.type !== 'request-job-card') return;
  const { user, host, port } = event.data;

  const connectionSpec = jobCardConnectionSpec(user, host, port);

  const jobCard = await vscode.window.showInputBox({
    title: `Zowe MCP: Job card for ${user}@${host}`,
    prompt:
      'Paste or type the job card. Put whitespace between lines (e.g. spaces or newlines before each // line).',
    placeHolder: '//MYJOB  JOB ...',
    ignoreFocusOut: true,
  });
  if (jobCard == null || jobCard.trim() === '') {
    log.warn(`User cancelled job card input for ${user}@${host}`);
    return;
  }
  const normalized = normalizeJobCardInput(jobCard);
  try {
    await persistJobCardToSettings(connectionSpec, normalized);
  } catch (e) {
    log.warn(
      `Failed to persist job card to settings: ${e instanceof Error ? e.message : String(e)}`
    );
  }
  emitJobCardEvent(options.sendEventToServers, user, host, port, normalized, log);
}

/**
 * Handles store-job-card: persist the job card into the zoweMCP.jobCards workspace/global setting.
 */
async function handleStoreJobCard(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  _options: NativeSecretsOptions
): Promise<void> {
  if (event.type !== 'store-job-card') return;
  const { connectionSpec, jobCard } = event.data;
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const current = config.get<Record<string, string | string[]>>('jobCards', {}) ?? {};
  const updated = { ...current, [connectionSpec]: jobCard };
  await config.update('jobCards', updated, vscode.ConfigurationTarget.Global);
  log.info(`Stored job card for ${connectionSpec} in settings`);
}

/**
 * Persists CLI plugin profiles from the MCP server into zoweMCP.cliPluginConfiguration
 * and mirrors the same JSON to globalStorage (same path buildServerConfig uses on startup).
 */
async function handleStoreCliPluginProfiles(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  options: NativeSecretsOptions
): Promise<void> {
  if (event.type !== 'store-cli-plugin-profiles') return;
  const { pluginName, profilesFile } = event.data as {
    pluginName: string;
    profilesFile: Record<string, unknown>;
  };
  const config = vscode.workspace.getConfiguration('zoweMCP');
  const current = config.get<Record<string, unknown>>('cliPluginConfiguration', {}) ?? {};
  const updated = { ...current, [pluginName]: profilesFile };
  await config.update('cliPluginConfiguration', updated, vscode.ConfigurationTarget.Global);

  const storageDir = options.context.globalStorageUri.fsPath;
  fs.mkdirSync(storageDir, { recursive: true });
  const connFile = path.join(storageDir, `cli-plugin-conn-${pluginName}.json`);
  fs.writeFileSync(connFile, `${JSON.stringify(profilesFile, null, 2)}\n`, 'utf-8');
  log.info(`Stored CLI plugin profiles for "${pluginName}" in settings and ${connFile}`);
}

const ZOWE_EDITOR_REQUIRED_MSG =
  'Zowe Explorer is required to open this resource. Install the Zowe Explorer extension.';

interface OpenInEditorSpec {
  scheme: string;
  pathPart: string;
  displayPath: string;
}

/**
 * Generic handler for open-in-editor events. Checks Zowe Explorer, resolves profile,
 * delegates URI construction to the caller-supplied buildSpec, and opens the document.
 */
async function handleOpenInEditor(
  log: vscode.LogOutputChannel,
  logLabel: string,
  data: { system?: string; connectionKind?: 'native' | 'zosmf' },
  buildSpec: () => OpenInEditorSpec
): Promise<void> {
  if (!vscode.extensions.getExtension('Zowe.vscode-extension-for-zowe')) {
    void vscode.window.showWarningMessage(ZOWE_EDITOR_REQUIRED_MSG);
    return;
  }

  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const sessionKey = (data.system ?? '').trim();
  const profile = await resolveProfileForZoweEditor(
    log,
    logLabel,
    workspaceDir,
    sessionKey,
    data.system,
    data.connectionKind
  );
  if (!profile) return;

  const { scheme, pathPart, displayPath } = buildSpec();
  const uri = vscode.Uri.parse(`${scheme}:/${encodeURIComponent(profile)}/${pathPart}`);
  await openZoweUriInEditor(log, uri, logLabel, displayPath);
}

function handleOpenDatasetInEditor(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent
): Promise<void> {
  if (event.type !== 'open-dataset-in-editor') return Promise.resolve();
  const data = event.data as {
    dsn: string;
    member?: string;
    system?: string;
    connectionKind?: 'native' | 'zosmf';
  };
  return handleOpenInEditor(log, 'open-dataset-in-editor', data, () => {
    const segments = data.member ? [data.dsn, data.member] : [data.dsn];
    const pathPart = segments.map(seg => encodeURIComponent(seg)).join('/');
    return { scheme: 'zowe-ds', pathPart, displayPath: pathPart };
  });
}

function handleOpenUssFileInEditor(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent
): Promise<void> {
  if (event.type !== 'open-uss-file-in-editor') return Promise.resolve();
  const data = event.data as {
    path: string;
    system?: string;
    connectionKind?: 'native' | 'zosmf';
  };
  return handleOpenInEditor(log, 'open-uss-file-in-editor', data, () => {
    const trimmed = data.path.trim();
    const pathPart = trimmed.startsWith('/')
      ? '/' +
        trimmed
          .slice(1)
          .split('/')
          .map(seg => encodeURIComponent(seg))
          .join('/')
      : trimmed
          .split('/')
          .map(seg => encodeURIComponent(seg))
          .join('/');
    return { scheme: 'zowe-uss', pathPart, displayPath: trimmed };
  });
}

function handleOpenJobInEditor(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent
): Promise<void> {
  if (event.type !== 'open-job-in-editor') return Promise.resolve();
  const data = event.data as {
    jobId: string;
    jobFileId?: number;
    system?: string;
    connectionKind?: 'native' | 'zosmf';
  };
  return handleOpenInEditor(log, 'open-job-in-editor', data, () => {
    const jobIdEnc = encodeURIComponent(data.jobId.trim());
    const hasFile = data.jobFileId !== undefined && data.jobFileId !== null;
    const pathPart = hasFile ? `${jobIdEnc}/${String(data.jobFileId)}` : `${jobIdEnc}/`;
    const displayPath = hasFile ? `${data.jobId} spool ${data.jobFileId}` : data.jobId;
    return { scheme: 'zowe-jobs', pathPart, displayPath };
  });
}

/**
 * Handles a single event received from the MCP server over the named pipe.
 *
 * @param options - When provided, enables request-password and password-invalid handling (native mode).
 */
export function handleServerEvent(
  log: vscode.LogOutputChannel,
  event: ServerToExtensionEvent,
  options?: NativeSecretsOptions
): void {
  switch (event.type) {
    case 'log':
      logToOutputChannel(log, event);
      break;
    case 'notification':
      showNotification(event);
      break;
    case 'request-password':
      if (options) void handleRequestPassword(log, event, options);
      break;
    case 'password-invalid':
      if (options) void handlePasswordInvalid(log, event, options);
      break;
    case 'store-password':
      if (options) void handleStorePassword(log, event, options);
      break;
    case 'request-job-card':
      if (options) void handleRequestJobCard(log, event, options);
      break;
    case 'store-job-card':
      if (options) void handleStoreJobCard(log, event, options);
      break;
    case 'store-cli-plugin-profiles':
      if (options) void handleStoreCliPluginProfiles(log, event, options);
      break;
    case 'open-dataset-in-editor':
      void handleOpenDatasetInEditor(log, event);
      break;
    case 'open-uss-file-in-editor':
      void handleOpenUssFileInEditor(log, event);
      break;
    case 'open-job-in-editor':
      void handleOpenJobInEditor(log, event);
      break;
    case 'ceedump-collected':
      showCeedumpCollected(log, event);
      break;
    case 'active-connection-changed':
      if (options?.context) {
        updateZoweMcpStatusBar(event.data.activeConnection, options.context);
      }
      break;
    case 'cli-plugin-active-profiles-changed':
      updateCliPluginActiveProfiles(
        event.data.pluginName,
        event.data.activeProfiles,
        event.data.activeContext
      );
      break;
    default:
      log.warn(`Unknown event type from MCP server: ${(event as { type: string }).type}`);
  }
}
