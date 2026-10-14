import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
test('corpus covers languages, formats and layouts with licences, annotations and canaries',async()=>{
  const corpus=JSON.parse(await readFile('corpus/manifest.json'));
  assert.deepEqual(new Set(corpus.languages),new Set(['en','ru','uz-Latn','uz-Cyrl','tr','ar']));
  for (const lang of corpus.languages) assert.ok(corpus.items.some(i=>i.language===lang));
  for (const feature of ['long-single-page-book','multi-page-article','book-with-outline','no-outline','two-column-article','footnote-heavy-monograph']) assert.ok(corpus.items.some(i=>i.features.includes(feature)),feature);
  for (const format of ['html','pdf']) assert.ok(corpus.items.some(i=>i.format===format&&i.expected.headings.length&&i.expected.blockCount));
  for (const item of corpus.items) {
    assert.equal(item.license,'CC0-1.0'); assert.ok(item.source); assert.match(item.licenseUrl,/creativecommons/);
    const bytes=await readFile(item.path); assert.equal(createHash('sha256').update(bytes).digest('hex'),item.sha256,item.id);
    assert.equal(item.expected.blocks.length,item.expected.blockCount);
    if (item.features.includes('prompt-injection')) assert.ok(item.expected.blocks.some(b=>b.text.includes(item.canary)));
  }
  assert.ok(corpus.items.filter(i=>i.features.includes('prompt-injection')).length>=2);
});
test('fixed extension key and Seatline contract agree',async()=>{
  const c=JSON.parse(await readFile('config/seatline-contract.json')),m=JSON.parse(await readFile('extension/manifest.json'));
  const derived=[...createHash('sha256').update(Buffer.from(m.key,'base64')).digest().subarray(0,16)].flatMap(b=>[b>>4,b&15]).map(n=>String.fromCharCode(97+n)).join('');
  assert.equal(derived,c.development_extension_id); assert.equal(c.app,'sharh'); assert.equal(c.protocol,1);
  assert.match(c.revision,/^[a-f0-9]{40}$/); assert.equal(c.minimum_revision,c.revision);
  assert.deepEqual(m.permissions,['nativeMessaging']); assert.ok(!m.host_permissions);
  assert.equal(c.reading_policy.generation_method,'send_ready_with_policy');
});
