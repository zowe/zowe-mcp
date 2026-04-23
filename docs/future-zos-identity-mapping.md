# Future: z/OS identity and OIDC subject mapping

Today, **OIDC `sub`** (and optional `email`) identify the **chat or portal user** at the MCP HTTP layer. **SSH credentials** for z/OS are separate: `ZOWE_MCP_PASSWORD_*`, `ZOWE_MCP_CREDENTIALS`, vault-injected secrets, or prompts—not derived automatically from the JWT.

## How this relates to Zowe API ML OIDC

The Zowe docs topic [**Authenticating with OIDC**](https://docs.zowe.org/stable/extend/extend-apiml/api-mediation-oidc-authentication/) describes the **API Mediation Layer** approach to the same underlying problem: accept OIDC access tokens, validate them (JWKS / `userInfo`), then **map the distributed identity to a z/OS identity** using **SAF/ESM** distributed identity mapping (e.g. RACF `RACMAP`, Top Secret `IDMAP`, ACF2 IDMAP) and the **API ML internal mapper** (or ZSS). When mapping exists, the Gateway can issue **mainframe credentials** (Zowe JWT, SAF IDT, PassTicket) expected by downstream services.

That is **platform-level identity federation** at the gateway. **Zowe MCP today** does not implement that mapping path: it validates JWTs for HTTP tenancy and uses **separate** SSH secrets for z/OS. A future direction could **align** with API ML patterns (same ESM mapping concepts, or MCP as a service **behind** the Gateway so requests inherit API ML’s identity handling)—but that is **not** current MCP scope.

### API ML propagation and ZNP (SSH)

**API ML OIDC / identity propagation does not substitute for SSH authentication to Zowe Remote SSH (ZNP)**. Propagation applies to **HTTP** requests routed through the Gateway (token validation, distributed identity → SAF mapping, mainframe-appropriate credentials for downstream **APIs**). ZNP is reached over **SSH** from the MCP server process; the z/OS side authenticates that **SSH session** (password, key, or other SSH mechanisms)—not the MCP HTTP Bearer token.

Using API ML and ZNP together therefore requires a **separate design** if you want IdP identity, Gateway mapping, and SSH/ZNP to line up—for example explicit mapping of tenant or `sub` to connection specs and secrets, or future product bridges. Nothing in API ML alone turns an OIDC access token into an SSH login for ZNP.

## Direction (not committed product scope)

Where enterprises deploy bridges between corporate identity and the mainframe, a future integration could:

- Map **`sub`** (or a claim) to a **SAF user ID** or **SSH principal** via policy or directory sync—conceptually similar to API ML’s **distributed identity → mainframe user** mapping, but MCP-specific.
- Reduce repeated password elicitation when a trusted mapping exists.
- Align audit trails: “who in IdP” ↔ “who on z/OS” for shared MCP hosts.

## What stays true regardless

- z/OS is **not** a generic OAuth 2.0 Authorization Server in the cloud IdP sense; any mapping runs **outside** the MCP token issuer unless you adopt a federation product (e.g. Keycloak with user federation, IBM Verify, custom bridge services).
- **Zowe MCP** remains an **OAuth2 resource server** for HTTP: it validates access tokens; it does not issue them.

See also: **`AGENTS.md`** (OIDC subject vs z/OS user), **`docs/mcp-authentication-oauth.md`** (HTTP OAuth vs z/OS SSH).
