// 静态 import 图完整性检查：从 main.js 出发，所有相对导入都必须能解析到文件。
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const seen = new Set();
const missing = [];

function crawl(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (!existsSync(file)) {
    missing.push(file);
    return;
  }
  const src = readFileSync(file, 'utf8');
  const patterns = [
    /(?:import|export)[^'"]*?from\s*['"](\.[^'"]+)['"]/g,
    /import\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
    /import\s*['"](\.[^'"]+)['"]/g
  ];
  for (const re of patterns) {
    for (const m of src.matchAll(re)) {
      crawl(resolve(dirname(file), m[1]));
    }
  }
}

crawl(resolve('src/main.js'));
crawl(resolve('tools/serve.mjs'));
console.log('modules reached:', seen.size);
if (missing.length) {
  console.error('MISSING:', missing);
  process.exit(1);
}
console.log('import-graph-ok');
