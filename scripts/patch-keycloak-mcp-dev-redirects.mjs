#!/usr/bin/env node
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
 * Idempotently merges Valid redirect URIs and Web origins on the Keycloak OAuth client (default `demo`)
 * in realm `demo` so browser-based OIDC (authorization code + PKCE) works for tools
 * such as MCP Inspector (`/oauth/callback` on the inspector UI origin).
 *
 * Env:
 * - KEYCLOAK_HOST_PORT (default 18080) — Keycloak on host
 * - KC_URL — override base URL (e.g. http://localhost:18080)
 * - KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD — admin credentials (Keycloak 26+; falls back to KEYCLOAK_ADMIN / KEYCLOAK_ADMIN_PASSWORD, then admin/admin)
 * - MCP_INSPECTOR_PORT (default 6274) — MCP Inspector client UI port (redirect + web origins)
 * - ZOWE_MCP_PUBLIC_BASE_URL — optional HTTPS MCP base (e.g. https://zowe.mcp.example.com:7542) for OAuth redirect URIs when MCP is behind HTTPS
 * - ZOWE_MCP_KEYCLOAK_REALM (default demo)
 * - ZOWE_MCP_KEYCLOAK_CLIENT (default demo)
 */

const hostPort = process.env.KEYCLOAK_HOST_PORT?.trim() || '18080';
const kcBase = (process.env.KC_URL || `http://localhost:${hostPort}`).replace(/\/$/, '');
const adminUser =
  process.env.KC_BOOTSTRAP_ADMIN_USERNAME?.trim() || process.env.KEYCLOAK_ADMIN?.trim() || 'admin';
const adminPass =
  process.env.KC_BOOTSTRAP_ADMIN_PASSWORD?.trim() ||
  process.env.KEYCLOAK_ADMIN_PASSWORD?.trim() ||
  'admin';
const inspectorPort = process.env.MCP_INSPECTOR_PORT?.trim() || '6274';
const realm = process.env.ZOWE_MCP_KEYCLOAK_REALM?.trim() || 'demo';
const clientId = process.env.ZOWE_MCP_KEYCLOAK_CLIENT?.trim() || 'demo';

/** HTTPS MCP base URL from remote-https-dev (e.g. https://zowe.mcp.example.com:7542) — merged into client for browser OAuth */
const publicBase = (() => {
  const u = process.env.ZOWE_MCP_PUBLIC_BASE_URL?.trim();
  return u ? u.replace(/\/$/, '') : '';
})();

const DEFAULT_REDIRECT_URIS = [
  'http://localhost/*',
  'http://127.0.0.1/*',
  `http://localhost:${inspectorPort}/*`,
  `http://127.0.0.1:${inspectorPort}/*`,
  `http://localhost:${inspectorPort}/oauth/callback`,
  `http://127.0.0.1:${inspectorPort}/oauth/callback`,
  // VS Code OAuth (HTTPS MCP / web callback — same URIs shown when DCR is unavailable)
  'https://vscode.dev/redirect',
  'https://insiders.vscode.dev/redirect',
  'https://code.visualstudio.com/*',
  // Cursor MCP OAuth (custom scheme; host must be trusted for DCR — see init-keycloak.sh)
  'cursor://anysphere.cursor-mcp/oauth/callback',
];

if (publicBase.startsWith('https://')) {
  DEFAULT_REDIRECT_URIS.push(`${publicBase}/*`, `${publicBase}/oauth/callback`);
}

const DEFAULT_WEB_ORIGINS = [
  `http://localhost:${inspectorPort}`,
  `http://127.0.0.1:${inspectorPort}`,
  'https://vscode.dev',
  'https://insiders.vscode.dev',
  'https://code.visualstudio.com',
];

if (publicBase.startsWith('https://')) {
  DEFAULT_WEB_ORIGINS.push(publicBase);
}

async function getAdminToken() {
  const res = await fetch(`${kcBase}/realms/master/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'admin-cli',
      username: adminUser,
      password: adminPass,
      grant_type: 'password',
    }),
  });
  if (!res.ok) {
    throw new Error(`Keycloak admin token failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = /** @type {{ access_token?: string }} */ (await res.json());
  const t = body.access_token;
  if (!t) {
    throw new Error('Keycloak admin token response missing access_token');
  }
  return t;
}

/**
 * @param {string} token
 */
async function patchClient(token) {
  const hdr = { Authorization: `Bearer ${token}` };
  const base = `${kcBase}/admin/realms/${realm}`;

  const listRes = await fetch(`${base}/clients?clientId=${encodeURIComponent(clientId)}`, {
    headers: hdr,
  });
  if (!listRes.ok) {
    throw new Error(`List clients failed: HTTP ${listRes.status} ${await listRes.text()}`);
  }
  /** @type {unknown} */
  const list = await listRes.json();
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(`Client ${clientId} not found — run keycloak-init first`);
  }
  const id = /** @type {{ id?: string }} */ (list[0]).id;
  if (!id) {
    throw new Error(`Client ${clientId} has no id in admin API response`);
  }

  const getRes = await fetch(`${base}/clients/${id}`, { headers: hdr });
  if (!getRes.ok) {
    throw new Error(`GET client failed: HTTP ${getRes.status} ${await getRes.text()}`);
  }
  /** @type {Record<string, unknown>} */
  const client = await getRes.json();

  const existingRedirect = Array.isArray(client.redirectUris) ? client.redirectUris : [];
  const existingWeb = Array.isArray(client.webOrigins) ? client.webOrigins : [];

  client.redirectUris = [...new Set([...existingRedirect, ...DEFAULT_REDIRECT_URIS])];
  client.webOrigins = [...new Set([...existingWeb, ...DEFAULT_WEB_ORIGINS])];

  const putRes = await fetch(`${base}/clients/${id}`, {
    method: 'PUT',
    headers: { ...hdr, 'Content-Type': 'application/json' },
    body: JSON.stringify(client),
  });
  if (!putRes.ok) {
    throw new Error(`PUT client failed: HTTP ${putRes.status} ${await putRes.text()}`);
  }

  console.log(
    `Keycloak client ${clientId}: merged redirect URIs and web origins (Inspector port ${inspectorPort}).`
  );
}

async function main() {
  try {
    const token = await getAdminToken();
    await patchClient(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`patch-keycloak-mcp-dev-redirects: ${msg}`);
  }
}

await main();
