import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixtureBrowser} from '../../scripts/lib/browser-fixtures.mjs';
test('production readers meet every annotated corpus heading, paragraph, page-label and layout expectation',async()=> {
  const world=await fixtureBrowser({module:'/dist/readers.mjs'}), report={kind:'production-reader-corpus',items:[],failures:[]};
  try {
    const corpus=JSON.parse(await readFile('corpus/manifest.json'));
    for (const item of corpus.items) {
      try {
        const extracted=await world.extract(item);
        assert.equal(extracted.blocks.length,item.expected.blockCount,`${item.id}: paragraph count`);
        assert.deepEqual(extracted.blocks.map(b=>b.text),item.expected.blocks.map(b=>b.text));
        assert.deepEqual(extracted.blocks.filter(b=>b.kind==='heading').map(b=>b.text),item.expected.headings);
        assert.deepEqual(extracted.blocks.map(b=>b.kind),item.expected.blocks.map(b=>b.kind));
        const doc=await world.page.evaluate(async ({extracted,item})=> {
          const {createDocument,buildScope,scopeSize}=await import('/dist/readers.mjs');
          const doc=createDocument(extracted,{kind:item.format,identity:item.path,language:item.language});
          const scope=buildScope(doc);
          return {id:doc.id,version:doc.version,size:scopeSize(doc,scope),sections:doc.sections};
        },{extracted,item});
        assert.ok(doc.size.fits); assert.equal(extracted.extractorVersion,'reader-2');
        if(item.format==='html') {
          const anchor=extracted.blocks.find(b=>b.kind==='para').anchor;
          await world.page.reload();
          const result=await world.page.evaluate(async anchor=> {
            const reader=await import('/dist/readers.mjs'), before=document.documentElement.outerHTML;
            const first=reader.highlightHTML(document,anchor), unchanged=before===document.documentElement.outerHTML;
            const aside=document.createElement('p'); aside.textContent='Unrelated insertion.'; document.querySelector('article').prepend(aside);
            const second=reader.highlightHTML(document,anchor);
            return {first,second,unchanged};
          },anchor);
          assert.equal(result.unchanged,true); assert.equal(result.first.text,anchor.quote.exact); assert.equal(result.second.text,anchor.quote.exact);
          assert.equal(result.second.strategy,'quote');
        } else {
          assert.deepEqual(extracted.pageLabels,item.expected.pageLabels);
          assert.ok(extracted.removed.length>=4);
          for(const section of extracted.sections) { assert.ok(section.firstPage<=section.lastPage); assert.ok(section.first<=section.last); }
        }
        report.items.push({id:item.id,passed:true,blocks:extracted.blocks.length,expected:item.expected.blockCount,headingCoverage:1,paragraphError:0,version:doc.version});
      } catch(error) { report.failures.push({id:item.id,cause:error.message}); }
    }
  } finally {
    await world.close(); await mkdir('test-results',{recursive:true}); await writeFile('test-results/c-readers.json',JSON.stringify(report,null,2)+'\n');
  }
  assert.deepEqual(report.failures,[]);
});
test('production web reader extracts whole/region modes and captures partial selections without DOM mutation',async()=> {
  const world=await fixtureBrowser({module:'/dist/readers.mjs'});
  try {
    await world.page.goto(`${world.server.url}/corpus/fixtures/html/article-en.html`);
    const result=await world.page.evaluate(async()=> {
      const r=await import('/dist/readers.mjs');
      document.body.innerHTML='<article id="region"><h1>Test heading</h1><p>First repeated word; repeated word again.</p><p>Two before.</p><p>One before.</p><p id="target">Selected public evidence here.</p><p>After.</p></article><section><h2>Outside</h2><p>Outside region.</p></section>';
      const before=document.body.innerHTML, whole=await r.extractHTML(document,{mode:'whole'}), region=await r.extractHTML(document,{mode:'region',region:'#region'});
      const p=document.querySelector('#target'), range=document.createRange(); range.setStart(p.firstChild,9); range.setEnd(p.firstChild,15); getSelection().removeAllRanges(); getSelection().addRange(range);
      const selection=r.selectedHTMLBlocks(document,region.blocks), doc=r.createDocument(region,{kind:'html',identity:document.URL});
      const scope=r.buildScope(doc,{kind:'selection',spans:selection.spans});
      // Repeated text inside the same block must preserve its actual offset.
      range.setStart(document.querySelector('article p').firstChild,21); range.setEnd(document.querySelector('article p').firstChild,29); getSelection().removeAllRanges(); getSelection().addRange(range);
      const repeated=r.selectedHTMLBlocks(document,region.blocks);
      return {whole:whole.blocks.length,region:region.blocks.length,selection,scope,repeated,unchanged:before===document.body.innerHTML};
    });
    assert.equal(result.whole,8); assert.equal(result.region,6); assert.equal(result.unchanged,true);
    assert.deepEqual(result.selection.spans,[{n:5,start:9,end:15}]);
    assert.deepEqual(result.scope.blocks.map(b=>b.n),[1,3,4,5,6]);
    assert.deepEqual(result.repeated.spans,[{n:2,start:21,end:29}]);
  } finally { await world.close(); }
});
