import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fixtureBrowser} from '../../scripts/lib/browser-fixtures.mjs';

test('HTML and PDF corpus: numbered extraction, sections, reload anchors and visible highlights',async()=>{
  const world=await fixtureBrowser(),report={kind:'synthetic-corpus-extraction',items:[],failures:[]};
  try{
    const corpus=JSON.parse(await readFile('corpus/manifest.json'));
    for (const item of corpus.items) {
      try {
        const extracted=await world.extract(item);
        assert.equal(extracted.blocks.length,item.expected.blockCount,item.id+' block count');
        assert.deepEqual(extracted.blocks.map(b=>b.text),item.expected.blocks.map(b=>b.text),item.id+' reading order/text');
        assert.deepEqual(extracted.blocks.filter(b=>b.kind==='heading').map(b=>b.text),item.expected.headings);
        assert.ok(extracted.sections.length>0);const sectionIds=new Set(extracted.sections.map(s=>s.id));assert.ok(extracted.blocks.every(b=>b.section===null||sectionIds.has(b.section)));assert.deepEqual(extracted.blocks.map(b=>b.n),Array.from({length:extracted.blocks.length},(_,i)=>i+1));
        const target=extracted.blocks.find(b=>b.kind==='para'),anchor=target.anchor;
        await world.page.reload();
        if (item.format==='html') {
          const result=await world.page.evaluate(async anchor=>{
            const p=await import('/dist/prototype.mjs');
            const before=document.body.innerHTML;
            const first=p.highlightHTML(document,anchor);
            const unchanged=before===document.body.innerHTML;
            // Shift paths with unrelated content, then force the quote fallback.
            const aside=document.createElement('p');aside.textContent='An unrelated DOM change.';document.querySelector('article').prepend(aside);
            const second=p.highlightHTML(document,anchor);
            return {first,unchanged,second,highlightRanges:CSS.highlights.get('sharh-reference')?.size,highlightColor:getComputedStyle(document.querySelector('article p'), '::highlight(sharh-reference)').backgroundColor};
          },anchor);
          assert.equal(result.unchanged,true);assert.equal(result.first.text,target.text);assert.equal(result.second.text,target.text);assert.equal(result.highlightRanges,1);assert.equal(result.highlightColor,'rgb(243, 201, 105)');assert.ok(result.first.rects.some(r=>r.width>0&&r.height>0));
          // Reload a serialized anchor, not a retained element/Range.
          assert.equal(result.second.strategy,'quote');
        } else {
          const result=await world.page.evaluate(async ({anchor,path})=>{
            const p=await import('/dist/prototype.mjs'),pdf=await p.openPDF(await (await fetch('/'+path)).arrayBuffer());
            try {
              const hit=await p.resolvePDFAnchor(pdf,anchor),page=await pdf.getPage(anchor.page+1),viewport=page.getViewport({scale:1});
              const canvas=document.createElement('canvas');canvas.width=viewport.width;canvas.height=viewport.height;document.body.append(canvas);
              const ctx=canvas.getContext('2d');await page.render({canvasContext:ctx,viewport}).promise;
              const sample=hit.rects[0],beforePixel=[...ctx.getImageData(Math.ceil(sample.x+1),Math.ceil(sample.y+1),1,1).data];
              ctx.fillStyle='rgba(255,200,0,.5)';for(const r of hit.rects)ctx.fillRect(r.x,r.y,r.width,r.height);
              return {...hit,beforePixel,pixel:[...ctx.getImageData(Math.ceil(hit.rects[0].x+1),Math.ceil(hit.rects[0].y+1),1,1).data]};
            } finally {await pdf.loadingTask.destroy();}
          },{anchor,path:item.path});
          assert.equal(result.text,target.text);assert.ok(result.rects.every(r=>r.width>0&&r.height>0));assert.equal(result.pixel[3],255);assert.notDeepEqual(result.pixel,result.beforePixel);
          assert.deepEqual(extracted.pageLabels,item.expected.pageLabels);
          assert.ok(extracted.removed.length>=4);
          if(item.expected.outline)assert.equal(extracted.sections[0].firstPage,0);
          assert.deepEqual(extracted.blocks.map(b=>b.kind),item.expected.blocks.map(b=>b.kind));
        }
        report.items.push({id:item.id,passed:true,blocks:extracted.blocks.length,headings:item.expected.headings.length,version:extracted.version,reloadAnchor:true,highlight:true});
      } catch(error){report.failures.push({id:item.id,cause:error.message});}
    }
  }finally{await world.close();await mkdir('test-results',{recursive:true});await writeFile('test-results/extraction.json',JSON.stringify(report,null,2)+'\n');}
  assert.deepEqual(report.failures,[]);
});
