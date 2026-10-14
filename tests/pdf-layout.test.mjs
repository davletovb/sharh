import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPDFBlocks, outlineSections, pdfItem} from '../src/prototypes/pdf-layout.mjs';
const viewport={convertToViewportPoint:(x,y)=>[x-100,900-y]};
const paragraph='A continuing paragraph describes the observation and explains why the evidence has limits. Different sources address different questions.';
function item(str,x,y,size=12,index=0){return {str,x,y,size,index,width:str.length*size*.45,height:size};}
test('PDF body/heading order, heading levels and notes are preserved',()=>{
  const pages=[{index:0,width:600,height:800,label:'1',items:[item(paragraph,45,70,12,0),item('New chapter',45,180,22,1),item(paragraph,45,250,12,2),item('Subsection',45,350,16,3),item(paragraph,45,420,12,4),item('1. A footnote',45,720,8,5)]}];
  const {blocks}=extractPDFBlocks(pages);
  assert.deepEqual(blocks.map(b=>b.kind),['para','heading','para','heading','para','note']);
  assert.deepEqual(blocks.filter(b=>b.kind==='heading').map(b=>b.level),[1,2]);
  assert.deepEqual(blocks.map(b=>b.anchor.items[0]),[0,1,2,3,4,5]);
});
test('PDF layout coordinates include the crop-box origin',()=>{
  const i=pdfItem({str:'body',transform:[12,0,0,12,145,700],width:30,height:12},3,viewport);
  assert.deepEqual([i.x,i.y,i.size,i.index],[45,200,12,3]);
});
test('outline ranges share pages, nest, and recover from missing destinations without dangling block sections',async()=>{
  const blocks=[{n:1,page:0,kind:'heading',level:1,text:'Preface',top:40,bottom:60},{n:2,page:0,kind:'para',text:paragraph,top:80,bottom:100},{n:3,page:0,kind:'heading',level:2,text:'Contents',top:190,bottom:210},{n:4,page:0,kind:'para',text:paragraph,top:240,bottom:260},{n:5,page:1,kind:'heading',level:1,text:'Chapter',top:40,bottom:60}];
  const pdf={getOutline:async()=>[{title:'Preface',dest:[0,{name:'Fit'}],items:[{title:'Contents',dest:[0,{name:'XYZ'},0,700,null]}]},{title:'Missing',dest:'missing'},{title:'Bad reference',dest:[{bad:true},{name:'Fit'}]},{title:'Chapter',dest:[1,{name:'Fit'}]}],getDestination:async()=>{throw Error('bad named destination')},getPageIndex:async()=>{throw Error('bad reference')}};
  const {sections,warnings}=await outlineSections(pdf,blocks,[{viewport},{viewport}]);
  const valid=new Map(sections.map(s=>[s.id,s]));
  for(const b of blocks){assert.ok(valid.has(b.section));const s=valid.get(b.section);assert.ok(b.n>=s.first&&b.n<=s.last);}
  assert.equal(blocks[0].section,'o1');assert.equal(blocks[2].section,'o2');assert.equal(sections[1].parent,'o1');
  assert.ok(sections.filter(s=>s.first!==null).every(s=>s.firstPage<=s.lastPage&&s.first<=s.last));
  assert.ok(sections.filter(s=>['Missing','Bad reference'].includes(s.title)).every(s=>s.first===null&&s.last===null&&s.firstPage===null));
  assert.equal(warnings.filter(w=>w.cause==='unresolved-outline-destination').length,2);
});
test('same-page destinations with no position retain explicit overlapping ranges instead of empty chapters',async()=>{
  const blocks=[{n:1,page:0,kind:'para',text:paragraph,top:30,bottom:50},{n:2,page:0,kind:'para',text:paragraph,top:80,bottom:100}];
  const {sections,warnings}=await outlineSections({getOutline:async()=>[{title:'A',dest:[0,{name:'Fit'}]},{title:'B',dest:[0,{name:'Fit'}]}]},blocks,[{viewport}]);
  assert.ok(sections.every(s=>s.first===1&&s.last===2&&s.firstPage===0&&s.lastPage===0));assert.ok(warnings.some(w=>w.cause==='outline-shared-start'));
});
