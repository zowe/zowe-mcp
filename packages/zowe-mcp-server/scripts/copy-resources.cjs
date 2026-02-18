/**
 * Copies src/resources into dist/resources so packaged resources are available at runtime.
 * Run from package root (packages/zowe-mcp-server) after tsc.
 */
const fs = require('node:fs');
const path = require('node:path');

const srcDir = path.join(__dirname, '..', 'src', 'resources');
const destDir = path.join(__dirname, '..', 'dist', 'resources');

if (!fs.existsSync(srcDir)) {
  process.exit(0);
}
fs.mkdirSync(destDir, { recursive: true });
fs.cpSync(srcDir, destDir, { recursive: true });
