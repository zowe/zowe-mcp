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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { generateAndPersistHostKey } from './host-keys.js';
import type { MockUsersFile } from './users.js';

interface FixtureOptions {
  mockDir: string;
  preset: string;
  force: boolean;
}

/**
 * Write a minimal set of fixtures sufficient to start the daemon and exercise
 * datasets, USS, jobs over both `ssh` and `--native`.
 *
 * Layout produced:
 *   <mockDir>/
 *     systems.json                  (compatible with FilesystemMockBackend)
 *     _ssh/host_key                 (RSA-3072)
 *     _ssh/users.json               (auth + scenarios)
 *     _ssh/banner.txt               (pre-auth banner)
 *     _ssh/motd.txt                 (post-auth MOTD)
 *     sys1/USER1/HELLO.cbl          (sample PDS member)
 *     uss/sys1/u/user1/README.txt   (sample USS file)
 */
export async function writeSampleFixtures(opts: FixtureOptions): Promise<void> {
  const { mockDir, force } = opts;
  await fs.mkdir(mockDir, { recursive: true });

  await writeIfMissing(
    path.join(mockDir, 'systems.json'),
    JSON.stringify(
      {
        systems: [
          {
            host: 'sys1',
            port: 22,
            description: 'Mock z/OS host',
            defaultUser: 'USER1',
            credentials: [{ user: 'USER1', password: 'password' }],
          },
        ],
      },
      null,
      2
    ),
    force
  );

  await generateAndPersistHostKey(mockDir, { force });

  const users: MockUsersFile = {
    defaultSystemId: 'sys1',
    users: [
      {
        username: 'USER1',
        password: 'password',
        uid: 12345,
        gid: 10,
        primaryGroup: 'STCGROUP',
        groups: ['SYS1'],
        home: '/u/user1',
        systemId: 'sys1',
        scenario: 'normal',
      },
      {
        username: 'EXPIRED',
        password: 'password',
        home: '/u/expired',
        systemId: 'sys1',
        scenario: 'passwordExpired',
      },
      {
        username: 'LOCKED',
        password: 'password',
        home: '/u/locked',
        systemId: 'sys1',
        scenario: 'racfRevoked',
      },
      {
        username: 'WARNING',
        password: 'password',
        home: '/u/warning',
        systemId: 'sys1',
        scenario: 'passwordExpiresInDays',
        scenarioValue: 3,
      },
    ],
  };
  await writeIfMissing(
    path.join(mockDir, '_ssh', 'users.json'),
    JSON.stringify(users, null, 2),
    force
  );

  await writeIfMissing(
    path.join(mockDir, '_ssh', 'banner.txt'),
    [
      '*****************************************************************',
      '*                  Zowe Mock z/OS SSH Host                      *',
      '*                       https://zowe.org                        *',
      '*                                                               *',
      '*  Open source under the Eclipse Public License v2.0.           *',
      '*  For development and testing only. Not for production use.    *',
      '*  Unauthorized access prohibited.                              *',
      '*****************************************************************',
      '',
    ].join('\n'),
    force
  );

  await writeIfMissing(
    path.join(mockDir, '_ssh', 'motd.txt'),
    'ZWE0000I Welcome to the Zowe mock z/OS host. This system is for development only.\n',
    force
  );

  // Sample PDS member
  const pdsDir = path.join(mockDir, 'sys1', 'USER1', 'SAMPLE.COBOL');
  await fs.mkdir(pdsDir, { recursive: true });
  await writeIfMissing(
    path.join(pdsDir, 'HELLO.cbl'),
    [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. HELLO.',
      '       PROCEDURE DIVISION.',
      "           DISPLAY 'Hello from mock z/OS!'.",
      '           STOP RUN.',
      '',
    ].join('\n'),
    force
  );
  await writeIfMissing(
    path.join(pdsDir, '_meta.json'),
    JSON.stringify(
      {
        dsn: 'USER1.SAMPLE.COBOL',
        dsorg: 'PO-E',
        recfm: 'FB',
        lrecl: 80,
        blksz: 27920,
        volser: 'VOL001',
        creationDate: new Date().toISOString().slice(0, 10),
      },
      null,
      2
    ),
    force
  );

  // Sample sequential
  const seqPath = path.join(mockDir, 'sys1', 'USER1', 'NOTES.TXT');
  await writeIfMissing(seqPath, 'Mock z/OS host sample notes.\n', force);

  // ─── USER1 USS home directory (/u/user1) ──────────────────────────────────
  //
  // Populated with files a z/OS UNIX user would normally see in their home
  // directory after a fresh setup: a .profile, .sh_history, a personal bin/
  // and tmp/ work area, sample COBOL project, and a copy of the HELLOJCL.
  const ussDir = path.join(mockDir, 'uss', 'sys1', 'u', 'user1');
  await fs.mkdir(ussDir, { recursive: true });

  // .profile — z/OS USS shell startup
  await writeIfMissing(
    path.join(ussDir, '.profile'),
    [
      '# Zowe mock z/OS UNIX profile for USER1',
      '# Sourced by /bin/sh on login.',
      '',
      'export USER=USER1',
      'export LOGNAME=USER1',
      'export HOME=/u/user1',
      'export PATH=/bin:/usr/bin:/usr/sbin:/usr/lpp/java/J17.0_64/bin:$HOME/bin',
      'export LIBPATH=/lib:/usr/lib:/usr/lpp/java/J17.0_64/lib',
      'export MANPATH=/usr/man/%L:/usr/man/En_US.IBM-1047',
      'export TZ=EST5EDT',
      'export _BPX_SHAREAS=YES',
      'export _BPX_SPAWN_SCRIPT=YES',
      'export STEPLIB=NONE',
      '',
      "PS1='${LOGNAME}:${PWD}> '",
      'umask 022',
      '',
      '# Pull dataset names into shell completion (not implemented in the mock,',
      '# but real shops often source helper scripts here).',
      '# . /etc/dataset-helpers.sh',
      '',
    ].join('\n'),
    force
  );

  // .sh_history — recent commands that ACTUALLY work in the mock shell.
  // (The mock interpreter doesn't implement `tso`, `vi`, `df`, or shell
  // substitution; we keep only commands the user can re-run successfully.)
  await writeIfMissing(
    path.join(ussDir, '.sh_history'),
    [
      'pwd',
      'ls -la',
      'cd projects/hello-cobol',
      'cat README.md',
      'cd ~',
      'whoami',
      'id',
      'uname -a',
      'env',
      '',
    ].join('\n'),
    force
  );

  // Top-level README. Only references files / commands that actually work
  // in the mock USS shell; mainframe-side workflows (job submit, dataset
  // listing) live on the SSH/RPC and z/OSMF transports, not in the
  // interactive shell here. No hello.sh or bin/ — both shipped with
  // commands the interpreter doesn't implement, so we no longer seed them.
  await writeIfMissing(
    path.join(ussDir, 'README.txt'),
    [
      'Welcome to the Zowe mock z/OS host.',
      '',
      "This is USER1's USS home directory. Layout:",
      '  .profile               sh startup file (z/OS UNIX flavour, declarative)',
      '  .sh_history            sample command history',
      '  tmp/                   scratch workspace',
      '  projects/hello-cobol/  sample mainframe project (source + JCL fixtures)',
      '  jcl/                   shell-side copies of common JCL',
      '',
      "What the mock's interactive shell supports:",
      '  pwd, cd, ls, cat, head, tail, wc, grep, mkdir, rm, touch,',
      '  echo, whoami, id, uname, env, sleep, which, exit',
      '',
      'Dataset / job operations are NOT exposed as shell commands here — use',
      'the zowex JSON-RPC channel (the Zowe MCP server connects automatically)',
      "or the daemon's z/OSMF HTTP listener (when --http-port is set).",
      '',
    ].join('\n'),
    force
  );

  // No hello.sh and no bin/: the previous samples relied on shell features
  // (`$(…)` substitution, `date`, `tso`) that the mock USS interpreter
  // doesn't implement. Better to ship nothing than files that fail when
  // invoked. `force` is referenced here so eslint doesn't flag the unused
  // parameter if every other writeIfMissing call is removed in the future.
  void force;

  // tmp/ — keep the directory present (with a placeholder so empty-dir
  // semantics don't lose it through some sync tools)
  await fs.mkdir(path.join(ussDir, 'tmp'), { recursive: true });
  await writeIfMissing(path.join(ussDir, 'tmp', '.keep'), '# scratch workspace\n', force);

  // projects/hello-cobol/ — sample mainframe project
  const projDir = path.join(ussDir, 'projects', 'hello-cobol');
  await fs.mkdir(projDir, { recursive: true });
  await writeIfMissing(
    path.join(projDir, 'README.md'),
    [
      '# hello-cobol',
      '',
      'A tiny COBOL sample paired with JCL to illustrate the mainframe project',
      'layout. The mock host does not actually run the compiler / submit jobs',
      'from this directory — submit through the Zowe MCP server or the z/OSMF',
      'REST API instead.',
      '',
      '## Layout',
      '',
      '- `hello.cbl` — COBOL source, copy of `USER1.SAMPLE.COBOL(HELLO)`.',
      '- `hello.jcl` — JCL to invoke IEFBR14 (a no-op step useful for smoke testing).',
      '',
    ].join('\n'),
    force
  );
  await writeIfMissing(
    path.join(projDir, 'hello.cbl'),
    [
      '       IDENTIFICATION DIVISION.',
      '       PROGRAM-ID. HELLO.',
      '       PROCEDURE DIVISION.',
      "           DISPLAY 'Hello from mock z/OS!'.",
      '           STOP RUN.',
      '',
    ].join('\n'),
    force
  );
  await writeIfMissing(
    path.join(projDir, 'hello.jcl'),
    [
      '//HELLOJCL JOB (ACCT),CLASS=A,MSGCLASS=H,NOTIFY=&SYSUID',
      '//STEP1   EXEC PGM=IEFBR14',
      '//SYSPRINT DD SYSOUT=*',
      '',
    ].join('\n'),
    force
  );
  // No Makefile: the previous wrapper invoked `tso submit` / `tso status`,
  // which the mock USS shell doesn't implement. Submit through the MCP
  // server's `submit_job` tool (RPC) or `POST /zosmf/restjobs/jobs` instead.

  // jcl/ — shell-side copies of frequently-used JCL
  await writeIfMissing(
    path.join(ussDir, 'jcl', 'hello.jcl'),
    [
      '//HELLOJCL JOB (ACCT),CLASS=A,MSGCLASS=H,NOTIFY=&SYSUID',
      '//STEP1   EXEC PGM=IEFBR14',
      '//SYSPRINT DD SYSOUT=*',
      '',
    ].join('\n'),
    force
  );
  await writeIfMissing(
    path.join(ussDir, 'jcl', 'iebcopy.jcl'),
    [
      '//IEBCOPY  JOB (ACCT),CLASS=A,MSGCLASS=H',
      '//STEP1    EXEC PGM=IEBCOPY',
      '//SYSPRINT DD SYSOUT=*',
      '//IN       DD DSN=USER1.SAMPLE.COBOL,DISP=SHR',
      '//OUT      DD DSN=USER1.BACKUP.COBOL,DISP=(NEW,CATLG,DELETE),',
      '//            LIKE=USER1.SAMPLE.COBOL',
      '//SYSIN    DD *',
      '   COPY OUTDD=OUT,INDD=((IN,R))',
      '/*',
      '',
    ].join('\n'),
    force
  );

  // Sample JCL fixture for submit_job (member of USER1.SAMPLE.COBOL PDS)
  await writeIfMissing(
    path.join(pdsDir, 'HELLOJCL.jcl'),
    [
      '//HELLOJCL JOB (ACCT),CLASS=A,MSGCLASS=H,NOTIFY=&SYSUID',
      '//STEP1   EXEC PGM=IEFBR14',
      '//SYSPRINT DD SYSOUT=*',
      '',
    ].join('\n'),
    force
  );
}

async function writeIfMissing(filePath: string, content: string, force: boolean): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (!force) {
    try {
      await fs.access(filePath);
      return; // exists, leave alone
    } catch {
      /* not present */
    }
  }
  await fs.writeFile(filePath, content);
}
