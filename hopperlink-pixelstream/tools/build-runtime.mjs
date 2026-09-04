import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const sourcePath = path.join(root, 'src', 'hopper-one-runtime.js');
const runtimeDir = path.join(root, 'runtime');
const manifestPath = path.join(root, 'hopper-one.runtime.json');
const build = process.env.HOPPER_BUILD || '1203';

const source = fs.readFileSync(sourcePath);
const text = source.toString('utf8');
const sha256 = crypto.createHash('sha256').update(source).digest('hex');
const compressed = zlib.gzipSync(source, { level: 9 });
const encoded = compressed.toString('base64');
const lines = encoded.match(/.{1,76}/g) || [];
const middle = Math.ceil(lines.length / 2);
const parts = [lines.slice(0, middle), lines.slice(middle)];
const names = ['hopper-one.bundle-01.txt', 'hopper-one.bundle-02.txt'];

fs.mkdirSync(runtimeDir, { recursive: true });
for (let index = 0; index < names.length; index++) {
  fs.writeFileSync(path.join(runtimeDir, names[index]), `${parts[index].join('\n')}\n`);
}

const manifest = {
  build,
  encoding: 'gzip-base64',
  length: text.length,
  bytes: source.length,
  sha256,
  parts: names.map((name) => `runtime/${name}`),
};
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Built HopperLink ONE ${build}: ${source.length} B → ${compressed.length} B gzip · ${sha256}`);
