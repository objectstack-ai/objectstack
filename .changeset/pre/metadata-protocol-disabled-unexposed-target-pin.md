---
'@objectstack/metadata-protocol': patch
---

Clause-②: no
Metadata-protocol: none

Docblocks of the `$expand` and nested-relation target checks now name the
disabled-package predicate beside the exposure decision: a lookup from an
enabled object into a disabled package's object keeps its stored id under
`$expand`, and a condition on that object's fields is refused `404
OBJECT_PACKAGE_DISABLED`, before (and instead of) the exposure refusal when the
target is also unexposed. No behaviour change; a new pin holds the order.
