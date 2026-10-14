import {normalizeText} from '../documents/model.mjs';
export const normalizeQuotation = text => normalizeText(text)
  .replace(/[\u2018\u2019\u201a\u201b\u02bb\u02bc\u02b9\u0060\uff07]/gu,"'")
  .replace(/[\u201c\u201d\u201e\u201f\u00ab\u00bb\u2039\u203a\uff02]/gu,'"')
  .replace(/[\u2010-\u2015\u2212\ufe58\ufe63\uff0d]/gu,'-')
  .replace(/\.(?:\s*\.){2,}/gu,'…');

export class QuotationIndex {
  constructor(blocks) { this.blocks=new Map(blocks.map(b=>[b.n,normalizeQuotation(b.text)])); }
  verify(quote,refs) {
    const parts=normalizeQuotation(quote).split('…').map(p=>p.trim()).filter(Boolean);
    if (!parts.length || !refs.length) return false;
    const cited=new Set(refs),numbers=new Set();
    for (const n of cited) for (const nearby of [n-1,n,n+1]) if(this.blocks.has(nearby))numbers.add(nearby);
    const groups=[];
    for (const n of [...numbers].sort((a,b)=>a-b)) {
      if (!groups.length || groups.at(-1).at(-1)!==n-1)groups.push([]);
      groups.at(-1).push(n);
    }
    return groups.some(group=> {
      let text=''; const intervals=[];
      for(const n of group) { if(text)text+=' '; const start=text.length; text+=this.blocks.get(n); if(cited.has(n))intervals.push([start,text.length]); }
      // Keep the earliest match for both states. A later duplicate can be the one that touches a citation.
      let uncited=0,anchored=Infinity;
      for(const part of parts) {
        let nextUncited=Infinity,nextAnchored=Infinity;
        for(let at=text.indexOf(part);at>=0;at=text.indexOf(part,at+1)) {
          const end=at+part.length,touches=intervals.some(([a,b])=>at<b && end>a);
          if(at>=anchored || at>=uncited && touches)nextAnchored=Math.min(nextAnchored,end);
          if(at>=uncited && !touches)nextUncited=Math.min(nextUncited,end);
        }
        uncited=nextUncited; anchored=nextAnchored;
      }
      return anchored!==Infinity;
    });
  }
}
export const verifyQuotation = (quote,refs,blocks) => new QuotationIndex(blocks).verify(quote,refs);
