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
 * MCP prompts for improving the Zowe MCP server experience in repositories that use it.
 *
 * Prompt names use camelCase per VS Code MCP naming conventions.
 * They appear as slash commands in chat (e.g. /mcp.zowe.reflectZoweMcp).
 *
 * These prompts are intended for use in other repositories (not the zowe-mcp repo).
 * When invoked, the AI is asked to reflect and create/update AGENTS.md and
 * ZOWE_MCP_SUGGESTIONS.md in the current workspace.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Logger } from '../log.js';

const REFLECT_MESSAGE =
  'Reflect on your experience using the Zowe MCP server and z/OS in this repository, then produce the requested artifacts.\n\n' +
  '1. **Learnings**: List all your learnings about z/OS and the Zowe MCP server (tools, data sets, systems, pagination, context, etc.).\n\n' +
  '2. **Struggles**: What did you struggle with? What was confusing, error-prone, or missing?\n\n' +
  '3. **Suggestions**: What are your suggestions to make the MCP server easier to understand and use?\n\n' +
  '4. **Artifacts**: Create or update the following in the **current repository** (this workspace):\n' +
  '- **AGENTS.md** — Update or create this file so it helps future agents use the Zowe MCP server better and understand the environment (e.g. system/connection context, data set naming, pagination, which tools to use when).\n' +
  '- **ZOWE_MCP_SUGGESTIONS.md** — Create or update this markdown file at the repository root with your concrete improvement suggestions (learnings, struggles, and suggestions for the Zowe MCP server). Use this filename exactly.';

/**
 * Registers improvement-related prompts on the given MCP server.
 * These prompts do not require a z/OS backend and are always available.
 */
export function registerImprovementPrompts(server: McpServer, logger: Logger): void {
  const log = logger.child('prompts');

  server.registerPrompt(
    'reflectZoweMcp',
    {
      title: 'Reflect and improve Zowe MCP',
      description:
        'Reflect on z/OS and Zowe MCP usage in this repo: list learnings, struggles, and suggestions. ' +
        'Then create or update AGENTS.md and ZOWE_MCP_SUGGESTIONS.md in the current repository to help future agents and capture improvement ideas.',
      argsSchema: {},
    },
    () => {
      log.info('reflectZoweMcp prompt called');

      return Promise.resolve({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: REFLECT_MESSAGE,
            },
          },
        ],
      });
    }
  );
}
