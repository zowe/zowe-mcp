# Plan: MCP icons for tools, prompts, and resources

This document captures design and implementation notes for adopting
[MCP icons](https://modelcontextprotocol.io/specification/2025-11-25/basic/index#icons)
on the Zowe MCP server when the ecosystem is ready. **No implementation work**
should proceed until **`@modelcontextprotocol/sdk` releases support for `icons`**
on the server APIs and includes them in protocol responses (for example
`tools/list`). Do not ship forked or locally patched SDK tarballs for this
feature alone.

## Goals

- Surface **icons** on MCP **tools**, and where the spec and clients support
  them, on **prompts**, **resources**, and the **server** descriptor so VS Code
  / Copilot and other clients can show consistent, meaningful imagery.
- Prefer semantics aligned with VS Code / **Codicon** vocabulary where
  documented (for example read vs search vs terminal vs list) so choices feel
  familiar to users already using MCP in VS Code.
- Keep icons **small and cache-friendly**: prefer inline **`data:`** SVG or PNG
  URIs (as allowed by the spec) unless the team later standardizes on hosted
  assets.

## Specification and client behavior

- Icons are optional metadata with `src` (URI), optional `mimeType`, and
  optional `sizes` / theme hints per the MCP spec (see link above).
- VS Code’s MCP developer documentation describes **`icons`** on tools and
  resources and notes that **`data:`** URIs work across transports; **`_meta`**
  is not the documented replacement for the top-level `icons` field for those
  surfaces.

## Current blocker (TypeScript SDK)

As of the SDK versions used in this monorepo (`@modelcontextprotocol/sdk` on
npm), **`registerTool`** / **`tools/list`** wiring does **not** yet expose an
`icons` field in the TypeScript server API or emit `icons` on listed tools.
Upstream discussion and proposed changes are tracked in the MCP TypeScript SDK
repository (for example
[typescript-sdk#1864](https://github.com/modelcontextprotocol/typescript-sdk/issues/1864)
and related PRs such as **#1934** / **#1977** — links may move as issues close).

**Policy for this repo:** wait for an **official npm release** that:

1. Extends server registration types with `icons?: Icon[]` (or equivalent).
2. Serializes `icons` on **`tools/list`** (and any other list endpoints that
   should carry icons per spec).

Only then implement icons in Zowe MCP without maintaining a fork or one-off
`resources/*.tgz` override.

## Implementation outline (when the SDK supports icons)

These steps are intentionally high-level; exact types and call sites will match
 whatever the released SDK exports.

1. **Dependency** — Bump **`packages/zowe-mcp-server/package.json`** (and lockfile)
   to the released SDK version that includes icons; run full test and pack
   pipelines.

2. **Icon set** — Decide on a single approach:
   - **Inline `data:image/svg+xml;base64,...` (or URL-encoded)** icons generated
     once at build time or from a small `icons/` asset folder; or
   - Curated subset of **VS Code Codicon** paths if clients document stable
     `vscode-resource:` or equivalent patterns (prefer spec-safe `data:` if in
     doubt).

3. **Semantic mapping** — Maintain a small table (module or JSON) mapping Zowe
   MCP **tool categories** to icon candidates, for example:
   - Context / server info → `info` / `organization`
   - Lists / catalogs → `list-unordered` / `folder`
   - Read content → `book` / `file`
   - Search → `search`
   - Write / mutate → `save` / `edit`
   - Jobs / JCL → `rocket` / `json`
   - USS / shell → `terminal` (align with `runSafeUssCommand` feel)
   - Destructive / execute-tier tools → icons that read as **caution** without
     duplicating MCP `destructiveHint` semantics (hints remain authoritative).

4. **Where to attach icons in code**
   - **`registerTool`** calls in `packages/zowe-mcp-server/src/tools/**` — pass
     `icons` from the mapping (after capability filter wraps registration, if
     the released SDK applies icons at the outer registration layer; follow
     upstream examples).
   - **CLI bridge** — `packages/zowe-mcp-server/src/tools/cli-bridge/` generated
     or YAML-driven tools may need optional `icons` in plugin YAML or a default
     derived from `resourceEffectLevel` / command group.
   - **Prompts and resources** — add when both spec and SDK expose stable fields;
     align with `docs/mcp-reference.md` / `generate-docs` if icons appear there.

5. **Capability tiers** — Icons are presentation only; they must **not** replace
   `resourceEffectLevel` or capability-tier filtering. If some tools are hidden at
   a tier, only registered tools need icons.

6. **Documentation** — Regenerate `docs/mcp-reference.md` if the generator can
   surface icon metadata; otherwise mention icons in README or MCP setup guides
   briefly.

## Testing checklist (post-SDK)

- **MCP Inspector** — `tools/list` payload includes `icons` for at least one
  representative tool; URI loads in the browser context if applicable.
- **VS Code** — Tools for Zowe MCP appear with icons in the tools UX where the
  client supports it; regression-test Cursor dual registration if behavior
  differs.
- **stdio and HTTP** — Smoke-test both transports if icon serialization paths
  differ (they should not for JSON-RPC fields once supported).

## Related work to avoid revisiting

- **Patches / local `npm pack` SDK tarballs** for icons are **out of scope**
  until upstream ships support; they increase security, supply-chain, and CI
  maintenance burden without a durable API contract.
- **Registry** — Normal `npm install` from Zowe Artifactory (or corporate mirror)
  remains the only supported path for `@modelcontextprotocol/sdk`.

## References

- MCP spec — icons: `https://modelcontextprotocol.io/specification/2025-11-25/basic/index#icons`
- VS Code MCP extension guides — search for “icons” in current MCP developer
  documentation for tools/resources.
- Zowe MCP server registration — `packages/zowe-mcp-server/src/server.ts` and
  component `register*Tools` patterns described in `AGENTS.md`.
