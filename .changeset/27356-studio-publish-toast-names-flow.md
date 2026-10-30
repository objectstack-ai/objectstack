---
'@object-ui/app-shell': patch
'@object-ui/i18n': patch
---

feat(studio): publishing the organization's own flows names them in the toast

Clause-②: no
Metadata-protocol: none

On Studio's Organization flows scope (flows in no package), publishing drafts used to toast "Published 1 package-less flow draft", which said neither which flow went live nor in plain words. One published flow now reads `Published flow "Lead follow-up"`, by its label (its machine name when it has none). Several read `Published 3 flows` with their names listed under it. A refusal and the nothing-pending answer are unchanged.
