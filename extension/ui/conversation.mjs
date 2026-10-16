// The reading conversation: what you asked, what Sharh answered, and one place to ask more.
import {element,button} from './dom.mjs';
import {icon} from './icons.mjs';
import {menuButton} from './components.mjs';

export const GOALS = [
  {id: 'gist', label: 'Get the gist', lens: 'summary', run: {operation: 'gist', budget: 2}, hint: 'The point of the text in one line, and a short abstract.'},
  {id: 'argument', label: 'Check the argument', lens: 'check', direct: true, run: {lens: 'check', budget: 10}, hint: 'What is claimed, why, how strong it is and where it is weakest.'},
  {id: 'terms', label: 'Learn the terms', lens: 'terms', run: {operation: 'learn', budget: 8}, hint: 'Up to eight terms you need, each with a translation and its meaning here.'},
  {id: 'deep', label: 'Study it deeply', deep: true, hint: 'Structure, argument and thinking together. This takes a few minutes.'}
];
// Plain names for the lenses that are not one of the four goals.
export const PLAIN = {
  summary: 'The gist', structure: 'How it is built', logic: 'The argument', check: 'The argument', thinking: 'How it thinks', themes: 'Themes',
  'meta-reading': 'What kind of text this is', critique: 'Strengths and weak points', literature: 'Who it cites',
  terms: 'Terms to learn', questions: 'Questions to check yourself', situate: 'Where it sits (web search)'
};

export function createConversation({surface = 'panel'} = {}) {
  const root = element('div', '', 'convo');
  const head = element('div', '', 'convo-head'), title = element('h2', '', 'convo-title'), scopeButton = button('', () => {}, 'convo-scope');
  const scopeLabel = element('span', '', 'convo-scope-label');
  scopeButton.append(scopeLabel, icon('chevron', {size: 14}));
  const scopeSlot = element('div', '', 'convo-scope-slot');
  head.append(title, scopeButton, scopeSlot);
  const stream = element('div', '', 'convo-stream');
  stream.setAttribute('role', 'log');
  stream.setAttribute('aria-label', 'Reading conversation');
  const intro = element('p', 'I’ve read this text. What would you like to know?', 'convo-say');
  stream.append(intro);

  const dock = element('div', '', 'dock'), strip = element('div', '', 'convo-strip'), quote = element('div', '', 'convo-quote');
  quote.hidden = true;
  const goals = element('div', '', 'chips goals'), goalButtons = new Map();
  goals.setAttribute('role', 'group');
  goals.setAttribute('aria-label', 'Ways to read');
  const form = element('form', '', 'ask-form'), input = element('textarea', '', 'ask-input'), send = element('button', '', 'send');
  const ways = menuButton({label: 'More ways to read', iconName: 'star'});
  ways.button.classList.add('ways');
  input.rows = 1; input.placeholder = 'Ask about this text…';
  input.setAttribute('aria-label', 'Ask about this text');
  send.type = 'submit'; send.setAttribute('aria-label', 'Send'); send.title = 'Send'; send.append(icon('send', {size: 18}));
  form.append(ways.root, input, send);
  dock.append(strip, quote, goals, form);
  root.append(head, stream, dock);

  let onGoal = () => {}, onAsk = () => {}, ready = false, busy = false, followUps = null;
  const count = () => stream.querySelectorAll('.convo-me, .convo-card').length;
  const sync = () => {
    for (const b of goalButtons.values()) b.disabled = !ready || busy;
    send.disabled = busy || !input.value.trim();
    input.disabled = busy;
    ways.button.disabled = busy;
    goals.hidden = count() > 0;
    intro.hidden = count() > 0;
  };
  function grow() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; }
  input.addEventListener('input', () => { grow(); sync(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = ''; grow(); sync();
    Promise.resolve().then(() => onAsk(text)).catch(error => form.dispatchEvent(new CustomEvent('sharh:error', {detail: error, bubbles: true})));
  });
  function clearFollowUps() { followUps?.remove(); followUps = null; }
  const api = {
    root, head, stream, dock, strip, scopeSlot, scopeButton, input, ways, form,
    setTitle(text) { title.textContent = text ?? ''; },
    setScope(text) { scopeLabel.textContent = text; },
    setGoals(list, handler) {
      onGoal = handler; goals.replaceChildren(); goalButtons.clear();
      for (const goal of list) {
        const b = element('button', goal.label, 'chip' + (goal.id === 'gist' ? ' accent' : ''));
        b.type = 'button'; b.title = goal.hint;
        b.addEventListener('click', () => Promise.resolve().then(() => onGoal(goal)).catch(error => b.dispatchEvent(new CustomEvent('sharh:error', {detail: error, bubbles: true}))));
        goalButtons.set(goal.id, b); goals.append(b);
      }
      sync();
    },
    onAsk(handler) { onAsk = handler; },
    setReady(value) { ready = value; sync(); },
    setBusy(value) { busy = value; root.classList.toggle('busy', value); sync(); },
    setQuote(text, onClear) {
      quote.replaceChildren();
      quote.hidden = !text;
      if (!text) return;
      const clear = button('', () => { api.setQuote(null); onClear?.(); }, 'ghost icon');
      clear.setAttribute('aria-label', 'Stop asking about this passage'); clear.append(icon('close', {size: 14}));
      quote.append(element('span', 'Asking about ', 'hint'), element('strong', text), clear);
    },
    focusInput() { input.focus(); },
    bubble(text) {
      clearFollowUps();
      const node = element('div', text, 'convo-me');
      stream.append(node); sync(); node.scrollIntoView?.({block: 'nearest'});
      return node;
    },
    note(text) { const node = element('p', text, 'convo-say'); stream.append(node); sync(); return node; },
    recount() { sync(); },
    card({title: heading = '', sub = ''} = {}) {
      clearFollowUps();
      const card = element('article', '', 'convo-card'), top = element('header'), name = element('h3', heading, 'convo-card-title'), when = element('span', sub, 'hint');
      const body = element('div', '', 'analysis-results'), foot = element('details', '', 'card-details'), meta = element('p', '', 'card-meta');
      top.append(name, when); foot.append(element('summary', 'Details'), meta); foot.hidden = true;
      card.append(top, body, foot); stream.append(card); sync();
      return {
        root: card, body,
        setTitle(value) { name.textContent = value; },
        setSub(value) { when.textContent = value; },
        setDetails(value) { meta.textContent = value; foot.hidden = !value; },
        setBusy(value) { card.classList.toggle('busy', value); card.setAttribute('aria-busy', String(value)); }
      };
    },
    followUps(items) {
      clearFollowUps();
      if (!items.length) return;
      followUps = element('div', '', 'chips follow-ups');
      for (const item of items) {
        const b = element('button', item.label, 'chip'); b.type = 'button'; b.title = item.hint ?? '';
        b.addEventListener('click', () => Promise.resolve().then(() => item.action()).catch(error => b.dispatchEvent(new CustomEvent('sharh:error', {detail: error, bubbles: true}))));
        followUps.append(b);
      }
      stream.append(followUps);
    },
    reset() {
      clearFollowUps(); stream.replaceChildren(intro); api.setQuote(null); sync();
    },
    get turns() { return count(); },
    surface
  };
  sync();
  return api;
}
