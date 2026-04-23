#!/usr/bin/env node
/**
 * Rephrase Tool Descriptions — AI-assisted tool for generating optimized
 * Endevor tool descriptions from CLI text.
 *
 * Reads the plugin YAML, sends each tool's CLI description to an LLM
 * (Gemini or any OpenAI-compatible endpoint), and writes the result back
 * into the `descriptions.optimized` field (or any target variant).
 *
 * Usage:
 *   node scripts/rephrase-tool-descriptions.mjs [options]
 *
 * Options:
 *   --yaml <path>       Path to plugin YAML (default: bundled endevor-tools.yaml)
 *   --model <id>        Model ID from evals.config.json (default: gemini-2.5-flash)
 *   --variant <name>    Description variant to generate (default: optimized)
 *   --source <name>     Source variant to rephrase (default: cli)
 *   --dry-run           Print new descriptions without writing back
 *   --tool <name>       Only rephrase a single tool (by toolName)
 *
 * The script reads evals.config.json from the repo root for model configuration.
 */

import { dump as yamlDump, load as yamlLoad } from 'js-yaml';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);

function getArg(flag, defaultVal) {
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}
function hasFlag(flag) {
  return args.includes(flag);
}

const DEFAULT_YAML = join(
  REPO_ROOT,
  'packages/zowe-mcp-server/src/tools/cli-bridge/endevor-tools.yaml'
);
const yamlPath = resolve(getArg('--yaml', DEFAULT_YAML));
const modelId = getArg('--model', 'gemini-2.5-flash');
const targetVariant = getArg('--variant', 'optimized');
const sourceVariant = getArg('--source', 'cli');
const dryRun = hasFlag('--dry-run');
const singleTool = getArg('--tool', null);

// ---------------------------------------------------------------------------
// Load evals.config.json to find model config
// ---------------------------------------------------------------------------

const evalsConfigPath = join(REPO_ROOT, 'evals.config.json');
let evalsConfig;
try {
  evalsConfig = JSON.parse(readFileSync(evalsConfigPath, 'utf-8'));
} catch {
  console.error('ERROR: Could not read evals.config.json — run from repo root');
  process.exit(1);
}

const models = evalsConfig.models ?? [evalsConfig];
const modelConfig = models.find(m => m.id === modelId || m.serverModel === modelId);
if (!modelConfig) {
  console.error(
    `ERROR: Model '${modelId}' not found in evals.config.json. Available: ${models.map(m => m.id).join(', ')}`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build LLM caller
// ---------------------------------------------------------------------------

async function callLlm(prompt) {
  const { provider, serverModel, baseUrl, apiKey } = modelConfig;

  if (provider === 'gemini') {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY environment variable not set');
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${serverModel}:generateContent?key=${geminiApiKey}`;
    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 1024 },
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }
    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  }

  // OpenAI-compatible (vLLM, LM Studio, etc.)
  const endpoint = `${baseUrl ?? 'http://localhost:1234/v1'}/chat/completions`;
  const body = {
    model: serverModel,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    max_tokens: 1024,
  };
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey && apiKey !== 'no key needed') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`API error ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

// ---------------------------------------------------------------------------
// Rephrase prompt
// ---------------------------------------------------------------------------

function buildRephrasePrompt(toolName, zoweCommand, sourceDesc, contextDesc) {
  return `You are a technical writer rewriting tool descriptions for an AI coding assistant (LLM) that uses MCP (Model Context Protocol) tools.

The tool is an MCP wrapper around a Zowe CLI command for Endevor (a mainframe source code management system).

Tool name: ${toolName}
Zowe CLI command: zowe ${zoweCommand}
Current description: ${sourceDesc}
${contextDesc ? `Context: ${contextDesc}` : ''}

Write a single improved description for this tool following these rules:
1. Start with an ACTION VERB (e.g. "Lists", "Retrieves", "Queries", "Sets")
2. Be concise but COMPLETE — 1-3 sentences max. Every sentence must end with a period.
3. Explain what the tool does and when to use it
4. Mention key parameters only if they are not obvious
5. Do NOT start with "This tool", "For automation", or similar boilerplate
6. Do NOT mention implementation details (CLI, SSH, REST API)
7. Use Endevor terminology naturally (environment, stage, system, subsystem, type, element)
8. IMPORTANT: The description must be a fully complete sentence ending with a period (.).

Respond with ONLY the description text, no JSON, no markdown, no quotes, no bullet points.`;
}

function buildCompletionPrompt(partialDescription) {
  return `The following tool description was cut off mid-sentence. Complete it so it ends with a proper period.

Partial description: ${partialDescription}

Rules:
- Complete ONLY the unfinished sentence — do not rewrite from scratch
- End with a period (.)
- Do NOT add extra sentences beyond completing the current one
- Respond with ONLY the completed full description text, no markdown, no quotes

Completed description:`;
}

// ---------------------------------------------------------------------------
// Output validation and cleanup
// ---------------------------------------------------------------------------

/** Returns true if the text ends with sentence-ending punctuation. */
function isComplete(text) {
  return /[.!?]$/.test(text.trim());
}

/** Strips markdown formatting (bold, italic, backticks) from a string. */
function stripMarkdown(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1') // italic
    .replace(/`(.+?)`/g, '$1') // inline code
    .trim();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Loading YAML from: ${yamlPath}`);
  const rawYaml = readFileSync(yamlPath, 'utf-8');
  const config = yamlLoad(rawYaml);

  const tools = config.tools ?? [];
  const filtered = singleTool ? tools.filter(t => t.toolName === singleTool) : tools;

  if (filtered.length === 0) {
    console.error(`No tools to rephrase (singleTool='${singleTool ?? '(all)'}')`);
    process.exit(1);
  }

  console.log(
    `Model: ${modelConfig.id ?? modelConfig.serverModel} (provider: ${modelConfig.provider})`
  );
  console.log(`Source variant: ${sourceVariant} → target variant: ${targetVariant}`);
  if (dryRun) console.log('[DRY RUN — no file writes]');
  console.log('');

  let updated = 0;

  for (const tool of filtered) {
    const sourceDesc = tool.descriptions?.[sourceVariant];
    if (!sourceDesc) {
      console.warn(`  SKIP ${tool.toolName} — no '${sourceVariant}' description`);
      continue;
    }

    const contextDesc = tool.descriptions?.intent ?? '';
    const prompt = buildRephrasePrompt(tool.toolName, tool.zoweCommand, sourceDesc, contextDesc);

    process.stdout.write(`  Rephrasing ${tool.toolName} ...`);
    try {
      let result = stripMarkdown((await callLlm(prompt)).trim());
      if (!result) {
        console.log(' EMPTY');
        continue;
      }

      // Validate completeness — retry once if truncated
      if (!isComplete(result)) {
        process.stdout.write(' (incomplete, retrying) ...');
        const completionPrompt = buildCompletionPrompt(result);
        const completed = stripMarkdown((await callLlm(completionPrompt)).trim());
        if (completed && isComplete(completed)) {
          result = completed;
        } else if (completed) {
          // Retry returned something but still incomplete — use original + appended period
          console.log(` WARN: still incomplete after retry — appending period`);
          result = result.endsWith('.') ? result : result + '.';
        } else {
          console.log(` WARN: retry returned empty — appending period to original`);
          result = result.endsWith('.') ? result : result + '.';
        }
      }

      console.log(' done');
      console.log(`    → ${result.substring(0, 120)}${result.length > 120 ? '…' : ''}`);

      if (!dryRun) {
        if (!tool.descriptions) tool.descriptions = {};
        tool.descriptions[targetVariant] = result;
        updated++;
      }
    } catch (err) {
      console.log(` ERROR: ${err.message}`);
    }
  }

  if (!dryRun && updated > 0) {
    const newYaml = yamlDump(config, { lineWidth: 200, quotingType: '"', forceQuotes: false });
    writeFileSync(yamlPath, newYaml, 'utf-8');
    console.log(`\nWrote ${updated} optimized descriptions back to ${yamlPath}`);
  } else if (!dryRun) {
    console.log('\nNo descriptions were updated.');
  }
}

main().catch(err => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
