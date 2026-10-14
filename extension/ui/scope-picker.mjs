import {buildScope, scopeSize} from '../../src/documents/scopes.mjs';
import {chapterSections} from '../../src/documents/model.mjs';
export function bindScopePicker(root, {selection = async () => null, onChange = () => {}, onChapterLevel = () => {}, sizing = {}} = {}) {
  const $ = id => root.querySelector(`#${id}`);
  let doc, current;
  const option = (value,text) => { const el = document.createElement('option'); el.value=value; el.textContent=text; return el; };
  async function update() {
    if (!doc) return;
    try {
      const kind=$('scope-kind').value, choice={kind};
      $('scope-section-label').hidden=!['section','chapter'].includes(kind);
      $('scope-pages').hidden=kind !== 'pages';
      if (['section','chapter'].includes(kind)) choice.id=$('scope-section').value;
      if (kind==='pages') { choice.first=Number($('scope-first').value)-1; choice.last=Number($('scope-last').value)-1; }
      if (kind==='selection') { const selected=await selection(); choice.spans=selected?.spans; }
      current=buildScope(doc,choice);
      const size=scopeSize(doc,current,sizing);
      $('scope-size').textContent=`≈${size.estimatedTokens.toLocaleString()} tokens · ${size.requestBytes.toLocaleString()} / ${size.maxRequestBytes.toLocaleString()} UTF-8 bytes`;
      $('scope-help').textContent=size.hint || 'Estimated for a Seatline analysis turn. Final rules, task and model options are checked again before sending.';
      $('scope-help').dataset.oversize=String(!size.fits);
      onChange(current,size);
    } catch (error) {
      current=null; $('scope-size').textContent='';
      const hints={NO_SELECTION:'Select text in the source, then choose Selection or click Refresh selection.',INVALID_PAGE_RANGE:'Choose a valid physical PDF page range.',SCOPE_NOT_FOUND:'Choose a section or chapter.',EMPTY_SCOPE:'This range contains no extracted text.',REEXTRACT_REQUIRED:'Read the source page again before choosing its selection.'};
      $('scope-help').textContent=hints[error.message] || error.message; onChange(null,null);
    }
  }
  function fillSections() {
    $('scope-section').replaceChildren(...($('scope-kind').value === 'chapter' ? chapterSections(doc) : doc.sections).map(s => option(s.id,`${'· '.repeat(s.level-1)}${s.title} · ¶${s.first}–${s.last}`)));
  }
  $('scope-kind').addEventListener('change',() => { fillSections(); update(); });
  for (const id of ['scope-section','scope-first','scope-last']) $(id).addEventListener('change',update);
  $('scope-refresh').addEventListener('click',update);
  $('chapter-level').addEventListener('change',() => { doc.chapterLevel=Number($('chapter-level').value); onChapterLevel(doc.chapterLevel); fillSections(); update(); });
  return {
    setDocument(value) {
      doc=value; root.hidden=false;
      $('scope-kind').replaceChildren(option('document','Whole document'),option('selection','Selection'),...(doc.sections.length ? [option('section','Section'),option('chapter','Chapter')] : []),...(doc.kind==='pdf' ? [option('pages','Page range')] : []));
      $('scope-first').value=1; $('scope-last').value=doc.pageCount || 1;
      for (const id of ['scope-first','scope-last']) $(id).max=doc.pageCount || 1;
      const levels=[...new Set(doc.sections.map(s => s.level))].sort((a,b)=>a-b);
      $('chapter-level').replaceChildren(...levels.map(level => option(String(level),`Heading level ${level}`)));
      $('chapter-level').value=String(doc.chapterLevel); $('chapter-level-label').hidden=!levels.length;
      fillSections(); return update();
    }, refresh:update, get value() { return current; }
  };
}
