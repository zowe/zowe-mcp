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

import type { RestConnection } from '@zowe/mcp-server/dist/zos/rest/connection.js';
import type * as vscode from 'vscode';

/** Read secret-free settings before writing the server's configuration snapshot. */
export function getRestConnections(config: vscode.WorkspaceConfiguration): RestConnection[] {
  const connections = config.get<unknown[]>('zoRestConnections', []) ?? [];
  const allowed = new Set([
    'url',
    'user',
    'deployment',
    'serviceId',
    'rejectUnauthorized',
    'caFile',
    'timeoutSeconds',
    'sessionLogin',
  ]);
  if (!Array.isArray(connections)) throw new Error('zoweMCP.zoRestConnections must be an array.');
  for (const entry of connections) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !allowed.has(key))) {
      throw new Error(
        'zoRestConnections accepts url, user, deployment, serviceId, rejectUnauthorized, caFile, timeoutSeconds, and sessionLogin only. Passwords are collected securely when connecting.'
      );
    }
    const connection = entry as Partial<RestConnection>;
    let url: URL;
    try {
      url = new URL(connection.url ?? '');
    } catch {
      throw new Error('Each zo REST connection needs a valid HTTPS URL.');
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error(
        'zo REST URLs must use HTTPS and must not contain credentials, a query, or a fragment.'
      );
    }
    if (!connection.user || !/^[A-Za-z0-9@#$]{1,8}$/.test(connection.user))
      throw new Error('Each zo REST connection needs a z/OS user ID (1–8 characters).');
  }
  for (const entry of connections as Partial<RestConnection>[]) {
    if (!entry.sessionLogin) continue;
    const login = entry.sessionLogin;
    if (
      typeof login !== 'object' ||
      Object.keys(login).some(key => !['url', 'method', 'cookieName', 'tokenField'].includes(key))
    )
      throw new Error('Session login configuration must not contain credentials.');
    let loginUrl: URL;
    try {
      loginUrl = new URL(login.url, entry.url);
    } catch {
      throw new Error('Session login needs a valid HTTPS URL.');
    }
    if (
      loginUrl.protocol !== 'https:' ||
      loginUrl.username ||
      loginUrl.password ||
      loginUrl.search ||
      loginUrl.hash
    )
      throw new Error('Session login URL must not contain credentials, a query, or a fragment.');
  }
  return connections as RestConnection[];
}
