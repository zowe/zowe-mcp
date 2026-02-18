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
 * Unit tests for z/OS dataset name utilities (dsn.ts).
 *
 * Covers inferMimeType content-based detection, resolveDsn name resolution,
 * validateDsn / validateMember validation, and buildDsUri URI construction.
 */

import { describe, expect, it } from 'vitest';
import {
  buildDsUri,
  DsnError,
  inferMimeType,
  resolveDsn,
  resolveWithPrefix,
  validateDsn,
  validateListPattern,
  validateMember,
} from '../src/zos/dsn.js';

// ---------------------------------------------------------------------------
// inferMimeType — content-based MIME type detection
// ---------------------------------------------------------------------------

describe('inferMimeType', () => {
  describe('JCL detection', () => {
    it('should detect JCL from job card and EXEC statements', () => {
      const jcl = [
        "//MYJOB   JOB (ACCT),'MY JOB',CLASS=A",
        '//*  THIS IS A COMMENT',
        '//STEP1   EXEC PGM=IEFBR14',
        '//SYSPRINT DD SYSOUT=*',
      ].join('\n');
      expect(inferMimeType(jcl)).toBe('text/x-jcl');
    });

    it('should detect JCL with only comment lines', () => {
      const jcl = [
        "//MYJOB   JOB (ACCT),'MY JOB'",
        '//* COMMENT LINE 1',
        '//* COMMENT LINE 2',
      ].join('\n');
      expect(inferMimeType(jcl)).toBe('text/x-jcl');
    });

    it('should detect JCL with DD statements', () => {
      const jcl = [
        '//STEP1   EXEC PGM=SORT',
        '//SORTIN   DD DSN=MY.INPUT,DISP=SHR',
        '//SORTOUT  DD DSN=MY.OUTPUT,DISP=(NEW,CATLG)',
        '//SYSIN    DD *',
        '  SORT FIELDS=(1,10,CH,A)',
        '/*',
      ].join('\n');
      expect(inferMimeType(jcl)).toBe('text/x-jcl');
    });

    it('should not detect JCL from a single // line', () => {
      const text = '//SINGLE LINE\nsome other content\n';
      expect(inferMimeType(text)).not.toBe('text/x-jcl');
    });
  });

  describe('REXX detection', () => {
    it('should detect REXX from /* REXX */ header', () => {
      const rexx = ['/* REXX */', 'SAY "Hello, World!"', 'EXIT 0'].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from first line containing REXX', () => {
      const rexx = ['/* This is a REXX program */', 'ARG name', 'SAY "Hello," name'].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from SAY keyword', () => {
      const rexx = ['/* Program */', 'x = 42', 'SAY "The answer is" x', 'EXIT'].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from PARSE ARG', () => {
      const rexx = [
        '/* Utility */',
        'PARSE ARG input',
        'output = STRIP(input)',
        'RETURN output',
      ].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from PARSE UPPER ARG', () => {
      const rexx = [
        '/* Utility */',
        'PARSE UPPER ARG cmd rest',
        'IF cmd = "HELP" THEN DO',
        '  SAY "Usage: ..."',
        'END',
      ].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from PULL keyword', () => {
      const rexx = [
        '/* Interactive */',
        'SAY "Enter your name:"',
        'PULL name',
        'SAY "Hello," name',
      ].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from SIGNAL keyword', () => {
      const rexx = [
        '/* Error handler */',
        'SIGNAL ON ERROR',
        'x = 1 / 0',
        'EXIT',
        'ERROR:',
        '  SAY "Error occurred"',
      ].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });
  });

  describe('COBOL detection', () => {
    it('should detect COBOL from division keywords', () => {
      const cobol = [
        '       IDENTIFICATION DIVISION.',
        '       PROGRAM-ID. HELLO.',
        '       ENVIRONMENT DIVISION.',
        '       DATA DIVISION.',
        '       WORKING-STORAGE SECTION.',
        '       01 WS-NAME PIC X(20).',
        '       PROCEDURE DIVISION.',
        '           DISPLAY "HELLO WORLD".',
        '           STOP RUN.',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from PERFORM and MOVE verbs', () => {
      const cobol = [
        '           PERFORM 100-INIT',
        '           MOVE WS-INPUT TO WS-OUTPUT',
        '           PERFORM 200-PROCESS',
        '           MOVE SPACES TO WS-BUFFER',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from EXEC SQL', () => {
      const cobol = [
        '           EXEC SQL',
        '             SELECT NAME INTO :WS-NAME',
        '             FROM EMPLOYEE',
        '             WHERE ID = :WS-ID',
        '           END-EXEC',
        '           DISPLAY WS-NAME',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from COPY statement', () => {
      const cobol = [
        '       WORKING-STORAGE SECTION.',
        '       COPY CUSTCPY.',
        '       COPY ACCTCPY.',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from fixed-format layout', () => {
      // Lines with column 7 indicator area (space or *)
      const cobol = [
        '000100 IDENTIFICATION DIVISION.                                         ',
        '000200 PROGRAM-ID. TESTPGM.                                             ',
        '000300*THIS IS A COMMENT                                                ',
        '000400 ENVIRONMENT DIVISION.                                            ',
        '000500 DATA DIVISION.                                                   ',
        '000600 WORKING-STORAGE SECTION.                                         ',
        '000700 01 WS-VAR PIC X(10).                                             ',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });
  });

  describe('Assembler detection', () => {
    it('should detect assembler from CSECT and USING', () => {
      const asm = [
        'MYPROG   CSECT',
        '         USING *,15',
        '         BALR  15,0',
        '         LA    1,MYDATA',
        "         MVC   0(10,1),=C'HELLO     '",
        '         BR    14',
        'MYDATA   DS    CL10',
        '         END',
      ].join('\n');
      expect(inferMimeType(asm)).toBe('text/x-asm');
    });

    it('should detect assembler from DC and DS directives', () => {
      const asm = [
        'CONSTANTS CSECT',
        "MSG1     DC    C'HELLO WORLD'",
        "MSG2     DC    C'GOODBYE'",
        'BUFFER   DS    CL256',
        'COUNTER  DS    F',
        '         END',
      ].join('\n');
      expect(inferMimeType(asm)).toBe('text/x-asm');
    });

    it('should detect assembler from MACRO/MEND', () => {
      const asm = [
        '         MACRO',
        '&NAME    MYMAC &PARM1,&PARM2',
        '&NAME    LA    1,&PARM1',
        '         MVC   0(10,1),&PARM2',
        '         MEND',
      ].join('\n');
      expect(inferMimeType(asm)).toBe('text/x-asm');
    });

    it('should not detect assembler from fewer than 3 keyword lines', () => {
      const text = [
        'Some text with CSECT mentioned',
        'And USING in a sentence',
        'But nothing else assembly-like',
      ].join('\n');
      expect(inferMimeType(text)).not.toBe('text/x-asm');
    });
  });

  describe('text/plain fallback', () => {
    it('should return text/plain for plain text', () => {
      expect(inferMimeType('Hello, World!')).toBe('text/plain');
    });

    it('should return text/plain for empty content', () => {
      expect(inferMimeType('')).toBe('text/plain');
    });

    it('should return text/plain for generic data', () => {
      const data = [
        'JOHN,DOE,1990-01-15,NEW YORK',
        'JANE,SMITH,1985-06-22,CHICAGO',
        'BOB,JONES,1978-11-30,DALLAS',
      ].join('\n');
      expect(inferMimeType(data)).toBe('text/plain');
    });

    it('should return text/plain for XML-like content', () => {
      const xml = ['<?xml version="1.0"?>', '<root>', '  <item>value</item>', '</root>'].join(
        '\n'
      );
      expect(inferMimeType(xml)).toBe('text/plain');
    });
  });

  describe('priority ordering', () => {
    it('should prefer JCL over COBOL when both patterns match', () => {
      // JCL that happens to contain COBOL-like words
      const jcl = [
        "//COMPILE JOB (ACCT),'COBOL COMPILE'",
        '//STEP1   EXEC PGM=IGYCRCTL',
        '//SYSIN   DD DSN=MY.COBOL.SRC(HELLO),DISP=SHR',
        '// PERFORM COMPILE',
      ].join('\n');
      expect(inferMimeType(jcl)).toBe('text/x-jcl');
    });

    it('should prefer REXX over COBOL when first line says REXX', () => {
      // REXX that uses DISPLAY (a COBOL keyword)
      const rexx = ['/* REXX - display utility */', 'PARSE ARG dsn', 'SAY "Processing" dsn'].join(
        '\n'
      );
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should prefer JCL over REXX even when REXX keywords appear', () => {
      // JCL that references REXX programs — JCL pattern takes priority
      const jcl = [
        "//RUNREXX  JOB (ACCT),'RUN REXX'",
        '//STEP1   EXEC PGM=IKJEFT01',
        '//SYSTSIN  DD *',
        '  %MYREX SAY HELLO',
        '/*',
      ].join('\n');
      expect(inferMimeType(jcl)).toBe('text/x-jcl');
    });

    it('should prefer assembler over COBOL when both patterns match', () => {
      // Assembler with a COPY directive (also a COBOL keyword)
      const asm = [
        'MYPROG   CSECT',
        '         USING *,15',
        '         BALR  15,0',
        '         COPY  MYDSECT',
        '         PERFORM MYDSECT',
        '         MVC   AREA(10),INPUT',
        '         BR    14',
      ].join('\n');
      expect(inferMimeType(asm)).toBe('text/x-asm');
    });
  });

  describe('edge cases', () => {
    it('should handle content with only whitespace lines', () => {
      expect(inferMimeType('   \n  \n    \n')).toBe('text/plain');
    });

    it('should handle content with only newlines', () => {
      expect(inferMimeType('\n\n\n\n\n')).toBe('text/plain');
    });

    it('should handle single-line content', () => {
      expect(inferMimeType('HELLO WORLD')).toBe('text/plain');
    });

    it('should handle very long content (only examines first ~2000 chars)', () => {
      // JCL at the beginning, then lots of filler
      const jcl = ["//MYJOB   JOB (ACCT),'TEST'", '//STEP1   EXEC PGM=IEFBR14'].join('\n');
      const filler = '\nDATA LINE'.repeat(500); // ~5000 chars
      expect(inferMimeType(jcl + filler)).toBe('text/x-jcl');
    });

    it('should NOT detect JCL if // lines appear only after 2000 chars', () => {
      const filler = 'A'.repeat(2100);
      const jcl = ["//MYJOB   JOB (ACCT),'TEST'", '//STEP1   EXEC PGM=IEFBR14'].join('\n');
      // JCL is beyond the 2000-char sample window
      expect(inferMimeType(filler + '\n' + jcl)).not.toBe('text/x-jcl');
    });

    it('should detect REXX from INTERPRET keyword', () => {
      const rexx = ['/* Dynamic execution */', 'code = "SAY 42"', 'INTERPRET code'].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect REXX from PARSE VAR', () => {
      const rexx = [
        '/* String parsing */',
        'line = "John Doe 42"',
        'PARSE VAR line first last age',
      ].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should detect COBOL from EVALUATE statement', () => {
      const cobol = [
        '           EVALUATE TRUE',
        '             WHEN WS-CODE = 1',
        '               PERFORM 100-PROCESS',
        '             WHEN OTHER',
        '               DISPLAY "UNKNOWN"',
        '           END-EVALUATE',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from ACCEPT and DISPLAY', () => {
      const cobol = [
        '           DISPLAY "ENTER NAME:"',
        '           ACCEPT WS-NAME',
        '           DISPLAY "HELLO " WS-NAME',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from LINKAGE SECTION', () => {
      const cobol = [
        '       LINKAGE SECTION.',
        '       01 LS-PARM.',
        '         05 LS-LENGTH PIC S9(4) COMP.',
        '         05 LS-DATA   PIC X(100).',
        '       PROCEDURE DIVISION USING LS-PARM.',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect assembler from EQU directives', () => {
      const asm = [
        'R0       EQU 0',
        'R1       EQU 1',
        'R15      EQU 15',
        'MYPROG   CSECT',
        '         USING *,R15',
      ].join('\n');
      expect(inferMimeType(asm)).toBe('text/x-asm');
    });

    it('should detect assembler from DSECT', () => {
      const asm = [
        'MYDSECT  DSECT',
        'FIELD1   DS    CL8',
        'FIELD2   DS    F',
        'FIELD3   DS    H',
        '         END',
      ].join('\n');
      expect(inferMimeType(asm)).toBe('text/x-asm');
    });

    it('should not misidentify JSON as any mainframe language', () => {
      const json = [
        '{',
        '  "name": "test",',
        '  "version": "1.0.0",',
        '  "description": "A test package"',
        '}',
      ].join('\n');
      expect(inferMimeType(json)).toBe('text/plain');
    });

    it('should not misidentify a shell script as JCL', () => {
      // Shell scripts can have lines starting with // in paths
      const shell = ['#!/bin/bash', 'echo "Hello"', 'cp //dev/null /tmp/test', 'ls -la'].join(
        '\n'
      );
      // Only one // line, so should not trigger JCL (needs >= 2)
      expect(inferMimeType(shell)).not.toBe('text/x-jcl');
    });

    it('should not misidentify C++ comments as JCL', () => {
      const cpp = [
        '#include <iostream>',
        '// This is a comment',
        '// Another comment',
        'int main() { return 0; }',
      ].join('\n');
      // C++ comments start with "// " (space after //), which matches /^\/\/[^ ]/ only
      // if the next char is not a space — "// T" has space, so "//T" would match but "// T" won't
      expect(inferMimeType(cpp)).not.toBe('text/x-jcl');
    });

    it('should handle mixed-case REXX header', () => {
      const rexx = ['/* Rexx */', 'say "hello"'].join('\n');
      expect(inferMimeType(rexx)).toBe('text/x-rexx');
    });

    it('should handle COBOL with sequence numbers in columns 1-6', () => {
      const cobol = [
        '000100 IDENTIFICATION DIVISION.',
        '000200 PROGRAM-ID. SEQTEST.',
        '000300 DATA DIVISION.',
        '000400 WORKING-STORAGE SECTION.',
        '000500 01 WS-VAR PIC X(10).',
        '000600 PROCEDURE DIVISION.',
        '000700     DISPLAY "HELLO".',
        '000800     STOP RUN.',
      ].join('\n');
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should detect COBOL from fixed-format heuristic when no keywords match', () => {
      // Lines that look like fixed-format COBOL (col 7 indicator) but no explicit keywords
      const cobol = [
        '000100      MOVE A TO B.',
        '000200      MOVE C TO D.',
        '000300*     THIS IS A COMMENT.',
        '000400      ADD 1 TO COUNTER.',
        '000500      IF X > 0',
        '000600        SUBTRACT 1 FROM X',
        '000700      END-IF.',
      ].join('\n');
      // These lines have col 7 as space or *, length <= 80, and > 50% match
      expect(inferMimeType(cobol)).toBe('text/x-cobol');
    });

    it('should not detect COBOL fixed-format from fewer than 5 lines', () => {
      const text = ['000100 SOME LINE', '000200 ANOTHER LINE'].join('\n');
      // Only 2 lines — below the 5-line threshold
      expect(inferMimeType(text)).toBe('text/plain');
    });
  });
});

// ---------------------------------------------------------------------------
// resolveWithPrefix — pattern/name resolution (no validation)
// ---------------------------------------------------------------------------

describe('resolveWithPrefix', () => {
  it('absolute: single-quoted with undefined prefix returns resolved, wasAbsolute true', () => {
    const r = resolveWithPrefix("'SYS1.PROCLIB'", undefined);
    expect(r.resolved).toBe('SYS1.PROCLIB');
    expect(r.wasAbsolute).toBe(true);
  });

  it('absolute: single-quoted with prefix returns resolved, wasAbsolute true', () => {
    const r = resolveWithPrefix("'SYS1.PROCLIB'", 'USER');
    expect(r.resolved).toBe('SYS1.PROCLIB');
    expect(r.wasAbsolute).toBe(true);
  });

  it('relative with prefix: prepends prefix', () => {
    const r = resolveWithPrefix('SRC.COBOL', 'USER');
    expect(r.resolved).toBe('USER.SRC.COBOL');
    expect(r.wasAbsolute).toBe(false);
  });

  it('relative with prefix: trims input', () => {
    const r = resolveWithPrefix('  SRC.COBOL  ', 'USER');
    expect(r.resolved).toBe('USER.SRC.COBOL');
    expect(r.wasAbsolute).toBe(false);
  });

  it('relative pattern with prefix: SRC.*', () => {
    const r = resolveWithPrefix('SRC.*', 'USER');
    expect(r.resolved).toBe('USER.SRC.*');
    expect(r.wasAbsolute).toBe(false);
  });

  it('relative pattern with prefix: *', () => {
    const r = resolveWithPrefix('*', 'USER');
    expect(r.resolved).toBe('USER.*');
    expect(r.wasAbsolute).toBe(false);
  });

  it('relative with undefined prefix throws', () => {
    expect(() => resolveWithPrefix('JCL.CNTL', undefined)).toThrow(DsnError);
  });

  it('absolute pattern with prefix: single-quoted', () => {
    const r = resolveWithPrefix("'USER.SRC.*'", 'OTHER');
    expect(r.resolved).toBe('USER.SRC.*');
    expect(r.wasAbsolute).toBe(true);
  });

  it('throws for empty input', () => {
    expect(() => resolveWithPrefix('', 'USER')).toThrow(DsnError);
    expect(() => resolveWithPrefix('   ', 'USER')).toThrow(DsnError);
  });
});

// ---------------------------------------------------------------------------
// validateListPattern
// ---------------------------------------------------------------------------

describe('validateListPattern', () => {
  it('accepts valid patterns', () => {
    expect(() => validateListPattern('USER.*')).not.toThrow();
    expect(() => validateListPattern('SYS1.**')).not.toThrow();
    expect(() => validateListPattern('USER.SRC.COBOL')).not.toThrow();
  });

  it('throws for empty pattern', () => {
    expect(() => validateListPattern('')).toThrow(DsnError);
  });

  it('throws for pattern with empty qualifier (consecutive dots)', () => {
    expect(() => validateListPattern('USER..BAR')).toThrow(DsnError);
    expect(() => validateListPattern('...')).toThrow(DsnError);
  });

  it('throws for pattern starting with dot', () => {
    expect(() => validateListPattern('.USER')).toThrow(DsnError);
  });

  it('throws for pattern ending with dot', () => {
    expect(() => validateListPattern('USER.')).toThrow(DsnError);
  });
});

// ---------------------------------------------------------------------------
// resolveDsn — dataset name resolution
// ---------------------------------------------------------------------------

describe('resolveDsn', () => {
  describe('relative names (no quotes)', () => {
    it('should prepend prefix to relative name', () => {
      const result = resolveDsn('SRC.COBOL', 'USER');
      expect(result.dsn).toBe('USER.SRC.COBOL');
      expect(result.wasAbsolute).toBe(false);
    });

    it('should uppercase relative name', () => {
      const result = resolveDsn('src.cobol', 'USER');
      expect(result.dsn).toBe('USER.SRC.COBOL');
    });

    it('should throw when relative name and no prefix', () => {
      expect(() => resolveDsn('USER.SRC.COBOL', undefined)).toThrow(DsnError);
      expect(() => resolveDsn('JCL.CNTL', undefined)).toThrow(DsnError);
    });
  });

  describe('absolute names (single-quoted)', () => {
    it('should strip quotes and use as-is', () => {
      const result = resolveDsn("'SYS1.PROCLIB'", 'USER');
      expect(result.dsn).toBe('SYS1.PROCLIB');
      expect(result.wasAbsolute).toBe(true);
    });

    it('should uppercase absolute name', () => {
      const result = resolveDsn("'sys1.proclib'", 'USER');
      expect(result.dsn).toBe('SYS1.PROCLIB');
    });

    it('should ignore prefix for absolute names', () => {
      const result = resolveDsn("'SYS1.PROCLIB'", 'USER');
      expect(result.dsn).toBe('SYS1.PROCLIB');
    });
  });

  describe('member resolution', () => {
    it('should include member when provided', () => {
      const result = resolveDsn('SRC.COBOL', 'USER', 'HELLO');
      expect(result.dsn).toBe('USER.SRC.COBOL');
      expect(result.member).toBe('HELLO');
    });

    it('should uppercase member name', () => {
      const result = resolveDsn('SRC.COBOL', 'USER', 'hello');
      expect(result.member).toBe('HELLO');
    });

    it('should return undefined member when not provided', () => {
      const result = resolveDsn('SRC.COBOL', 'USER');
      expect(result.member).toBeUndefined();
    });

    it('should return undefined member for empty string', () => {
      const result = resolveDsn('SRC.COBOL', 'USER', '');
      expect(result.member).toBeUndefined();
    });

    it('should return undefined member for whitespace-only', () => {
      const result = resolveDsn('SRC.COBOL', 'USER', '   ');
      expect(result.member).toBeUndefined();
    });
  });

  describe('validation', () => {
    it('should throw for empty input', () => {
      expect(() => resolveDsn('', 'USER')).toThrow(DsnError);
    });

    it('should throw for name exceeding 44 characters', () => {
      // 6 qualifiers of 8 chars each + 5 dots = 53 chars (exceeds 44-char limit)
      const longName = "'ABCDEFGH.ABCDEFGH.ABCDEFGH.ABCDEFGH.ABCDEFGH.ABCDEF'";
      expect(longName.slice(1, -1).length).toBeGreaterThan(44);
      expect(() => resolveDsn(longName, undefined)).toThrow(DsnError);
    });

    it('should throw for invalid member name', () => {
      expect(() => resolveDsn('SRC.COBOL', 'USER', '123BAD')).toThrow(DsnError);
    });
  });

  describe('whitespace handling', () => {
    it('should trim leading/trailing whitespace', () => {
      const result = resolveDsn('  SRC.COBOL  ', 'USER');
      expect(result.dsn).toBe('USER.SRC.COBOL');
    });

    it('should trim whitespace from quoted names', () => {
      const result = resolveDsn("  'SYS1.PROCLIB'  ", 'USER');
      expect(result.dsn).toBe('SYS1.PROCLIB');
    });
  });
});

// ---------------------------------------------------------------------------
// validateDsn — dataset name validation
// ---------------------------------------------------------------------------

describe('validateDsn', () => {
  it('should accept a valid simple name', () => {
    expect(() => validateDsn('USER')).not.toThrow();
  });

  it('should accept a valid multi-qualifier name', () => {
    expect(() => validateDsn('USER.SRC.COBOL')).not.toThrow();
  });

  it('should accept national characters (#, @, $)', () => {
    expect(() => validateDsn('#TEMP.@DATA.$FILE')).not.toThrow();
  });

  it('should accept hyphens in qualifiers', () => {
    expect(() => validateDsn('MY-DATA.TST-FILE')).not.toThrow();
  });

  it('should reject empty name', () => {
    expect(() => validateDsn('')).toThrow(DsnError);
  });

  it('should reject name longer than 44 characters', () => {
    const long =
      'A'.repeat(8) +
      '.' +
      'B'.repeat(8) +
      '.' +
      'C'.repeat(8) +
      '.' +
      'D'.repeat(8) +
      '.' +
      'E'.repeat(8) +
      '.' +
      'F'.repeat(3);
    expect(long.length).toBeGreaterThan(44);
    expect(() => validateDsn(long)).toThrow(DsnError);
  });

  it('should reject name starting with a dot', () => {
    expect(() => validateDsn('.USER')).toThrow(DsnError);
  });

  it('should reject name ending with a dot', () => {
    expect(() => validateDsn('USER.')).toThrow(DsnError);
  });

  it('should reject consecutive dots', () => {
    expect(() => validateDsn('USER..DATA')).toThrow(DsnError);
  });

  it('should reject qualifier longer than 8 characters', () => {
    expect(() => validateDsn('USER.TOOLONGQU')).toThrow(DsnError);
  });

  it('should reject qualifier starting with a digit', () => {
    expect(() => validateDsn('USER.1BAD')).toThrow(DsnError);
  });

  it('should reject qualifier with invalid characters', () => {
    expect(() => validateDsn('USER.BAD!NAME')).toThrow(DsnError);
  });
});

// ---------------------------------------------------------------------------
// validateMember — member name validation
// ---------------------------------------------------------------------------

describe('validateMember', () => {
  it('should accept a valid member name', () => {
    expect(() => validateMember('HELLO')).not.toThrow();
  });

  it('should accept single character', () => {
    expect(() => validateMember('A')).not.toThrow();
  });

  it('should accept 8-character name', () => {
    expect(() => validateMember('ABCDEFGH')).not.toThrow();
  });

  it('should accept national characters', () => {
    expect(() => validateMember('#TEST')).not.toThrow();
    expect(() => validateMember('@DATA')).not.toThrow();
    expect(() => validateMember('$UTIL')).not.toThrow();
  });

  it('should reject empty name', () => {
    expect(() => validateMember('')).toThrow(DsnError);
  });

  it('should reject name longer than 8 characters', () => {
    expect(() => validateMember('TOOLONGMM')).toThrow(DsnError);
  });

  it('should reject name starting with a digit', () => {
    expect(() => validateMember('1BAD')).toThrow(DsnError);
  });

  it('should reject name with invalid characters', () => {
    expect(() => validateMember('BAD!')).toThrow(DsnError);
  });
});

// ---------------------------------------------------------------------------
// buildDsUri — URI construction
// ---------------------------------------------------------------------------

describe('buildDsUri', () => {
  it('should build a basic dataset URI', () => {
    expect(buildDsUri('sys1.example.com', 'USER.SRC.COBOL')).toBe(
      'zos-ds://sys1.example.com/USER.SRC.COBOL'
    );
  });

  it('should include member in parentheses', () => {
    expect(buildDsUri('sys1.example.com', 'USER.SRC.COBOL', 'HELLO')).toBe(
      'zos-ds://sys1.example.com/USER.SRC.COBOL(HELLO)'
    );
  });

  it('should include volser as query parameter', () => {
    expect(buildDsUri('sys1.example.com', 'USER.DATA', undefined, 'VOL001')).toBe(
      'zos-ds://sys1.example.com/USER.DATA?volser=VOL001'
    );
  });

  it('should include both member and volser', () => {
    expect(buildDsUri('sys1.example.com', 'USER.SRC.COBOL', 'HELLO', 'VOL001')).toBe(
      'zos-ds://sys1.example.com/USER.SRC.COBOL(HELLO)?volser=VOL001'
    );
  });

  it('should omit member when undefined', () => {
    const uri = buildDsUri('sys1.example.com', 'USER.DATA');
    expect(uri).not.toContain('(');
  });

  it('should omit volser when undefined', () => {
    const uri = buildDsUri('sys1.example.com', 'USER.DATA');
    expect(uri).not.toContain('?');
  });
});
