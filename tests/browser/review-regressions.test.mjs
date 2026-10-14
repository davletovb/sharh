// Original regression text/PDF layouts, dedicated to CC0-1.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {PDFDocument,StandardFonts,PDFName,PDFString,PDFNumber,degrees} from 'pdf-lib';
import {fixtureBrowser} from '../../scripts/lib/browser-fixtures.mjs';
const lede='A public library serves a town whose residents have different working hours and transport needs. Counting the books that leave the building measures activity, but it does not identify the people who wanted to read and could not visit. Interviews and observations answer different questions, so this article compares both kinds of evidence.';
const closing='A second observation checks whether the pattern survives another period. The observer keeps the limits of the count visible and does not equate more visits with a proven improvement in access.';

test('Readability provenance excludes duplicated teasers and keeps nested own text and table paragraphs',async()=>{
  const world=await fixtureBrowser();
  try {
    await world.page.goto(world.server.url+'/dist/index.html');
    await world.page.setContent(`<!doctype html><title>Fieldwork</title><div class="teaser"><p>${lede}</p></div><main><article><h1>Fieldwork</h1><p>${lede}</p><p>${closing}</p></article></main>`);
    const duplicate=await world.page.evaluate(async()=>{
      const p=await import('/dist/prototype.mjs'), before=document.body.innerHTML, result=await p.extractHTML(document,{identity:'duplicated-lede'});
      return {result,unchanged:before===document.body.innerHTML, hit:p.highlightHTML(document,result.blocks[1].anchor)};
    });
    assert.deepEqual(duplicate.result.blocks.map(b=>b.text),['Fieldwork',lede,closing]);assert.equal(duplicate.unchanged,true);assert.equal(duplicate.hit.text,lede);
    assert.ok(duplicate.result.blocks[1].anchor.path.includes('article'));
    await world.page.setContent(`<!doctype html><title>Nested source</title><article id="source"><h1>Nested source</h1><p>${lede}</p><ul><li>Parent item<ul><li>Child item</li></ul>Parent tail</li></ul><blockquote>Quotation intro<p>Quoted paragraph</p>Quotation tail</blockquote><table><tr><td><p>Cell paragraph</p></td><td>Cell neighbour</td></tr></table><p>${closing}</p></article>`);
    const nested=await world.page.evaluate(async()=>{
      const p=await import('/dist/prototype.mjs'), result=await p.extractHTML(document,{mode:'region',region:'#source',identity:'nested'});
      return {result,hits:result.blocks.map(b=>p.highlightHTML(document,b.anchor)?.text)};
    });
    const expected=['Nested source',lede,'Parent item','Child item','Parent tail','Quotation intro','Quoted paragraph','Quotation tail','Cell paragraph Cell neighbour',closing];
    assert.deepEqual(nested.result.blocks.map(b=>b.text),expected);assert.deepEqual(nested.hits,expected);
    assert.equal(nested.result.blocks[8].kind,'table');
  } finally {await world.close();}
});
test('duplicate anchors use consistent DOM context, even when a stale path now selects another identical paragraph',async()=>{
  const world=await fixtureBrowser();
  try {
    await world.page.goto(world.server.url+'/dist/index.html');
    await world.page.setContent('<!doctype html><section id="source"><p>First context</p><p>Repeated paragraph.</p><p>Middle context</p><p>Repeated paragraph.</p><p>Last context</p></section><div><p>Repeated paragraph.</p></div>');
    const r=await world.page.evaluate(async()=>{
      const p=await import('/dist/prototype.mjs'), extracted=await p.extractHTML(document,{mode:'region',region:'#source',identity:'duplicates'}), anchor=JSON.parse(JSON.stringify(extracted.blocks[3].anchor));
      // Two new siblings make the old nth-of-type path point to the first copy.
      for(const text of ['Unrelated B','Unrelated A']){const el=document.createElement('p');el.textContent=text;document.querySelector('#source').prepend(el);}
      const hit=p.resolveHTMLAnchor(document,anchor);
      return {text:hit?.text,after:hit?.element.nextElementSibling?.textContent,strategy:hit?.strategy};
    });
    assert.equal(r.text,'Repeated paragraph.');assert.equal(r.after,'Last context');assert.equal(r.strategy,'quote');
  }finally{await world.close();}
});
test('explicit identity is stable across fixture ports and HTML extraction works in an insecure HTTP context',async()=>{
  const first=await fixtureBrowser(),second=await fixtureBrowser();
  try{
    const item={path:'corpus/fixtures/html/article-en.html',format:'html'};
    const a=await first.extract(item),b=await second.extract(item);assert.notEqual(first.server.url,second.server.url);assert.equal(a.version,b.version);
    await first.page.route('http://insecure.sharh.test/**',async route=>route.fulfill({response:await first.page.request.get(first.server.url+new URL(route.request().url()).pathname)}));
    await first.page.goto('http://insecure.sharh.test/'+item.path);
    const http=await first.page.evaluate(async identity=>({secure:isSecureContext,subtle:!!globalThis.crypto?.subtle,result:await(await import('/dist/prototype.mjs')).extractHTML(document,{identity})}),item.path);
    assert.equal(http.secure,false);assert.equal(http.subtle,false);assert.equal(http.result.version,a.version);
  }finally{await first.close();await second.close();}
});
async function regressionPDF({rotation=0,crop=false,outline=false}={}) {
  const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold),pages=[];
  for(let i=0;i<2;i++) {
    const page=doc.addPage(crop?[800,1000]:[600,800]);pages.push(page);const offset=crop?100:0;
    if(crop)page.setCropBox(100,100,600,800);page.setRotation(degrees(rotation));
    const draw=(text,y,size=12,heading=false)=>page.drawText(text,{x:offset+45,y:offset+y,size,font:heading?bold:font});
    draw('RUNNING SERIES',776,9);draw(String(i+1),20,9);
    if(i===0){draw('A paragraph continues the preceding chapter.',730);draw('New chapter',600,22,true);draw(lede.slice(0,60),540);draw('Subsection',440,16,true);draw('A long-',380);draw('term plan uses Wi-',364);draw('Fi and state-',348);draw('of-the-art methods. Public partici-',332);draw('pation matters.',316);draw('1. A note about evidence.',80,8);}
    else {draw('Next chapter',730,22,true);draw(closing.slice(0,65),670);}
  }
  if(outline) {
    const root=doc.context.obj({Type:'Outlines'}),rootRef=doc.context.register(root);
    const top=[['Preface',[pages[0].ref,PDFName.of('Fit')]],['New chapter',[pages[0].ref,PDFName.of('XYZ'),45,600,null]],['Missing','missing-destination'],['Next chapter',[pages[1].ref,PDFName.of('Fit')]]];
    const nodes=top.map(([title,dest])=>doc.context.obj({Title:PDFString.of(title),Parent:rootRef,Dest:typeof dest==='string'?PDFString.of(dest):dest})),refs=nodes.map(n=>doc.context.register(n));
    nodes.forEach((n,i)=>{if(i)n.set(PDFName.of('Prev'),refs[i-1]);if(i+1<nodes.length)n.set(PDFName.of('Next'),refs[i+1]);});
    const child=doc.context.obj({Title:PDFString.of('Subsection'),Parent:refs[1],Dest:[pages[0].ref,PDFName.of('XYZ'),45,440,null]}),childRef=doc.context.register(child);
    nodes[1].set(PDFName.of('First'),childRef);nodes[1].set(PDFName.of('Last'),childRef);nodes[1].set(PDFName.of('Count'),PDFNumber.of(1));
    root.set(PDFName.of('First'),refs[0]);root.set(PDFName.of('Last'),refs.at(-1));root.set(PDFName.of('Count'),PDFNumber.of(5));doc.catalog.set(PDFName.of('Outlines'),rootRef);
  }
  return Array.from(await doc.save());
}
test('actual PDF.js pages preserve mid-page headings, nested outlines, crop boxes and display-rotated anchors',async()=>{
  const world=await fixtureBrowser(),report={kind:'review-regressions',cases:[]};
  try {
    await world.page.goto(world.server.url+'/dist/index.html');
    const expected=['A paragraph continues the preceding chapter.','New chapter',lede.slice(0,60),'Subsection','A long- term plan uses Wi- Fi and state- of-the-art methods. Public participation matters.','1. A note about evidence.','Next chapter',closing.slice(0,65)];
    for(const options of [{outline:true},{crop:true},{rotation:90},{rotation:180,crop:true},{rotation:270}]) {
      const bytes=await regressionPDF(options);
      const r=await world.page.evaluate(async bytes=>{
        const p=await import('/dist/prototype.mjs'),pdf=await p.openPDF(new Uint8Array(bytes).buffer);
        try{const extracted=await p.extractPDF(pdf,'review-pdf');return {extracted,hits:await Promise.all(extracted.blocks.map(b=>p.resolvePDFAnchor(pdf,b.anchor)))};}finally{await pdf.loadingTask.destroy();}
      },bytes);
      assert.deepEqual(r.extracted.blocks.map(b=>b.text),expected,JSON.stringify(options));assert.deepEqual(r.hits.map(h=>h.text),expected);
      assert.ok(r.hits.every(h=>h.rects.every(r=>r.width>0&&r.height>0)));
      const sections=new Map(r.extracted.sections.map(s=>[s.id,s]));
      assert.ok(r.extracted.blocks.every(b=>b.section===null||sections.has(b.section)));
      if(options.outline){const valid=r.extracted.sections.filter(s=>s.first!==null);assert.ok(valid.every(s=>s.first<=s.last&&s.firstPage<=s.lastPage));assert.ok(r.extracted.warnings.some(w=>w.cause==='unresolved-outline-destination'));assert.equal(r.extracted.blocks[3].section,'o3');}
      report.cases.push({options,passed:true,blocks:r.extracted.blocks.length});
    }
  }finally{await world.close();await mkdir('test-results',{recursive:true});await writeFile('test-results/review-regressions.json',JSON.stringify(report,null,2)+'\n');}
});
