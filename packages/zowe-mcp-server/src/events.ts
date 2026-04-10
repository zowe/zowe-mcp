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
  /**
   * When set, only an "Open Settings" button is shown that opens this specific
   * settings key. When absent the extension shows its default action buttons.
   */
  settingsKey?: string;
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

/** Payload for an `open-dataset-in-editor` event (server → extension). */
export interface OpenDatasetInEditorEventData {
  /** Zowe profile name for the zowe-ds URI. When omitted, extension resolves via default or match-by-system. */
  profile?: string;
  /** Fully qualified data set name. */
  dsn: string;
  /** PDS or PDS/E member name; omit for sequential data sets. */
  member?: string;
  /** Current MCP system id (e.g. user@host) for match-by-system resolution. */
  system?: string;
  /** When 'native', extension prefers ssh profile when matching by system. */
  connectionKind?: 'native' | 'zosmf';
}

/** Asks the extension to open a data set or member in Zowe Explorer's editor (zowe-ds URI). */
export type OpenDatasetInEditorEvent = McpEvent<
  'open-dataset-in-editor',
  OpenDatasetInEditorEventData
>;

/** Payload for an `open-uss-file-in-editor` event (server → extension). */
export interface OpenUssFileInEditorEventData {
  /** USS file or directory path (absolute or relative to home). */
  path: string;
  /** Current MCP system id (e.g. user@host) for match-by-system resolution. */
  system?: string;
  /** When 'native', extension prefers ssh profile when matching by system. */
  connectionKind?: 'native' | 'zosmf';
}

/** Asks the extension to open a USS file in Zowe Explorer's editor (zowe-uss URI). */
export type OpenUssFileInEditorEvent = McpEvent<
  'open-uss-file-in-editor',
  OpenUssFileInEditorEventData
>;

/** Payload for an `open-job-in-editor` event (server → extension). */
export interface OpenJobInEditorEventData {
  /** Job ID (e.g. JOB00123). */
  jobId: string;
  /** Optional job file (spool) ID from listJobFiles; when omitted, opens the job node. */
  jobFileId?: number;
  /** Current MCP system id (e.g. user@host) for match-by-system resolution. */
  system?: string;
  /** When 'native', extension prefers ssh profile when matching by system. */
  connectionKind?: 'native' | 'zosmf';
}

/** Asks the extension to open a job or spool file in Zowe Explorer's editor (zowe-jobs URI). */
export type OpenJobInEditorEvent = McpEvent<'open-job-in-editor', OpenJobInEditorEventData>;

/** Payload for a `ceedump-collected` event (server → extension). */
export interface CeedumpCollectedEventData {
  /** Absolute path to the saved CEEDUMP file (YAML metadata + dump content). */
  path: string;
  /** Abend reason text (e.g. CEE3204S protection exception 0C4). Present when the dump was collected after a ZNP abend. */
  reason?: string;
  /** Zowe Native operation that was in progress when the abend occurred (e.g. listDatasets, readDataset). */
  znpOperation?: string;
  /** MCP tool that was in progress when the abend occurred (e.g. listDatasets, searchInDataset). */
  mcpTool?: string;
}

/** Notifies the extension that a CEEDUMP was collected after a ZNP abend; extension can show a message and offer to open the file. */
export type CeedumpCollectedEvent = McpEvent<'ceedump-collected', CeedumpCollectedEventData>;

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

/** Payload for a `connections-update` event (extension → server). */
export interface ConnectionsUpdateEventData {
  /** Connection specs (user@host or user@host:port). Multiple specs can target the same z/OS system. */
  connections: string[];
}

/** Updates the list of connection specs (user@host) for native mode. */
export type ConnectionsUpdateEvent = McpEvent<'connections-update', ConnectionsUpdateEventData>;

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

/** Payload for a `cli-plugin-configuration-update` event (extension → server). */
export interface CliPluginConfigurationUpdateEventData {
  /**
   * Map of plugin name → CliPluginProfilesFile inline object.
   * Same shape as the zoweMCP.cliPluginConfiguration VS Code setting.
   * The server updates profilesByType and activeProfileId on each named plugin state in-place.
   */
  configuration: Record<string, unknown>;
}

/** Updates CLI plugin profiles on the running server without restart. */
export type CliPluginConfigurationUpdateEvent = McpEvent<
  'cli-plugin-configuration-update',
  CliPluginConfigurationUpdateEventData
>;

// ---------------------------------------------------------------------------
// Extension → Server events
// ---------------------------------------------------------------------------

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

/** Payload for a `zowe-explorer-update` event (extension → server). */
export interface ZoweExplorerUpdateEventData {
  /** Whether Zowe Explorer is installed and available for open-in-editor tools. */
  available: boolean;
}

/** Notifies the server that Zowe Explorer availability changed (e.g. installed or activated). */
export type ZoweExplorerUpdateEvent = McpEvent<
  'zowe-explorer-update',
  ZoweExplorerUpdateEventData
>;

/** Payload for a `cli-plugin-active-profiles-changed` event (server → extension). */
export interface CliPluginActiveProfilesChangedEventData {
  /** Plugin name (e.g. "endevor"). */
  pluginName: string;
  /**
   * Active named profile ID per type key (for `required: true` types, e.g. connection).
   * Only entries with a defined ID are included.
   */
  activeProfiles: Record<string, string>;
  /**
   * Active virtual context fields per type key (for `perToolOverride: true` types, e.g. location).
   * Only entries with at least one defined field are included.
   */
  activeContext: Record<string, Record<string, string>>;
}

/** Notifies the extension when the active CLI plugin profile or location context changes. */
export type CliPluginActiveProfilesChangedEvent = McpEvent<
  'cli-plugin-active-profiles-changed',
  CliPluginActiveProfilesChangedEventData
>;

/** Payload for `store-cli-plugin-profiles` (server → extension). */
export interface StoreCliPluginProfilesEventData {
  /** Plugin id from YAML `plugin:` (e.g. `db2`). */
  pluginName: string;
  /**
   * Full profiles document to merge into `zoweMCP.cliPluginConfiguration[pluginName]`.
   * Same shape as the JSON file used with `--cli-plugin-configuration`.
   */
  profilesFile: Record<string, unknown>;
}

/** Persists CLI plugin named profiles into workspace/global settings (mirrors connection file). */
export type StoreCliPluginProfilesEvent = McpEvent<
  'store-cli-plugin-profiles',
  StoreCliPluginProfilesEventData
>;

/** Payload for an `active-connection-changed` event (server → extension). */
export interface ActiveConnectionChangedEventData {
  /** Connection spec (e.g. user@host) or null when no active system. */
  activeConnection: string | null;
}

/** Notifies the extension that the MCP server's active z/OS connection changed (e.g. after setSystem or auto-activation). */
export type ActiveConnectionChangedEvent = McpEvent<
  'active-connection-changed',
  ActiveConnectionChangedEventData
>;

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
  | StoreJobCardEvent
  | OpenDatasetInEditorEvent
  | OpenUssFileInEditorEvent
  | OpenJobInEditorEvent
  | CeedumpCollectedEvent
  | CliPluginActiveProfilesChangedEvent
  | StoreCliPluginProfilesEvent
  | ActiveConnectionChangedEvent;

/** Events that flow from the VS Code extension to the MCP server. */
export type ExtensionToServerEvent =
  | LogLevelEvent
  | PasswordEvent
  | ConnectionsUpdateEvent
  | NativeOptionsUpdateEvent
  | EncodingOptionsUpdateEvent
  | JobCardsUpdateEvent
  | JobCardEvent
  | ZoweExplorerUpdateEvent
  | CliPluginConfigurationUpdateEvent;

/** Union of all event types exchanged over the pipe. */
export type AnyMcpEvent = ServerToExtensionEvent | ExtensionToServerEvent;
