---
"@objectstack/spec": minor
"@objectstack/metadata-protocol": patch
---

feat(spec): `Field.autonumber` declares the field `readonly: true` (#5628)

`FieldSchema.readonly` is a **two-part** contract: "never editable in forms"
AND server-enforced on both write paths. #5503 closed the server half for
`autonumber` **by type** — a caller-supplied record number is stripped before
any driver sees it, flag or no flag. The form half is keyed on the **flag**, and
`Field.autonumber` never set it. So an authoring/rendering layer that decides
editability from `field.readonly` drew an editable "record number" input whose
value the server was already guaranteed to discard: the user types one, the
create succeeds, and the record comes back carrying the number the sequence
issued instead. Data was never at risk (that half has been enforced since
#5503/#5627); what was wrong is what the form told the user.

`Field.autonumber(...)` now emits `readonly: true`. The injection is applied
**after** the author's config, so it cannot be spread away, and the authoring
type rejects the one config that contradicts it — `Field.autonumber({ readonly:
false })` is a **compile error** rather than a silently coerced value, because
an "editable record number" is not a state the runtime can deliver. Restating
`readonly: true` stays legal. A hand-written `{ type: 'autonumber' }` literal
(YAML/JSON metadata, or a plain object in TS) is unchanged and unaffected: it is
covered by the by-type server enforcement, which never depended on the flag.

Two consequences worth knowing:

- **A flow that writes an autonumber field is now caught at `os validate`.**
  `flow-update-readonly-field` reads the static flag, so an `update_record` node
  writing a builder-authored record number — already a silent no-op at run time
  — is now reported at design time instead of in server WARN logs.
- **The historical-import exemption is unchanged**, and stays that way by
  construction. The DataProtocol create ingress (`stripReadonlyForInsert`,
  #3043) knows only the `isSystem` exemption, while the engine's runtime-owned
  strip also honours `preserveAudit` (#3493 — a migration reinstating legacy
  record numbers). Now that the field carries the flag, the ingress would have
  deleted that value *before* the engine could keep it, so the ingress skips
  runtime-owned field types outright and leaves them to the engine strip, which
  runs on every insert path (including the direct `engine.insert` callers the
  ingress never sees). Author-declared `readonly` on every other field type is
  stripped at the ingress exactly as wide as before.

The set backing "which types the runtime owns" is now declared once in the
protocol — `RUNTIME_OWNED_FIELD_TYPES`, exported from `@objectstack/spec/data`
— and read by both consumers (objectql's write-path strips, the DataProtocol
ingress) instead of each carrying its own literal.
