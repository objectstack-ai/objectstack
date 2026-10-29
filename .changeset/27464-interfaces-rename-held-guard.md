---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

fix(studio): a navigation rename typed in the Interfaces nav editor but not yet committed now asks before a reload or a tab close

Clause-②: no
Metadata-protocol: none

A rename in the nav editor commits on blur or Enter. Before either, the typed label lived only in the input, so a reload or a tab close dropped it with no prompt, while every other held Studio edit asked. `AppNavCanvas` gains an optional `onRenamePendingChange` report, and the Interfaces pillar folds it into the same held-edit report the other pillars use, so the surface's one `beforeunload` guard covers it and Publish names it as an edit not finished yet. Escape, or typing the authored label back, lets the guard go.
