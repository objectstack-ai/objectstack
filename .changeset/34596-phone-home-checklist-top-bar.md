---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): on a phone, Home keeps its first screen for the apps — the setup checklist folds to one line after them

Clause-②: no
Metadata-protocol: none

Below 768 px, Home draws the administrator's first-run checklist after the apps instead of above the greeting, folded to one line: its title, its progress (「已完成 2/5」, "2 of 5 done") and **Continue**. Continue opens the whole card in place; a fold control beside the progress closes it to one line again. A fresh visit starts folded. The rows, the progress count, the done rule and the close button are unchanged, and from 768 px up the card is drawn above the page as before. With no app yet the card stays above the empty state at every width.

`HomePage` (`@object-ui/app-shell`) takes an optional `checklist(placement)` slot: Home calls it with `'top'` on a desktop or with no app, and with `'afterApps'` on a phone, and draws what it returns there. The console's Home route passes the first-run checklist through it. `@object-ui/i18n` adds `console.firstRunChecklist.continue` to every pack.
