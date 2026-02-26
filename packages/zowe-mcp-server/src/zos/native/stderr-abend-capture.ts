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
 * Captures stderr output that indicates the ZNP server on z/OS abended
 * (e.g. "Invalid JSON response: CEE3204S...") when the SDK logs it but does not
 * reject the in-flight Promise. Used so we can treat a subsequent timeout as an
 * abend and evict the connection / run CEEDUMP collection.
 */

/** Removes trailing dots and spaces from an abend/error message for logs and user display. */
export function sanitizeAbendMessage(msg: string): string {
  return msg
    .trim()
    .replace(/\s*\.+\s*$/, '')
    .trim();
}

const abendSnippetsByKey = new Map<string, string>();

function isAbendStderrChunk(chunk: string): boolean {
  const lower = chunk.toLowerCase();
  if (!lower.includes('invalid json')) return false;
  return (
    /cee3204s/i.test(chunk) ||
    lower.includes('protection exception') ||
    /\b0c4\b/i.test(chunk) ||
    lower.includes('completion code')
  );
}

const originalStderrWrite = process.stderr.write.bind(process.stderr);

/**
 * Wraps process.stderr.write so that when the ZNP SDK logs abend output
 * (e.g. "Invalid JSON response: CEE3204S The system detected a protection exception..."),
 * we call onAbend(snippet) once so the in-flight request can reject immediately,
 * and store the snippet for takeAbendSnippet. Call the returned function to unbind.
 */
export function installStderrAbendCapture(
  connectionKey: string,
  onAbend: (snippet: string) => void
): () => void {
  let fired = false;
  const write = (
    chunk: unknown,
    encodingOrCallback?: BufferEncoding | ((err?: Error) => void),
    callback?: (err?: Error) => void
  ): boolean => {
    if (chunk !== undefined && chunk !== null && !fired) {
      let str: string;
      if (typeof chunk === 'string') {
        str = chunk;
      } else if (Buffer.isBuffer(chunk)) {
        str = chunk.toString('utf-8');
      } else if (typeof (chunk as { toString?: () => string }).toString === 'function') {
        str = (chunk as { toString: () => string }).toString();
      } else {
        str = '';
      }
      if (str && isAbendStderrChunk(str)) {
        fired = true;
        const snippet = sanitizeAbendMessage(str).slice(0, 2000);
        abendSnippetsByKey.set(connectionKey, snippet);
        onAbend(snippet);
      }
    }
    const cb = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
    const enc = typeof encodingOrCallback === 'string' ? encodingOrCallback : undefined;
    return originalStderrWrite(
      chunk as string,
      enc,
      cb as (err?: Error | null) => void | undefined
    );
  };

  (process.stderr as NodeJS.WritableStream & { write: typeof write }).write = write;
  return function unbind(): void {
    (process.stderr as NodeJS.WritableStream).write = originalStderrWrite;
  };
}

/**
 * Returns and removes the captured abend snippet for the key, if any.
 * Call this in the error path when a request timed out so we can treat
 * the timeout as an abend and surface the real error.
 */
export function takeAbendSnippet(connectionKey: string): string | undefined {
  const snippet = abendSnippetsByKey.get(connectionKey);
  abendSnippetsByKey.delete(connectionKey);
  return snippet;
}
