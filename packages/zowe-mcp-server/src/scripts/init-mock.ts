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
 * CLI script to generate a realistic mock data directory.
 *
 * Usage:
 *   npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data
 *   npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data --preset minimal
 *   npx zowe-mcp-server init-mock --output ./zowe-mcp-mock-data --systems 5 --users-per-system 3
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { MockDatasetMeta, MockSystemsConfig } from '../zos/mock/mock-types.js';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface MockPreset {
  systems: number;
  usersPerSystem: number;
  datasetsPerUser: number;
  membersPerPds: number;
}

const PRESETS: Record<string, MockPreset> = {
  minimal: { systems: 1, usersPerSystem: 1, datasetsPerUser: 5, membersPerPds: 3 },
  default: { systems: 2, usersPerSystem: 2, datasetsPerUser: 8, membersPerPds: 5 },
  large: { systems: 5, usersPerSystem: 3, datasetsPerUser: 20, membersPerPds: 15 },
};

// ---------------------------------------------------------------------------
// System / user templates
// ---------------------------------------------------------------------------

const SYSTEM_TEMPLATES = [
  { host: 'mainframe-dev.example.com', description: 'Development LPAR' },
  { host: 'mainframe-test.example.com', description: 'Test/QA LPAR' },
  { host: 'mainframe-prod.example.com', description: 'Production LPAR' },
  { host: 'mainframe-dr.example.com', description: 'Disaster Recovery LPAR' },
  { host: 'mainframe-sandbox.example.com', description: 'Sandbox LPAR' },
];

const USER_TEMPLATES = ['IBMUSER', 'DEVUSR1', 'DEVUSR2', 'SYSPROG', 'QAUSER1', 'PRODMGR'];

// ---------------------------------------------------------------------------
// Content generators
// ---------------------------------------------------------------------------

function generateCobolProgram(programName: string, hlq: string): string {
  const copybooks = ['CUSTREC', 'ACCTFMT', 'ERRCODES'];
  const usedCopy = copybooks[Math.floor(Math.random() * copybooks.length)];
  return `       IDENTIFICATION DIVISION.
       PROGRAM-ID. ${programName}.
       AUTHOR. GENERATED-MOCK.
       DATE-WRITTEN. 2024-03-15.
      *
      * ${programName} - Generated mock COBOL program
      * Part of ${hlq} application suite
      *
       ENVIRONMENT DIVISION.
       CONFIGURATION SECTION.
       SOURCE-COMPUTER. IBM-ZOS.
       OBJECT-COMPUTER. IBM-ZOS.
      *
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT INFILE  ASSIGN TO INDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-FILE-STATUS.
           SELECT OUTFILE ASSIGN TO OUTDD
                  ORGANIZATION IS SEQUENTIAL
                  ACCESS MODE IS SEQUENTIAL
                  FILE STATUS IS WS-OUT-STATUS.
      *
       DATA DIVISION.
       FILE SECTION.
       FD  INFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  IN-RECORD                    PIC X(80).
      *
       FD  OUTFILE
           RECORDING MODE IS F
           BLOCK CONTAINS 0 RECORDS.
       01  OUT-RECORD                   PIC X(133).
      *
       WORKING-STORAGE SECTION.
       01  WS-FILE-STATUS               PIC XX VALUE SPACES.
       01  WS-OUT-STATUS                PIC XX VALUE SPACES.
       01  WS-EOF-FLAG                  PIC X  VALUE 'N'.
           88 END-OF-FILE               VALUE 'Y'.
       01  WS-RECORD-COUNT              PIC 9(7) VALUE ZERO.
       01  WS-ERROR-COUNT               PIC 9(5) VALUE ZERO.
      *
           COPY ${usedCopy}.
      *
       PROCEDURE DIVISION.
       0000-MAIN.
           PERFORM 1000-INITIALIZE
           PERFORM 2000-PROCESS UNTIL END-OF-FILE
           PERFORM 3000-TERMINATE
           STOP RUN.
      *
       1000-INITIALIZE.
           OPEN INPUT  INFILE
           OPEN OUTPUT OUTFILE
           IF WS-FILE-STATUS NOT = '00'
              DISPLAY '${programName}: ERROR OPENING INPUT FILE'
              DISPLAY 'FILE STATUS: ' WS-FILE-STATUS
              MOVE 16 TO RETURN-CODE
              STOP RUN
           END-IF
           READ INFILE
              AT END SET END-OF-FILE TO TRUE
           END-READ.
      *
       2000-PROCESS.
           ADD 1 TO WS-RECORD-COUNT
           MOVE IN-RECORD TO OUT-RECORD
           WRITE OUT-RECORD
           READ INFILE
              AT END SET END-OF-FILE TO TRUE
           END-READ.
      *
       3000-TERMINATE.
           CLOSE INFILE
           CLOSE OUTFILE
           DISPLAY '${programName}: PROCESSED ' WS-RECORD-COUNT
                   ' RECORDS'
           DISPLAY '${programName}: ERRORS    ' WS-ERROR-COUNT.
`;
}

function generateCopybook(copybookName: string): string {
  const copybooks: Record<string, string> = {
    CUSTREC: `      * Customer Record Layout - ${copybookName}
       01  CUSTOMER-RECORD.
           05  CUST-ID                  PIC 9(8).
           05  CUST-NAME.
               10  CUST-LAST-NAME      PIC X(25).
               10  CUST-FIRST-NAME     PIC X(20).
               10  CUST-MIDDLE-INIT    PIC X.
           05  CUST-ADDRESS.
               10  CUST-STREET         PIC X(30).
               10  CUST-CITY           PIC X(20).
               10  CUST-STATE          PIC XX.
               10  CUST-ZIP            PIC 9(5).
           05  CUST-PHONE              PIC 9(10).
           05  CUST-ACCT-TYPE          PIC XX.
               88  CUST-CHECKING       VALUE 'CK'.
               88  CUST-SAVINGS        VALUE 'SV'.
               88  CUST-MONEY-MARKET   VALUE 'MM'.
           05  CUST-BALANCE            PIC S9(9)V99 COMP-3.
           05  CUST-OPEN-DATE          PIC 9(8).
           05  FILLER                  PIC X(10).
`,
    ACCTFMT: `      * Account Format Layout - ${copybookName}
       01  ACCOUNT-RECORD.
           05  ACCT-NUMBER             PIC 9(10).
           05  ACCT-TYPE               PIC XX.
           05  ACCT-STATUS             PIC X.
               88  ACCT-ACTIVE         VALUE 'A'.
               88  ACCT-CLOSED         VALUE 'C'.
               88  ACCT-FROZEN         VALUE 'F'.
           05  ACCT-BALANCE            PIC S9(11)V99 COMP-3.
           05  ACCT-OPEN-DATE          PIC 9(8).
           05  ACCT-LAST-ACTIVITY      PIC 9(8).
           05  ACCT-OWNER-ID           PIC 9(8).
           05  ACCT-BRANCH             PIC 9(4).
           05  FILLER                  PIC X(20).
`,
    ERRCODES: `      * Error Code Definitions - ${copybookName}
       01  ERROR-CODES.
           05  ERR-NONE                PIC XX VALUE '00'.
           05  ERR-NOT-FOUND           PIC XX VALUE '04'.
           05  ERR-DUPLICATE           PIC XX VALUE '08'.
           05  ERR-INVALID-INPUT       PIC XX VALUE '12'.
           05  ERR-SYSTEM-ERROR        PIC XX VALUE '16'.
           05  ERR-AUTH-FAILURE        PIC XX VALUE '20'.
           05  ERR-FILE-ERROR          PIC XX VALUE '24'.
           05  ERR-TIMEOUT             PIC XX VALUE '28'.
`,
  };

  return copybooks[copybookName] ?? copybooks.CUSTREC;
}

function generateJcl(jobName: string, hlq: string, programName: string): string {
  return `//${jobName} JOB (ACCT),'${hlq}',
//  CLASS=A,MSGCLASS=X,MSGLEVEL=(1,1),
//  NOTIFY=&SYSUID
//*
//* ${jobName} - Compile and run ${programName}
//* Generated mock JCL
//*
//COMPILE EXEC PGM=IGYCRCTL,
//  PARM='RENT,APOST,MAP,XREF,OFFSET'
//STEPLIB  DD DSN=IGY.V6R4M0.SIGYCOMP,DISP=SHR
//SYSIN    DD DSN=${hlq}.SRC.COBOL(${programName}),DISP=SHR
//SYSLIB   DD DSN=${hlq}.SRC.COPYBOOK,DISP=SHR
//         DD DSN=SYS1.MACLIB,DISP=SHR
//SYSPRINT DD SYSOUT=*
//SYSLIN   DD DSN=&&LOADSET,DISP=(MOD,PASS),
//            UNIT=SYSDA,SPACE=(TRK,(3,3))
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT2   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT3   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT4   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT5   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT6   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//SYSUT7   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//LKED    EXEC PGM=IEWL,COND=(4,LT),
//  PARM='LIST,XREF,LET,RENT'
//SYSLIB   DD DSN=CEE.SCEELKED,DISP=SHR
//SYSLIN   DD DSN=&&LOADSET,DISP=(OLD,DELETE)
//SYSLMOD  DD DSN=${hlq}.LOAD.MODULE,DISP=SHR
//SYSPRINT DD SYSOUT=*
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//RUN     EXEC PGM=${programName},COND=(4,LT)
//STEPLIB  DD DSN=${hlq}.LOAD.MODULE,DISP=SHR
//INDD     DD DSN=${hlq}.DATA.INPUT,DISP=SHR
//OUTDD    DD DSN=${hlq}.LOG.OUTPUT,DISP=SHR
//SYSOUT   DD SYSOUT=*
//SYSPRINT DD SYSOUT=*
`;
}

function generateSequentialData(type: 'input' | 'log' | 'results'): string {
  if (type === 'input') {
    const records: string[] = [];
    for (let i = 1; i <= 10; i++) {
      records.push(
        `${String(i).padStart(8, '0')}CUSTOMER${String(i).padStart(3, '0')}  SMITH${' '.repeat(20)}JOHN${' '.repeat(17)}M123 MAIN ST${' '.repeat(19)}ANYTOWN${' '.repeat(14)}NY10001`
      );
    }
    return records.join('\n') + '\n';
  }
  if (type === 'log') {
    return `2024-03-15 10:00:00 INFO  Application started
2024-03-15 10:00:01 INFO  Opening input file
2024-03-15 10:00:01 INFO  Processing records
2024-03-15 10:00:02 INFO  Record 1 processed successfully
2024-03-15 10:00:02 INFO  Record 2 processed successfully
2024-03-15 10:00:03 WARN  Record 3 - field validation warning
2024-03-15 10:00:03 INFO  Record 3 processed with warnings
2024-03-15 10:00:04 INFO  Processing complete
2024-03-15 10:00:04 INFO  Total records: 3, Errors: 0, Warnings: 1
2024-03-15 10:00:04 INFO  Application ended RC=0
`;
  }
  // results
  return `TEST RESULTS REPORT
===================
Date: 2024-03-15
Environment: TEST

Test Suite: CUSTFILE Processing
  TC001 - Read customer record    : PASS
  TC002 - Validate account type   : PASS
  TC003 - Calculate balance       : PASS
  TC004 - Write output record     : PASS
  TC005 - Error handling          : PASS

Summary: 5 tests, 5 passed, 0 failed
`;
}

function generateSysProclib(): string {
  return `//IEFPROC PROC
//*
//* IEFPROC - System initialization procedure
//* This is a mock system procedure
//*
//STEP1   EXEC PGM=IEFBR14
//SYSPRINT DD SYSOUT=*
// PEND
`;
}

function generateSysParmlib(): string {
  return `/* IEASYS00 - System parameter member (mock) */
ALLOC=00,
APF=00,
CLOCK=00,
CMD=00,
CON=00,
COUPLE=DEFAULT,
DIAG=00,
FIX=00,
GRS=STAR,
IOS=00,
LPA=00,
MLPA=,
PROG=00,
RDE=00,
RSU=00,
SMF=00,
SQA=(4,128),
SVC=00,
VAL=00,
`;
}

// ---------------------------------------------------------------------------
// COBOL program name templates
// ---------------------------------------------------------------------------

const COBOL_PROGRAMS = [
  'CUSTFILE',
  'ACCTPROC',
  'RPTGEN',
  'BATCHUPD',
  'VALCHECK',
  'SORTMRGE',
  'FILECONV',
  'DATAXFER',
  'BALCALC',
  'ERRHNDLR',
  'MAINPGM',
  'SUBPGM1',
  'SUBPGM2',
  'IOMODULE',
  'DBACCESS',
];

const COPYBOOK_NAMES = ['CUSTREC', 'ACCTFMT', 'ERRCODES'];

const JCL_JOBS = [
  'COMPILE',
  'LINKJOB',
  'RUNJOB',
  'SORTJOB',
  'BACKUP',
  'RESTORE',
  'MIGRATE',
  'CLEANUP',
  'REPORTS',
  'TESTRUN',
  'BATCHJB',
  'NIGHTJB',
  'WEEKJOB',
  'MONTHJB',
  'YEAREND',
];

// ---------------------------------------------------------------------------
// Main generation logic
// ---------------------------------------------------------------------------

async function writeMeta(
  dirPath: string,
  dsn: string,
  dsorg: string,
  extra?: Partial<MockDatasetMeta>
): Promise<void> {
  const meta: MockDatasetMeta = {
    dsn,
    dsorg,
    recfm: extra?.recfm ?? 'FB',
    lrecl: extra?.lrecl ?? 80,
    blksz: extra?.blksz ?? 27920,
    volser: extra?.volser ?? 'VOL001',
    creationDate: extra?.creationDate ?? '2024-03-15',
    smsClass: extra?.smsClass ?? { data: 'STANDARD', storage: 'PRIMARY', management: 'DEFAULT' },
  };
  await fs.writeFile(path.join(dirPath, '_meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
}

async function generateUserDatasets(
  sysDir: string,
  hlq: string,
  datasetsPerUser: number,
  membersPerPds: number
): Promise<void> {
  const hlqDir = path.join(sysDir, hlq);
  await fs.mkdir(hlqDir, { recursive: true });

  // Always create core datasets
  const cobolDir = path.join(hlqDir, 'SRC.COBOL');
  await fs.mkdir(cobolDir, { recursive: true });
  await writeMeta(cobolDir, `${hlq}.SRC.COBOL`, 'PO-E');
  const numCobol = Math.min(membersPerPds, COBOL_PROGRAMS.length);
  for (let i = 0; i < numCobol; i++) {
    const pgm = COBOL_PROGRAMS[i];
    await fs.writeFile(path.join(cobolDir, `${pgm}.cbl`), generateCobolProgram(pgm, hlq), 'utf-8');
  }

  const copybookDir = path.join(hlqDir, 'SRC.COPYBOOK');
  await fs.mkdir(copybookDir, { recursive: true });
  await writeMeta(copybookDir, `${hlq}.SRC.COPYBOOK`, 'PO-E');
  for (const cpyName of COPYBOOK_NAMES) {
    await fs.writeFile(
      path.join(copybookDir, `${cpyName}.cpy`),
      generateCopybook(cpyName),
      'utf-8'
    );
  }

  const jclDir = path.join(hlqDir, 'JCL.CNTL');
  await fs.mkdir(jclDir, { recursive: true });
  await writeMeta(jclDir, `${hlq}.JCL.CNTL`, 'PO-E');
  const numJcl = Math.min(membersPerPds, JCL_JOBS.length);
  for (let i = 0; i < numJcl; i++) {
    const job = JCL_JOBS[i];
    const pgm = COBOL_PROGRAMS[i % numCobol];
    await fs.writeFile(path.join(jclDir, `${job}.jcl`), generateJcl(job, hlq, pgm), 'utf-8');
  }

  // Sequential datasets
  await fs.writeFile(path.join(hlqDir, 'LOAD.MODULE'), '', 'utf-8');
  await fs.writeFile(path.join(hlqDir, 'DATA.INPUT'), generateSequentialData('input'), 'utf-8');
  await fs.writeFile(path.join(hlqDir, 'LOG.OUTPUT'), generateSequentialData('log'), 'utf-8');
  await fs.writeFile(
    path.join(hlqDir, 'TEST.RESULTS'),
    generateSequentialData('results'),
    'utf-8'
  );

  // Generate additional datasets if requested
  let extraCount = datasetsPerUser - 7; // 7 = 3 PDS + 4 sequential above
  for (let i = 1; extraCount > 0 && i <= 20; i++, extraCount--) {
    if (i % 2 === 0) {
      // Extra PDS
      const extraDir = path.join(hlqDir, `EXTRA.LIB${String(i).padStart(2, '0')}`);
      await fs.mkdir(extraDir, { recursive: true });
      await writeMeta(extraDir, `${hlq}.EXTRA.LIB${String(i).padStart(2, '0')}`, 'PO-E');
      for (let m = 1; m <= Math.min(membersPerPds, 5); m++) {
        await fs.writeFile(
          path.join(extraDir, `MEM${String(m).padStart(4, '0')}.txt`),
          `* Member ${m} of ${hlq}.EXTRA.LIB${String(i).padStart(2, '0')}\n* Generated mock data\n`,
          'utf-8'
        );
      }
    } else {
      // Extra sequential
      await fs.writeFile(
        path.join(hlqDir, `DATA.FILE${String(i).padStart(2, '0')}`),
        `* Sequential dataset ${hlq}.DATA.FILE${String(i).padStart(2, '0')}\n* Generated mock data\n`,
        'utf-8'
      );
    }
  }
}

async function generateSystemDatasets(sysDir: string): Promise<void> {
  // SYS1.PROCLIB
  const proclibDir = path.join(sysDir, 'SYS1', 'PROCLIB');
  await fs.mkdir(proclibDir, { recursive: true });
  await writeMeta(proclibDir, 'SYS1.PROCLIB', 'PO-E', {
    lrecl: 80,
    volser: 'SYSVOL',
  });
  await fs.writeFile(path.join(proclibDir, 'IEFPROC.jcl'), generateSysProclib(), 'utf-8');

  // SYS1.PARMLIB
  const parmlibDir = path.join(sysDir, 'SYS1', 'PARMLIB');
  await fs.mkdir(parmlibDir, { recursive: true });
  await writeMeta(parmlibDir, 'SYS1.PARMLIB', 'PO-E', {
    lrecl: 80,
    volser: 'SYSVOL',
  });
  await fs.writeFile(path.join(parmlibDir, 'IEASYS00.txt'), generateSysParmlib(), 'utf-8');

  // SYS1.MACLIB
  const maclibDir = path.join(sysDir, 'SYS1', 'MACLIB');
  await fs.mkdir(maclibDir, { recursive: true });
  await writeMeta(maclibDir, 'SYS1.MACLIB', 'PO-E', {
    lrecl: 80,
    volser: 'SYSVOL',
  });
  await fs.writeFile(
    path.join(maclibDir, 'YREGS.asm'),
    `* YREGS - Register equates\nR0  EQU 0\nR1  EQU 1\nR2  EQU 2\nR3  EQU 3\n`,
    'utf-8'
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  output: string;
  systems: number;
  usersPerSystem: number;
  datasetsPerUser: number;
  membersPerPds: number;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let output = './zowe-mcp-mock-data';
  let preset: MockPreset = PRESETS.default;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--output':
        output = args[++i];
        break;
      case '--preset':
        preset = PRESETS[args[++i]] ?? preset;
        break;
      case '--systems':
        preset = { ...preset, systems: parseInt(args[++i], 10) };
        break;
      case '--users-per-system':
        preset = { ...preset, usersPerSystem: parseInt(args[++i], 10) };
        break;
      case '--datasets-per-user':
        preset = { ...preset, datasetsPerUser: parseInt(args[++i], 10) };
        break;
      case '--members-per-pds':
        preset = { ...preset, membersPerPds: parseInt(args[++i], 10) };
        break;
    }
  }

  return {
    output,
    systems: preset.systems,
    usersPerSystem: preset.usersPerSystem,
    datasetsPerUser: preset.datasetsPerUser,
    membersPerPds: preset.membersPerPds,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  console.log(`Generating mock data in: ${args.output}`);
  console.log(
    `  Systems: ${args.systems}, Users/system: ${args.usersPerSystem}, ` +
      `Datasets/user: ${args.datasetsPerUser}, Members/PDS: ${args.membersPerPds}`
  );

  // Clean and create output directory
  await fs.rm(args.output, { recursive: true, force: true });
  await fs.mkdir(args.output, { recursive: true });

  // Build systems.json
  const config: MockSystemsConfig = { systems: [] };

  for (let s = 0; s < args.systems; s++) {
    const template = SYSTEM_TEMPLATES[s % SYSTEM_TEMPLATES.length];
    const users = USER_TEMPLATES.slice(0, args.usersPerSystem);
    const defaultUser = users[0];

    config.systems.push({
      host: template.host,
      port: 443,
      description: template.description,
      defaultUser,
      credentials: users.map(u => ({ user: u, password: 'mock' })),
    });

    const sysDir = path.join(args.output, template.host);
    await fs.mkdir(sysDir, { recursive: true });

    // Generate datasets for each user
    for (const user of users) {
      await generateUserDatasets(sysDir, user, args.datasetsPerUser, args.membersPerPds);
    }

    // Generate system datasets
    await generateSystemDatasets(sysDir);
  }

  await fs.writeFile(
    path.join(args.output, 'systems.json'),
    JSON.stringify(config, null, 2),
    'utf-8'
  );

  // Count what was generated
  let totalDatasets = 0;
  let totalMembers = 0;
  for (const sys of config.systems) {
    const sysDir = path.join(args.output, sys.host);
    const hlqs = await fs.readdir(sysDir);
    for (const hlq of hlqs) {
      const hlqPath = path.join(sysDir, hlq);
      const stat = await fs.stat(hlqPath);
      if (!stat.isDirectory()) continue;
      const entries = await fs.readdir(hlqPath);
      for (const entry of entries) {
        if (entry === '_meta.json' || entry.startsWith('.')) continue;
        totalDatasets++;
        const entryPath = path.join(hlqPath, entry);
        const entryStat = await fs.stat(entryPath);
        if (entryStat.isDirectory()) {
          const members = await fs.readdir(entryPath);
          totalMembers += members.filter(m => m !== '_meta.json' && !m.startsWith('.')).length;
        }
      }
    }
  }

  console.log(`\nGenerated:`);
  console.log(`  ${config.systems.length} systems`);
  console.log(`  ${totalDatasets} datasets`);
  console.log(`  ${totalMembers} members`);
  console.log(`\nMock data directory: ${path.resolve(args.output)}`);
}

main().catch((err: unknown) => {
  console.error('Error generating mock data:', err);
  process.exit(1);
});
