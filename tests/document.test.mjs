import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {EXTRACTOR_VERSION, normalizeText, normalizePDFText, versionOf} from '../src/prototypes/document.mjs';
test('HTML normalization preserves source-wrapped compounds; PDF joins conservative line-break fragments',()=>{
  for(const [source, expected] of [['a long-\nterm plan','a long- term plan'],['Wi-\nFi','Wi- Fi'],['state-\nof-the-art','state- of-the-art']]) assert.equal(normalizeText(source),expected);
  assert.equal(normalizePDFText('partici-\npation'),'participation');
  assert.equal(normalizePDFText('long-\nterm Wi-\nFi state-\nof-the-art'),'long- term Wi- Fi state- of-the-art');
  assert.equal(normalizePDFText('discre\u00ad\ntionary'),'discretionary');
});
test('version hashing remains SHA-256 when secure-context WebCrypto is absent',async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  Object.defineProperty(globalThis,'crypto',{value:undefined,configurable:true});
  try {assert.equal(await versionOf('fixture','Ўқиш'),createHash('sha256').update(`${EXTRACTOR_VERSION}\nfixture\nЎқиш`).digest('hex'));}
  finally{Object.defineProperty(globalThis,'crypto',descriptor);}
});
