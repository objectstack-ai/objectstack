---
"@objectstack/metadata-protocol": patch
---

Trim the dead `field` limb from `saveMetaItem`'s Phase 3a-destructive gate: the
reachable type set is `object` alone (#11014). The condition read
`(singularType === 'object' || singularType === 'field')` and the `field` half
could not produce a finding, so the gate's coverage *read* wider than it is —
#10886's face inventory had to establish per face which types reach this gate,
and the `field` spelling is the one thing that made the answer look bigger.

Both reasons the limb was inert were re-measured through the real `saveMetaItem`
before the deletion, and both hold:

1. **A `field` body has no `fields` map to diff.** The detector reads
   `prev.fields` / `next.fields`; a `field` item's body IS one field definition
   (`FieldSchema`, a `strictObject` declaring no `fields` key), so both sides
   fold to `{}`. Measured: a `text` → `number` change on a stored `field` row —
   the exact edit that raises `field_type_change` inside an object body — saved
   with no 409, while the same-shaped change on an `object` refused in the same
   harness.
2. **`field` is code-only** (`allowRuntimeCreate: false` and
   `allowOrgOverride: false` in the kernel registry), so the #5086 refusal one
   gate up answers first — `NOT_CREATABLE` for a runtime-only parent,
   `NOT_OVERRIDABLE` for an artifact-backed one — before persistence and before
   the diff.

Neither reason is absolute, and the trim is right because of where they stop.
Reason 2 stops at the documented operator hatch (`OS_METADATA_WRITABLE=field`),
which does carry a `field` write into the gate — reason 1 then holds it inert on
its own. Reason 1 stops at schema-valid bodies: the detector is type-agnostic, so
a *stored* `field` row carrying a `fields` map did fire the gate. That is the one
behaviour delta: such a save now succeeds instead of answering `409
DESTRUCTIVE_CHANGE`. It needed two faults at once (hatch open, plus a body
`FieldSchema` rejects with `unrecognized_keys: ['fields']`), and the refusal it
removed was a false alarm — a `field` write mints a standalone `sys_metadata` row
nothing composes into its parent object (#7893), so no driver ever materialised
the columns the finding named.

`object` behaviour is untouched: same predicate, same findings, same `409`
envelope, same remedy clause. The reachable type set is now pinned by
`protocol.destructive-gate-reachable-types.test.ts`, which carries the
measurements above and pairs every "no 409" assertion with a live `object`
control, so the limb cannot grow back on the reading it was deleted for.
