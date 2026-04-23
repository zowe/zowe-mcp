# TLS certificates (local dev)

Nginx, Keycloak, and the **local MCP registry** HTTPS front all read **`cert.pem`** and **`key.pem`** in this directory (PEM format). Those two names are usually **symlinks** to the leaf files [mkcert](https://github.com/FiloSottile/mkcert) writes when you generate **one** certificate that covers every dev hostname — **including the registry** — so we do not maintain a separate “MCP + Keycloak only” mkcert story.

Generate (from repo root or this directory):

```bash
mkcert -install
cd docker/remote-https-dev/certs
mkcert zowe.mcp.example.com keycloak.mcp.example.com registry.mcp.example.com localhost 127.0.0.1 ::1
```

mkcert prints new filenames each run. With that SAN list, the leaf and key are typically named like **`./zowe.mcp.example.com+5.pem`** and **`./zowe.mcp.example.com+5-key.pem`** (the **`+N`** reflects how many names are in the certificate, not a version you choose — your **`N`** may differ after another run).

Point **`cert.pem`** and **`key.pem`** at that pair:

```bash
ln -sf zowe.mcp.example.com+5.pem cert.pem
ln -sf zowe.mcp.example.com+5-key.pem key.pem
```

Replace **`+5`** with the filenames mkcert printed. **`cert.pem` is not updated automatically** — if you run **`mkcert`** again, refresh the symlinks.

Confirm SANs:

```bash
openssl x509 -in cert.pem -noout -text | grep DNS
```

If several **`zowe.mcp.example.com+*.pem`** files exist, pick the leaf whose SANs include **`keycloak.mcp.example.com`** and **`registry.mcp.example.com`** (non-key files only):

```bash
for f in zowe.mcp.example.com+*.pem; do
  [ -f "$f" ] || continue
  case "$f" in *-key.pem) continue ;; esac
  openssl x509 -in "$f" -noout -text 2> /dev/null | grep -q "DNS:keycloak.mcp.example.com" && echo "candidate: $f"
done
```

These files are gitignored (`*.pem`).

## After you change `cert.pem` / `key.pem` or point symlinks at a new `+N` leaf

Containers do not pick up new TLS material automatically:

- **Keycloak** loads HTTPS keystore at process start. **Recreate** the service after updating files on disk.
- **nginx** (MCP and optional registry HTTPS) loads certs when the master starts; **recreate** the nginx container or reload nginx (**`nginx -s reload`**) inside it.

From the **repository root** (adjust paths if you use a different compose project):

```bash
docker compose -f docker/remote-dev/docker-compose.yml -f docker/remote-https-dev/docker-compose.keycloak-native-tls.yml up -d --force-recreate keycloak
docker compose -f docker/remote-https-dev/docker-compose.yml up -d --force-recreate nginx-mcp-tls
```

If you use the **local MCP registry** HTTPS nginx:

```bash
docker compose -f infrastructure/local-registry/docker-compose.yml up -d --force-recreate nginx-registry-tls
```

**Why:** Older setups bind-mounted **`cert.pem`** and **`key.pem`** as **single files**. Docker pins the **host inode** at container create time; changing a symlink to a new mkcert leaf can leave Keycloak serving the **previous** certificate until **`--force-recreate`**. Keycloak now mounts the **whole** TLS directory (same idea as MCP nginx) so symlinks resolve inside the mount — you still **recreate** Keycloak after a swap so the JVM reloads TLS.

## Keycloak native HTTPS (`npm run start:remote-https-dev-native-zos`)

The Keycloak container runs as **uid 1000** and needs to **read** the mounted **`key.pem`** and **`cert.pem`**. If **`key.pem`** is mode **600** and owned only by your user, Keycloak may not open HTTPS on **8443** (host **18443** looks dead; `curl` → connection refused). For local dev only: **`chmod a+r key.pem cert.pem`** (see **`../README.md`**).
