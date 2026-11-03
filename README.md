# Tidy Tabs

A Chrome extension that groups your open tabs with Claude. Click once, review the suggested groups, apply. Undo if you don't like it.

Tidy Tabs groups by what you're working on, not by website. Tabs from GitHub, arXiv and a docs site about the same project end up together. Tabs that don't fit anywhere are left alone instead of being dumped into a catch-all group.

## Features

- **Preview before applying.** Rename a group, change its color, or take a tab out of it before anything changes in your window.
- **One-step undo.** Restores the previous groups and tab order.
- **Your own rules.** Write plain-language instructions such as "put arXiv papers under Reading" and Claude follows them every time.
- **Keyboard shortcut.** Alt+Shift+O organizes and applies in one step, without the preview.
- **Small tools.** Close duplicate tabs, ungroup everything, collapse or expand all groups.
- **Light and dark mode**, following your system setting.

Pinned tabs are never touched.

## Install

Tidy Tabs isn't on the Chrome Web Store. You load it from source, which takes about a minute.

1. Download this repository (Code, then Download ZIP) and unzip it, or clone it:
   ```
   git clone https://github.com/HongweiRuan/Tidy-Tabs.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** in the top right corner.
4. Click **Load unpacked** and choose the `Tidy-Tabs` folder (the one that contains `manifest.json`).
5. Open the puzzle-piece menu in the toolbar and pin Tidy Tabs so it's one click away.

Keep the folder where it is after loading. Chrome runs the extension from that folder, and moving it means loading it again.

## Get a Claude API key

Tidy Tabs calls the Claude API with your own key, so you pay for your own usage directly.

1. Sign in to [Claude Console](https://platform.claude.com/) and create a key under API keys.
2. Make sure the organization has credits. If you're on a Claude Max or Team plan, your plan includes monthly API credits: claim them from Settings, then Billing on claude.ai, which links them to a Console organization. Otherwise add credits in Console.
3. Click the Tidy Tabs icon, then the settings icon in the top right of the popup.
4. Paste the key and click **Check key**.

Console shows a new key only once, so keep a copy in your password manager.

## Use it

1. Click the Tidy Tabs icon and press **Organize tabs**.
2. Claude reads the window and suggests groups. The colored strip at the top shows the new layout.
3. Adjust anything you want:
   - Click a group name to rename it.
   - Click a group's row to expand it, then pick a color or remove a tab with the × next to it.
4. Press **Apply**. Press **Undo** right after if you change your mind.

Running it again later reuses the names and colors of groups that still fit, so your layout stays stable over time.

## Settings

| Setting | What it does |
| --- | --- |
| Model | Haiku 5.5 by default, which is fast and handles almost any window well. Sonnet 5.5 and Opus 5.5 are more careful with closely related projects and cost more per run. |
| Group names | Write group names in English, Chinese, or the language most of your tabs are in. |
| Your rules | Instructions Claude follows on every run. They take priority over the built-in grouping rules. |
| After applying | Optionally collapse the new groups. The group holding your current tab always stays open. |
| Shortcut | Change it at `chrome://extensions/shortcuts`. |

Example rules:

```
Keep everything for my thesis in one group called Thesis.
Put arXiv papers and blog posts under Reading.
Never group email with anything else.
```

## Cost

Organizing a window usually takes a few thousand tokens, so each run costs a fraction of a cent with Haiku 5.5. The popup shows how many tokens the last run used, under the Apply button.

## Privacy

- **What is sent:** for each unpinned tab in the current window, its title and address (host and path only, without the query string or fragment), plus the name of any group it's already in. Page contents are never read.
- **Where it goes:** only to `api.anthropic.com`, using your key. There is no other server, no analytics and no tracking.
- **Where your key lives:** in Chrome's local storage for this extension, in your browser profile. It's not in the extension folder, not synced through your Google account, and not readable by websites or other extensions. Removing the extension deletes it.

### Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Read tab titles and addresses, close duplicates |
| `tabGroups` | Create, name, color and move tab groups |
| `storage` | Save your key and settings, hold the preview while it's open |
| `favicon` | Show site icons in the preview |
| `api.anthropic.com` | Call the Claude API |

## Troubleshooting

**"Your API key was rejected."** The key was mistyped, revoked, or belongs to a deleted organization. Create a new one in Console and paste it again.

**"Your Console organization is out of credits."** Add credits in Console. Monthly plan credits refresh with your billing cycle.

**"The model isn't available to your key."** Pick a different model in Settings.

**The shortcut does nothing.** Another extension or app may already use Alt+Shift+O. Set a different one at `chrome://extensions/shortcuts`.

**My key disappeared after an update.** Chrome treats an unpacked extension loaded from a new folder location as a different extension. Update by replacing the files in the original folder and clicking the reload button on the extension's card in `chrome://extensions`.

## Project structure

```
Tidy-Tabs/
├── manifest.json     Extension manifest (Manifest V3)
├── background.js     Service worker: calls Claude, applies groups, undo, duplicates
├── shared.js         Constants and settings helpers
├── popup.html/.css/.js     The toolbar popup
├── options.html/.css/.js   The settings page
├── base.css          Shared design tokens and buttons
├── fonts/            Instrument Sans (SIL Open Font License)
└── icons/
```

No build step and no dependencies. Edit a file, then click reload on the extension's card in `chrome://extensions`.