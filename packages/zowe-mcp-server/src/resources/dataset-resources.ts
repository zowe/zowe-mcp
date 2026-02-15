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
 * MCP resource templates for z/OS datasets.
 *
 * Registers `zos-ds://` URI templates so that LLMs can read dataset
 * content directly via `resources/read`.
 *
 * Templates:
 * - `zos-ds://{system}/{dsn}` — sequential dataset content
 * - `zos-ds://{system}/{dsn}({member})` — PDS/PDSE member content
 *
 * Both support an optional `?volser=` query parameter for uncataloged datasets.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../log.js';
import type { ZosBackend } from '../zos/backend.js';
import { inferMimeType } from '../zos/dsn.js';

/** Dependencies injected into resource registration. */
export interface DatasetResourceDeps {
  backend: ZosBackend;
}

/**
 * Registers dataset resource templates on the given MCP server.
 */
export function registerDatasetResources(
  server: McpServer,
  deps: DatasetResourceDeps,
  logger: Logger
): void {
  const log = logger.child('resources');

  // -----------------------------------------------------------------------
  // Sequential dataset content
  // zos-ds://{system}/{dsn}
  // -----------------------------------------------------------------------
  server.registerResource(
    'Dataset Content',
    new ResourceTemplate('zos-ds://{system}/{dsn}', { list: undefined }),
    {
      description:
        'Content of a sequential z/OS dataset. ' +
        'Provide the system hostname and fully-qualified dataset name.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const system = variables.system as string;
      const dsn = (variables.dsn as string).toUpperCase();
      log.info('Reading dataset resource', { system, dsn });

      const result = await deps.backend.readDataset(system, dsn);
      const mimeType = inferMimeType(result.text);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType,
            text: result.text,
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // PDS/PDSE member content
  // zos-ds://{system}/{dsn}({member})
  // -----------------------------------------------------------------------
  server.registerResource(
    'Member Content',
    new ResourceTemplate('zos-ds://{system}/{dsn}({member})', { list: undefined }),
    {
      description:
        'Content of a PDS/PDSE member on z/OS. ' +
        'Provide the system hostname, dataset name, and member name.',
      mimeType: 'text/plain',
    },
    async (uri, variables) => {
      const system = variables.system as string;
      const dsn = (variables.dsn as string).toUpperCase();
      const member = (variables.member as string).toUpperCase();
      log.info('Reading member resource', { system, dsn, member });

      const result = await deps.backend.readDataset(system, dsn, member);
      const mimeType = inferMimeType(result.text);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType,
            text: result.text,
          },
        ],
      };
    }
  );
}
