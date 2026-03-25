/**
 * Copies src/resources into dist/resources and non-TypeScript assets from
 * src/tools/* into their dist counterparts so packaged resources are available
 * at runtime. Run from package root (packages/zowe-mcp-server) after tsc.
 */
const fs = require('node:fs');
const path = require('node:path');

const pkgRoot = path.join(__dirname, '..');

/** Copies files matching filter from srcDir into destDir (flat, no recursion). */
function copyDir(srcDir, destDir, filter) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const f of fs.readdirSync(srcDir)) {
    if (!filter || filter(f)) {
      fs.copyFileSync(path.join(srcDir, f), path.join(destDir, f));
    }
  }
}

/** Recursively copies srcDir into destDir (for directories that need full tree copies). */
function copyDirRecursive(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  fs.cpSync(srcDir, destDir, { recursive: true });
}

const src = p => path.join(pkgRoot, 'src', ...p.split('/'));
const dist = p => path.join(pkgRoot, 'dist', ...p.split('/'));

copyDirRecursive(src('resources'), dist('resources'));
copyDir(src('tools/tso'), dist('tools/tso'), f => f.endsWith('.json'));
copyDir(src('tools/console'), dist('tools/console'), f => f.endsWith('.json'));
copyDir(
  src('tools/cli-bridge'),
  dist('tools/cli-bridge'),
  f => f.endsWith('.yaml') || f.endsWith('.json')
);
