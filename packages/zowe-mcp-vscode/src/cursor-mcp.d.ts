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
 * Type declarations for Cursor's MCP Extension API.
 * @see https://cursor.com/docs/context/mcp-extension-api
 */

declare module 'vscode' {
  export namespace cursor {
    export namespace mcp {
      export interface StdioServerConfig {
        name: string;
        server: {
          command: string;
          args: string[];
          env: Record<string, string>;
        };
      }

      export interface RemoteServerConfig {
        name: string;
        server: {
          url: string;
          /**
           * Optional HTTP headers to include with every request to this server (e.g. for authentication).
           */
          headers?: Record<string, string>;
        };
      }

      export type ExtMCPServerConfig = StdioServerConfig | RemoteServerConfig;

      /**
       * Register an MCP server that the Cursor extension can communicate with.
       */
      export const registerServer: (config: ExtMCPServerConfig) => void;

      /**
       * Unregister a previously registered MCP server.
       */
      export const unregisterServer: (serverName: string) => void;
    }
  }
}
