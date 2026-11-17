---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console-ai): the AI assistant is one right-side drawer, opened from the top-bar robot, with no full page

Clause-②: yes (widening — new @object-ui/i18n locale keys only)
Metadata-protocol: none

The console's AI assistant now has one container, the right-side drawer (ui ADR-0057, amended).

- The robot in the top bar opens and closes the drawer on the page you are on. The URL does not change. The floating button in the bottom-right corner is gone. While a proposed plan waits for approval, the robot carries the marker that button used to carry.
- The drawer's expand button makes it fill the window in place, with the conversation history as a column beside the chat. The same button puts it back as a side panel. Moving to another page puts it back too. At side-panel width the history is behind a "History" button. On a phone the drawer is a bottom sheet with the same "History" button.
- Home hosts the same drawer. "Build with AI" and "Ask AI" on Home, and "Edit with AI" in app management, open the drawer instead of a page. A new build still starts unbound to any app (ADR-0057 A1).
- The old `/ai`, `/ai/AGENT` and `/ai/AGENT/CONVERSATION` addresses still work. That includes bookmarks, shared links, `?package=` and `?new=`. They open the drawer on the conversation they name, filling the window, over the home page. A Builder handoff still travels only as navigation state.
- Inside an app, a builder's empty state offers data questions as well as changes, as the composer hint already did. Its description and its first suggestions name both.
- The drawer's share button now opens the share dialog. Before, it did nothing in the drawer.

`@object-ui/i18n`: new keys `console.ai.dock.history`, `console.ai.dock.backToChat`, `console.ai.dock.expand`, `console.ai.dock.restore` and `console.ai.empty.editApp.askOrChangeDescription`, in every locale pack. No key was removed or changed. The console no longer reads `console.ai.dock.maximize` or `console.ai.empty.editApp.description`. Retiring them is a separate change.
