/**
 * Copies src/resources into dist/resources and src/tools/tso/*.json into dist/tools/tso
 * so packaged resources are available at runtime.
 * Run from package root (packages/zowe-mcp-server) after tsc.
 */
const fs = require('node:fs');
const path = require('node:path');

const pkgRoot = path.join(__dirname, '..');

const srcResources = path.join(pkgRoot, 'src', 'resources');
const destResources = path.join(pkgRoot, 'dist', 'resources');
if (fs.existsSync(srcResources)) {
  fs.mkdirSync(destResources, { recursive: true });
  fs.cpSync(srcResources, destResources, { recursive: true });
}

const srcTso = path.join(pkgRoot, 'src', 'tools', 'tso');
const destTso = path.join(pkgRoot, 'dist', 'tools', 'tso');
if (fs.existsSync(srcTso)) {
  fs.mkdirSync(destTso, { recursive: true });
  const files = fs.readdirSync(srcTso);
  for (const f of files) {
    if (f.endsWith('.json')) {
      fs.copyFileSync(path.join(srcTso, f), path.join(destTso, f));
    }
  }
}

const srcConsole = path.join(pkgRoot, 'src', 'tools', 'console');
const destConsole = path.join(pkgRoot, 'dist', 'tools', 'console');
if (fs.existsSync(srcConsole)) {
  fs.mkdirSync(destConsole, { recursive: true });
  const consoleFiles = fs.readdirSync(srcConsole);
  for (const f of consoleFiles) {
    if (f.endsWith('.json')) {
      fs.copyFileSync(path.join(srcConsole, f), path.join(destConsole, f));
    }
  }
}
