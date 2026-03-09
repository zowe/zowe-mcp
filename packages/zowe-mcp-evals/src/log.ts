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
 
// ToDo: Is it duplicated? 

const NAME = 'evals';

const isTTY = process.stderr.isTTY === true;
const GREEN = isTTY ? '\x1b[32m' : '';
const RED = isTTY ? '\x1b[31m' : '';
const RESET = isTTY ? '\x1b[0m' : '';

function format(level: string, message: string, data?: unknown): string {
  const timestamp = new Date().toISOString();
  const tag = level.toUpperCase();
  const nameTag = ` [${NAME}]`;
  const suffix = data !== undefined ? ` ${JSON.stringify(data)}` : '';
  return `${timestamp} [${tag}]${nameTag} ${message}${suffix}\n`;
}

type LogFn = (message: string, data?: unknown) => void;

interface Logger {
  debug: LogFn;
  info: LogFn;
  notice: LogFn;
  warning: LogFn;
  error: LogFn;
  pass: LogFn;
  fail: LogFn;
}

export const log: Logger = {
  debug(message, data) {
    process.stderr.write(format('debug', message, data));
  },

  info(message, data) {
    process.stderr.write(format('info', message, data));
  },

  notice(message, data) {
    process.stderr.write(format('notice', message, data));
  },

  warning(message, data) {
    process.stderr.write(format('warning', message, data));
  },

  error(message, data) {
    process.stderr.write(format('error', message, data));
  },

  pass(message, data) {
    process.stderr.write(`${GREEN}${format('notice', message, data)}${RESET}`);
  },

  fail(message, data) {
    process.stderr.write(`${RED}${format('notice', message, data)}${RESET}`);
  },
};
