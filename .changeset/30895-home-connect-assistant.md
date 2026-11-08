---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
'@object-ui/console': patch
---

feat(console): Home offers Connect an AI Assistant until the person has connected one; the first-run checklist gains its row

Clause-②: yes (widening)
Metadata-protocol: none

- **`@object-ui/app-shell`**: Home shows a card to every signed-in person who has connected nothing yet: they can work in this system from Claude, Doubao and similar AI assistants, as themselves, with one button to Connect an AI Assistant. It is hidden once they have authorized an assistant or hold an API key that still works (read by `useConnectedAccess`, the same read as the Connect page's Connected line), and once they close it (remembered for that person on that browser, like Home's other dismissible items). While the read is out or fails, and where MCP is turned off, it is not shown. `useConnectedAccess` and `connectAssistantPath` are now exported, and the avatar menu item reads its path from `connectAssistantPath`.
- **`@object-ui/console`**: the administrator's first-run checklist gains "Connect an AI assistant", done once that administrator has authorized an assistant or holds a working API key (never from a click), with a link to the page; left out when that cannot be read or MCP is turned off.
- **`@object-ui/i18n`**: `home.connectAssistant.title`, `body`, `action`, `dismiss` and `console.firstRunChecklist.connectAssistant.title`, `todo`, `done`, `action` added in all eleven packs.
