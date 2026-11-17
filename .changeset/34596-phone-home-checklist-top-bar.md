---
'@object-ui/app-shell': patch
'@object-ui/console': patch
'@object-ui/i18n': patch
---

feat(console): on a phone, Home keeps its first screen for the apps, and the top bar's badge and title fit

Clause-②: yes (widening)
Metadata-protocol: none

**Home's setup checklist.** Below 768 px, Home draws the administrator's first-run checklist after the apps instead of above the greeting, folded to one line: its title, its progress ("2 of 5 done") and **Continue**. Continue opens the whole card in place; a fold control beside the progress closes it to one line again. A fresh visit starts folded. The rows, the progress count, the done rule and the close button are unchanged, and from 768 px up the card is drawn above the page as before. With no app yet the card stays above the empty state at every width.

`HomePage` (`@object-ui/app-shell`) takes an optional `checklist(placement)` slot: Home calls it with `'top'` on a desktop or with no app, and with `'afterApps'` on a phone, and draws what it returns there. The console's Home route passes the first-run checklist through it. `@object-ui/i18n` adds `console.firstRunChecklist.continue` to every pack.

**The phone top bar.** Below 768 px the bell's unread badge ("9+") sits inside the bell's 44 px target, on the glyph's corner, instead of 2 px above it, where the bar's top edge cut it. Below 640 px the bar's control groups draw no divider and no extra gap, and the page title beside the app pill takes no margin of its own, so the title keeps that width. The controls the bar shows are unchanged: search, the bell, the AI assistant (where the server serves AI) and the account menu.
