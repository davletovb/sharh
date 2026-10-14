import {createDocument,versionOf} from '../../src/documents/model.mjs';
export async function exampleDocument(identity='https://example.org/article') {
  const texts=['Title','Section','First paragraph','Second paragraph','Selected public evidence.','After selection','Last paragraph'];
  const blocks=texts.map((text,i)=>({n:i+1,kind:i<2 ? 'heading' : 'para',...(i<2?{level:i+1}:{}),text,section:i===0?'s1':'s2',
    anchor:{type:'html',path:`p:nth-of-type(${i+1})`,quote:{exact:text,prefix:'',suffix:''},position:{start:i*100,end:i*100+text.length}}}));
  return createDocument({extractorVersion:'reader-1',version:await versionOf(identity,JSON.stringify(blocks)),blocks,
    sections:[{id:'s1',title:'Title',level:1,parent:null,first:1,last:7},{id:'s2',title:'Section',level:2,parent:'s1',first:2,last:7}]},{kind:'html',identity,title:'A title',language:'uz'});
}
