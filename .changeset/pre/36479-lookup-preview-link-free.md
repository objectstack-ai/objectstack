---
'@object-ui/fields': patch
---

fix(fields): a tap anywhere on a lookup picker option selects it, including on a record chip in its preview

Clause-②: no
Metadata-protocol: none

A lookup picker's option shows a preview of its other columns under its label. A column that references another record drew a link to that record there (on a record page, its chip), and a tap or a click on it opened that record instead of selecting the option, leaving the edit behind. An email, URL or phone column in the preview did the same with the mail client, the browser or the dialer.

The preview now draws every column the way the "browse all records" picker table already did: a reference keeps its face, the record page's chip included, without the link, and an email, URL, phone or file column shows its text. A tap or a click anywhere on the option selects it, on a phone and on a desktop. Both picker surfaces now take this rule from the one renderer they share.

What does not change: the read cells outside the picker (record page fields, list and grid cells) keep their links. No metadata key, value or default changes.
