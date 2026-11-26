---
'@objectstack/skills': patch
---

docs(skills): objectstack-ui teaches `navigation: { openNewTab: true }` for a list that opens records in a new tab

Clause-②: no
Metadata-protocol: none

Step 5 of the record-page rules told authors to omit `navigation.mode: 'new_window'` on an object's list and named no replacement. It now says a list that wants a new tab writes `navigation: { openNewTab: true }`, and that a phone opens the page in place. Text only; nearby prose in the same file is tightened to pay for it.
