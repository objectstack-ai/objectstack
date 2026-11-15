---
'@objectstack/skills': patch
---

docs(skills): a stored computed field reads only its own row; the skills name the cross-record and volatile-input warnings

Clause-②: no
Metadata-protocol: none

The three places the published skills tell an agent to move a `formula`'s `expression` onto a stored field now say what that field may read. `objectstack-data` → Relationships → Computed column owns the sentence: a stored computed field reads only its own row; a related record's value (`record.product.unit_price`) keeps what it held at the row's last write and draws the `stored-expression-cross-record-input` warning, so it stays a `formula` (read time, not totallable) or becomes a snapshot a flow on the related object writes, with drift repaired by `os migrate stored-expressions --object OBJECT --field FIELD --changed --apply`; `now()`, `today()`, the acting user and `can()` are fixed at the write and draw `stored-expression-volatile-input`. The `formula` row in `rules/field-types.md` and the total-over-a-computed-value bullet in `objectstack-ui` `rules/dashboards.md` point to it. The dashboards bullet also stops saying existing rows have no backfill: `os migrate stored-expressions --apply` fills them. Both rules are warnings, not refusals; no schema or runtime change.
