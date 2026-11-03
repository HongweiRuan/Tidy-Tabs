import { COLORS, getSettings, stateKey, undoKey, normalizeUrl } from './shared.js';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TABS = 400;

// ---------- messaging ----------

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  route(msg)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(err => sendResponse({ ok: false, error: err.message || String(err) }));
  return true;
});

async function route(msg) {
  switch (msg.type) {
    case 'propose': return propose(msg.windowId);
    case 'apply': return apply(msg.windowId, msg.plan);
    case 'undo': return undo(msg.windowId);
    case 'discard': return setState(msg.windowId, null);
    case 'dedupe': return dedupe(msg.windowId);
    case 'ungroupAll': return ungroupAll(msg.windowId);
    case 'testKey': return testKey(msg.apiKey);
    default: throw new Error(`Unknown request: ${msg.type}`);
  }
}

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'organize-now') return;
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  try {
    const { plan } = await propose(win.id);
    await apply(win.id, plan);
  } catch (err) {
    flashBadge('!', '#B3261E');
  }
});

// ---------- state ----------

async function setState(windowId, value) {
  const key = stateKey(windowId);
  if (value === null) await chrome.storage.session.remove(key);
  else await chrome.storage.session.set({ [key]: value });
  return {};
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

function flashBadge(text, color) {
  setBadge(text, color);
  setTimeout(() => setBadge(''), 4000);
}

// ---------- reading the window ----------

async function readWindow(windowId) {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  const groupById = new Map(groups.map(g => [g.id, g]));
  const loose = tabs.filter(t => !t.pinned);
  return { tabs: loose, groups, groupById };
}

function describeTab(tab, groupById) {
  const title = (tab.title || '').replace(/\s+/g, ' ').trim().slice(0, 110);
  let where = tab.url || tab.pendingUrl || '';
  try {
    const u = new URL(where);
    where = (u.host + u.pathname).replace(/\/$/, '').slice(0, 90);
  } catch {
    where = where.slice(0, 90);
  }
  const group = tab.groupId !== -1 ? groupById.get(tab.groupId) : null;
  const tag = group && group.title ? ` (in group "${group.title}")` : '';
  return `[${tab.id}] ${title || '(untitled)'} | ${where}${tag}`;
}

// ---------- asking Claude ----------

const TOOL = {
  name: 'organize_tabs',
  description: 'Propose how to arrange the tabs into Chrome tab groups.',
  input_schema: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        description: 'Tab groups in the order they should appear, left to right.',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Short group name, 1 to 3 words.' },
            color: { type: 'string', enum: COLORS },
            tab_ids: { type: 'array', items: { type: 'integer' } }
          },
          required: ['name', 'color', 'tab_ids']
        }
      }
    },
    required: ['groups']
  }
};

function systemPrompt(settings) {
  const language = {
    auto: 'Write group names in the language most of the tabs are in.',
    en: 'Write group names in English.',
    zh: 'Write group names in Simplified Chinese.'
  }[settings.language] || '';

  return [
    'You arrange a person\'s open browser tabs into Chrome tab groups so the window is easy to scan.',
    '',
    'How to group:',
    '- Group by the task or topic the person is working on, not by website. Tabs from different sites about the same project belong together.',
    '- A site that is a tool in its own right (mail, calendar, chat) can be its own group when there are several such tabs.',
    '- Every group needs at least 2 tabs. Leave a tab out of every group when nothing fits it. Leaving a few tabs loose is better than a vague catch-all group.',
    '- Usually 3 to 8 groups. Fewer when there are few tabs.',
    '- Use each tab id at most once, and only ids from the list.',
    '- Order groups by how active they look, most active first.',
    '',
    'Naming:',
    '- 1 to 3 words, specific and plain, like "NAVSIM eval" or "Flights to Tokyo". No emoji, no punctuation at the ends.',
    '- When an existing group still fits, keep its exact name.',
    `- ${language}`,
    '',
    'Colors: pick from the allowed list, give different groups different colors where possible, and keep the color of an existing group you reuse.',
    settings.instructions.trim()
      ? `\nThe person\'s own rules, which take priority over the above:\n${settings.instructions.trim()}`
      : ''
  ].join('\n');
}

// Models that reject a forced tool_choice. Learned at runtime and remembered.
const NO_FORCED_TOOL = new Set();

async function request(settings, userText, forced) {
  const body = {
    model: settings.model,
    max_tokens: forced ? 4096 : 16000,
    system: systemPrompt(settings) + (forced ? '' : '\n\nAlways answer by calling the organize_tabs tool exactly once. Do not reply in plain text.'),
    tools: [TOOL],
    tool_choice: forced ? { type: 'tool', name: TOOL.name } : { type: 'auto' },
    messages: [{ role: 'user', content: userText }]
  };
  try {
    return await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error('Could not reach the Claude API. Check your connection and try again.');
  }
}

// Fallback when a model answers in text: pull the first JSON object with "groups" out of it.
function parseTextPlan(content) {
  const text = (content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return Array.isArray(obj.groups) ? obj : null;
  } catch {
    return null;
  }
}

async function callClaude(settings, userText) {
  if (!settings.apiKey) throw new Error('NO_KEY');

  let forced = !NO_FORCED_TOOL.has(settings.model);
  let res = await request(settings, userText, forced);
  let body = await res.json().catch(() => ({}));

  if (!res.ok && forced && res.status === 400 && /tool_choice/i.test(body?.error?.message || '')) {
    NO_FORCED_TOOL.add(settings.model);
    forced = false;
    res = await request(settings, userText, false);
    body = await res.json().catch(() => ({}));
  }

  if (!res.ok) {
    const detail = body?.error?.message || `HTTP ${res.status}`;
    if (res.status === 401) throw new Error('Your API key was rejected. Paste a fresh one in Settings.');
    if (res.status === 429) throw new Error('Rate limited by the API. Wait a few seconds and try again.');
    if (res.status === 404) throw new Error(`The model isn't available to your key. Pick another one in Settings. (${detail})`);
    if (/credit|balance/i.test(detail)) throw new Error('Your Console organization is out of credits. Monthly credits refresh with your billing cycle.');
    throw new Error(detail);
  }

  const call = (body.content || []).find(c => c.type === 'tool_use' && c.name === TOOL.name);
  const input = call ? call.input : parseTextPlan(body.content);
  if (!input) throw new Error('Claude returned no grouping. Try again.');
  return { input, usage: body.usage };
}

function cleanPlan(raw, tabs) {
  const valid = new Set(tabs.map(t => t.id));
  const used = new Set();
  const groups = [];

  for (const g of raw.groups || []) {
    const ids = (g.tab_ids || []).filter(id => valid.has(id) && !used.has(id));
    if (ids.length < 2) continue;
    ids.forEach(id => used.add(id));
    groups.push({
      name: String(g.name || 'Group').trim().slice(0, 40),
      color: COLORS.includes(g.color) ? g.color : 'grey',
      tabIds: ids
    });
  }

  // Keep tabs inside a group in their current left-to-right order.
  const order = new Map(tabs.map((t, i) => [t.id, i]));
  groups.forEach(g => g.tabIds.sort((a, b) => order.get(a) - order.get(b)));

  const loose = tabs.map(t => t.id).filter(id => !used.has(id));
  return { groups, loose };
}

async function propose(windowId) {
  const settings = await getSettings();
  const { tabs, groupById } = await readWindow(windowId);
  if (tabs.length < 2) throw new Error('There are not enough unpinned tabs here to group.');

  const sample = tabs.slice(0, MAX_TABS);
  await setState(windowId, { status: 'working', count: sample.length, startedAt: Date.now() });
  setBadge('…', '#1B2230');

  try {
    const lines = sample.map(t => describeTab(t, groupById)).join('\n');
    const { input, usage } = await callClaude(settings, `Here are the tabs in this window, one per line as [id] title | address:\n\n${lines}`);
    const plan = cleanPlan(input, sample);
    plan.model = settings.model;
    plan.usage = usage;
    await setState(windowId, { status: 'ready', plan });
    setBadge('');
    return { plan };
  } catch (err) {
    setBadge('');
    const message = err.message === 'NO_KEY' ? 'NO_KEY' : err.message;
    await setState(windowId, { status: 'error', error: message });
    throw err;
  }
}

// ---------- applying ----------

async function snapshot(windowId) {
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query({ windowId }),
    chrome.tabGroups.query({ windowId })
  ]);
  return {
    tabs: tabs.map(t => ({ id: t.id, index: t.index, groupId: t.groupId, pinned: t.pinned })),
    groups: groups.map(g => ({ id: g.id, title: g.title, color: g.color, collapsed: g.collapsed }))
  };
}

async function apply(windowId, plan) {
  if (!plan || !plan.groups) throw new Error('Nothing to apply.');

  const before = await snapshot(windowId);
  await chrome.storage.session.set({ [undoKey(windowId)]: before });

  const { tabs, groups: existing } = await readWindow(windowId);
  const present = new Map(tabs.map(t => [t.id, t]));
  const byTitle = new Map(existing.filter(g => g.title).map(g => [g.title.toLowerCase(), g.id]));
  const active = tabs.find(t => t.active);
  const settings = await getSettings();

  // Tabs the plan leaves loose come out of their old groups first.
  const looseGrouped = (plan.loose || []).filter(id => present.get(id)?.groupId > -1);
  if (looseGrouped.length) await chrome.tabs.ungroup(looseGrouped);

  const created = [];
  for (const g of plan.groups) {
    const ids = g.tabIds.filter(id => present.has(id));
    if (!ids.length) continue;
    const reuse = byTitle.get(g.name.toLowerCase());
    let groupId;
    if (reuse !== undefined) {
      try {
        groupId = await chrome.tabs.group({ groupId: reuse, tabIds: ids });
      } catch {
        groupId = undefined;
      }
      byTitle.delete(g.name.toLowerCase());
    }
    if (groupId === undefined) {
      groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
    }
    await chrome.tabGroups.update(groupId, { title: g.name, color: g.color, collapsed: false });
    created.push({ groupId, ids });
  }

  // Lay groups out left to right in plan order, after any loose tabs.
  for (const { groupId } of created) {
    await chrome.tabGroups.move(groupId, { index: -1 });
  }

  if (settings.collapse) {
    for (const { groupId, ids } of created) {
      if (active && ids.includes(active.id)) continue;
      await chrome.tabGroups.update(groupId, { collapsed: true });
    }
  }

  await setState(windowId, { status: 'applied', groupCount: created.length, at: Date.now() });
  flashBadge(String(created.length), '#1B2230');
  return { groupCount: created.length };
}

async function undo(windowId) {
  const key = undoKey(windowId);
  const { [key]: snap } = await chrome.storage.session.get(key);
  if (!snap) throw new Error('Nothing to undo.');

  const tabs = await chrome.tabs.query({ windowId });
  const alive = new Set(tabs.map(t => t.id));
  const grouped = tabs.filter(t => t.groupId > -1 && !t.pinned).map(t => t.id);
  if (grouped.length) await chrome.tabs.ungroup(grouped);

  // Restore order first, then rebuild groups over contiguous runs.
  const order = snap.tabs.filter(t => alive.has(t.id) && !t.pinned).sort((a, b) => a.index - b.index);
  for (const t of order) {
    try { await chrome.tabs.move(t.id, { index: t.index }); } catch { /* window changed */ }
  }

  for (const g of snap.groups) {
    const ids = snap.tabs.filter(t => t.groupId === g.id && alive.has(t.id)).map(t => t.id);
    if (!ids.length) continue;
    const id = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId } });
    await chrome.tabGroups.update(id, { title: g.title, color: g.color, collapsed: g.collapsed });
  }

  await chrome.storage.session.remove(key);
  await setState(windowId, null);
  return {};
}

// ---------- small tools ----------

async function dedupe(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const seen = new Map();
  const close = [];
  // Visit the active tab first so it is always the one kept.
  const ordered = [...tabs].sort((a, b) => (b.active - a.active) || (b.pinned - a.pinned) || (a.index - b.index));
  for (const t of ordered) {
    const key = normalizeUrl(t.url || t.pendingUrl);
    if (!key) continue;
    if (seen.has(key)) close.push(t.id);
    else seen.set(key, t.id);
  }
  if (close.length) await chrome.tabs.remove(close);
  return { closed: close.length };
}

async function ungroupAll(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  const ids = tabs.filter(t => t.groupId > -1).map(t => t.id);
  if (ids.length) await chrome.tabs.ungroup(ids);
  return { count: ids.length };
}

async function testKey(apiKey) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      }
    });
  } catch {
    throw new Error('Could not reach the Claude API.');
  }
  if (res.status === 401) throw new Error('This key was rejected.');
  if (!res.ok) throw new Error(`The API answered with HTTP ${res.status}.`);
  return {};
}
