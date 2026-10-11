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
 * Entry point for `zowe-mcp-server doctor-local`: environment checks for
 * same-system ("local") zowex execution. See src/zos/native/local-doctor.ts
 * for the checks and docs/zos-local-zowex-identity.md for the design.
 *
 * Usage:
 *   zowe-mcp-server doctor-local [--probe-user <userid>] [--stdio]
 *
 * --probe-user performs a REAL, SAF-audited SURROGAT identity switch through
 * the configured launcher (runs `id` as that user) — opt-in only.
 * --stdio checks the stdio same-user arm instead (deployment shape 2): the
 * invoking user's identity and a resolvable zowex; no launcher or SURROGAT.
 */

import { formatLocalDoctorReport, runLocalDoctor } from '../zos/native/local-doctor.js';

function parseProbeUser(argv: string[]): string | undefined {
  const eq = argv.find(a => a.startsWith('--probe-user='));
  if (eq) {
    return eq.slice('--probe-user='.length);
  }
  const idx = argv.indexOf('--probe-user');
  return idx >= 0 ? argv[idx + 1] : undefined;
}

const cliArgs = process.argv.slice(2);
const report = runLocalDoctor({
  probeUser: parseProbeUser(cliArgs),
  stdio: cliArgs.includes('--stdio'),
});
console.log(formatLocalDoctorReport(report));
process.exit(report.ok ? 0 : 1);
