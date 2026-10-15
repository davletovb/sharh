import test from 'node:test';
import assert from 'node:assert/strict';
import {ReadingPreferences,DETAIL,AUTO_READ,PARTNER_DEFAULT} from '../src/ui/preferences.mjs';
function memory(){let data={};return {async get(k){return {[k]:structuredClone(data[k])};},async set(v){data={...data,...structuredClone(v)};}};}
test('new readers ask before reading, report standard detail and follow no model for another job',async()=>{
  const p=new ReadingPreferences(memory()),value=await p.load();
  assert.equal(value.autoRead,'never');assert.equal(value.detail,'standard');assert.deepEqual(value.follow,[]);assert.deepEqual(value.partner,PARTNER_DEFAULT);
  assert.deepEqual(Object.keys(DETAIL),['brief','standard','thorough']);assert.ok(DETAIL.brief<DETAIL.standard && DETAIL.standard<DETAIL.thorough && DETAIL.thorough<=200);
  assert.deepEqual(Object.keys(AUTO_READ),['never','allowed']);
});
test('invalid stored choices fall back and are never trusted',async()=>{
  const storage=memory();await storage.set({sharhReading:{detail:'enormous',autoRead:'always',follow:['analysis','quick','nope'],partner:{path:'Not A Path!',provider:'x'},language:'not a code!'}});
  const value=await new ReadingPreferences(storage).load();
  assert.equal(value.detail,'standard');assert.equal(value.autoRead,'never');assert.deepEqual(value.follow,['quick']);assert.deepEqual(value.partner,PARTNER_DEFAULT);assert.equal(value.language,'en');
});
test('jobs that follow the default model track it, and stop tracking when unticked',async()=>{
  const storage=memory(),p=new ReadingPreferences(storage);
  await p.save({tiers:{analysis:{path:'seatline',provider:'codex',model:null,effort:'medium'}},follow:['quick','synthesis']});
  let value=await new ReadingPreferences(storage).load();
  assert.equal(value.tiers.quick.provider,'codex');assert.equal(value.tiers.synthesis.effort,'medium');assert.equal(value.tiers.book.provider,'claude');
  await p.save({tiers:{analysis:{path:'seatline',provider:'grok',model:null}}});
  value=await new ReadingPreferences(storage).load();assert.equal(value.tiers.quick.provider,'grok');
  await p.save({follow:['synthesis']});value=await new ReadingPreferences(storage).load();assert.equal(value.tiers.quick.provider,'grok');assert.equal(value.tiers.synthesis.provider,'grok');
});
test('detail, auto-read and the second reader model persist',async()=>{
  const storage=memory(),p=new ReadingPreferences(storage);
  await p.save({detail:'thorough',autoRead:'allowed',partner:{path:'seatline',provider:'grok',model:'grok-4'}});
  const value=await new ReadingPreferences(storage).load();
  assert.equal(value.detail,'thorough');assert.equal(value.autoRead,'allowed');assert.deepEqual(value.partner,{path:'seatline',provider:'grok',model:'grok-4'});
});
