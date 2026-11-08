// Kopiuje z node_modules/three tylko pliki potrzebne stronie do vendor/three.
// Uzycie: npm install && npm run vendor
import { cpSync, rmSync } from 'node:fs';

const files = [
  'LICENSE',
  'build/three.module.min.js',
  'build/three.core.min.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
];

rmSync('vendor/three', { recursive: true, force: true });
for (const file of files) cpSync(`node_modules/three/${file}`, `vendor/three/${file}`);
console.log(`three.js -> vendor/three (${files.length} plikow)`);