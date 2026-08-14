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
 * Split a string into up to `maxPieces` roughly-equal, non-empty pieces
 * (in original order, concatenation reproduces the input exactly). Used to
 * simulate a model streaming its output over several chunks instead of one.
 * Deterministic given the same input, so tests/logs stay reproducible.
 */
export function splitIntoChunks(text: string, maxPieces = 3): string[] {
  if (text.length === 0) {
    return [];
  }
  const pieceCount = Math.min(maxPieces, text.length);
  const size = Math.ceil(text.length / pieceCount);
  const pieces: string[] = [];
  for (let i = 0; i < text.length; i += size) {
    pieces.push(text.slice(i, i + size));
  }
  return pieces;
}
