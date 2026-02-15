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
 * MCP prompts for z/OS dataset workflows.
 *
 * Prompt names use camelCase per VS Code MCP naming conventions.
 * They appear as slash commands in chat (e.g. `/mcp.zowe.reviewJcl`).
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Logger } from '../log.js';
import type { ZosBackend } from '../zos/backend.js';
import { resolveDsn } from '../zos/dsn.js';
import type { SessionState } from '../zos/session.js';

/** Dependencies injected into prompt registration. */
export interface DatasetPromptDeps {
  backend: ZosBackend;
  sessionState: SessionState;
}

/**
 * Registers dataset-related prompts on the given MCP server.
 */
export function registerDatasetPrompts(
  server: McpServer,
  deps: DatasetPromptDeps,
  logger: Logger
): void {
  const log = logger.child('prompts');

  // -----------------------------------------------------------------------
  // reviewJcl
  // -----------------------------------------------------------------------
  server.registerPrompt(
    'reviewJcl',
    {
      title: 'Review JCL',
      description:
        'Read a JCL member and analyze it for common issues, ' +
        'suggest improvements, and explain what the job does.',
      argsSchema: {
        dataset: z
          .string()
          .describe('JCL dataset name (relative or absolute with single quotes).'),
        member: z.string().optional().describe('JCL member name (for PDS/PDSE datasets).'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dataset, member, system }) => {
      log.info('reviewJcl prompt called', { dataset, member, system });

      const systemId = deps.sessionState.requireSystem(system);
      const prefix = deps.sessionState.getDsnPrefix(systemId);
      const resolved = resolveDsn(dataset, prefix, member);

      const result = await deps.backend.readDataset(systemId, resolved.dsn, resolved.member);

      const dsLabel = resolved.member ? `${resolved.dsn}(${resolved.member})` : resolved.dsn;

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Please review the following JCL from ${dsLabel} on ${systemId}.\n\n` +
                'Analyze it for:\n' +
                '1. Common JCL errors (missing DD statements, incorrect PGM names, bad COND parameters)\n' +
                '2. Performance issues (unnecessary steps, inefficient SPACE allocations)\n' +
                '3. Best practices (job card conventions, NOTIFY, MSGCLASS settings)\n' +
                '4. Security concerns (hardcoded passwords, excessive permissions)\n' +
                '5. Explain what each step does and the overall purpose of the job\n\n' +
                '```jcl\n' +
                result.text +
                '\n```',
            },
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // explainDataset
  // -----------------------------------------------------------------------
  server.registerPrompt(
    'explainDataset',
    {
      title: 'Explain Dataset',
      description:
        'Get attributes and sample content of a dataset, then explain ' +
        'its purpose, structure, and how it fits into the system.',
      argsSchema: {
        dataset: z.string().describe('Dataset name (relative or absolute with single quotes).'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dataset, system }) => {
      log.info('explainDataset prompt called', { dataset, system });

      const systemId = deps.sessionState.requireSystem(system);
      const prefix = deps.sessionState.getDsnPrefix(systemId);
      const resolved = resolveDsn(dataset, prefix);

      const attrs = await deps.backend.getAttributes(systemId, resolved.dsn);

      // Try to get sample content
      let sampleContent = '';
      try {
        if (attrs.dsorg === 'PO' || attrs.dsorg === 'PO-E') {
          const members = await deps.backend.listMembers(systemId, resolved.dsn);
          if (members.length > 0) {
            const firstMember = members[0].name;
            const memberContent = await deps.backend.readDataset(
              systemId,
              resolved.dsn,
              firstMember
            );
            sampleContent =
              `\nSample content (first member: ${firstMember}):\n` +
              '```\n' +
              memberContent.text.slice(0, 2000) +
              (memberContent.text.length > 2000 ? '\n... (truncated)' : '') +
              '\n```';
          }
        } else {
          const content = await deps.backend.readDataset(systemId, resolved.dsn);
          sampleContent =
            '\nSample content:\n```\n' +
            content.text.slice(0, 2000) +
            (content.text.length > 2000 ? '\n... (truncated)' : '') +
            '\n```';
        }
      } catch {
        sampleContent = '\n(Could not read sample content)';
      }

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Please explain the z/OS dataset ${resolved.dsn} on ${systemId}.\n\n` +
                'Dataset attributes:\n' +
                '```json\n' +
                JSON.stringify(attrs, null, 2) +
                '\n```' +
                sampleContent +
                '\n\nPlease explain:\n' +
                '1. What is the purpose of this dataset based on its name and content?\n' +
                '2. What type of data does it contain (COBOL source, JCL, copybooks, data, etc.)?\n' +
                '3. How does it relate to other datasets in the same HLQ?\n' +
                '4. What are the key attributes (record format, record length) and why?\n' +
                '5. Any observations about the content structure or conventions used?',
            },
          },
        ],
      };
    }
  );

  // -----------------------------------------------------------------------
  // compareMembers
  // -----------------------------------------------------------------------
  server.registerPrompt(
    'compareMembers',
    {
      title: 'Compare Members',
      description:
        'Read two PDS/PDSE members and compare them, explaining ' +
        'the differences and their significance.',
      argsSchema: {
        dataset: z
          .string()
          .describe('PDS/PDSE dataset name (relative or absolute with single quotes).'),
        member1: z.string().describe('First member name to compare.'),
        member2: z.string().describe('Second member name to compare.'),
        system: z
          .string()
          .optional()
          .describe('Target z/OS system hostname. Defaults to the active system.'),
      },
    },
    async ({ dataset, member1, member2, system }) => {
      log.info('compareMembers prompt called', { dataset, member1, member2, system });

      const systemId = deps.sessionState.requireSystem(system);
      const prefix = deps.sessionState.getDsnPrefix(systemId);
      const resolved = resolveDsn(dataset, prefix);

      const [content1, content2] = await Promise.all([
        deps.backend.readDataset(systemId, resolved.dsn, member1.toUpperCase()),
        deps.backend.readDataset(systemId, resolved.dsn, member2.toUpperCase()),
      ]);

      return {
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text:
                `Please compare these two members from ${resolved.dsn} on ${systemId}.\n\n` +
                `**Member 1: ${member1.toUpperCase()}**\n` +
                '```\n' +
                content1.text +
                '\n```\n\n' +
                `**Member 2: ${member2.toUpperCase()}**\n` +
                '```\n' +
                content2.text +
                '\n```\n\n' +
                'Please:\n' +
                '1. Identify and explain the key differences between the two members\n' +
                '2. Highlight any additions, deletions, or modifications\n' +
                '3. Explain the significance of each difference\n' +
                '4. Note any potential issues introduced by the changes\n' +
                '5. Suggest which version is preferred and why (if applicable)',
            },
          },
        ],
      };
    }
  );
}
