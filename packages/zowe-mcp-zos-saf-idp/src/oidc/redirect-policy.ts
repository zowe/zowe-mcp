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
 * Redirect-URI policy for anonymous Dynamic Client Registration (RFC 7591).
 *
 * Without initial access tokens anyone who can reach the IdP can register a
 * client, so the only thing standing between a registered client and token
 * exfiltration is where the authorization response may be sent. Mirrors the
 * trusted-hosts posture of the Keycloak dev bootstrap
 * (docker/remote-dev/init-keycloak.sh): loopback http(s) on any port/path,
 * plus the fixed VS Code web redirect URIs.
 */

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

const DEFAULT_EXACT_ALLOWED = [
  'https://vscode.dev/redirect',
  'https://insiders.vscode.dev/redirect',
];

export interface RedirectPolicy {
  isAllowed(uri: string): boolean;
  /** Human-readable summary of the active rules, for logs and error messages. */
  describe(): string;
}

export function createRedirectPolicy(extraExactAllowed: string[] = []): RedirectPolicy {
  const exactAllowed = new Set([...DEFAULT_EXACT_ALLOWED, ...extraExactAllowed]);

  return {
    isAllowed(uri: string): boolean {
      if (exactAllowed.has(uri)) {
        return true;
      }
      let parsed: URL;
      try {
        parsed = new URL(uri);
      } catch {
        return false;
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return false;
      }
      return LOOPBACK_HOSTNAMES.has(parsed.hostname);
    },
    describe(): string {
      return `loopback http(s) URIs on any port, or one of: ${[...exactAllowed].join(', ')}`;
    },
  };
}
