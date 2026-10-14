import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, mkdir, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const digest = async () =>
  createHash('sha256')
    .update(await readFile('dist/sharh.zip'))
    .digest('hex');
let first;
for (let i = 0; i < 2; i++) {
  execFileSync(process.execPath, ['scripts/build.mjs'], {stdio: 'inherit'});
  execFileSync(process.execPath, ['scripts/package.mjs'], {stdio: 'inherit'});
  const sha = await digest();
  if (i === 0) first = sha;
  else assert.equal(sha, first);
}
await mkdir('test-results', {recursive: true});
await writeFile('test-results/package.json', JSON.stringify({reproducible: true, sha256: first}) + '\n');
console.log('Reproducible extension package verified.');
