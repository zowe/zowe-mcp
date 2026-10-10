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
 * String-literal HTML pages for the OIDC interaction UI (login, consent, error).
 * Deliberately no template engine: every interpolated value goes through
 * `escapeHtml`, and pages carry a strict CSP so a slip never becomes XSS.
 */

import type { Response } from 'express';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// No form-action directive: Chromium enforces form-action against every
// redirect that follows a form submission, and the consent POST's chain
// deliberately ends on the OAuth client's own redirect_uri (a different
// origin) — 'self' would silently kill the navigation right after "Allow".
// CSRF is covered by the interaction-cookie/:uid binding, not by CSP.
const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'";

/** Applies the security headers every interaction page must carry. */
export function setInteractionPageHeaders(res: Response): void {
  res.setHeader('Content-Security-Policy', PAGE_CSP);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.type('html');
}

const STYLE = `
  body { font-family: system-ui, sans-serif; background: #f4f4f4; margin: 0;
         display: flex; justify-content: center; padding: 8vh 16px 16px; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px;
          padding: 24px 28px; max-width: 380px; width: 100%; }
  h1 { font-size: 1.15rem; margin: 0 0 4px; }
  p.sub { color: #555; font-size: 0.85rem; margin: 0 0 16px; }
  label { display: block; font-size: 0.85rem; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 8px; font-size: 1rem;
          border: 1px solid #bbb; border-radius: 4px; }
  button { margin-top: 16px; width: 100%; padding: 10px; font-size: 1rem;
           border: 0; border-radius: 4px; background: #1a5fb4; color: #fff; cursor: pointer; }
  button.secondary { background: #e0e0e0; color: #222; margin-top: 8px; }
  .error { background: #fbe4e4; border: 1px solid #e0a0a0; color: #7a1f1f;
           border-radius: 4px; padding: 8px 10px; font-size: 0.85rem; margin-bottom: 8px; }
  .notice { background: #fdf3d7; border: 1px solid #e0c877; color: #6a5312;
            border-radius: 4px; padding: 8px 10px; font-size: 0.85rem; margin-bottom: 8px; }
  ul.scopes { font-size: 0.9rem; padding-left: 20px; }
  code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
`;

function page(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="card">
${body}
</div>
</body>
</html>`;
}

export interface LoginPageOptions {
  uid: string;
  clientId: string;
  /** System the credentials are verified against — shown on the form. */
  systemName: string;
  /** Security product name (RACF / ACF2 / Top Secret), or a generic SAF label. */
  securityProduct: string;
  /** Purpose banner shown above the form (dev/test disclaimer by default). */
  notice: string;
  errorMessage?: string;
}

/** SAF/RACF username+password form posting to `/interaction/:uid/login`. */
export function loginPage(options: LoginPageOptions): string {
  const error = options.errorMessage
    ? `<div class="error">${escapeHtml(options.errorMessage)}</div>`
    : '';
  const notice = options.notice ? `<div class="notice">${escapeHtml(options.notice)}</div>` : '';
  return page(
    'Sign in — Zowe MCP z/OS SAF IdP',
    `<h1>Sign in to ${escapeHtml(options.systemName)}</h1>
<p class="sub">Application <code>${escapeHtml(options.clientId)}</code> is requesting access.
Credentials are verified by <strong>${escapeHtml(options.securityProduct)}</strong> on
<strong>${escapeHtml(options.systemName)}</strong>.</p>
${notice}
${error}
<form method="post" action="/interaction/${encodeURIComponent(options.uid)}/login" autocomplete="off">
  <label for="username">Username</label>
  <input id="username" name="username" type="text" autocomplete="username" autocapitalize="off" autofocus required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="off" required>
  <button type="submit">Sign in</button>
</form>`
  );
}

export interface ConsentPageOptions {
  uid: string;
  clientId: string;
  username: string;
  scopes: string[];
}

/** One-click consent page posting to `/interaction/:uid/confirm` (or abort). */
export function consentPage(options: ConsentPageOptions): string {
  const scopeItems = options.scopes.length
    ? `<ul class="scopes">${options.scopes.map(s => `<li><code>${escapeHtml(s)}</code></li>`).join('')}</ul>`
    : '<p class="sub">No additional permissions requested.</p>';
  const uid = encodeURIComponent(options.uid);
  return page(
    'Authorize — Zowe MCP z/OS SAF IdP',
    `<h1>Authorize ${escapeHtml(options.clientId)}</h1>
<p class="sub">Signed in as <code>${escapeHtml(options.username)}</code>. The application requests:</p>
${scopeItems}
<form method="post" action="/interaction/${uid}/confirm">
  <button type="submit">Allow</button>
</form>
<form method="post" action="/interaction/${uid}/abort">
  <button type="submit" class="secondary">Deny</button>
</form>`
  );
}

export interface ErrorPageOptions {
  error: string;
  errorDescription?: string;
}

/** Generic error page — never includes stack traces or internals. */
export function errorPage(options: ErrorPageOptions): string {
  const description = options.errorDescription
    ? `<p class="sub">${escapeHtml(options.errorDescription)}</p>`
    : '';
  return page(
    'Error — Zowe MCP z/OS SAF IdP',
    `<h1>Something went wrong</h1>
<div class="error">${escapeHtml(options.error)}</div>
${description}`
  );
}
