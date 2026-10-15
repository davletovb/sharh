// The only place a reader chooses models. Everything else in Sharh uses these choices.
import {FOLLOWING, validateTarget, usable, PARTNER_DEFAULT} from '../../src/ui/preferences.mjs';
import {diagnostic} from '../../src/paths/diagnostics.mjs';
import {element, field, options} from './dom.mjs';

const JOBS = {
  quick: ['Quick help', 'Selection tools (Explain, Translate, Logic, Define), Terms and Questions.'],
  book: ['Book pass', 'Chapter by chapter in whole-book jobs.'],
  synthesis: ['Synthesis', 'Literature reviews, meta-synthesis and comparisons across texts.']
};

// One compact model chooser: provider and model, plus effort and speed where the provider accepts them.
function targetPicker(providers, desired, onChange, {id = 'model'} = {}) {
  const choices = [];
  const target = element('select'), effort = element('select'), speed = element('select');
  for (const p of providers) {
    const group = element('optgroup');
    group.label = p.label ?? p.provider;
    for (const m of [{id: null, label: 'Provider default'}, ...(p.models ?? [])]) {
      const o = element('option', m.label + (usable(p) ? '' : ' · unavailable'));
      o.value = String(choices.length);
      choices.push({info: p, model: m.id});
      group.append(o);
    }
    target.append(group);
  }
  const effortField = field('Effort', effort), speedField = field('Speed', speed);
  target.id = `${id}-target`;
  const modelInput = element('input');
  modelInput.maxLength = 128;
  modelInput.placeholder = 'Provider default';
  const modelField = field('Model ID', modelInput);
  const badges = element('p', '', 'hint');
  const root = element('div', '', 'picker');
  root.append(field('Model', target), modelField, effortField, speedField);
  const wrapper = element('div');
  wrapper.append(root, badges);
  function selected() { return choices[Number(target.value)] ?? null; }
  function fill(saved = {}) {
    const info = selected()?.info;
    if (!info) { root.hidden = true; return; }
    root.hidden = false;
    modelField.hidden = !!info.models?.length;
    if (!modelField.hidden) modelInput.value = saved.model ?? '';
    options(effort, [['', 'Provider default'], ...(info.capabilities?.effort ?? []).map(v => [v, v])]);
    effortField.hidden = !info.capabilities?.effort?.length;
    effort.value = info.capabilities?.effort?.includes(saved.effort) ? saved.effort : '';
    options(speed, [['', 'Provider default'], ...(info.capabilities?.serviceTier ?? []).map(v => [v, v])]);
    speedField.hidden = !info.capabilities?.serviceTier?.length;
    speed.value = info.capabilities?.serviceTier?.includes(saved.serviceTier) ? saved.serviceTier : '';
    badges.textContent = usable(info) ? '' : `${info.label ?? info.provider} is not ready: ${diagnostic(info).title}. See Connection.`;
  }
  function value() {
    const choice = selected();
    if (!choice) throw Error('Choose an available model provider.');
    return validateTarget({
      path: choice.info.path, provider: choice.info.provider,
      model: modelField.hidden ? choice.model : modelInput.value.trim(),
      effort: effortField.hidden || !effort.value ? null : effort.value,
      serviceTier: speedField.hidden || !speed.value ? null : speed.value
    }, choice.info);
  }
  function emit() { try { onChange(value()); } catch (error) { badges.textContent = error.message; } }
  let index = choices.findIndex(c => c.info.path === desired.path && c.info.provider === desired.provider && (c.model ?? null) === (desired.model ?? null));
  if (index < 0) index = choices.findIndex(c => c.info.path === desired.path && c.info.provider === desired.provider);
  target.value = String(Math.max(index, 0));
  fill(desired);
  target.addEventListener('change', () => { fill(); emit(); });
  for (const control of [modelInput, effort, speed]) control.addEventListener('change', emit);
  return wrapper;
}

export async function buildModelSettings(container, {preferences, providers}) {
  const state = element('p', '', 'status-line');
  state.setAttribute('role', 'status');
  // Only a structural change redraws the page; edits keep focus where it is.
  async function save(patch, {redraw = false} = {}) {
    try { await preferences.save(patch); state.textContent = 'Saved.'; if (redraw) render(); }
    catch (error) { state.textContent = error.message; }
  }
  function render() {
    const value = preferences.value;
    container.replaceChildren();
    if (!providers.some(usable)) {
      const note = element('div', '', 'callout warn'), text = element('div');
      text.append(element('span', 'No model is ready yet.', 'title'), element('p', 'You can choose models now. Connect one on the Connection page before reading.'));
      note.append(element('span', '', 'dot warn'), text);
      container.append(note);
    }
    const main = element('section', '', 'card');
    main.append(element('h3', 'Default model'), element('p', 'Used for chapter analysis and most reading.', 'hint'));
    main.append(targetPicker(providers, value.tiers.analysis, target => save({tiers: {analysis: target}}), {id: 'default'}));
    container.append(main);

    const jobs = element('section', '', 'card');
    jobs.append(element('h3', 'Different models for specific jobs'), element('p', 'Each job can use the default model or its own. A smaller, faster model is a good fit for quick help.', 'hint'));
    for (const key of FOLLOWING) {
      const row = element('div', '', 'tier-row'), head = element('div', '', 'row wrap');
      const [title, hint] = JOBS[key];
      const heading = element('div');
      heading.append(element('h3', title), element('p', hint, 'hint'));
      const follow = element('input'), toggle = element('label', '', 'spread');
      follow.type = 'checkbox';
      follow.checked = value.follow.includes(key);
      toggle.append(follow, element('span', 'Use the default model'));
      follow.addEventListener('change', () => save({follow: follow.checked ? [...new Set([...value.follow, key])] : value.follow.filter(k => k !== key)}, {redraw: true}));
      head.append(heading, toggle);
      row.append(head);
      if (!follow.checked) row.append(targetPicker(providers, value.tiers[key], target => save({tiers: {[key]: target}}), {id: key}));
      jobs.append(row);
    }
    container.append(jobs);

    const second = element('section', '', 'card');
    second.append(element('h3', 'Second reader'), element('p', 'A different model that reads the same text independently, so you can see where the two agree.', 'hint'));
    second.append(targetPicker(providers, value.partner ?? PARTNER_DEFAULT, target => save({partner: target}), {id: 'partner'}));
    container.append(second, state);
  }
  await preferences.load();
  render();
  return {render};
}
