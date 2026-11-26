---
'@object-ui/app-shell': patch
---

fix(studio): a metadata page's title row with no buttons of its own draws no hairline before the AI assistant

Clause-②: no
Metadata-protocol: none

Under Studio, the AI assistant (or, with no assistant served, the right panel's show / hide button) ends every page's title row behind a thin divider that separates it from the page's own buttons. On a metadata list or item page with no stats and no buttons, that divider stood alone at the start of the group with nothing before it. It is now drawn only when the row has stats or buttons of its own, or while Save is shown, as the item header and the metadata directory already did. Outside Studio nothing changes.
