# Remote HTTPS dev — Keycloak native TLS + MCP nginx

This stack uses **TLS in nginx for MCP only** and **TLS inside the Keycloak container** (PEM mounts). HTTP **18080:8080** stays available for **`keycloak-init`** and **`patch-keycloak-mcp-dev-redirects.mjs`** (admin API). Keycloak HTTPS is on host port **`ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT`** (default **18443** → container **8443**).

**Do not** put a second nginx or reverse proxy in front of Keycloak for this profile unless you know you need it — DCR and CORS are tuned for direct Keycloak HTTPS (see below).

## Layout

**`docker/remote-https-dev/`** holds TLS **`certs/`**, the MCP-only **nginx** compose + template, and **`docker-compose.keycloak-native-tls.yml`** (merged with **`docker/remote-dev/docker-compose.yml`** for Keycloak).

## Certificates

Use **`cert.pem`** / **`key.pem`** from **`certs/`** (default **`ZOWE_MCP_TLS_CERT_DIR`** → **`docker/remote-https-dev/certs`**). The leaf must list MCP, Keycloak, and **local MCP registry** hostnames in SANs — see **`certs/README.md`** (mkcert filenames such as **`zowe.mcp.example.com+5.pem`** / **`*-key.pem`**, symlinked to **`cert.pem`** / **`key.pem`**).

## JWT issuer alignment

Access tokens use an **`iss`** that matches the **authorization server URL** used at sign-in. **`ZOWE_MCP_JWT_ISSUER`** must equal that issuer exactly (see server **`bearer-jwt.ts`**). **`npm run start:remote-https-dev-native-zos`** sets **`KC_HOSTNAME`** and JWT env vars from **`https://<Keycloak host>:<bind port>`** (port omitted only when **443**).

If you **change** Keycloak hostname or HTTPS port, obtain a new token (or full browser sign-in) so **`iss`** matches — otherwise you may see **401 JWT issuer mismatch**.

## VS Code: “does not support automatic client registration” (DCR) with native HTTPS

**Cause:** VS Code uses **OIDC Dynamic Client Registration** from an embedded browser. Without CORS on the DCR endpoint, registration fails.

**Fix:** Keycloak **26.5.0+** adds CORS on OIDC DCR endpoints ([keycloak#8863](https://github.com/keycloak/keycloak/issues/8863)). **`docker-compose.keycloak-native-tls.yml`** pins **`image: quay.io/keycloak/keycloak:26.5.0`**. After changing the image, recreate Keycloak (`docker compose … up -d --force-recreate keycloak`).

**Trusted Hosts (DCR `insufficient_scope` / `Host not trusted`):** Re-run **`keycloak-init`** with the same compose merge you use for Keycloak. **`init-keycloak.sh`** uses **host TCP check off** and **client URI allowlist on**; **`trusted-hosts`** includes **Cursor** / VS Code hosts and **`192.168.65.1`**. Details: **`docs/remote-dev-keycloak.md`** (*Dynamic Client Registration*).

**Manual client:** If DCR is not an option, register a client in Keycloak and use Client ID **`demo`** (see **`docs/remote-dev-keycloak.md`** — browser OIDC / Inspector).

## Node.js JWKS

When **`ZOWE_MCP_JWKS_URI`** is **`https://keycloak…`**, Node’s **`fetch`** must trust the mkcert CA. The script sets **`NODE_EXTRA_CA_CERTS`** to **`$(mkcert -CAROOT)/rootCA.pem`** when mkcert is available. Without it, JWKS retrieval may fail.

## Files

| File | Purpose |
| --- | --- |
| **`docker-compose.keycloak-native-tls.yml`** | Merge with **`docker/remote-dev/docker-compose.yml`** — Keycloak **image ≥ 26.5** (DCR CORS), **`KC_HTTPS_*`**, PEM mounts, ports |
| **`docker-compose.yml`** | **MCP-only** nginx (TLS → **`host.docker.internal`** backend) |
| **`default.conf.template`** | MCP **`server { }`** block only |

## Only port `18080` mapped (no `:18443` on the Keycloak container)

`npm run start:remote-https-dev-native-zos` must start Keycloak with **both**:

- `docker/remote-dev/docker-compose.yml`
- `docker/remote-https-dev/docker-compose.keycloak-native-tls.yml`

If you previously ran **`docker compose -f docker/remote-dev/docker-compose.yml up`** without the Keycloak native-TLS merge, the existing Keycloak container may have **only** `18080:8080`. **Recreate** after adding **`docker-compose.keycloak-native-tls.yml`**:

```bash
docker compose -f docker/remote-dev/docker-compose.yml -f docker/remote-https-dev/docker-compose.keycloak-native-tls.yml up -d --force-recreate keycloak
```

**`docker compose run keycloak-init`** must use the **same `-f` merge** as Keycloak itself; otherwise Compose can recreate **`keycloak` from the base file only** and you lose **:8443** (and PEM mounts). The start script passes both compose files to **`run`**.

The start script runs **`docker compose up -d keycloak`**, **waits up to ~30s** for **`docker compose port keycloak 8443`** (avoids a race where a too-early check would wrongly **`--force-recreate`**). Only if **`8443` is still missing** after that does it run **`up -d --force-recreate keycloak`** (needed when an older container was HTTP-only). Plain **`up -d` does not change port bindings** on an already-created container.

The native-TLS override lists **both** `KEYCLOAK_HOST_PORT:8080` and `ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT:8443` so a single-file `ports` replace does not drop HTTP or HTTPS.

## Connection refused on the Keycloak HTTPS port (e.g. `curl` to `:18443`)

The Keycloak image runs as **uid 1000** (`keycloak`). Docker bind mounts keep the host file’s **owner and mode**. A **`key.pem` that is mode `600`** and owned only by your macOS/Linux user is often **not readable** inside the container, so Keycloak **does not start the HTTPS listener** on **8443** and the host mapping (**18443**) has nothing to accept connections → **`curl: (7) Couldn't connect to server`**.

**Fix (local dev only):** make the PEMs readable, then recreate Keycloak:

```bash
chmod a+r docker/remote-https-dev/certs/key.pem docker/remote-https-dev/certs/cert.pem
docker compose -f docker/remote-dev/docker-compose.yml -f docker/remote-https-dev/docker-compose.keycloak-native-tls.yml up -d --force-recreate keycloak
```

`npm run start:remote-https-dev-native-zos` runs a **preflight check** (same image, `cat` the mounted PEMs as uid 1000) and fails fast with this hint if reads would fail.

## Run

From the **repository root**:

```bash
npm run start:remote-https-dev-native-zos
```

First time after adding the native-TLS compose merge, recreate Keycloak so HTTPS env applies:

```bash
docker compose -f docker/remote-dev/docker-compose.yml -f docker/remote-https-dev/docker-compose.keycloak-native-tls.yml up -d --force-recreate keycloak
```

**Ctrl+C** stops MCP and runs **`docker compose -f docker/remote-https-dev/docker-compose.yml down`** (MCP nginx stack only — not Keycloak).

### Environment overrides

| Variable | Default | Purpose |
| --- | --- | --- |
| `KC_HOSTNAME` | `https://keycloak.mcp.example.com:18443` | Public Keycloak HTTPS base (**`docker-compose.keycloak-native-tls.yml`**). Set **`https://hostname`** without **`:port`** when using host port **443**. **`npm run start:remote-https-dev-native-zos`** exports this from host/port env. |
| `ZOWE_MCP_KEYCLOAK_HTTPS_BIND_PORT` | `18443` | Host port for Keycloak HTTPS (maps to **8443** in container) |
| `ZOWE_MCP_KEYCLOAK_HTTPS_HOST` | `keycloak.mcp.example.com` | Hostname in issuer URL and **`KC_HOSTNAME`** |
| `ZOWE_MCP_REGISTRY_HTTPS_HOST` | `registry.mcp.example.com` | Local MCP registry HTTPS front (**`infrastructure/local-registry`**) — must appear as **`DNS:`** in **`cert.pem`** SANs (same mkcert leaf as MCP + Keycloak) |
| `ZOWE_MCP_TLS_CERT_DIR` | *(in compose)* `../remote-https-dev/certs` when unset and merged with **`docker/remote-dev/docker-compose.yml`** — resolves to **`docker/remote-https-dev/certs`** | **`cert.pem`** + **`key.pem`** (often symlinks to **`zowe.mcp.example.com+*.pem`**). Override with an absolute path if needed. |
| `KEYCLOAK_HOST_PORT` | `18080` | Keycloak HTTP (init / admin API) |
| `ZOWE_MCP_MCP_TLS_PORT` | `7542` | MCP HTTPS (nginx) |
| `ZOWE_MCP_HTTP_BACKEND_PORT` | `7543` | Node MCP HTTP |
