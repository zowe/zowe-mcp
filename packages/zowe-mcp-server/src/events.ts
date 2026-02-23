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
 * Shared event type definitions for bidirectional communication
 * between the MCP server and the VS Code extension over a named pipe.
 *
 * Events are serialized as newline-delimited JSON (NDJSON) and flow
 * in both directions:
 *   - Server → Extension: {@link ServerToExtensionEvent}
 *   - Extension → Server: {@link ExtensionToServerEvent}
 */

import type { LogLevel } from './log.js';

// ---------------------------------------------------------------------------
// Base event envelope
// ---------------------------------------------------------------------------

/** Base event envelope sent over the pipe. */
export interface McpEvent<T extends string = string, D = unknown> {
  type: T;
  data: D;
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Server → Extension events
// ---------------------------------------------------------------------------

/** Payload for a `log` event (server → extension). */
export interface LogEventData {
  level: LogLevel;
  logger?: string;
  message: string;
  data?: unknown;
}

/** Forwards a server log message to the VS Code Output panel. */
export type LogEvent = McpEvent<'log', LogEventData>;

/** Severity level for a notification displayed to the user. */
export type NotificationSeverity = 'info' | 'warning' | 'error';

/** Payload for a `notification` event (server → extension). */
export interface NotificationEventData {
  /** Severity controls which VS Code API is used (showInformationMessage, showWarningMessage, showErrorMessage). */
  severity: NotificationSeverity;
  /** The message to display. */
  message: string;
}

/** Displays a notification message in the VS Code UI. */
export type NotificationEvent = McpEvent<'notification', NotificationEventData>;

/** Payload for a `request-password` event (server → extension). */
export interface RequestPasswordEventData {
  user: string;
  host: string;
  port?: number;
}

/** Asks the extension to provide a password for user@host (from SecretStorage or prompt). */
export type RequestPasswordEvent = McpEvent<'request-password', RequestPasswordEventData>;

/** Payload for a `password-invalid` event (server → extension). */
export interface PasswordInvalidEventData {
  user: string;
  host: string;
  port?: number;
}

/** Tells the extension to delete the stored password for that user@host. */
export type PasswordInvalidEvent = McpEvent<'password-invalid', PasswordInvalidEventData>;

/** Payload for a `store-password` event (server → extension). */
export interface StorePasswordEventData {
  user: string;
  host: string;
  port?: number;
  password: string;
}

/** Asks the extension to store a password for user@host in SecretStorage (e.g. after successful use of an elicited password). */
export type StorePasswordEvent = McpEvent<'store-password', StorePasswordEventData>;

/** Payload for a `request-job-card` event (server → extension). */
export interface RequestJobCardEventData {
  user: string;
  host: string;
  port?: number;
}

/** Asks the extension to provide a job card for user@host (multi-line JOB statement). */
export type RequestJobCardEvent = McpEvent<'request-job-card', RequestJobCardEventData>;

/** Payload for a `store-job-card` event (server → extension). */
export interface StoreJobCardEventData {
  /** Connection spec (e.g. user@host or user@host:port). */
  connectionSpec: string;
  /** Full job card text (multi-line). */
  jobCard: string;
}

/** Asks the extension to persist a job card (e.g. after elicitation) to settings or storage. */
export type StoreJobCardEvent = McpEvent<'store-job-card', StoreJobCardEventData>;

// ---------------------------------------------------------------------------
// Extension → Server events
// ---------------------------------------------------------------------------

/** Payload for a `log-level` event (extension → server). */
export interface LogLevelEventData {
  level: LogLevel;
}

/** Dynamically changes the server's log verbosity at runtime. */
export type LogLevelEvent = McpEvent<'log-level', LogLevelEventData>;

/** Payload for a `password` event (extension → server). */
export interface PasswordEventData {
  user: string;
  host: string;
  port?: number;
  password: string;
}

/** Supplies a password for user@host (after request-password or from SecretStorage). */
export type PasswordEvent = McpEvent<'password', PasswordEventData>;

/** Payload for a `systems-update` event (extension → server). */
export interface SystemsUpdateEventData {
  systems: string[];
}

/** Updates the list of connection specs (user@host) for native mode. */
export type SystemsUpdateEvent = McpEvent<'systems-update', SystemsUpdateEventData>;

/** Payload for a `native-options-update` event (extension → server). */
export interface NativeOptionsUpdateEventData {
  installZoweNativeServerAutomatically: boolean;
  zoweNativeServerPath?: string;
  /** Response timeout in seconds for ZNP requests (default 60). Applied to future connections. */
  responseTimeout?: number;
}

/** Updates native backend options (auto-install, server path). Applied to future connections. */
export type NativeOptionsUpdateEvent = McpEvent<
  'native-options-update',
  NativeOptionsUpdateEventData
>;

/** Payload for an `encoding-options-update` event (extension → server). */
export interface EncodingOptionsUpdateEventData {
  defaultMainframeMvsEncoding?: string;
  defaultMainframeUssEncoding?: string;
}

/** Updates default mainframe encodings. Applied immediately to the running server. */
export type EncodingOptionsUpdateEvent = McpEvent<
  'encoding-options-update',
  EncodingOptionsUpdateEventData
>;

/** Payload for a `job-cards-update` event (extension → server). */
export interface JobCardsUpdateEventData {
  /** Map of connection spec (user@host or user@host:port) to job card: string (multi-line) or array of lines. */
  jobCards: Record<string, string | string[]>;
}

/** Sends job cards from VS Code setting to the server. Merged with file-sourced job cards. */
export type JobCardsUpdateEvent = McpEvent<'job-cards-update', JobCardsUpdateEventData>;

/** Payload for a `job-card` event (extension → server). */
export interface JobCardEventData {
  user: string;
  host: string;
  port?: number;
  /** Full job card text (multi-line). */
  jobCard: string;
}

/** Supplies a job card for user@host (after request-job-card or from settings). */
export type JobCardEvent = McpEvent<'job-card', JobCardEventData>;

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

/** Events that flow from the MCP server to the VS Code extension. */
export type ServerToExtensionEvent =
  | LogEvent
  | NotificationEvent
  | RequestPasswordEvent
  | PasswordInvalidEvent
  | StorePasswordEvent
  | RequestJobCardEvent
  | StoreJobCardEvent;

/** Events that flow from the VS Code extension to the MCP server. */
export type ExtensionToServerEvent =
  | LogLevelEvent
  | PasswordEvent
  | SystemsUpdateEvent
  | NativeOptionsUpdateEvent
  | EncodingOptionsUpdateEvent
  | JobCardsUpdateEvent
  | JobCardEvent;

/** Union of all event types exchanged over the pipe. */
export type AnyMcpEvent = ServerToExtensionEvent | ExtensionToServerEvent;
