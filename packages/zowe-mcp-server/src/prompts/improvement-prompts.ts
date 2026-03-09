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

/**
 * Builds the reflection prompt text. Injects client (IDE) info when available.
 * The agent is instructed to add Client and Model (or N/A) in the doc itself—no user input asked.
 */
function buildReflectMessage(clientLine: string): string {
  return (
    'Reflect on your experience using the Zowe MCP server and z/OS in this repository, then produce the requested artifacts.\n\n' +
    (clientLine
      ? `**Context (use this when writing ZOWE_MCP_SUGGESTIONS.md):** ${clientLine}\n\n`
      : '') +
    '1. **Learnings**: List all your learnings about z/OS and the Zowe MCP server (tools, data sets, systems, pagination, context, etc.).\n\n' +
    '2. **Struggles**: What did you struggle with? What was confusing, error-prone, or missing?\n\n' +
    '3. **Suggestions**: What are your suggestions to make the MCP server easier to understand and use?\n\n' +
    '4. **Artifacts**: Create or update the following in the **current repository** (this workspace):\n' +
    '- **AGENTS.md** — Update or create this file so it helps future agents use the Zowe MCP server better and understand the environment (e.g. system/connection context, data set naming, pagination, which tools to use when).\n' +
    '- **ZOWE_MCP_SUGGESTIONS.md** — Create or update this markdown file at the repository root with your concrete improvement suggestions. Use this filename exactly.\n\n' +
    '**Attribution:** In every section you write in ZOWE_MCP_SUGGESTIONS.md, include at the start: **Client:** (use the Context above if provided, otherwise write N/A) and **Model:** (your model name if you know it, e.g. Claude 3.5, GPT-4; otherwise write N/A). Do not ask the user—fill this in yourself.\n\n' +
    '**When ZOWE_MCP_SUGGESTIONS.md already exists:** Read it first. Append a **new section** with a clear heading that includes the date (e.g. "## 2025-02-26"). ' +
    'In that section, add Client and Model as above, then your learnings, struggles, and suggestions. At the end of the section, optionally add a short "Agreement/conflict with prior feedback" line if your suggestions align or conflict with earlier sections. ' +
    'This keeps a history of feedback from different runs and models while allowing consolidation later.'
  );
}

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
      const clientInfo = server.server.getClientVersion();
      const clientLine =
        clientInfo?.name && clientInfo?.version
          ? `MCP client: ${clientInfo.name} ${clientInfo.version}.`
          : clientInfo?.name
            ? `MCP client: ${clientInfo.name}.`
            : '';
      log.info('reflectZoweMcp prompt called', {
        clientName: clientInfo?.name,
        clientVersion: clientInfo?.version,
      });

      const text = buildReflectMessage(clientLine);
      return Promise.resolve({
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text,
            },
          },
        ],
      });
    }
  );
}
