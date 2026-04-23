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
 * Reusable helpers for Zowe Remote SSH (`zowex-sdk`) API validation and response debug logging.
 */

/** Logger interface: at least debug(message, data). */
export interface ZowexRpcDebugLogger {
  debug(message: string, data?: unknown): void;
}

/**
 * Removes null bytes from a string (SDK sometimes returns padded fields like "JES2\u0000").
 */
export function sanitizeZowexString(s: string | undefined): string | undefined {
  if (s == null) return s;
  const out = s.replace(/\0/g, '');
  return out.length > 0 ? out : undefined;
}

/**
 * Validates that an object has the required method names as functions.
 * Logs the object's keys and which required methods are present; throws if any are missing.
 */
export function requireMethods(
  log: ZowexRpcDebugLogger,
  objectName: string,
  obj: Record<string, unknown>,
  methodNames: string[]
): void {
  const keys = Object.keys(obj);
  const hasFlags = Object.fromEntries(
    methodNames.map(m => [
      `has${m.charAt(0).toUpperCase() + m.slice(1)}`,
      typeof obj[m] === 'function',
    ])
  );
  log.debug(`${objectName} API`, { keys, ...hasFlags });

  for (const m of methodNames) {
    if (typeof obj[m] !== 'function') {
      throw new Error(
        `${objectName}.${m} is not a function. keys: ${keys.join(', ')}. ` +
          'Check zowex-sdk version and server capabilities.'
      );
    }
  }
}

/** Options for {@link logZowexRpcResponse}. */
export interface LogZowexRpcResponseOptions {
  /** Keys we map from the raw response; any other keys are logged as unmappedFields. */
  expectedKeys?: string[];
  /** Whether the mapped result meets our API expectation. */
  matchesExpectation?: boolean;
}

/**
 * Logs a raw zowex-sdk RPC response and the mapped result for debugging.
 */
export function logZowexRpcResponse<T>(
  log: ZowexRpcDebugLogger,
  operation: string,
  rawResponse: Record<string, unknown>,
  mappedResult: T,
  options?: LogZowexRpcResponseOptions
): void {
  log.debug(`zowex-sdk ${operation} raw response`, {
    responseKeys: Object.keys(rawResponse),
    response: rawResponse,
  });

  const extra: Record<string, unknown> = { result: mappedResult };
  if (options?.expectedKeys?.length) {
    const unmapped = Object.keys(rawResponse).filter(k => !options.expectedKeys!.includes(k));
    if (unmapped.length > 0) {
      extra.unmappedSdkFields = unmapped;
    }
  }
  if (options?.matchesExpectation !== undefined) {
    extra.matchesExpectation = options.matchesExpectation;
  }

  log.debug(`zowex-sdk ${operation} mapped result`, extra);
}
