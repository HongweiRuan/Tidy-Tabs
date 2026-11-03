import { COLORS, getSettings, modelName, stateKey, normalizeUrl } from './shared.js';

const $strip = document.getElementById('strip');
const $summary = document.getElementById('summary');
const $main = document.getElementById('main');

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

let windowId;
let settings;
let tabs = [];          // unpinned tabs in this window, left to right
let groups = new Map(); // groupId -> group
let state = null;       // per-window state from the service worker
let draft = null;       // editable copy of a proposed plan
let openGroups = new Set();
let flash = '';         // one-off error or note shown above the button
let shortcut = '';

// ---------- helpers ----------

const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'style') el.style.cssText = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

const favicon = url => chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url || '')}&size=32`);
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const tabById = id => tabs.find(t => t.id === id);
const send = msg => chrome.runtime.sendMessage({ windowId, ...msg });

const chevron = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 14 14');
  s.setAttribute('class', 'chev');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M5 3.5 8.5 7 5 10.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
};

const cross = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 12 12');
  s.setAttribute('width', '12');
  s.setAttribute('height', '12');
  s.innerHTML = '<path d="M3 3l6 6M9 3 3 9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>';
  return s;
};

// ---------- data ----------

async function loadWindow() {
  const [all, gs] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  tabs = all.filter(t => !t.pinned);
  groups = new Map(gs.map(g => [g.id, g]));
}

async function loadState() {
  const key = stateKey(windowId);
  const got = await chrome.storage.session.get(key);
  state = got[key] || null;
  if (state?.status === 'ready' && !draft) {
    draft = structuredClone(state.plan);
  }
  if (state?.status !== 'ready') draft = null;
}

function duplicateCount() {
  const seen = new Set();
  let n = 0;
  for (const t of tabs) {
    const k = normalizeUrl(t.url || t.pendingUrl);
    if (seen.has(k)) n++;
    else seen.add(k);
  }
  return n;
}

// ---------- strip ----------

function stripItems() {
  if (draft) {
    const items = draft.loose.map(id => ({ id, color: null, run: 'loose' }));
    draft.groups.forEach((g, gi) => g.tabIds.forEach(id => items.push({ id, color: g.color, run: `p${gi}` })));
    return items.filter(it => tabById(it.id));
  }
  return tabs.map(t => {
    const g = t.groupId > -1 ? groups.get(t.groupId) : null;
    return { id: t.id, color: g ? g.color : null, run: g ? `g${g.id}` : `l${t.id}` };
  });
}

function renderStrip() {
  const items = stripItems();
  const before = new Map();
  for (const el of $strip.children) before.set(el.dataset.id, el.getBoundingClientRect());

  const existing = new Map([...$strip.children].map(el => [el.dataset.id, el]));
  const frag = document.createDocumentFragment();
  let lastRun = null;

  items.forEach((it, i) => {
    let el = existing.get(String(it.id));
    if (!el) {
      el = h('div', { class: 'seg', 'data-id': it.id });
      el.addEventListener('click', () => chrome.tabs.update(Number(el.dataset.id), { active: true }));
    }
    existing.delete(String(it.id));
    el.classList.toggle('grouped', !!it.color);
    const startsRun = lastRun !== null && it.run !== lastRun && (it.color || lastRun.startsWith('g') || lastRun.startsWith('p'));
    el.classList.toggle('gap', startsRun);
    el.style.setProperty('--c', it.color ? `var(--g-${it.color})` : 'var(--loose)');
    el.style.setProperty('--i', i);
    el.title = tabById(it.id)?.title || '';
    frag.append(el);
    lastRun = it.run;
  });

  existing.forEach(el => el.remove());
  $strip.append(frag);
  $strip.classList.toggle('dense', items.length > 70);
  $strip.classList.toggle('working', state?.status === 'working');

  if (reduceMotion || !before.size) return;
  for (const el of $strip.children) {
    const a = before.get(el.dataset.id);
    if (!a) continue;
    const b = el.getBoundingClientRect();
    const dx = a.left - b.left;
    if (Math.abs(dx) < 0.5) continue;
    el.animate(
      [{ transform: `translateX(${dx}px)` }, { transform: 'none' }],
      { duration: 560, easing: 'cubic-bezier(.2,.75,.1,1)' }
    );
  }
}

function renderSummary() {
  $summary.replaceChildren();
  if (state?.status === 'working') {
    $summary.append('Reading ', h('b', {}, plural(state.count, 'tab')));
    return;
  }
  if (draft) {
    $summary.append(h('b', {}, plural(draft.groups.length, 'group')));
    if (draft.loose.length) $summary.append(`, ${draft.loose.length} left loose`);
    return;
  }
  const groupCount = new Set(tabs.filter(t => t.groupId > -1).map(t => t.groupId)).size;
  $summary.append(h('b', {}, plural(tabs.length, 'tab')));
  if (groupCount) $summary.append(` in ${plural(groupCount, 'group')}`);
}

// ---------- views ----------

function viewWelcome() {
  return h('section', { class: 'welcome' },
    h('h1', {}, 'Add your Claude API key'),
    h('p', {}, 'Tidy Tabs sends tab titles and addresses to Claude, which suggests groups. The key stays in this browser.'),
    h('button', { class: 'btn btn-primary go', onclick: () => chrome.runtime.openOptionsPage() }, 'Open settings')
  );
}

function viewIdle() {
  const working = state?.status === 'working';
  const err = state?.status === 'error' ? state.error : flash;
  const dupes = duplicateCount();
  const anyGroups = tabs.some(t => t.groupId > -1);

  const parts = [];

  if (err) {
    const needsSettings = /key|model|Settings/i.test(err);
    parts.push(h('p', { class: 'error', role: 'alert' }, err,
      needsSettings ? h('button', { class: 'link', onclick: () => chrome.runtime.openOptionsPage() }, 'Open settings') : null));
  }

  parts.push(h('button', {
    class: 'btn btn-primary go',
    disabled: working || tabs.length < 2,
    onclick: organize
  }, working ? h('span', { class: 'dots' }, 'Sorting') : 'Organize tabs'));

  parts.push(h('p', { class: 'hint' },
    `${modelName(settings.model)}${shortcut ? `, or press ${shortcut}` : ''}`));

  if (state?.status === 'applied') {
    parts.push(h('div', { class: 'toast', role: 'status' },
      h('span', {}, `Grouped into ${plural(state.groupCount, 'group')}`),
      h('button', { class: 'link', onclick: undo }, 'Undo')));
  }

  parts.push(h('div', { class: 'tools' },
    h('button', { class: 'btn btn-quiet', disabled: !dupes || working, onclick: dedupe },
      dupes ? `Close ${plural(dupes, 'duplicate')}` : 'No duplicates'),
    h('button', { class: 'btn btn-quiet', disabled: !anyGroups || working, onclick: ungroupAll }, 'Ungroup all'),
    h('button', { class: 'btn btn-quiet', disabled: !anyGroups || working, onclick: toggleCollapse },
      [...groups.values()].every(g => g.collapsed) && anyGroups ? 'Expand all' : 'Collapse all')
  ));

  return parts;
}

function viewPreview() {
  const list = h('ul', { class: 'groups' });

  draft.groups.forEach((g, gi) => {
    const key = `p${gi}`;
    const open = openGroups.has(key);
    const ids = g.tabIds.filter(tabById);

    const name = h('input', {
      class: 'name', value: g.name, 'aria-label': 'Group name', spellcheck: 'false',
      onclick: e => e.stopPropagation(),
      oninput: e => { g.name = e.target.value; },
      onkeydown: e => { if (e.key === 'Enter') e.target.blur(); }
    });

    const row = h('div', { class: 'row', onclick: () => toggleOpen(key) },
      h('button', {
        class: 'swatch', style: `--c: var(--g-${g.color})`, 'aria-label': `Color ${g.color}`,
        onclick: e => { e.stopPropagation(); openGroups.add(key); render(); }
      }),
      name,
      open ? null : h('span', { class: 'icons' }, ids.slice(0, 4).map(id => h('img', { src: favicon(tabById(id).url), alt: '' }))),
      h('span', { class: 'count' }, ids.length),
      chevron()
    );

    const detail = open ? h('div', { class: 'detail' },
      h('div', { class: 'palette', role: 'group', 'aria-label': 'Group color' },
        COLORS.map(c => h('button', {
          style: `--c: var(--g-${c})`, 'aria-label': c, 'aria-pressed': String(c === g.color), title: c,
          onclick: () => { g.color = c; render(); }
        }))),
      h('ul', { class: 'tablist' }, ids.map(id => tabRow(id, () => leaveLoose(gi, id))))
    ) : null;

    list.append(h('li', { class: `group${open ? ' open' : ''}` }, row, detail));
  });

  const loose = draft.loose.filter(tabById);
  if (loose.length) {
    const open = openGroups.has('loose');
    list.append(h('li', { class: `group loose${open ? ' open' : ''}` },
      h('div', { class: 'row', onclick: () => toggleOpen('loose') },
        h('span', { class: 'swatch' }),
        h('span', { class: 'name' }, 'Left as they are'),
        h('span', { class: 'count' }, loose.length),
        chevron()),
      open ? h('div', { class: 'detail' }, h('ul', { class: 'tablist' }, loose.map(id => tabRow(id)))) : null
    ));
  }

  const usage = draft.usage
    ? `${modelName(draft.model)} used ${((draft.usage.input_tokens + draft.usage.output_tokens) / 1000).toFixed(1)}k tokens`
    : '';

  return [
    list,
    h('div', { class: 'actions' },
      h('button', { class: 'btn btn-primary', onclick: apply }, 'Apply'),
      h('button', { class: 'btn btn-quiet', onclick: discard }, 'Discard')),
    usage ? h('p', { class: 'usage' }, usage) : null
  ];
}

function tabRow(id, onRemove) {
  const t = tabById(id);
  return h('li', { title: t.url },
    h('img', { src: favicon(t.url), alt: '' }),
    h('span', {}, t.title || t.url),
    onRemove ? h('button', { class: 'x', 'aria-label': 'Leave this tab loose', title: 'Leave loose', onclick: onRemove }, cross()) : null
  );
}

function render() {
  renderStrip();
  renderSummary();
  // Don't rebuild the list while a group name is being typed.
  if (draft && document.activeElement?.classList.contains('name')) return;
  $main.replaceChildren();
  let view;
  if (!settings.apiKey) view = viewWelcome();
  else if (draft) view = viewPreview();
  else view = viewIdle();
  $main.append(...[view].flat().filter(Boolean));
}

// ---------- actions ----------

function toggleOpen(key) {
  if (openGroups.has(key)) openGroups.delete(key);
  else openGroups.add(key);
  render();
}

function leaveLoose(gi, id) {
  const g = draft.groups[gi];
  g.tabIds = g.tabIds.filter(x => x !== id);
  draft.loose.push(id);
  if (!g.tabIds.length) {
    draft.groups.splice(gi, 1);
    openGroups.clear();
  }
  render();
}

async function organize() {
  flash = '';
  openGroups.clear();
  state = { status: 'working', count: tabs.length };
  render();
  const res = await send({ type: 'propose' });
  if (!res?.ok && res?.error === 'NO_KEY') {
    settings = await getSettings();
  }
}

async function apply() {
  const plan = {
    groups: draft.groups
      .map(g => ({ ...g, name: g.name.trim() || 'Group' }))
      .filter(g => g.tabIds.length),
    loose: draft.loose
  };
  const res = await send({ type: 'apply', plan });
  if (!res?.ok) flash = res?.error || 'Could not apply the groups.';
  draft = null;
}

async function discard() {
  draft = null;
  openGroups.clear();
  await send({ type: 'discard' });
}

async function undo() {
  const res = await send({ type: 'undo' });
  if (!res?.ok) { flash = res?.error; render(); }
}

async function dedupe() {
  await send({ type: 'dedupe' });
}

async function ungroupAll() {
  await send({ type: 'ungroupAll' });
}

async function toggleCollapse() {
  const list = [...groups.values()];
  const collapse = !list.every(g => g.collapsed);
  const active = tabs.find(t => t.active);
  for (const g of list) {
    if (collapse && active && active.groupId === g.id) continue;
    await chrome.tabGroups.update(g.id, { collapsed: collapse });
  }
}

// ---------- boot ----------

let pending;
function refresh() {
  clearTimeout(pending);
  pending = setTimeout(async () => {
    await Promise.all([loadWindow(), loadState()]);
    render();
  }, 60);
}

async function boot() {
  const win = await chrome.windows.getCurrent();
  windowId = win.id;
  settings = await getSettings();
  const commands = await chrome.commands.getAll();
  shortcut = commands.find(c => c.name === 'organize-now')?.shortcut || '';

  await Promise.all([loadWindow(), loadState()]);
  render();

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === 'local') { settings = await getSettings(); render(); }
    if (area === 'session' && changes[stateKey(windowId)]) {
      if (changes[stateKey(windowId)].newValue?.status !== 'ready') draft = null;
      refresh();
    }
  });

  for (const ev of [chrome.tabs.onCreated, chrome.tabs.onRemoved, chrome.tabs.onUpdated, chrome.tabs.onMoved,
    chrome.tabs.onAttached, chrome.tabs.onDetached, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved]) {
    ev.addListener(refresh);
  }

  document.getElementById('open-settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
}

boot();
