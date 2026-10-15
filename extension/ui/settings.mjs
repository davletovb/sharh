import {PathClient} from './client.mjs';
import {authorizeCommand, diagnostic} from '../../src/paths/diagnostics.mjs';
import {ReadingPreferences, DETAIL_LABELS, AUTO_READ} from '../../src/ui/preferences.mjs';
import {openDocumentStore} from '../../src/documents/store.mjs';
import {sourceOrigin} from '../lib/opening.mjs';
import {buildModelSettings} from './settings-models.mjs';
import {icon, brand} from './icons.mjs';
import {element} from './dom.mjs';

const client = new PathClient(),
  $ = selector => document.querySelector(selector),
  preferences = new ReadingPreferences(chrome.storage.local);
await preferences.load();

// ───────── Navigation: one section at a time ─────────
const sections = [...document.querySelectorAll('section[data-section]')],
  links = [...document.querySelectorAll('#settings-nav a')];
$('#brand-slot').replaceWith(brand());
for (const link of links) link.prepend(icon(link.dataset.icon));
function show(name) {
  const key = sections.some(s => s.dataset.section === name) ? name : 'connection';
  for (const section of sections) section.hidden = section.dataset.section !== key;
  for (const link of links) {
    if (link.dataset.section === key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  document.title = `${links.find(l => l.dataset.section === key).textContent} · Sharh settings`;
}
addEventListener('hashchange', () => show(location.hash.slice(1)));
show(location.hash.slice(1));

// ───────── Appearance ─────────
function applyTheme(theme) { document.documentElement.dataset.theme = theme; }
applyTheme(preferences.value.theme);
const swatches = {
  system: ['System', 'Follows your device', ['#f4eee0', '#7a5710', '#0e151d']],
  ink: ['Ink', 'Dark with gold', ['#0e151d', '#e7c27a', '#f1e8d6']],
  parchment: ['Parchment', 'Light and warm', ['#f4eee0', '#7a5710', '#272a2b']]
};
for (const [key, [title, hint, [bg, accent, text]]] of Object.entries(swatches)) {
  const label = element('label', '', 'theme-choice'), input = element('input'), swatch = element('span', '', 'theme-swatch');
  input.type = 'radio'; input.name = 'theme'; input.value = key; input.checked = preferences.value.theme === key;
  swatch.style.background = key === 'system' ? `linear-gradient(135deg, ${bg} 50%, #0e151d 50%)` : bg;
  for (const [color, width] of [[accent, '60%'], [text, '90%']]) {
    const bar = element('i'); bar.style.background = color; bar.style.width = width; swatch.append(bar);
  }
  const name = element('strong', title), sub = element('span', hint, 'hint');
  sub.style.display = 'block';
  label.append(input, swatch, name, sub);
  input.addEventListener('change', () => preferences.save({theme: key}).then(v => applyTheme(v.theme)));
  $('#theme-choices').append(label);
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sharhReading?.newValue) preferences.load().then(v => applyTheme(v.theme));
});

// ───────── Connection ─────────
let providers = [], models;
$('#authorize').textContent = authorizeCommand(chrome.runtime.id);
$('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText($('#authorize').textContent);
    $('#copied').textContent = 'Copied';
  } catch {
    $('#copied').textContent = 'Select and copy the command shown here.';
  }
});
const saved = await chrome.storage.local.get('seatlinePolicy');
$('#gemini-cloud').checked = saved.seatlinePolicy?.allowGeminiCloud === true;
$('#gemini-cloud').addEventListener('change', async () => {
  await chrome.storage.local.set({seatlinePolicy: {allowGeminiCloud: $('#gemini-cloud').checked}});
  await check();
});
$('#check').addEventListener('click', () => check());
function summarize(results) {
  const states = results.map(p => diagnostic(p).state);
  const hostMissing = states.length > 0 && states.every(s => s === 'companion_missing');
  const notAuthorized = !hostMissing && states.length > 0 && states.every(s => s === 'sharh_not_authorized');
  const ready = results.filter((p, i) => states[i] === 'ready');
  return {
    steps: {install: hostMissing ? 'bad' : 'ok', authorize: hostMissing ? 'wait' : notAuthorized ? 'bad' : 'ok', signin: hostMissing || notAuthorized ? 'wait' : ready.length ? 'ok' : 'bad'},
    ready
  };
}
function renderStatus(results) {
  const {steps, ready} = summarize(results);
  for (const li of document.querySelectorAll('#setup-steps li')) {
    const state = steps[li.dataset.step];
    if (state === 'wait') li.removeAttribute('data-state'); else li.dataset.state = state;
  }
  const box = $('#connection-status'), body = box.querySelector('div');
  box.className = 'callout ' + (ready.length ? 'ok' : 'warn');
  box.querySelector('.dot').className = 'dot ' + (ready.length ? 'ok' : 'warn');
  body.replaceChildren();
  if (ready.length) {
    body.append(element('span', 'Connected', 'title'), element('p', `${ready.map(p => p.label).join(' and ')} ${ready.length === 1 ? 'is' : 'are'} ready to read with.`));
  } else {
    const next = steps.install === 'bad' ? 'Install Seatline to get started.' : steps.authorize === 'bad' ? 'Allow Sharh to use Seatline with the command below.' : 'Sign in to a model CLI, then check again.';
    body.append(element('span', 'Not connected yet', 'title'), element('p', next));
  }
  $('#setup-details').open = !ready.length && steps.install !== 'bad' ? steps.authorize === 'bad' : steps.install === 'bad';
}
function renderProviders(results) {
  $('#diagnostics').replaceChildren();
  for (const provider of results) {
    const state = diagnostic(provider), card = element('article', '', 'provider-card');
    card.dataset.state = state.state;
    const tone = state.state === 'ready' ? 'ok' : ['disconnected', 'provider_failed'].includes(state.state) ? 'warn' : 'bad';
    const text = element('div');
    text.append(element('h3', `${provider.label} · ${state.title}`), element('p', state.state === 'ready' ? 'Available, signed in and accepted.' : state.hint, 'hint'));
    card.append(element('span', '', 'dot ' + (state.state === 'ready' ? 'ok' : tone)), text);
    $('#diagnostics').append(card);
  }
}
async function check({fresh = true} = {}) {
  $('#check').disabled = true;
  $('#check-state').textContent = 'Checking…';
  try {
    providers = await client.call('discover', {fresh});
    renderStatus(providers);
    renderProviders(providers);
    $('#check-state').textContent = fresh ? 'Fresh check complete.' : 'Showing the latest check.';
    await models?.rebuild(providers);
  } catch (error) {
    $('#check-state').textContent = error.message;
  } finally {
    $('#check').disabled = false;
  }
}

// ───────── Models ─────────
let modelsView;
models = {
  async rebuild(next) {
    modelsView = await buildModelSettings($('#models-content'), {preferences, providers: next});
  }
};
await check({fresh: false});

// ───────── Reading ─────────
const LANGUAGES = [['en', 'English'], ['uz', 'Oʻzbekcha (Latin)'], ['uz-Cyrl', 'Ўзбекча (Кирилл)'], ['ru', 'Русский'], ['ar', 'العربية'], ['fa', 'فارسی'], ['tr', 'Türkçe'], ['kk', 'Қазақша'], ['fr', 'Français'], ['de', 'Deutsch'], ['es', 'Español'], ['it', 'Italiano'], ['pt', 'Português'], ['zh', '中文'], ['ja', '日本語'], ['hi', 'हिन्दी']];
const language = $('#language');
for (const [code, name] of [...LANGUAGES, ['other', 'Other…']]) language.append(Object.assign(element('option', name), {value: code}));
function showLanguage() {
  const known = LANGUAGES.some(([code]) => code === preferences.value.language);
  language.value = known ? preferences.value.language : 'other';
  $('#language-other-field').hidden = known;
  if (!known) $('#language-other').value = preferences.value.language;
}
showLanguage();
const readingState = $('#reading-state');
const saveReading = async patch => { await preferences.save(patch); readingState.textContent = 'Saved.'; showLanguage(); };
language.addEventListener('change', () => {
  if (language.value === 'other') { $('#language-other-field').hidden = false; $('#language-other').focus(); return; }
  saveReading({language: language.value}).catch(error => { readingState.textContent = error.message; });
});
$('#language-other').addEventListener('change', () => {
  if ($('#language-other').reportValidity() && $('#language-other').value) saveReading({language: $('#language-other').value}).catch(error => { readingState.textContent = error.message; });
});
function radioGroup(container, name, choices, current, onChange) {
  for (const [value, text] of Object.entries(choices)) {
    const input = element('input'), label = element('label');
    input.type = 'radio'; input.name = name; input.value = value; input.checked = current === value;
    input.addEventListener('change', () => onChange(value));
    label.append(input, element('span', text));
    container.append(label);
  }
}
// Detail is a segmented choice; the radio inputs stay in the document for keyboards and screen readers.
{
  const group = $('#detail');
  for (const [value, text] of Object.entries(DETAIL_LABELS)) {
    const b = element('button', text);
    b.type = 'button'; b.dataset.value = value;
    b.addEventListener('click', () => saveReading({detail: value}).then(markDetail));
    group.append(b);
  }
  const markDetail = () => { for (const b of group.children) b.setAttribute('aria-pressed', String(b.dataset.value === preferences.value.detail)); };
  markDetail();
}
radioGroup($('#auto-read'), 'auto-read', AUTO_READ, preferences.value.autoRead, value => saveReading({autoRead: value}).catch(error => { readingState.textContent = error.message; }));

// ───────── Sites and PDFs ─────────
const reader = await chrome.storage.local.get('pdfAutoOpen');
$('#pdf-auto-open').checked = reader.pdfAutoOpen !== false;
$('#pdf-auto-open').addEventListener('change', () => chrome.storage.local.set({pdfAutoOpen: $('#pdf-auto-open').checked}));
const siteState = $('#reader-settings-state');
async function renderSites() {
  const {origins = []} = await chrome.permissions.getAll(), list = $('#site-list');
  list.replaceChildren();
  const sites = origins.filter(o => /^(https?|file):/.test(o));
  if (!sites.length) list.append(element('p', 'No sites yet. Sharh asks the first time you read a page.', 'hint'));
  for (const origin of sites) {
    const row = element('div', '', 'site-row'), remove = element('button', 'Remove', 'ghost');
    remove.type = 'button'; remove.setAttribute('aria-label', `Remove access to ${origin.replace(/\/\*$/, '')}`);
    remove.addEventListener('click', async () => { await chrome.permissions.remove({origins: [origin]}); await renderSites(); });
    row.append(element('span', origin.replace(/\/\*$/, '')), remove);
    list.append(row);
  }
}
await renderSites();
chrome.permissions.onAdded.addListener(() => renderSites());
chrome.permissions.onRemoved.addListener(() => renderSites());
$('#add-site').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const granted = await chrome.permissions.request({origins: [sourceOrigin($('#site-address').value)]});
    siteState.textContent = granted ? 'Access allowed.' : 'Access was not granted.';
    if (granted) $('#site-address').value = '';
  } catch (error) { siteState.textContent = error.message; }
});
$('#allow-pdf-sites').addEventListener('click', () => {
  chrome.permissions.request({origins: ['http://*/*', 'https://*/*']}).then(granted => {
    siteState.textContent = granted ? 'Website access enabled.' : 'Website access was not granted.';
  }).catch(error => { siteState.textContent = error.message; });
});
$('#file-access').addEventListener('click', () => chrome.tabs.create({url: `chrome://extensions/?id=${chrome.runtime.id}`}));

// ───────── Your data ─────────
const dataState = $('#data-state');
async function usage() {
  try {
    const {usage: used = 0} = await navigator.storage.estimate();
    $('#storage-used').textContent = `Sharh is using about ${(used / 1048576).toFixed(1)} MB in this browser.`;
  } catch { $('#storage-used').textContent = ''; }
}
await usage();
$('#export-data').addEventListener('click', async () => {
  const store = await openDocumentStore();
  try {
    const archive = await store.exportData(), url = URL.createObjectURL(new Blob([JSON.stringify(archive)], {type: 'application/json'})), a = document.createElement('a');
    a.href = url; a.download = 'sharh-documents.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    dataState.textContent = 'Documents exported.';
  } catch (error) { dataState.textContent = error.message; }
  finally { store.close(); }
});
$('#import-data').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  const store = await openDocumentStore();
  try { dataState.textContent = `Imported ${await store.importData(JSON.parse(await file.text()))} document(s).`; await usage(); }
  catch (error) { dataState.textContent = error.message; }
  finally { store.close(); event.target.value = ''; }
});
$('#delete-all').addEventListener('click', async () => {
  if (!confirm('Delete every saved document, reading and chat from this browser? This cannot be undone.')) return;
  const store = await openDocumentStore();
  try {
    for (const item of await store.listDocuments()) await store.deleteDocument(item.id);
    await client.call('maintenance').catch(() => {});
    dataState.textContent = 'All saved documents were deleted.';
    await usage();
  } catch (error) { dataState.textContent = error.message; }
  finally { store.close(); }
});
