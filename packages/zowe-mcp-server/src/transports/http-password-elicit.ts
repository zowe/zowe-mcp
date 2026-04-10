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
 * Browser page for MCP URL-mode password elicitation (POST completes pending elicitation).
 * Styling evokes VS Code (light/dark via prefers-color-scheme); all CSS is embedded — no CDN.
 */

import type { Express, Request, Response } from 'express';
import type { Logger } from '../log.js';
import { isVisualStudioCodeMcpClient } from '../mcp-client-hints.js';
import {
  type PendingPasswordUrlElicit,
  getPasswordUrlPending,
  takePasswordUrlPending,
} from '../zos/native/password-url-elicit-registry.js';

/** HTML shell for the password form and success page — self-contained, no external assets. */
const ELICIT_STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff;
  --bg-elevated: #f8f8f8;
  --fg: #333333;
  --fg-muted: #616161;
  --border: #cecece;
  --border-focus: #007fd4;
  --btn-bg: #007acc;
  --btn-fg: #ffffff;
  --btn-hover: #0062a3;
  --input-bg: #ffffff;
  --shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  --radius: 6px;
  --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #1e1e1e;
    --bg-elevated: #252526;
    --fg: #cccccc;
    --fg-muted: #9d9d9d;
    --border: #3c3c3c;
    --border-focus: #007fd4;
    --btn-bg: #0e639c;
    --btn-fg: #ffffff;
    --btn-hover: #1177bb;
    --input-bg: #3c3c3c;
    --shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  font-family: var(--font);
  font-size: 13px;
  line-height: 1.5;
  background: var(--bg);
  color: var(--fg);
}
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.card {
  width: 100%;
  max-width: 440px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 24px 28px 28px;
}
.brand {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--fg-muted);
  margin-bottom: 6px;
}
h1 {
  font-size: 18px;
  font-weight: 600;
  margin: 0 0 12px;
  color: var(--fg);
}
.connection-spec {
  margin: 0 0 16px;
  padding: 10px 12px;
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 4px;
  word-break: break-all;
}
.connection-spec .label {
  display: block;
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--fg-muted);
  margin-bottom: 4px;
}
.lead {
  margin: 0 0 20px;
  color: var(--fg-muted);
  font-size: 12px;
}
.lead code {
  font-family: var(--mono);
  font-size: inherit;
}
label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 6px;
  color: var(--fg);
}
.connection-spec input.connection-identity {
  display: block;
  width: 100%;
  margin: 0;
  padding: 0;
  border: none;
  background: transparent;
  font-family: var(--mono);
  font-size: 13px;
  font-weight: 500;
  color: var(--fg);
  outline: none;
  cursor: default;
}
.password-row {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin-bottom: 18px;
  border: 1px solid var(--border);
  border-radius: 4px;
  background: var(--input-bg);
  overflow: hidden;
}
.password-row:focus-within {
    border-color: var(--border-focus);
  box-shadow: 0 0 0 1px var(--border-focus);
}
.password-row input[type="password"],
.password-row input[type="text"] {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  font-size: 13px;
  font-family: var(--mono);
  color: var(--fg);
  background: transparent;
  border: none;
  outline: none;
  margin: 0;
}
.password-row .pw-toggle {
  flex-shrink: 0;
  font-family: var(--font);
  font-size: 12px;
  font-weight: 500;
  padding: 0 12px;
  color: var(--btn-bg);
  background: var(--bg-elevated);
  border: none;
  border-left: 1px solid var(--border);
  cursor: pointer;
  white-space: nowrap;
}
.password-row .pw-toggle:hover {
  background: var(--bg);
  color: var(--btn-hover);
}
.password-row .pw-toggle:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: -2px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
button[type="submit"] {
  font-family: var(--font);
  font-size: 13px;
  font-weight: 500;
  padding: 6px 18px;
  color: var(--btn-fg);
  background: var(--btn-bg);
  border: none;
  border-radius: 2px;
  cursor: pointer;
}
button[type="submit"]:hover {
  background: var(--btn-hover);
}
button[type="submit"]:focus-visible {
  outline: 2px solid var(--border-focus);
  outline-offset: 2px;
}
.success-icon {
  width: 40px;
  height: 40px;
  margin-bottom: 12px;
  border-radius: 50%;
  background: var(--btn-bg);
  color: var(--btn-fg);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 22px;
  line-height: 1;
}
.success-lead {
  margin: 0 0 8px;
  color: var(--fg-muted);
  font-size: 12px;
}
.close-hint {
  margin: 0;
  font-size: 11px;
  color: var(--fg-muted);
}
.error-title {
  margin: 0 0 8px;
  font-size: 16px;
}
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Display identity user@host or user@host:port when not 22 (native SSH, CLI bridge passwords, etc.). */
function formatSshTarget(user: string, host: string, port: number): string {
  const u = user.trim();
  const h = host.trim();
  if (port === 22) {
    return `${u}@${h}`;
  }
  return `${u}@${h}:${port}`;
}

/** Optional block listing MCP client from `initialize` clientInfo (e.g. Visual Studio Code). */
function mcpClientSectionHtml(mcpClientName?: string, mcpClientVersion?: string): string {
  const name = mcpClientName?.trim();
  if (!name) {
    return '';
  }
  const ver = mcpClientVersion?.trim();
  const line = ver ? `${escapeHtml(name)} ${escapeHtml(ver)}` : escapeHtml(name);
  return `<div class="connection-spec"><span class="label">MCP client</span>${line}</div>`;
}

function passwordElicitFormHtml(
  user: string,
  host: string,
  port: number,
  mcpClientName?: string,
  mcpClientVersion?: string
): string {
  const connectionIdentity = formatSshTarget(user, host, port);
  const spec = escapeHtml(connectionIdentity);
  const clientBlock = mcpClientSectionHtml(mcpClientName, mcpClientVersion);
  const hasClient = Boolean(mcpClientName?.trim());
  const vsCode = isVisualStudioCodeMcpClient(mcpClientName);
  const leadExtra = hasClient ? '' : ' This page was opened from your MCP client.';
  const lead = vsCode
    ? `<p class="lead">Enter your password for <code>${spec}</code>. It is sent only to this Zowe MCP server, not to chat or the language model.</p>`
    : `<p class="lead">Enter the password for this connection (${connectionIdentity}). Depending on your setup, that may be an SSH password for z/OS, a password used by Zowe CLI plugins (for example Db2), or another credential stored under this user and host.${leadExtra} The password is sent only to this Zowe MCP server; it is not pasted into chat and does not pass through the language model.</p>`;
  const pageTitle = escapeHtml(`Zowe MCP — Password (${connectionIdentity})`);
  const metaDesc = vsCode
    ? escapeHtml(`Enter your Zowe MCP password for ${connectionIdentity} (Visual Studio Code).`)
    : escapeHtml(
        `Enter the connection password for ${connectionIdentity} in Zowe MCP (z/OS SSH, Db2, or other tools using this user@host).`
      );
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="description" content="${metaDesc}"/>
  <title>${pageTitle}</title>
  <style>${ELICIT_STYLES}</style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="brand">Zowe MCP</div>
      <h1>Connection password</h1>
      <form id="zowe-mcp-pw-form" method="post" action="" autocomplete="on">
        <div class="connection-spec">
          <label class="label" for="conn-account">Connection</label>
          <input type="text" id="conn-account" name="username" class="connection-identity" autocomplete="username" value="${spec}" spellcheck="false" tabindex="0" aria-label="Connection account ${spec}"/>
        </div>
        ${clientBlock}
        ${lead}
        <label for="pw">Password</label>
        <div class="password-row">
          <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus spellcheck="false" autocapitalize="off" autocorrect="off" enterkeyhint="done"/>
          <button type="button" class="pw-toggle" id="pw-toggle" aria-pressed="false" aria-controls="pw" aria-label="Show password">Show</button>
        </div>
        <div class="actions">
          <button type="submit">Continue</button>
        </div>
      </form>
    </div>
  </div>
  <script>
(function(){
  var pw = document.getElementById("pw");
  var btn = document.getElementById("pw-toggle");
  if (!pw || !btn) return;
  btn.addEventListener("click", function(){
    if (pw.getAttribute("type") === "password") {
      pw.setAttribute("type", "text");
      btn.textContent = "Hide";
      btn.setAttribute("aria-pressed", "true");
      btn.setAttribute("aria-label", "Hide password");
    } else {
      pw.setAttribute("type", "password");
      btn.textContent = "Show";
      btn.setAttribute("aria-pressed", "false");
      btn.setAttribute("aria-label", "Show password");
    }
  });
})();
  </script>
</body>
</html>`;
}

function passwordElicitSuccessHtml(
  user: string,
  host: string,
  port: number,
  mcpClientName?: string,
  mcpClientVersion?: string
): string {
  const spec = escapeHtml(formatSshTarget(user, host, port));
  const clientBlock = mcpClientSectionHtml(mcpClientName, mcpClientVersion);
  const vsCode = isVisualStudioCodeMcpClient(mcpClientName);
  const successLead = vsCode
    ? `<p class="success-lead">You can close this tab and return to Visual Studio Code.</p>`
    : `<p class="success-lead">You can return to your MCP client. If you opened this URL in a normal tab (for example &ldquo;Open link in new tab&rdquo;), the browser usually keeps the tab open and will not auto-close it. If the MCP client opened a small popup, the browser may close that window automatically.</p>`;
  const closeHint = vsCode
    ? ''
    : `<p class="close-hint" id="closeFallback">If this tab stays open, close it manually.</p>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <title>Zowe MCP — Password received</title>
  <style>${ELICIT_STYLES}</style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="brand">Zowe MCP</div>
      <div class="success-icon" aria-hidden="true">&#10003;</div>
      <h1>Password received</h1>
      <div class="connection-spec"><span class="label">Connection</span>${spec}</div>
      ${clientBlock}
      ${successLead}
      ${closeHint}
    </div>
  </div>
  <script>
(function(){
  function tryClose(){
    try { window.close(); } catch (e) {}
    setTimeout(function(){
      var el = document.getElementById("closeFallback");
      if (el) { el.textContent = "You can close this tab when you are done."; }
    }, 2000);
  }
  setTimeout(tryClose, 400);
})();
  </script>
</body>
</html>`;
}

function elicitExpiredHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <title>Zowe MCP — Link expired</title>
  <style>${ELICIT_STYLES}</style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="brand">Zowe MCP</div>
      <h1 class="error-title">This link is no longer valid</h1>
      <p class="lead">The password request may have timed out or already completed. Return to your MCP client and trigger the request again if you still need to enter a password.</p>
    </div>
  </div>
</body>
</html>`;
}

export function registerPasswordUrlElicitRoutes(app: Express, log: Logger): void {
  const child = log.child('http.elicit');

  app.get('/zowe-mcp/password-elicit/:id', (req: Request, res: Response) => {
    const id = paramId(req);
    const entry: PendingPasswordUrlElicit | undefined = getPasswordUrlPending(id);
    if (!entry) {
      res.status(404).setHeader('Cache-Control', 'no-store').type('html').end(elicitExpiredHtml());
      return;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      passwordElicitFormHtml(
        entry.user,
        entry.host,
        entry.port,
        entry.mcpClientName,
        entry.mcpClientVersion
      )
    );
  });

  app.post('/zowe-mcp/password-elicit/:id', (req: Request, res: Response) => {
    const id = paramId(req);
    const body = req.body as { password?: string };
    const password = typeof body?.password === 'string' ? body.password : '';
    const entry: PendingPasswordUrlElicit | undefined = takePasswordUrlPending(id);
    if (!entry || password === '') {
      child.warning('Password elicit POST rejected', { id: id.slice(0, 8) });
      res.status(400).type('text/plain').send('Invalid or expired elicitation id.');
      return;
    }
    try {
      entry.resolve(password);
      res
        .status(200)
        .type('html')
        .setHeader('Cache-Control', 'no-store')
        .end(
          passwordElicitSuccessHtml(
            entry.user,
            entry.host,
            entry.port,
            entry.mcpClientName,
            entry.mcpClientVersion
          )
        );
    } catch (e) {
      child.error('Password elicit resolve failed', e);
      res.status(500).type('text/plain').send('Internal error');
    }
  });
}

function paramId(req: Request): string {
  const raw = req.params.id;
  return Array.isArray(raw) ? (raw[0] ?? '') : (raw ?? '');
}
