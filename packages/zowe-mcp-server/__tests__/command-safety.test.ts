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

import { describe, expect, it } from 'vitest';
import { formatBlockedCommandMessage } from '../src/tools/command-safety.js';

describe('formatBlockedCommandMessage', () => {
  it('wraps a USS reason and points to an SSH or OMVS session', () => {
    expect(formatBlockedCommandMessage('USS', 'Pipes URL content to shell')).toBe(
      'This USS command was BLOCKED by the z/OS MCP safety policy and was NOT run. Pipes URL content to shell ' +
        'Do not retry it or explain how to run it; if it is genuinely required, advise the user to run it ' +
        'through an authorized channel (such as an SSH or OMVS session) under their own authority.'
    );
  });

  it('keeps the 3270 wording for TSO and console', () => {
    for (const kind of ['TSO', 'console'] as const) {
      const msg = formatBlockedCommandMessage(kind);
      expect(msg).toContain(`This ${kind} command was BLOCKED`);
      expect(msg).toContain('It is classified as dangerous.');
      expect(msg).toContain('(such as a 3270 session)');
    }
  });
});
