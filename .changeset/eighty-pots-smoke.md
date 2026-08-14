---
'@objectstack/objectql': patch
---

Stop serving a `__search` companion column the registry never provisioned.

The `/meta` object read exits replay the registry's materialization seam onto the
served document, but that document has already had its `extend` contributors
folded on. Every stamp whose decision reads the field set was therefore re-decided
over a strictly larger map than the registry ever judged: an object whose own base
layer has no title-eligible field, extended by a contributor that adds one, was
served a `__search` column by both `GET /meta/object/:name` and `GET /meta/object`
while `registry.getObject()` had none — a column the driver's `syncSchema` never
created.

The seam now materializes a BASE layer in the only way available to it: a
document-sensitive stamp is withheld when this registry has resolved the object and
its own answer does not carry that stamp. This generalises the `nameField` withhold
into the seam's one rule, so convergence can only move the served copy onto the
registry's answer and never manufacture a stamp the registry declined. Extensions do
not redesignate the owner's title (ADR-0079).

No schema migration: the divergence is removed rather than repaired by growing the
schema — no object gains a column it did not already have.
