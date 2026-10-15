// Shared interface components: a menu button, a chip group and a callout.
import {element} from './dom.mjs';
import {icon} from './icons.mjs';

let menuSerial = 0;
// A button that opens a small menu. Items: {label, action, hidden, disabled} or the string '-' for a divider.
export function menuButton({label, iconName = null, text = '', className = ''} = {}) {
  const wrap = element('div', '', 'menu-wrap'), trigger = element('button', text, className), list = element('div', '', 'menu');
  trigger.type = 'button';
  list.id = `menu-${++menuSerial}`;
  list.setAttribute('role', 'menu');
  list.hidden = true;
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', list.id);
  if (label) { trigger.setAttribute('aria-label', label); trigger.title = label; }
  const labelNode = element('span', text, 'menu-label');
  if (iconName) { trigger.classList.add('icon'); trigger.prepend(icon(iconName)); }
  else if (text) { trigger.textContent = ''; trigger.append(labelNode, icon('chevron', {size: 14})); }
  wrap.append(trigger, list);
  let items = [];
  const doc = () => wrap.ownerDocument;
  function close({focus = false} = {}) {
    if (list.hidden) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    doc().removeEventListener('pointerdown', outside, true);
    doc().removeEventListener('keydown', keys, true);
    if (focus) trigger.focus();
  }
  function outside(event) { if (!wrap.contains(event.target)) close(); }
  function entries() { return [...list.querySelectorAll('button[role="menuitem"]:not(:disabled)')]; }
  function keys(event) {
    if (event.key === 'Escape') { event.preventDefault(); close({focus: true}); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Tab'].includes(event.key)) return;
    const all = entries(), at = all.indexOf(doc().activeElement);
    if (event.key === 'Tab') { close(); return; }
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? all.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + all.length) % all.length;
    all[next]?.focus();
  }
  function open() {
    render();
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    doc().addEventListener('pointerdown', outside, true);
    doc().addEventListener('keydown', keys, true);
    entries()[0]?.focus();
  }
  function render() {
    list.replaceChildren();
    for (const item of items.filter(i => i === '-' || !i.hidden)) {
      if (item === '-') { list.append(element('hr')); continue; }
      const b = element('button', item.label);
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.disabled = item.disabled === true;
      b.addEventListener('click', () => {
        close({focus: true});
        Promise.resolve().then(() => item.action()).catch(error => b.dispatchEvent(new CustomEvent('sharh:error', {detail: error, bubbles: true})));
      });
      list.append(b);
    }
  }
  trigger.addEventListener('click', () => (list.hidden ? open() : close({focus: true})));
  return {root: wrap, button: trigger, close, setLabel(value) { labelNode.textContent = value; }, setItems(next) { items = next; if (!list.hidden) render(); }};
}

// A row of toggle chips where exactly one is pressed. Choices: [[value, label], ...].
export function chipGroup({label, choices, onChange, className = 'chips'}) {
  const root = element('div', '', className), buttons = new Map();
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', label);
  for (const [value, text] of choices) {
    const b = element('button', text, 'chip');
    b.type = 'button';
    b.dataset.value = value;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => onChange(value));
    buttons.set(value, b);
    root.append(b);
  }
  return {root, buttons, select(value) { for (const [v, b] of buttons) b.setAttribute('aria-pressed', String(v === value)); }};
}

export function callout(tone, title, text = '') {
  const box = element('div', '', 'callout ' + tone), body = element('div');
  body.append(element('span', title, 'title'));
  if (text) body.append(element('p', text));
  box.append(element('span', '', 'dot ' + tone), body);
  return box;
}
