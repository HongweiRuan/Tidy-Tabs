import { MODELS, LANGUAGES, getSettings } from './shared.js';

const $ = id => document.getElementById(id);
const $saved = $('saved');
let savedTimer;

async function save(patch) {
  await chrome.storage.local.set(patch);
  $saved.textContent = 'Saved';
  $saved.classList.add('on');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $saved.classList.remove('on'), 1400);
}

function radio(name, value, checked, onChange) {
  const input = document.createElement('input');
  input.type = 'radio';
  input.name = name;
  input.value = value;
  input.checked = checked;
  input.addEventListener('change', () => input.checked && onChange(value));
  return input;
}

async function init() {
  const s = await getSettings();

  // API key
  const key = $('apiKey');
  key.value = s.apiKey;
  let keyTimer;
  key.addEventListener('input', () => {
    clearTimeout(keyTimer);
    setStatus('');
    keyTimer = setTimeout(() => save({ apiKey: key.value.trim() }), 300);
  });
  $('toggleKey').addEventListener('click', e => {
    const show = key.type === 'password';
    key.type = show ? 'text' : 'password';
    e.currentTarget.textContent = show ? 'Hide' : 'Show';
  });
  $('testKey').addEventListener('click', async () => {
    const value = key.value.trim();
    if (!value) { setStatus('Paste a key first.', 'bad'); return; }
    await save({ apiKey: value });
    setStatus('Checking…');
    const res = await chrome.runtime.sendMessage({ type: 'testKey', apiKey: value });
    setStatus(res?.ok ? 'This key works.' : (res?.error || 'Check failed.'), res?.ok ? 'good' : 'bad');
  });

  // Model
  const model = $('model');
  for (const m of MODELS) {
    const label = document.createElement('label');
    label.className = 'choice';
    const dot = document.createElement('span');
    dot.className = 'dot';
    const name = document.createElement('strong');
    name.textContent = m.name;
    const note = document.createElement('span');
    note.className = 'note';
    note.textContent = m.note;
    label.append(radio('model', m.id, s.model === m.id, v => save({ model: v })), dot, name, note);
    model.append(label);
  }

  // Language
  const lang = $('language');
  for (const l of LANGUAGES) {
    const label = document.createElement('label');
    label.append(radio('language', l.id, s.language === l.id, v => save({ language: v })), l.name);
    lang.append(label);
  }

  // Rules
  const rules = $('instructions');
  rules.value = s.instructions;
  let rulesTimer;
  rules.addEventListener('input', () => {
    clearTimeout(rulesTimer);
    rulesTimer = setTimeout(() => save({ instructions: rules.value }), 400);
  });

  // Collapse
  const collapse = $('collapse');
  collapse.checked = s.collapse;
  collapse.addEventListener('change', () => save({ collapse: collapse.checked }));

  // Shortcut
  const commands = await chrome.commands.getAll();
  const cmd = commands.find(c => c.name === 'organize-now');
  if (cmd?.shortcut) $('shortcut').textContent = cmd.shortcut;
  $('editShortcut').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
}

function setStatus(text, kind) {
  const el = $('keyStatus');
  el.textContent = text;
  el.className = `status${kind ? ` ${kind}` : ''}`;
}

init();
