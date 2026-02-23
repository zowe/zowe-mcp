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

import { type Faker, fakerCS_CZ, fakerDE, fakerEN, fakerES, fakerIT } from '@faker-js/faker';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MockDatasetMeta, MockSystemsConfig } from '../zos/mock/mock-types.js';

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

interface MockPreset {
  systems: number;
  usersPerSystem: number;
  datasetsPerUser: number;
  membersPerPds: number;
  /** When set, generate one INVENTORY dataset with this many members (ITEM0001..ITEMnnnn). */
  inventoryMembers?: number;
  /** When set, generate USER.PEOPLE.firstname.lastname PS datasets (unique English names, ≤8 chars each). */
  peopleDatasets?: number;
}

const PRESETS: Record<string, MockPreset> = {
  minimal: { systems: 1, usersPerSystem: 1, datasetsPerUser: 5, membersPerPds: 3 },
  default: { systems: 2, usersPerSystem: 2, datasetsPerUser: 8, membersPerPds: 5 },
  large: { systems: 5, usersPerSystem: 3, datasetsPerUser: 20, membersPerPds: 15 },
  inventory: {
    systems: 1,
    usersPerSystem: 1,
    datasetsPerUser: 8,
    membersPerPds: 5,
    inventoryMembers: 2000,
  },
  pagination: {
    systems: 1,
    usersPerSystem: 1,
    datasetsPerUser: 8,
    membersPerPds: 5,
    inventoryMembers: 2000,
    peopleDatasets: 1000,
  },
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

const USER_TEMPLATES = ['USER', 'DEVUSR1', 'DEVUSR2', 'SYSPROG', 'QAUSER1', 'PRODMGR'];

/** Faker instances for inventory item cards (en, es, de, it, cs_CZ). Language is randomized per item; not written into the card. */
const INVENTORY_LOCALES: Faker[] = [fakerEN, fakerES, fakerDE, fakerIT, fakerCS_CZ];

/** Escape a string for use as a YAML value (double-quoted if needed). Exported for tests. */
export function yamlValue(s: string): string {
  if (/[\n":\\#]/.test(s) || s.startsWith(' ') || s.endsWith(' ')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
  }
  return s;
}

/**
 * Generate a single inventory item card as YAML (name, description, category, price, material, product, upc).
 * Uses the given Faker instance so content can be in that locale's language. Exported for tests.
 */
export function generateInventoryMemberCard(fakerInstance: Faker): string {
  const name = fakerInstance.commerce.productName();
  const description = fakerInstance.commerce.productDescription();
  const category = fakerInstance.commerce.department();
  const price = fakerInstance.commerce.price();
  const material = fakerInstance.commerce.productMaterial();
  const product = fakerInstance.commerce.product();
  // UPC: use isbn() as product identifier (Faker 9.x has no commerce.upc(); added in 10.2)
  const upc = fakerInstance.commerce.isbn(13).replace(/-/g, '');
  return [
    `name: ${yamlValue(name)}`,
    `description: ${yamlValue(description)}`,
    `category: ${yamlValue(category)}`,
    `price: ${yamlValue(price)}`,
    `material: ${yamlValue(material)}`,
    `product: ${yamlValue(product)}`,
    `upc: ${yamlValue(upc)}`,
  ].join('\n');
}

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
//SYSLMOD  DD DSN=${hlq}.LOADLIB,DISP=SHR
//SYSPRINT DD SYSOUT=*
//SYSUT1   DD UNIT=SYSDA,SPACE=(CYL,(1,1))
//*
//RUN     EXEC PGM=${programName},COND=(4,LT)
//STEPLIB  DD DSN=${hlq}.LOADLIB,DISP=SHR
//INDD     DD DSN=${hlq}.DATA.INPUT,DISP=SHR
//OUTDD    DD DSN=${hlq}.LISTING,DISP=SHR
//SYSOUT   DD SYSOUT=*
//SYSPRINT DD SYSOUT=*
`;
}

/**
 * Pad a line to LRECL 133 for FBA; first character is ASA carriage control.
 * ASA: ' ' = single space, '0' = double space, '1' = skip to channel 1 (new page),
 * '-' = triple space, '+' = overprint (see IBM machine code / ASA printer control).
 */
function fba133(control: string, line: string): string {
  const rest = line.slice(0, 132).padEnd(132, ' ');
  return control.slice(0, 1) + rest;
}

/**
 * Generate FBA 133 listing content with ASA control characters in column 1.
 */
function generateListingData(hlq: string): string {
  const lines = [
    fba133('1', `${hlq} - APPLICATION LISTING - PAGE 1`.padEnd(132)),
    fba133(' ', ''),
    fba133(' ', '2024-03-15 10:00:00 INFO  Application started'),
    fba133(' ', '2024-03-15 10:00:01 INFO  Opening input file'),
    fba133(' ', '2024-03-15 10:00:01 INFO  Processing records'),
    fba133('0', ''),
    fba133(' ', '2024-03-15 10:00:02 INFO  Record 1 processed successfully'),
    fba133(' ', '2024-03-15 10:00:02 INFO  Record 2 processed successfully'),
    fba133(' ', '2024-03-15 10:00:03 WARN  Record 3 - field validation warning'),
    fba133(' ', '2024-03-15 10:00:03 INFO  Record 3 processed with warnings'),
    fba133('0', ''),
    fba133(' ', '2024-03-15 10:00:04 INFO  Processing complete'),
    fba133(' ', '2024-03-15 10:00:04 INFO  Total records: 3, Errors: 0, Warnings: 1'),
    fba133(' ', '2024-03-15 10:00:04 INFO  Application ended RC=0'),
  ];
  return lines.join('\n') + '\n';
}

function generateSequentialData(type: 'input' | 'results'): string {
  if (type === 'input') {
    const records: string[] = [];
    for (let i = 1; i <= 10; i++) {
      records.push(
        `${String(i).padStart(8, '0')}CUSTOMER${String(i).padStart(3, '0')}  SMITH${' '.repeat(20)}JOHN${' '.repeat(17)}M123 MAIN ST${' '.repeat(19)}ANYTOWN${' '.repeat(14)}NY10001`
      );
    }
    return records.join('\n') + '\n';
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

  // LOADLIB as PDS/E (load library: RECFM=U, LRECL=0, BLKSIZE=32760)
  const loadlibDir = path.join(hlqDir, 'LOADLIB');
  await fs.mkdir(loadlibDir, { recursive: true });
  await writeMeta(loadlibDir, `${hlq}.LOADLIB`, 'PO-E', {
    recfm: 'U',
    lrecl: 0,
    blksz: 32760,
  });

  // Sequential datasets
  await fs.writeFile(path.join(hlqDir, 'DATA.INPUT'), generateSequentialData('input'), 'utf-8');

  // LISTING: FBA 133 with ASA printer control in column 1 (see IBM machine code printer control)
  const listingPath = path.join(hlqDir, 'LISTING');
  await fs.writeFile(listingPath, generateListingData(hlq), 'utf-8');
  const listingMeta: MockDatasetMeta = {
    dsn: `${hlq}.LISTING`,
    dsorg: 'PS',
    recfm: 'FBA',
    lrecl: 133,
    blksz: 27920,
    volser: 'VOL001',
    creationDate: '2024-03-15',
    smsClass: { data: 'STANDARD', storage: 'PRIMARY', management: 'DEFAULT' },
  };
  await fs.writeFile(
    path.join(hlqDir, 'LISTING_meta.json'),
    JSON.stringify(listingMeta, null, 2),
    'utf-8'
  );

  await fs.writeFile(
    path.join(hlqDir, 'TEST.RESULTS'),
    generateSequentialData('results'),
    'utf-8'
  );

  // Generate additional datasets if requested
  let extraCount = datasetsPerUser - 7; // 7 = 4 PDS (SRC.COBOL, SRC.COPYBOOK, JCL.CNTL, LOADLIB) + 3 sequential above
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
// Inventory dataset (fake goods: ITEM0001..ITEMnnnn, YAML cards, multi-locale)
// ---------------------------------------------------------------------------

/**
 * Generate one INVENTORY PDS with memberCount members (ITEM0001.txt .. ITEMnnnn.txt).
 * Each member contains a YAML card (name, description, category, price, material, product, upc).
 * Locale is chosen deterministically per item from [en, es, de, it, cs_CZ] using seed + item index.
 */
async function generateInventoryDataset(
  sysDir: string,
  hlq: string,
  memberCount: number,
  seed: number,
  addLargeMember = false
): Promise<void> {
  // Qualifier must be ≤8 chars (z/OS). Use INVNTORY.
  const invDir = path.join(sysDir, hlq, 'INVNTORY');
  await fs.mkdir(invDir, { recursive: true });
  await writeMeta(invDir, `${hlq}.INVNTORY`, 'PO-E');

  const padLength = Math.max(4, String(memberCount).length);
  for (let i = 1; i <= memberCount; i++) {
    const localeIndex = (seed + i) % INVENTORY_LOCALES.length;
    const fakerInstance = INVENTORY_LOCALES[localeIndex];
    const itemSeed = seed * 10000 + i;
    fakerInstance.seed(itemSeed);
    const card = generateInventoryMemberCard(fakerInstance);
    const memberName = `ITEM${String(i).padStart(padLength, '0')}`;
    await fs.writeFile(path.join(invDir, `${memberName}.txt`), card + '\n', 'utf-8');
  }

  // When pagination preset (addLargeMember true), add one member with many lines for readDataset pagination tests
  if (memberCount >= 2000 && addLargeMember) {
    const largeLines = Array.from(
      { length: 2500 },
      (_, i) => `LINE ${String(i + 1).padStart(4, '0')}`
    );
    await fs.writeFile(path.join(invDir, 'LARGE.txt'), largeLines.join('\n') + '\n', 'utf-8');
  }
}

/**
 * Generate one large sequential dataset (e.g. USER.LARGE.SEQ) with 2200 lines for readDataset pagination tests.
 * With MAX_READ_LINES=1000 the agent must do 3 reads: 1–1000, 1001–2000, 2001–2200. LUKE is on the last chunk.
 */
async function generateLargeSequentialDataset(sysDir: string, hlq: string): Promise<void> {
  const hlqDir = path.join(sysDir, hlq);
  await fs.mkdir(hlqDir, { recursive: true });
  const entryName = 'LARGE.SEQ';
  const dsn = `${hlq}.${entryName}`;
  const largeLines = Array.from(
    { length: 2200 },
    (_, i) => `LINE ${String(i + 1).padStart(4, '0')}`
  );
  // Line 2100: Star Wars character for read-pagination evals (answer on third page, 2001–2200)
  largeLines[2099] = 'LUKE SKYWALKER';
  await fs.writeFile(path.join(hlqDir, entryName), largeLines.join('\n') + '\n', 'utf-8');
  await writeMetaFile(hlqDir, entryName, dsn, 'PS');
}

// ---------------------------------------------------------------------------
// People datasets (USER.PEOPLE.firstname.lastname, PS, unique English names ≤8 chars)
// ---------------------------------------------------------------------------

/** Sanitize to DSN qualifier: ASCII letters only, max 8 chars, uppercase. */
function sanitizeQualifier(s: string): string {
  const letters = s.replace(/[^A-Za-z]/g, '').slice(0, 8);
  return letters.toUpperCase();
}

/**
 * Generate unique English first/last name pairs (each ≤8 chars, no special characters).
 * Uses fakerEN with deterministic seeds so the same seed yields the same set.
 */
function generateUniquePeopleNames(
  count: number,
  seed: number
): { first: string; last: string }[] {
  const seen = new Set<string>();
  const result: { first: string; last: string }[] = [];
  let tries = 0;
  const maxTries = count * 20;
  for (; result.length < count && tries < maxTries; tries++) {
    const itemSeed = seed * 10000 + (result.length * 1000 + tries);
    fakerEN.seed(itemSeed);
    const first = sanitizeQualifier(fakerEN.person.firstName());
    const last = sanitizeQualifier(fakerEN.person.lastName());
    if (first.length === 0 || last.length === 0) continue;
    const key = `${first}.${last}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ first, last });
  }
  if (result.length < count) {
    throw new Error(
      `Could not generate ${count} unique people names (got ${result.length}). Try a different seed.`
    );
  }
  return result;
}

async function writeMetaFile(
  hlqDir: string,
  entryName: string,
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
  const metaPath = path.join(hlqDir, `${entryName}_meta.json`);
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

/**
 * Generate USER.PEOPLE.firstname.lastname PS datasets (configurable count).
 * Names are unique, English, no special characters, first and last each ≤8 chars.
 * Uses the same seed as inventory for reproducibility.
 */
async function generatePeopleDatasets(
  sysDir: string,
  hlq: string,
  count: number,
  seed: number
): Promise<void> {
  const hlqDir = path.join(sysDir, hlq);
  await fs.mkdir(hlqDir, { recursive: true });
  const names = generateUniquePeopleNames(count, seed);
  for (const { first, last } of names) {
    const entryName = `PEOPLE.${first}.${last}`;
    const dsn = `${hlq}.${entryName}`;
    const filePath = path.join(hlqDir, entryName);
    await fs.writeFile(filePath, `* ${first} ${last}\n`, 'utf-8');
    await writeMetaFile(hlqDir, entryName, dsn, 'PS');
  }
}

// ---------------------------------------------------------------------------
// USS (UNIX System Services) tree for getUssHome, listUssFiles, readUssFile evals
// ---------------------------------------------------------------------------

/**
 * Create a minimal USS directory tree for a user: /u/<userId>/ with file.txt and subdir.
 * Mock backend expects: mockDir/uss/<systemId>/u/<userId>/...
 */
async function generateUssForUser(
  mockDir: string,
  systemId: string,
  userId: string
): Promise<void> {
  const base = path.join(mockDir, 'uss', systemId, 'u', userId);
  await fs.mkdir(path.join(base, 'subdir'), { recursive: true });
  await fs.writeFile(
    path.join(base, 'file.txt'),
    'Hello from USS mock. Use this file for readUssFile evals.\n',
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
  inventoryMembers: number;
  peopleDatasets: number;
  seed: number;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let output = './zowe-mcp-mock-data';
  let preset: MockPreset = PRESETS.default;
  let seed = 42;

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
      case '--inventory-members':
        preset = { ...preset, inventoryMembers: parseInt(args[++i], 10) };
        break;
      case '--people-datasets':
        preset = { ...preset, peopleDatasets: parseInt(args[++i], 10) };
        break;
      case '--seed':
        seed = parseInt(args[++i], 10);
        break;
    }
  }

  return {
    output,
    systems: preset.systems,
    usersPerSystem: preset.usersPerSystem,
    datasetsPerUser: preset.datasetsPerUser,
    membersPerPds: preset.membersPerPds,
    inventoryMembers: preset.inventoryMembers ?? 0,
    peopleDatasets: preset.peopleDatasets ?? 0,
    seed,
  };
}

async function main(): Promise<void> {
  const args = parseCliArgs();

  console.log(`Generating mock data in: ${args.output}`);
  console.log(
    `  Systems: ${args.systems}, Users/system: ${args.usersPerSystem}, ` +
      `Datasets/user: ${args.datasetsPerUser}, Members/PDS: ${args.membersPerPds}`
  );
  if (args.inventoryMembers > 0) {
    console.log(`  Inventory dataset: ${args.inventoryMembers} members, seed: ${args.seed}`);
  }
  if (args.peopleDatasets > 0) {
    console.log(
      `  People datasets: ${args.peopleDatasets} (USER.PEOPLE.first.last), seed: ${args.seed}`
    );
  }

  // Clean and create output directory
  await fs.rm(args.output, { recursive: true, force: true });
  await fs.mkdir(args.output, { recursive: true });

  // Build systems.json
  const config: MockSystemsConfig = { systems: [] };

  for (let s = 0; s < args.systems; s++) {
    const template = SYSTEM_TEMPLATES[s % SYSTEM_TEMPLATES.length];
    console.log(`Creating system ${s + 1}/${args.systems}: ${template.host}...`);
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
    for (let u = 0; u < users.length; u++) {
      console.log(`  User ${u + 1}/${users.length}: ${users[u]}...`);
      await generateUserDatasets(sysDir, users[u], args.datasetsPerUser, args.membersPerPds);
    }

    // Generate system datasets
    await generateSystemDatasets(sysDir);

    // Optional: one INVENTORY dataset for first system / first user
    if (s === 0 && args.inventoryMembers > 0) {
      const addLargeMember = args.inventoryMembers >= 2000 && args.peopleDatasets > 0;
      await generateInventoryDataset(
        sysDir,
        defaultUser,
        args.inventoryMembers,
        args.seed,
        addLargeMember
      );
    }
    // Optional: USER.PEOPLE.firstname.lastname PS datasets for first system / first user
    if (s === 0 && args.peopleDatasets > 0) {
      await generatePeopleDatasets(sysDir, defaultUser, args.peopleDatasets, args.seed);
    }
    // Optional: large sequential for readDataset pagination (pagination preset only)
    if (s === 0 && args.inventoryMembers >= 2000 && args.peopleDatasets > 0) {
      await generateLargeSequentialDataset(sysDir, defaultUser);
    }
    // USS tree for first system / default user (getUssHome, listUssFiles, readUssFile evals)
    if (s === 0) {
      await generateUssForUser(args.output, template.host, defaultUser);
    }
  }

  console.log('Writing systems.json...');
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
  if (args.inventoryMembers > 0) {
    console.log(`  Inventory: ${args.inventoryMembers} members`);
  }
  if (args.peopleDatasets > 0) {
    console.log(`  People: ${args.peopleDatasets} datasets`);
  }
  console.log(`\nMock data directory: ${path.resolve(args.output)}`);
}

const isMain =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);

if (isMain) {
  main().catch((err: unknown) => {
    console.error('Error generating mock data:', err);
    process.exit(1);
  });
}
