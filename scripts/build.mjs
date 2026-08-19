import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'index.html'), resolve(dist, 'index.html'));
await cp(resolve(root, 'src'), resolve(dist, 'src'), { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });

// A Hostinger mantém JS, CSS e imagens em cache por até sete dias. Como este
// projeto é publicado sem bundler, os nomes dos arquivos não mudam entre
// versões. Acrescentar a revisão do deploy às URLs força o navegador a buscar
// os arquivos novos sem desativar o cache para os usuários.
const buildVersion = String(process.env.GITHUB_SHA || Date.now())
  .replace(/[^a-zA-Z0-9_-]/g, '')
  .slice(0, 12);

const withVersion = (url) => `${url}?v=${buildVersion}`;

const indexPath = resolve(dist, 'index.html');
let indexHtml = await readFile(indexPath, 'utf8');
indexHtml = indexHtml.replace(
  /((?:href|src)=["'])(\/(?:src|assets)\/[^"'?]+|\/config\.js)(["'])/g,
  (_, before, url, after) => `${before}${withVersion(url)}${after}`,
);
await writeFile(indexPath, indexHtml);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? listFiles(path) : [path];
  }));
  return files.flat();
}

for (const file of await listFiles(resolve(dist, 'src'))) {
  if (!file.endsWith('.js') && !file.endsWith('.css')) continue;
  let content = await readFile(file, 'utf8');

  if (file.endsWith('.js')) {
    content = content.replace(
      /((?:from\s+|import\s*)["'])(\.{1,2}\/[^"'?]+\.js)(["'])/g,
      (_, before, url, after) => `${before}${withVersion(url)}${after}`,
    );
    content = content.replace(
      /(\bimport\(\s*["'])(\.{1,2}\/[^"'?]+\.js)(["']\s*\))/g,
      (_, before, url, after) => `${before}${withVersion(url)}${after}`,
    );
  }

  content = content.replace(
    /(["'`])(\/assets\/[^"'`?]+\.(?:svg|png|webp|jpe?g|ico))\1/g,
    (_, quote, url) => `${quote}${withVersion(url)}${quote}`,
  );
  content = content.replace(
    /(url\(\s*["']?)(\/assets\/[^"')?]+)(["']?\s*\))/g,
    (_, before, url, after) => `${before}${withVersion(url)}${after}`,
  );

  await writeFile(file, content);
}

await writeFile(resolve(dist, 'build-version.txt'), `${buildVersion}\n`);
console.log(`Build concluído em dist/ (versão ${buildVersion})`);
