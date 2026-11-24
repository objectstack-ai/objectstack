---
'@objectstack/skills': patch
---

Clause-②: no
Metadata-protocol: none

`objectstack-ui` record-page rule: an authored `kind: 'full'` record page is drawn on the desktop full page only. A phone and the side drawer draw the standard page (the object's declarations plus any slotted page), and no key keeps a full page there; a page named in the URL, such as a print page, still draws everywhere. The standard page draws no `record_section` action, so an action that must show on a phone or in the drawer also lists `record_more` in its `locations`. The drawer step now says the drawer always shows the standard page.
