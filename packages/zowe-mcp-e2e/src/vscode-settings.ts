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
 * Builders for the `settings.json` fragments each e2e scenario needs, kept
 * out of the test files so the scenario intent (which backend, which BYOK
 * endpoint) reads clearly at the call site.
 */

/** BYOK settings pointing VS Code's (deprecated-but-working) Ollama-provider auto-migration at `endpointUrl`. */
export function byokOllamaSettings(endpointUrl: string): Record<string, unknown> {
  return {
    'github.copilot.chat.byok.ollamaEndpoint': endpointUrl,
  };
}

/**
 * capabilityTier controls both which tool *actions* are allowed AND how
 * many tools the server registers in the first place (read-strict/read: 36,
 * update: 61, delete: 68, full: 75 — measured against the mock backend).
 * "full" sounds like the right default for a permissive e2e profile, but it
 * pushes the registered tool count (75) past Copilot Chat's hardcoded
 * mandatory-tool-grouping floor (64 — see the README's "Known gotchas"),
 * which then requires a GitHub-hosted CAPI utility model call that always
 * fails without a GitHub sign-in and aborts the whole agent turn before any
 * tool is called. These e2e scenarios only ever call `listDatasets` (a read
 * op), so "read" (36 tools, comfortably under the 64 floor) is both
 * sufficient and safer.
 */
const CAPABILITY_TIER = 'read';

/** zoweMCP.* settings for the filesystem mock backend. */
export function zoweFilesystemMockSettings(mockDataDirectory: string): Record<string, unknown> {
  return {
    'zoweMCP.backend': 'mock',
    'zoweMCP.mockDataDirectory': mockDataDirectory,
    'zoweMCP.capabilityTier': CAPABILITY_TIER,
  };
}

/** zoweMCP.* settings for the native (zowex/SSH) backend pointed at a mock z/OS host. */
export function zoweNativeMockZosSettings(connections: string[]): Record<string, unknown> {
  return {
    'zoweMCP.backend': 'zowex',
    'zoweMCP.zowexConnections': connections,
    'zoweMCP.capabilityTier': CAPABILITY_TIER,
  };
}

/**
 * Builds the `ZOWE_MCP_PRIVATE_KEY_<USER>_<HOST>` env var name (per
 * `zowe-mcp-server`'s `connection-spec.ts#toPrivateKeyEnvVarName`: user
 * uppercased, host's dots replaced with underscores). Required to get SSH
 * key auth working against the mock z/OS host from *inside* a VS Code
 * profile: unlike the standalone CLI, the VS Code-embedded MCP server does
 * NOT read `ZOWE_MCP_PASSWORD_*` env vars for passwords (VS Code mode
 * expects passwords via an interactive SecretStorage-backed prompt
 * instead) — but SSH key resolution reads directly from `process.env`
 * regardless of standalone-vs-VS-Code mode, so pointing this env var at a
 * throwaway keypair (see `mock-backends.ts`'s `generateThrowawaySshKeypair`
 * + `authorizeSshKeyForUser`) is what lets a headless `code chat` avoid the
 * password prompt entirely.
 */
export function privateKeyEnvVarName(user: string, host: string): string {
  const userPart = user.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  const hostPart = host.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `ZOWE_MCP_PRIVATE_KEY_${userPart}_${hostPart}`;
}
