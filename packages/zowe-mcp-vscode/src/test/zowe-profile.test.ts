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

import * as assert from 'node:assert/strict';
import {
  getAllZosmfProfileNames,
  getDefaultZosmfProfileName,
  getExplorerProfileInfo,
  resolveProfileFromSystem,
} from '../zowe-profile';

suite('Zowe Explorer profile lookup', () => {
  test('uses the same team profiles as Explorer for defaults, picks, and system matching', async () => {
    const zosmf = { profName: 'team.zosmf' };
    const ssh = { profName: 'team.ssh' };
    const profiles = {
      getDefaultProfile: () => zosmf,
      getAllProfiles: (type: string) => (type === 'zosmf' ? [zosmf] : [ssh]),
      mergeArgsForProfile: () => ({
        knownArgs: [
          { argName: 'host', argValue: 'example.invalid' },
          { argName: 'user', argValue: 'TESTUSER' },
        ],
      }),
    };
    const info = await getExplorerProfileInfo({
      activate: () =>
        Promise.resolve({
          getExplorerExtenderApi: () => ({
            getProfilesCache: () => ({ getProfileInfo: () => Promise.resolve(profiles) }),
          }),
        }),
    });

    assert.equal(getDefaultZosmfProfileName(info), 'team.zosmf');
    assert.deepEqual(getAllZosmfProfileNames(info), ['team.zosmf']);
    assert.equal(resolveProfileFromSystem(info, 'TESTUSER@EXAMPLE.INVALID'), 'team.zosmf');
    assert.equal(resolveProfileFromSystem(info, 'TESTUSER@example.invalid:22', true), 'team.ssh');
    assert.equal(resolveProfileFromSystem(info, 'OTHER@example.invalid'), null);
  });

  test('leaves manual selection available when Explorer cannot load its profile cache', async () => {
    const info = await getExplorerProfileInfo({
      activate: () =>
        Promise.resolve({
          getExplorerExtenderApi: () => ({
            getProfilesCache: () => ({
              getProfileInfo: () => Promise.reject(new Error('Configuration unavailable')),
            }),
          }),
        }),
    });

    assert.equal(getDefaultZosmfProfileName(info), null);
    assert.deepEqual(getAllZosmfProfileNames(info), []);
    assert.equal(resolveProfileFromSystem(info, 'TESTUSER@example.invalid'), null);
  });
});
