// @ts-check

const path = require('path');
const fs = require('fs/promises');
const { minify } = require('html-minifier-terser');

const SOURCE_ROOT = path.resolve(__dirname, '..', 'public');
const DIST_ROOT = path.join(SOURCE_ROOT, 'dist');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function resetDist() {
  await fs.rm(DIST_ROOT, { recursive: true, force: true });
  await ensureDir(DIST_ROOT);
}

async function processDir(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(dir, entry.name);
    if (srcPath === DIST_ROOT) continue;

    const relPath = path.relative(SOURCE_ROOT, srcPath);
    const destPath = path.join(DIST_ROOT, relPath);

    if (entry.isDirectory()) {
      await ensureDir(destPath);
      await processDir(srcPath);
      continue;
    }

    await ensureDir(path.dirname(destPath));
    const ext = path.extname(entry.name).toLowerCase();

    if (ext === '.html') {
      const html = await fs.readFile(srcPath, 'utf8');
      const minified = await minify(html, {
        collapseWhitespace: true,
        removeComments: true,
        removeRedundantAttributes: true,
        removeEmptyAttributes: true,
        removeAttributeQuotes: true,
        minifyCSS: true,
        minifyJS: true
      });
      await fs.writeFile(destPath, minified);
      continue;
    }

    await fs.copyFile(srcPath, destPath);
  }
}

async function main() {
  await resetDist();
  await processDir(SOURCE_ROOT);
}

main().catch(error => {
  console.error('[pages:build] Failed to build GitHub Pages assets.', error);
  process.exit(1);
});
