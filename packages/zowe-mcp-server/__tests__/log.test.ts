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
 * Unit tests for the Logger class.
 *
 * These tests verify stderr output, level filtering, child loggers,
 * and MCP protocol forwarding via sendLoggingMessage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogLevel } from '../src/log.js';
import { Logger, tryParseLogLevel } from '../src/log.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    delete process.env.ZOWE_MCP_LOG_LEVEL;
  });

  // -----------------------------------------------------------------------
  // Basic output
  // -----------------------------------------------------------------------

  it('should write info messages to stderr', () => {
    const logger = new Logger({ level: 'debug' });
    logger.info('hello world');

    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[INFO]');
    expect(output).toContain('hello world');
    expect(output.endsWith('\n')).toBe(true);
  });

  it('should include a timestamp in ISO format', () => {
    const logger = new Logger({ level: 'debug' });
    logger.info('timestamped');

    const output = stderrSpy.mock.calls[0][0] as string;
    // ISO 8601 pattern: YYYY-MM-DDTHH:mm:ss.sssZ
    expect(output).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it('should include the logger name when provided', () => {
    const logger = new Logger({ level: 'debug', name: 'http' });
    logger.info('with name');

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[http]');
  });

  it('should omit the name tag when no name is set', () => {
    const logger = new Logger({ level: 'debug' });
    logger.info('no name');

    const output = stderrSpy.mock.calls[0][0] as string;
    // Should have [INFO] followed directly by the message (no extra brackets)
    expect(output).toMatch(/\[INFO\] no name/);
  });

  it('should include JSON-serialized data when provided', () => {
    const logger = new Logger({ level: 'debug' });
    logger.info('with data', { key: 'value' });

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('{"key":"value"}');
  });

  // -----------------------------------------------------------------------
  // Level filtering
  // -----------------------------------------------------------------------

  it('should suppress messages below the configured level', () => {
    const logger = new Logger({ level: 'warning' });
    logger.debug('suppressed');
    logger.info('suppressed');
    logger.notice('suppressed');

    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('should emit messages at or above the configured level', () => {
    const logger = new Logger({ level: 'warning' });
    logger.warning('shown');
    logger.error('shown');
    logger.critical('shown');

    expect(stderrSpy).toHaveBeenCalledTimes(3);
  });

  it('should default to info level', () => {
    const logger = new Logger();
    logger.debug('suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.info('shown');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // All level methods
  // -----------------------------------------------------------------------

  it('should support all RFC 5424 log levels', () => {
    const logger = new Logger({ level: 'debug' });
    const levels: LogLevel[] = [
      'debug',
      'info',
      'notice',
      'warning',
      'error',
      'critical',
      'alert',
      'emergency',
    ];

    for (const level of levels) {
      logger[level](`${level} message`);
    }

    expect(stderrSpy).toHaveBeenCalledTimes(levels.length);

    for (let i = 0; i < levels.length; i++) {
      const output = stderrSpy.mock.calls[i][0] as string;
      expect(output).toContain(`[${levels[i].toUpperCase()}]`);
    }
  });

  // -----------------------------------------------------------------------
  // Environment variable override
  // -----------------------------------------------------------------------

  it('should respect ZOWE_MCP_LOG_LEVEL environment variable', () => {
    process.env.ZOWE_MCP_LOG_LEVEL = 'error';
    const logger = new Logger(); // default would be info

    logger.info('suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.error('shown');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('should ignore invalid ZOWE_MCP_LOG_LEVEL values', () => {
    process.env.ZOWE_MCP_LOG_LEVEL = 'banana';
    const logger = new Logger(); // falls back to info

    logger.debug('suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.info('shown');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('should be case-insensitive for ZOWE_MCP_LOG_LEVEL', () => {
    process.env.ZOWE_MCP_LOG_LEVEL = 'DEBUG';
    const logger = new Logger();

    logger.debug('shown');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // Child loggers
  // -----------------------------------------------------------------------

  it('should create child loggers with a different name', () => {
    const parent = new Logger({ level: 'debug', name: 'parent' });
    const child = parent.child('child');

    child.info('child message');

    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[child]');
    expect(output).not.toContain('[parent]');
  });

  it('should inherit the parent level in child loggers', () => {
    const parent = new Logger({ level: 'error' });
    const child = parent.child('child');

    child.info('suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();

    child.error('shown');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  // -----------------------------------------------------------------------
  // MCP protocol forwarding
  // -----------------------------------------------------------------------

  it('should forward messages to McpServer when attached and connected', () => {
    const mockServer = {
      isConnected: vi.fn().mockReturnValue(true),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };

    const logger = new Logger({ level: 'debug' });
    logger.attach(mockServer as never);

    logger.info('forwarded');

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledExactlyOnceWith({
      level: 'info',
      logger: undefined,
      data: 'forwarded',
    });
  });

  it('should include data in protocol message when provided', () => {
    const mockServer = {
      isConnected: vi.fn().mockReturnValue(true),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };

    const logger = new Logger({ level: 'debug' });
    logger.attach(mockServer as never);

    logger.error('failed', { code: 42 });

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'error',
      logger: undefined,
      data: { code: 42 },
    });
  });

  it('should include logger name in protocol message', () => {
    const mockServer = {
      isConnected: vi.fn().mockReturnValue(true),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };

    const logger = new Logger({ level: 'debug', name: 'http' });
    logger.attach(mockServer as never);

    logger.info('request');

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'http',
      data: 'request',
    });
  });

  it('should not forward when server is not connected', () => {
    const mockServer = {
      isConnected: vi.fn().mockReturnValue(false),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };

    const logger = new Logger({ level: 'debug' });
    logger.attach(mockServer as never);

    logger.info('not forwarded');

    expect(mockServer.sendLoggingMessage).not.toHaveBeenCalled();
    // But stderr should still get the message
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('should not forward when no server is attached', () => {
    const logger = new Logger({ level: 'debug' });
    // No attach() call — should not throw
    logger.info('no server');

    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('should share server reference with child loggers', () => {
    const mockServer = {
      isConnected: vi.fn().mockReturnValue(true),
      sendLoggingMessage: vi.fn().mockResolvedValue(undefined),
    };

    const parent = new Logger({ level: 'debug' });
    parent.attach(mockServer as never);

    const child = parent.child('tools');
    child.info('from child');

    expect(mockServer.sendLoggingMessage).toHaveBeenCalledWith({
      level: 'info',
      logger: 'tools',
      data: 'from child',
    });
  });

  // -----------------------------------------------------------------------
  // tryParseLogLevel / emitForcedInfo
  // -----------------------------------------------------------------------

  it('tryParseLogLevel should accept valid levels case-insensitively', () => {
    expect(tryParseLogLevel('DEBUG')).toBe('debug');
    expect(tryParseLogLevel('error')).toBe('error');
    expect(tryParseLogLevel('  INFO  ')).toBe('info');
  });

  it('tryParseLogLevel should return undefined for invalid input', () => {
    expect(tryParseLogLevel(undefined)).toBeUndefined();
    expect(tryParseLogLevel('')).toBeUndefined();
    expect(tryParseLogLevel('banana')).toBeUndefined();
  });

  it('emitForcedInfo should write to stderr even when configured level is error', () => {
    const logger = new Logger({ level: 'error' });
    logger.info('suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.emitForcedInfo('log level ack');
    expect(stderrSpy).toHaveBeenCalledOnce();
    const output = stderrSpy.mock.calls[0][0] as string;
    expect(output).toContain('[INFO]');
    expect(output).toContain('log level ack');
  });

  it('emitForcedInfo should write to stderr even after setLevel makes info normally suppressed', () => {
    const logger = new Logger({ level: 'debug' });
    logger.setLevel('error');
    logger.info('suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();

    logger.emitForcedInfo('confirm');
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect((stderrSpy.mock.calls[0][0] as string).includes('confirm')).toBe(true);
  });
});
