# MCP safety and security principles (Zowe MCP)

This document adapts general MCP safety and security ideas to **Zowe MCP**: an MCP server that exposes z/OS-oriented tools (data sets, jobs, USS, TSO, local file bridge, and context) over **stdio** or **HTTP (Streamable)**, with optional **JWT validation** at the HTTP layer and **separate SSH credentials** for the native (Zowe Remote SSH) backend.

For how identity and secrets actually work in this project, see [mcp-authentication-oauth.md](./mcp-authentication-oauth.md), [future-zos-identity-mapping.md](./future-zos-identity-mapping.md), and [AGENTS.md](../AGENTS.md). For registry and remote HTTP topology, see [remote-http-mcp-registry.md](./remote-http-mcp-registry.md).

**Implementation status** (what exists in the product today vs gaps, and what is planned in-repo) is summarized in [§10](#10-implementation-status-in-zowe-mcp). Planned Zowe MCP work for addressable gaps is tracked in [TODO.md](../TODO.md) under **MCP safety & security**.

---

## 1. Safety vs. security — a critical distinction

**Safety** is about preventing accidental harm: a user or agent does the wrong thing by mistake. **Security** is about defending against deliberate threats: unauthorized actors exploit the system on purpose.

In the context of Zowe MCP and LLM agents:

- **Safety example:** VS Code’s MCP confirmation flow, or Zowe MCP’s **pattern-based command gates** (`runSafeTsoCommand`, `runSafeUssCommand`), catch or elicit approval before a risky TSO/USS command runs. That reduces accidental damage when the model “meant well.”
- **Security example:** The SSH principal used by the server **cannot** alter production catalog entries or purge system data sets because **SAF** denies it—through resource profiles and related controls—regardless of what the model asks for.

Safety is a net. Security is the fence. You need both, but you must not mistake one for the other.

---

## 2. When safety mechanisms are not enough

Safety layers—prompt filters, output guards, client approval dialogs, and server-side “safe command” lists—can be fragile. They may be bypassed by prompt injection, novel client behavior, or unexpected inputs. Ecosystem incidents (for example, public-repo content influencing an agent with access to private resources) illustrate a recurring lesson: **if an operation is catastrophic, the agent path should not have the authority to perform it**, not merely be discouraged.

For Zowe MCP specifically:

- **Client hints** (`readOnlyHint`, `destructiveHint` on tools) improve UX in supporting hosts; they are **not** a cryptographic boundary.
- **TSO/USS “safe lists”** (`tso-command-patterns.json`, USS hard-stop / sensitivity evaluation) are **policy in code**, not a substitute for z/OS security administration.
- **Tool-call logging** (`ZOWE_MCP_LOG_TOOL_CALLS`, `CreateServerOptions.logToolCalls`) aids audit and debugging; it does not prevent abuse and may capture sensitive arguments—treat retention and access accordingly.

The durable lesson: combine product-side safety with **least-privilege service accounts**, **network placement**, and **platform controls** on z/OS.

---

## 3. Least privilege applied to agents and to Zowe MCP

Agents should only receive access needed for the task. Apply least privilege at several layers:

| Layer | Zowe MCP relevance |
| --- | --- |
| **z/OS credentials** | Prefer a **dedicated SSH user** with narrow data set / USS / job profiles over a personal ID with broad ALTER and special attributes. The server resolves passwords/keys via env (`ZOWE_MCP_CREDENTIALS`, `ZOWE_MCP_PASSWORD_*`), Vault KV, Kubernetes secrets, MCP elicitation, or (HTTP + JWT) per-tenant connection storage—not from the OAuth token by default. |
| **OAuth / HTTP** | JWT validation (`ZOWE_MCP_JWT_ISSUER`, `ZOWE_MCP_JWKS_URI`, optional audience) answers “who may call this MCP HTTP API?” It does **not** replace SSH user authority on the mainframe. See [mcp-authentication-oauth.md](./mcp-authentication-oauth.md). |
| **Tool exposure** | MCP today surfaces **one flat tool list** per server instance. Zowe MCP does not ship **scope-based tool hiding** tied to OAuth claims; operational mitigations are architectural (see §5–§6). |
| **Data scope** | Restrict which systems appear in config (`--system` / `--config`, VS Code `zoweMCP.nativeConnections`, tenant `addZosConnection`). Consider HLQ / path conventions and SAF resource profiles so even a confused agent cannot name arbitrary high-impact objects. |
| **Local file bridge** | Workspace-relative operations use MCP `roots/list` when available, or `ZOWE_MCP_WORKSPACE_DIR`, `ZOWE_MCP_LOCAL_FILES_ROOT`, or `--local-files-root`. Misconfiguration here expands blast radius to the IDE host. |

Least privilege limits **blast radius** whether the failure mode is accident or exploitation.

---

## 4. Sub-agent architecture (defense in depth)

Splitting work across specialized agents with different credentials or tool access is a **defense-in-depth** pattern that complements Zowe MCP:

- A **reader agent** uses read-only patterns on z/OS (or mock) and never receives job-submit or delete tools if your deployment can split servers or configs.
- A **validator agent** proposes JCL or data set changes as text for human review without holding submit/delete authority.
- A **writer agent** uses narrowly scoped credentials only after review.

Each boundary is an audit point. Zowe MCP does not enforce this topology; orchestration and credential separation are **operator choices**—often the right ones for production.

---

## 5. MCP tool grouping and the ecosystem gap

The MCP protocol does not standardize **risk tiers**, **tool groups**, or **per-token tool visibility**. Many clients show all registered tools at once.

Practical mitigations that apply to Zowe MCP:

- **Separate MCP server instances or configs** per sensitivity tier (e.g., read-only mock lab vs. native production).
- **Client / gateway allowlists** where the product supports them (enterprise MCP registry posture, `chat.mcp.access`, org policies—see [mcp-authentication-oauth.md](./mcp-authentication-oauth.md) and [mcp-registry-research.md](./mcp-registry-research.md)).
- **Reverse proxy or sidecar** filtering of `tools/call` (advanced; must not break session semantics).

None of these is a complete, portable, multi-dimensional model; the gap is **ecosystem-wide**, not specific to Zowe MCP.

---

## 6. OAuth scope filtering — pattern for shared HTTP deployments

The **GitHub MCP server** illustrates tying **tool registration or visibility** to **OAuth scopes**: read-only token holders may never see destructive tools, which reduces planner attack surface and accidental calls.

**Zowe MCP today:** HTTP mode can validate **Bearer JWTs** as a resource server, but **does not** map custom OAuth scopes to subsets of Zowe MCP tools. JWT `sub` (and optional claims) primarily support **multi-session identity** and **tenant-scoped connection persistence** (`ZOWE_MCP_TENANT_STORE_DIR`), not per-scope tool filtering.

**If you adopt this pattern for Zowe MCP in the future**, scopes might express capability tiers or namespaces, for example:

- `zowemcp:datasets:read` vs `zowemcp:datasets:write` vs `zowemcp:datasets:delete`
- `zowemcp:jobs:submit`, `zowemcp:uss:exec`, etc.

Runtime behavior could mirror GitHub MCP: **hide** tools at discovery time when claims are static, or **challenge** for additional consent when the client supports incremental authorization.

**Critical caveat (unchanged):** OAuth scopes define what the **MCP HTTP layer** allows. They do **not** replace **SAF / USS ACLs / scheduler security** on z/OS. A token with a hypothetical `zowemcp:datasets:write` scope can still only change what the **SSH user** is permitted to change.

---

## 7. Progressive safety configuration (proposed for stdio / local use)

The following **capability-level** model is **not implemented as a single product knob** in Zowe MCP today (see [§10](#10-implementation-status-in-zowe-mcp)). It is a **reasonable operator pattern** for teams that want explicit safety rails while experimenting—especially when personal credentials are broader than the task requires. **Planned implementation** is the first item under **MCP safety & security** in [TODO.md](../TODO.md).

### Capability levels (conceptual)

| Level | Name | Intent |
| --- | --- | --- |
| 1 | Read-only, explicit | Read operations only; combine with client confirmations or human-in-the-loop workflows. |
| 2 | Read-only, auto | Read operations without per-call approval; still bounded by z/OS profiles. |
| 3 | Update | Read + create/update existing user-owned objects. |
| 4 | Delete | Adds deletion (data sets, USS objects, jobs as supported). |
| 5 | Execute | Full operational surface including job submission, TSO/USS command tools, and other state-changing paths. |

Levels are cumulative. In the absence of native server support, approximate them with **separate service accounts**, **mock mode** for learning, and **client-side tool restrictions** where available.

### Functional scoping (second dimension)

Restrict which **domains** an agent needs: data sets only, jobs only, USS only, etc. Today that implies **not registering** unwanted surfaces—which in practice means **process / config separation** (different server flags or different `mcp.json` entries), not an in-server “datasets-only” flag.

### Data scope (third dimension)

Even with broad tools, **naming and security rules** on z/OS should keep agents in-lane: HLQ prefixes, catalog search restrictions, USS path roots, job class limits, etc.

---

## 8. What progressive configuration is and is not

A progressive configuration story is primarily **safety guidance and onboarding discipline**. It helps first-time users avoid accidental damage and build intuition before widening scope.

It is **not** a replacement for:

- **System-level access controls** (SAF, USS ACLs, scheduler exits)
- **Credential lifecycle** (rotation, vault policies, no long-lived personal passwords in shared HTTP pods)
- **Audit, SIEM, and compliance** evidence
- **Threat modeling** for shared HTTP endpoints (TLS, JWT validation, rate limits, tenant store encryption via `ZOWE_MCP_TENANT_STORE_KEY`, etc.)

### Onboarding problem it addresses

Teams often start with **broad personal credentials** before security approves a service account. Voluntary constraints (mock backend, narrow bootstrap `--config`, dedicated low-privilege SSH user) bridge the gap until **real** controls are in place.

---

## 9. Both layers working together (Zowe MCP)

The robust posture combines:

1. **MCP / product layer** — Clear tool semantics, hints for hosts, command safety evaluation, optional JWT at HTTP, careful logging, tenant isolation for saved connections, and (when available) scope- or gateway-based **tool visibility**.
2. **z/OS and infrastructure layer** — SSH user with minimal rights, network segmentation, secrets management (Vault / K8s / elicitation policy), SMF and platform audit, and mainframe security rules that **enforce** the real boundary.

The configuration layer guides what the agent *should* do. **SAF** ensures it *cannot* do more than the platform allows—**even if** the MCP layer or the model fails.

---

## 10. Implementation status in Zowe MCP

This section states **explicitly** what this repository already provides versus what the earlier sections describe as patterns, ecosystem gaps, or **planned** product work.

### Implemented today (Zowe MCP)

| Area | What exists |
| --- | --- |
| **Transports** | stdio and Streamable HTTP; optional JWT validation for HTTP (`ZOWE_MCP_JWT_ISSUER`, `ZOWE_MCP_JWKS_URI`, optional audience). |
| **Identity vs z/OS access** | Bearer token identifies the MCP HTTP caller; **z/OS access uses SSH** and separate credential resolution (env, Vault, elicitation, tenant store)—not the OAuth password. See [mcp-authentication-oauth.md](./mcp-authentication-oauth.md). |
| **Multi-user HTTP** | Per-tenant connection persistence and isolation when JWT + `ZOWE_MCP_TENANT_STORE_DIR` are set; optional encrypt-at-rest (`ZOWE_MCP_TENANT_STORE_KEY`). |
| **Tool hints** | `readOnlyHint` / `destructiveHint` on tools for supporting MCP clients (UX, not enforcement). |
| **Command safety** | Pattern-based evaluation for TSO and USS command tools (`tso-command-patterns.json`, USS path/command gates); block vs elicit vs allow paths. |
| **Audit / debug** | Optional full tool-call logging (`ZOWE_MCP_LOG_TOOL_CALLS` / `CreateServerOptions.logToolCalls`)—operational risk if secrets appear in arguments. |
| **Backend choice** | Mock filesystem backend vs native (Zowe Remote SSH) to limit real system exposure during learning or CI. |
| **Local file bridge** | Paths constrained via MCP `roots/list` or `ZOWE_MCP_WORKSPACE_DIR`, `ZOWE_MCP_LOCAL_FILES_ROOT`, `--local-files-root`. |

### Not implemented (product gaps called out in this document)

These are **not** provided as first-class Zowe MCP features today. Some are **in scope for the product** and listed in [TODO.md](../TODO.md) (**MCP safety & security**); others stay **operator-only** or depend on external systems.

| Topic | In Zowe MCP today | Notes |
| --- | --- | --- |
| **Progressive capability levels** (§7) | No single cumulative tier (1–5) controlling which tools register or run | **Planned first** — [TODO.md](../TODO.md) |
| **OAuth / JWT scope → tool list** (§6) | JWT validates caller identity; **no** mapping from token scopes/claims to subsets of tools | Planned — [TODO.md](../TODO.md) |
| **In-server functional scoping** (§7) | No “datasets-only / jobs-only / USS-only” switch on one server process | Planned — [TODO.md](../TODO.md) |
| **In-server data scope policy** (§7) | No built-in HLQ or USS path allowlist enforced in tool handlers | Planned — [TODO.md](../TODO.md) |
| **MCP-standard risk tiers / portable tool groups** (§5) | Ecosystem limitation; Zowe MCP does not define a protocol-level fix | Track MCP spec; mitigate with separate deployments or gateway (operator). |
| **Sub-agent topology** (§4) | Not enforced; multiple agents/credentials are orchestration outside this server | Operator / platform choice. |
| **Reverse proxy filtering `tools/call`** (§5) | Not part of this package | External deployment pattern. |

Related existing TODO items (overlap): **Configurable safety for TSO/USS/JCL** and **Dev/test vs production system awareness** in [TODO.md](../TODO.md) align with safety themes but are separate from the ordered **MCP safety & security** list.

---

## Quick reference: where to read more

| Topic | Document |
| --- | --- |
| OAuth vs z/OS credentials, Copilot / VS Code | [mcp-authentication-oauth.md](./mcp-authentication-oauth.md) |
| JWT `sub` vs future z/OS identity mapping | [future-zos-identity-mapping.md](./future-zos-identity-mapping.md) |
| Transports, tools, env vars, tenant store | [AGENTS.md](../AGENTS.md) |
| Remote HTTP registry and URLs | [remote-http-mcp-registry.md](./remote-http-mcp-registry.md) |
| Local OIDC lab | [remote-dev-keycloak.md](./remote-dev-keycloak.md), [dev-oidc-tinyauth.md](./dev-oidc-tinyauth.md) |
| Principles in this doc vs product | This doc [§10](#10-implementation-status-in-zowe-mcp), [TODO.md](../TODO.md) |
