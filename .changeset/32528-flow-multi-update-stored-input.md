---
'@objectstack/lint': patch
---

feat(lint): a flow `update_record` with `multi: true` whose `fields` set an input of a stored computed field on its target object is warned at authoring (`flow-multi-update-moves-stored-input`)

Clause-②: yes (widening) — a new advisory and its rule id exported from the package root; no build, validate, save or publish that passed before is refused, and the engine's behaviour is unchanged.
Metadata-protocol: none

A stored computed field is any field but a `formula` that declares an `expression`; the engine computes it from the row each write stores. A predicate update writes one patch to every matched row and is never split into single-row writes, so the engine stores the computed value only when it is the same on every matched row, and refuses the whole update with `VALIDATION_FAILED` (nothing written) when the patch moves an input to values that compute differently on different rows. That refusal is unchanged. What is new is that `os validate`, `os build` and the flow save and publish doors now name it before the first run, with the shape that always works: `get_record` (same filter, `limit` above 1) → `loop` → `update_record` with `filter: { id: item.id }` and no `multi`.

An input is a field the `expression` reads as `record.FIELD`, through a reference field, or through another stored field that reads it; fields an object extension adds count. A target object the stack does not carry is not judged. The rule is a warning because a patch that computes the same value on every matched row is stored. `os explain flow-multi-update-moves-stored-input` carries the full explanation.
