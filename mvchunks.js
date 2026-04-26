import { readdirSync, renameSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, 'dist');
const chunksDir = resolve(distDir, 'chunks');

const renameMap = new Map();

for (const file of readdirSync(chunksDir)) {
  if (!file.endsWith('.js')) continue;
  const match = file.match(/^.+?\.([A-Za-z0-9_-]+)\.js$/);
  if (!match) continue;
  const newName = `${match[1]}.js`;
  if (file !== newName) renameMap.set(file, newName);
}

if (renameMap.size === 0) {
  console.log('No chunks to rename.');
  process.exit(0);
}

for (const dir of [distDir, chunksDir]) {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.js')) continue;
    const filePath = resolve(dir, file);
    let content = readFileSync(filePath, 'utf8');
    let changed = false;
    for (const [oldName, newName] of renameMap) {
      if (content.includes(oldName)) {
        content = content.replaceAll(oldName, newName);
        changed = true;
      }
    }
    if (changed) writeFileSync(filePath, content, 'utf8');
  }
}
try {
  const htmlPath = resolve(distDir, 'index.html');
  let html = readFileSync(htmlPath, 'utf8');
  let changed = false;
  for (const [oldName, newName] of renameMap) {
    if (html.includes(oldName)) {
      html = html.replaceAll(oldName, newName);
      changed = true;
    }
  }
  if (changed) writeFileSync(htmlPath, html, 'utf8');
} catch {}

for (const [oldName, newName] of renameMap) {
  renameSync(resolve(chunksDir, oldName), resolve(chunksDir, newName));
console.log(`${oldName} -> ${newName}`);
}

console.log(`${renameMap.size} chnuks were renamed.`);