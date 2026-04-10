# TLS certificates (local dev)

Place **`cert.pem`** and **`key.pem`** here (PEM format).

Generate with [mkcert](https://github.com/FiloSottile/mkcert). For **`npm run start:remote-https-dev-native-zos`**, the leaf certificate must include **both** the MCP hostname and the Keycloak hostname in SANs (defaults **`zowe.mcp.example.com`** and **`keycloak.mcp.example.com`**) — nginx uses them for MCP TLS; Keycloak uses the same PEM for its HTTPS listener:

```bash
mkcert -install
cd docker/remote-https-dev/certs
mkcert zowe.mcp.example.com keycloak.mcp.example.com localhost 127.0.0.1 ::1
```

mkcert prints two **new** filenames each run. The **`+N`** in the name is **not** a version you choose — mkcert picks **`N`** from how many subject names are in **that** certificate (and past files in the directory). So **`+3.pem`** might be an older cert with only **`zowe.mcp.example.com`** and **`localhost`**, while a later run with Keycloak might produce **`+4.pem`** (or **`+5.pem`**, etc.). **Do not assume “use +4”** — use the pair mkcert **just printed**, or pick the leaf file whose SANs include **`keycloak.mcp.example.com`**:

```bash
cd docker/remote-https-dev/certs
for f in zowe.mcp.example.com+*.pem; do
  [ -f "$f" ] || continue
  case "$f" in *-key.pem) continue ;; esac
  openssl x509 -in "$f" -noout -text 2>/dev/null | grep -q "DNS:keycloak.mcp.example.com" && echo "includes Keycloak SAN: $f"
done
```

Then point **`cert.pem`** and **`key.pem`** at that leaf and its `*-key.pem` (symlink or copy). **`cert.pem` is not updated automatically** — if you run mkcert again, you **must** replace the symlinks.

```bash
ln -sf zowe.mcp.example.com+4.pem cert.pem
ln -sf zowe.mcp.example.com+4-key.pem key.pem
```

Replace **`+4`** with the filename mkcert printed or the path the loop reported. Confirm: `openssl x509 -in cert.pem -noout -text | grep DNS`.

These files are gitignored (`*.pem`).

## Keycloak native HTTPS (`npm run start:remote-https-dev-native-zos`)

The Keycloak container runs as **uid 1000** and needs to **read** the mounted **`key.pem`** and **`cert.pem`**. If **`key.pem`** is mode **600** and owned only by your user, Keycloak may not open HTTPS on **8443** (host **18443** looks dead; `curl` → connection refused). For local dev only: **`chmod a+r key.pem cert.pem`** (see **`../README.md`**).
