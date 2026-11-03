---
'@objectstack/skills': patch
---

docs(skills): objectstack-data teaches `relatedList` placement by each value's role, not by record-page tabs or columns

Clause-②: no
Metadata-protocol: none

- **Before.** `rules/relationships.md` said `relatedList: 'primary'` draws "a full-width table in the details column after the first field section (in the Details tab, no tab of its own)" and that `true` / omitted is "a side card (the shared **Related** tab)". The spec's `relatedList` describe no longer names any tab or column, so the skill taught a page layout the record page does not draw.
- **Now.** The three bullets follow the spec describe: `'primary'` is part of the record's main content, a full-width table in the record's detail body (still the default for an inline-edited `master_detail` FK); `false` means the child object is not shown on the parent record page; `true` or omitted is an auxiliary panel on the record page. Layout stays ADR-0085's to define.
- The file gets smaller and stays under its token ceiling; no ceiling moves, no schema, key or behaviour changes.
