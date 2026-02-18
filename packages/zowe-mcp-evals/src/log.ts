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
 * Logger that uses the same stderr format as the Zowe MCP server:
 * YYYY-MM-DDTHH:mm:ss.sssZ [LEVEL] [name] message {data}
 */

const NAME = 'evals';

function format(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase();
  const nameTag = ` [${NAME}]`;
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  return `${timestamp} [${tag}]${nameTag} ${message}${suffix}\n`;
}

export const log = {
  debug(message: string, data?: unknown): void {
    process.stderr.write(format('debug', message, data));
  },

  info(message: string, data?: unknown): void {
    process.stderr.write(format('info', message, data));
  },

  notice(message: string, data?: unknown): void {
    process.stderr.write(format('notice', message, data));
  },

  warning(message: string, data?: unknown): void {
    process.stderr.write(format('warning', message, data));
  },

  error(message: string, data?: unknown): void {
    process.stderr.write(format('error', message, data));
  },
};
