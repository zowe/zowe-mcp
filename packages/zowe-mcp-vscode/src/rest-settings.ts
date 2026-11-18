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
import { isAbsolute } from 'node:path';
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
    'oidcTokenExchange',
  ]);
  if (!Array.isArray(connections)) throw new Error('zoweMCP.zoRestConnections must be an array.');
  for (const entry of connections) {
    if (!entry || typeof entry !== 'object' || Object.keys(entry).some(key => !allowed.has(key))) {
      throw new Error(
        'zoRestConnections accepts url, user, deployment, serviceId, rejectUnauthorized, caFile, timeoutSeconds, sessionLogin, and oidcTokenExchange only. Passwords are collected securely when connecting.'
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
    if (
      connection.caFile !== undefined &&
      (typeof connection.caFile !== 'string' || !isAbsolute(connection.caFile))
    )
      throw new Error(
        'zoweMCP.zoRestConnections caFile must be an absolute path to a site CA file.'
      );
  }
  for (const entry of connections as Partial<RestConnection>[]) {
    if (!entry.oidcTokenExchange) continue;
    const exchange = entry.oidcTokenExchange;
    if (
      typeof exchange !== 'object' ||
      Object.keys(exchange).some(
        key =>
          !['url', 'audience', 'resource', 'scope', 'clientId', 'clientSecretEnv'].includes(key)
      )
    )
      throw new Error('OIDC token exchange settings must not contain credentials.');
    let exchangeUrl: URL;
    try {
      exchangeUrl = new URL(exchange.url);
    } catch {
      throw new Error('OIDC token exchange needs an absolute HTTPS URL.');
    }
    if (
      exchangeUrl.protocol !== 'https:' ||
      exchangeUrl.username ||
      exchangeUrl.password ||
      exchangeUrl.search ||
      exchangeUrl.hash
    )
      throw new Error(
        'OIDC token exchange URL must use HTTPS without credentials, query, or fragment.'
      );
    if (!exchange.audience && !exchange.resource)
      throw new Error('OIDC token exchange requires a downstream audience or resource.');
    for (const parameter of [
      exchange.audience,
      exchange.resource,
      exchange.scope,
      exchange.clientId,
    ])
      if (
        parameter !== undefined &&
        (typeof parameter !== 'string' || !parameter.trim() || /[\r\n]/.test(parameter))
      )
        throw new Error(
          'OIDC token exchange parameters must be nonblank and have no line breaks.'
        );
    if (exchange.resource) {
      try {
        const resource = new URL(exchange.resource);
        if (resource.username || resource.password || exchange.resource.includes('#'))
          throw new Error();
      } catch {
        throw new Error(
          'OIDC token exchange resource must be an absolute URI without credentials or a fragment.'
        );
      }
    }
    if (
      exchange.clientSecretEnv !== undefined &&
      (!exchange.clientId || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(exchange.clientSecretEnv))
    )
      throw new Error(
        'OIDC token exchange clientSecretEnv needs an environment variable name and clientId.'
      );
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
