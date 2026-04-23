# Zowe MCP HTTP + mock backend — install from a pre-built npm pack tarball (bundled dependencies).
#
# Build the tarball on the host first (from repo root):
#   npm run pack:server
#
# Then build this image (repo root = context):
#   docker build -f docker/remote-dev/Dockerfile -t zowe-mcp-http:dev .

FROM node:22-bookworm-slim

COPY zowe-mcp-server-*.tgz /tmp/

RUN T="$(ls /tmp/zowe-mcp-server-*.tgz | head -1)" \
  && npm install -g "$T" --omit=dev \
  && rm -f /tmp/zowe-mcp-server-*.tgz \
  && zowe-mcp-server init-mock --output /var/lib/zowe-mcp/mock --preset minimal

ENV ZOWE_MCP_MOCK_DIR=/var/lib/zowe-mcp/mock

EXPOSE 7542

CMD ["zowe-mcp-server", "--http", "--mock", "/var/lib/zowe-mcp/mock"]
