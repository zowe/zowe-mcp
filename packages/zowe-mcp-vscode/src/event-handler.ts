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
 * - `request-password` → get from SecretStorage or prompt, send password event
 * - `password-invalid` → delete secret for that user@host
 * - `store-password` → store password in SecretStorage (e.g. after successful use of elicited password)
 */

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import type {
  ExtensionToServerEvent,
  ServerToExtensionEvent,
} from 'zowe-mcp-server/dist/events.js';
import { getNativePasswordKey } from './secrets';

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

  const { severity, message } = event.data;
  const generateMock = 'Generate Mock Data';
  const openSettings = 'Open Settings';

  const showFn =
    severity === 'error'
      ? vscode.window.showErrorMessage
      : severity === 'warning'
        ? vscode.window.showWarningMessage
        : vscode.window.showInformationMessage;

  void showFn(message, generateMock, openSettings).then(choice => {
    if (choice === generateMock) {
      void vscode.commands.executeCommand('zowe-mcp.initMockData');
    } else if (choice === openSettings) {
      void vscode.commands.executeCommand(
        'workbench.action.openSettings',
        'zoweMCP.mockDataDirectory'
      );
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
    default:
      log.warn(`Unknown event type from MCP server: ${(event as { type: string }).type}`);
  }
}
