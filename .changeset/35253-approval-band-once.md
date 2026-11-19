---
'@object-ui/plugin-detail': patch
---

fix(plugin-detail): the record page draws its approval band once when the details are split around a body table

Clause-②: no
Metadata-protocol: none

The synthesized default record page splits its details around a body table (a `relatedList: 'primary'` list, such as a quote's or an opportunity's line items): one `record:details` part per run of sections. Each part mounted its own `DetailView`, and each drew the record's approval band, so an approval-locked record showed "Locked for approval" twice, above the table and again above the next section. The laid-out page now has the first details part alone draw the band, above the table. An authored page's details body, a standalone `DetailView` and the record drawer are unchanged, and so is the lock rule: an approval node with `lockRecord: false` still reads as an editable approval.
