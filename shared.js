// Shared constants and helpers for the popup, settings page and service worker.

export const COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];

export const MODELS = [
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5', note: 'Fast and cheap. Right for almost every window.' },
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5', note: 'Better at telling related projects apart.' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5', note: 'Most careful. Slower and costs more per run.' }
];

export const LANGUAGES = [
  { id: 'auto', name: 'Match my tabs' },
  { id: 'en', name: 'English' },
  { id: 'zh', name: '中文' }
];

export const DEFAULTS = {
  apiKey: '',
  model: 'claude-haiku-5-5',
  language: 'auto',
  instructions: '',
  collapse: false
};

export async function getSettings() {
  const stored = await chrome.storage.local.get(Object.keys(DEFAULTS));
  return { ...DEFAULTS, ...stored };
}

export function modelName(id) {
  return (MODELS.find(m => m.id === id) || { name: id }).name;
}

// Key used for per-window state in chrome.storage.session.
export const stateKey = windowId => `state:${windowId}`;
export const undoKey = windowId => `undo:${windowId}`;

export function normalizeUrl(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.toString();
  } catch {
    return url || '';
  }
}
