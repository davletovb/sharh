// Custom lenses: your own instructions for how a text is read. They appear next to the built-in lenses.
import {CustomLenses} from '../../src/toolkit/custom-lenses.mjs';
import {FIELDS} from '../../src/analysis/contract.mjs';
import {element, field, options, button} from './dom.mjs';

const TYPES = {
  note: ['Notes', 'Short free-form observations'],
  sum: ['Summaries', 'One line, abstract or section summaries'],
  arc: ['Steps of an arc', 'How the text moves from start to end'],
  sec: ['Sections', 'The parts of the text and their roles'],
  node: ['Claims and points', 'Statements the text makes'],
  edge: ['Links between points', 'Support, objection, cause (needs claims or concepts)'],
  step: ['Reasoning steps', 'An ordered path of the argument'],
  gap: ['Gaps', 'Missing support or jumps (needs claims)'],
  facet: ['Facets', 'Aspects of the model of thinking'],
  concept: ['Concepts', 'Key terms with a gloss'],
  theme: ['Themes', 'Recurring ideas'],
  code: ['Codes', 'Labelled passages under a theme (needs themes)'],
  excerpt: ['Excerpts', 'Quotations kept under a code (needs themes and codes)'],
  tension: ['Tensions', 'Where ideas pull apart (needs themes or codes)'],
  memo: ['Memos', 'Your own analytic remarks'],
  cite: ['Citations', 'Who is cited and why'],
  term: ['Terms', 'Source term and translation'],
  q: ['Questions', 'Questions the text raises'],
  finding: ['Findings across texts', 'Claims supported by several texts'],
  cell: ['Comparison cells', 'One item against one criterion']
};
// Choosing a type also chooses what it refers to, so a saved lens always passes validation.
const NEEDS = {edge: ['node'], gap: ['node'], code: ['theme'], excerpt: ['theme', 'code'], tension: ['theme']};
const TIERS = [['quick', 'Quick'], ['analysis', 'Analysis'], ['book', 'Book pass'], ['synthesis', 'Synthesis']];

export async function buildLensSettings(root, {storage = chrome.storage.local} = {}) {
  const lenses = new CustomLenses(storage);
  const list = element('div', '', 'lens-list'), status = element('p', '', 'status-line');
  status.setAttribute('role', 'status');
  const form = element('form', '', 'card lens-form'), heading = element('h3', 'New lens');
  const name = element('input'), instructions = element('textarea'), tier = element('select'), file = element('input');
  name.maxLength = 80; instructions.maxLength = 8000; instructions.rows = 6;
  instructions.placeholder = 'Say what to look for, for example: “Find every place the author appeals to authority, and say whether the appeal is explicit.”';
  file.type = 'file'; file.accept = 'application/json,.json';
  options(tier, TIERS); tier.value = 'analysis';
  const types = element('fieldset', '', 'lens-types'), boxes = new Map();
  types.append(element('legend', 'What may this lens produce?'));
  for (const type of Object.keys(FIELDS).filter(t => !['meta', 'end'].includes(t))) {
    const [label, hint] = TYPES[type] ?? [type, ''];
    const input = element('input'); input.type = 'checkbox'; input.value = type;
    const row = element('label', '', 'check'), text = element('span'), small = element('span', hint, 'hint');
    text.textContent = label; row.append(input, text, small); types.append(row); boxes.set(type, input);
    input.addEventListener('change', () => {
      if (input.checked) for (const need of NEEDS[type] ?? []) boxes.get(need).checked = true;
      else for (const [other, needs] of Object.entries(NEEDS)) if (needs.includes(type)) boxes.get(other).checked = false;
    });
  }
  let editing = null;
  function load(definition) {
    editing = definition?.id ?? null;
    heading.textContent = definition ? `Edit “${definition.name}”` : 'New lens';
    name.value = definition?.name ?? ''; instructions.value = definition?.instructions ?? ''; tier.value = definition?.tier ?? 'analysis';
    for (const [type, box] of boxes) box.checked = (definition?.types ?? ['note']).includes(type);
    cancel.hidden = !definition;
  }
  const save = element('button', 'Save lens', 'primary'), cancel = button('Cancel', () => load(null), 'ghost');
  save.type = 'submit'; cancel.hidden = true;
  const stacked = (text, control) => { const label = field(text, control); label.classList.add('stacked'); return label; };
  form.append(heading, stacked('Name', name), stacked('Instructions', instructions), types, stacked('Default model job', tier),
    element('p', 'Lenses use the model you chose for that job in Models.', 'hint'), element('div', '', 'row wrap'));
  form.lastChild.append(save, cancel);
  const say = text => { status.textContent = text; };
  const fail = error => say({CUSTOM_LENS_FILE_TOO_LARGE: 'That file is too large.', INVALID_CUSTOM_LENS_FILE: 'That is not a Sharh lens file.', INVALID_CUSTOM_LENS: 'Give the lens a name, instructions and at least one thing it may produce.'}[error.message] ?? error.message);
  async function refresh() {
    const all = await lenses.list();
    list.replaceChildren();
    if (!all.length) list.append(element('p', 'No custom lenses yet. Built-in lenses are always available.', 'hint'));
    for (const definition of all) {
      const card = element('article', '', 'card lens-card'), head = element('div', '', 'row');
      const title = element('strong', definition.name), meta = element('span', `${TIERS.find(t => t[0] === definition.tier)[1]} · ${definition.types.map(t => TYPES[t]?.[0] ?? t).join(', ')}`, 'hint');
      const actions = element('div', '', 'row wrap');
      actions.append(
        button(`Edit ${definition.name}`, () => { load(definition); name.focus(); }),
        button(`Export ${definition.name}`, () => {
          const url = URL.createObjectURL(new Blob([lenses.export(definition)], {type: 'application/json'})), a = document.createElement('a');
          a.href = url; a.download = `sharh-lens-${definition.id}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
        button(`Delete ${definition.name}`, async () => { await lenses.remove(definition.id); if (editing === definition.id) load(null); await refresh(); say('Lens deleted.'); }, 'danger'));
      head.append(title, actions);
      card.append(head, meta, element('p', definition.instructions.length > 220 ? definition.instructions.slice(0, 220) + '…' : definition.instructions, 'hint'));
      list.append(card);
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    (async () => {
      const definition = await lenses.save({version: 1, id: editing ?? crypto.randomUUID(), name: name.value, instructions: instructions.value, tier: tier.value, types: [...boxes].filter(([, b]) => b.checked).map(([t]) => t)});
      load(null); await refresh(); say(`Saved “${definition.name}”. It now appears in the More menu of every lens bar.`);
    })().catch(fail);
  });
  file.addEventListener('change', () => {
    const f = file.files[0]; if (!f) return;
    if (f.size > 100000) { fail(Error('CUSTOM_LENS_FILE_TOO_LARGE')); file.value = ''; return; }
    f.text().then(text => lenses.import(text)).then(async d => { await refresh(); say(`Imported “${d.name}”.`); }).catch(fail).finally(() => { file.value = ''; });
  });
  load(null);
  root.replaceChildren(list, form, element('div', '', 'card'));
  root.lastChild.append(stacked('Import a lens file', file), status);
  await refresh();
  return {refresh};
}
