---
'@objectstack/core': patch
---

docs: the external org-wide-default floor's docblock no longer lists `controlled_by_parent` among the models it closes

Clause-②: no
Metadata-protocol: none

`owdForAudience`'s module docblock said an external is floored on a `controlled_by_parent` detail. It is not: plugin-sharing exempts the detail, whose rows follow its master, and the master meets the floor (#25541). Comment only; no behaviour changes.
