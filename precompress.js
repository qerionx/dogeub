import dotenv from 'dotenv';
import { readdirSync, readFileSync, writeFileSync, statSync, utimesSync, existsSync, rmSync } from 'node:fs';
import { resolve, dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

dotenv.config({ quiet: true });

if (process.env.STATIC === 'true') {
  console.log('Static build, skipping precompression.');
  process.exit(0);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = resolve(__dirname, 'dist');
const EXTENSIONS = new Set(['.js', '.mjs', '.css', '.html', '.svg', '.json', '.w']);
const MIN_SIZE = 1024;

if (!existsSync(distDir)) {
  console.log('No dist directory, nothing to precompress.');
  process.exit(0);
}

const walk = dir =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });

let count = 0;
let raw = 0;
let br = 0;
let gz = 0;

const write = (target, data, source) => {
  if (data.length >= source.size) {
    rmSync(target, { force: true });
    return 0;
  }
  writeFileSync(target, data);
  utimesSync(target, source.atime, source.mtime);
  return data.length;
};

for (const file of walk(distDir)) {
  if (!EXTENSIONS.has(extname(file))) continue;
  const source = statSync(file);
  if (source.size < MIN_SIZE) continue;
  const input = readFileSync(file);
  const brData = brotliCompressSync(input, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_SIZE_HINT]: input.length
    }
  });
  const gzData = gzipSync(input, { level: 9 });
  count++;
  raw += input.length;
  br += write(`${file}.br`, brData, source) || input.length;
  gz += write(`${file}.gz`, gzData, source) || input.length;
}

console.log(`Precompressed ${count} files: ${raw} bytes raw, ${br} br, ${gz} gz.`);
