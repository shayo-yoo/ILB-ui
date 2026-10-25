/**
 * 极简测试运行器 + 无浏览器 DOM 桩。
 * 用法：node tests/run.mjs（要求 Node ≥ 18，不需要任何依赖）
 */
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const files = (await readdir(here))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort();

let failed = 0;

for (const file of files) {
  try {
    await import(pathToFileURL(join(here, file)).href);
  } catch (err) {
    failed += 1;
    console.error(`\n✗ ${file} 抛错：`);
    console.error(err);
  }
}

if (failed > 0) {
  console.error(`\n${failed} 个测试文件失败`);
  process.exit(1);
}

console.log('\n全部通过');
