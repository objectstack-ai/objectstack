---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(console): the left sidebar resizes by its right edge, the collapsed sidebar floats as a card, and a menu opened from the float no longer leaves it folded with the menu cut off

Clause-②: yes (widening) — one new `@object-ui/i18n` key (`sidebar.resize`) in all 11 locales; no spec, schema, server or published export change
Metadata-protocol: none

- **Resize** (`@object-ui/app-shell`): from 768 px up, the docked sidebar's right edge drags it between 200 and 350 px; a double-click comes back to 256; ← → move it 16 px, Home and End to either end. The width is kept in this browser (`console.sidebar.width`) and the menu floating over a collapsed sidebar takes it too. A phone's drawer keeps its own width.
- **The float is a card:** 8 px off the window's left, top and bottom edges, with rounded corners, a border and a shadow; the page under it is not dimmed or moved. Resting the pointer at the window's left edge still floats it and moving away still folds it.
- **A menu opened from the float keeps it out:** pressing the app name (or the account, or an entry's `…`) while the float was still sliding in under the pointer opened the menu and folded the float a moment later, leaving the menu cut off at the window's left edge. A press in the float now stops the fold's clock, and the fold does not happen while a menu or dialog is open, or while the pointer is on the float.
