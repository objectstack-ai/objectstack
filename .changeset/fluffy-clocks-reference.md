---
'@objectstack/spec': minor
---

Add the ADR-0087 D2 conversion `field-reference-to-alias` (#13700, ui#6837 half 1):
the legacy objectql field-key dialect `reference_to` canonicalizes to `reference` on
object and object-extension fields. The entry is `retiredFromLoadPath` from day one —
`FieldSchema` has always refused the key by name, and that authoring-surface rejection
is unchanged — so the widened accept surface is exactly the two paths that meet data
written around the Zod gate: stored `sys_metadata` rehydration (every serve seam now
emits only the canonical spelling, the guarantee objectui needs before deleting its
`reference ?? reference_to` fallback arms) and `os migrate meta` (including
`--stored`), which now rewrites the key mechanically. House #4923 precedence: an
already-canonical `reference` wins — a redundant twin is dropped, a disagreeing pair
is kept for the author to reconcile.
