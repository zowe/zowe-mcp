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
import {
  DEFAULT_MAINFRAME_MVS_ENCODING,
  DEFAULT_MAINFRAME_USS_ENCODING,
  resolveDatasetEncoding,
} from '../src/zos/encoding.js';

describe('encoding', () => {
  describe('resolveDatasetEncoding', () => {
    it('returns operation param when provided and non-empty', () => {
      expect(resolveDatasetEncoding('IBM-1047', 'IBM-37', DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        'IBM-1047'
      );
      expect(resolveDatasetEncoding('CP037', undefined, DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        'CP037'
      );
    });

    it('returns system override when operation param is undefined', () => {
      expect(resolveDatasetEncoding(undefined, 'IBM-1047', DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        'IBM-1047'
      );
      expect(resolveDatasetEncoding(undefined, 'IBM-37', DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        'IBM-37'
      );
    });

    it('returns system override when operation param is empty string', () => {
      expect(resolveDatasetEncoding('', 'IBM-1047', DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        'IBM-1047'
      );
    });

    it('returns server default when system override is null', () => {
      expect(resolveDatasetEncoding(undefined, null, DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        DEFAULT_MAINFRAME_MVS_ENCODING
      );
      expect(resolveDatasetEncoding(undefined, null, 'IBM-1047')).toBe('IBM-1047');
    });

    it('returns server default when system override is undefined', () => {
      expect(resolveDatasetEncoding(undefined, undefined, 'IBM-37')).toBe('IBM-37');
    });

    it('returns server default when both param and system override are empty', () => {
      expect(resolveDatasetEncoding('', '', DEFAULT_MAINFRAME_MVS_ENCODING)).toBe(
        DEFAULT_MAINFRAME_MVS_ENCODING
      );
    });
  });

  describe('default constants', () => {
    it('DEFAULT_MAINFRAME_MVS_ENCODING is IBM-37', () => {
      expect(DEFAULT_MAINFRAME_MVS_ENCODING).toBe('IBM-37');
    });

    it('DEFAULT_MAINFRAME_USS_ENCODING is IBM-1047', () => {
      expect(DEFAULT_MAINFRAME_USS_ENCODING).toBe('IBM-1047');
    });
  });
});
