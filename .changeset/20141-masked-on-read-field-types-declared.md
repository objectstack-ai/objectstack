---
'@objectstack/spec': minor
'@objectstack/objectql': patch
---

`@objectstack/spec/data` declares which field types are masked on read — `MASKED_ON_READ_FIELD_TYPES` and `isMaskedOnReadFieldType(fieldType, managedBy)` (#20141)

Clause-②: yes

The protocol used to state this only in prose (the `FieldType` comments), so
two consumers each carried their own hand-written copy: objectql's
`collectMaskedReadFields` (the generic read mask and the echoed-mask write
guard) and the renderer's masked-type set. The fact is now declared once:

- `MASKED_ON_READ_FIELD_TYPES` — a deep-frozen per-type rule table:
  `secret` is masked on every object; `password` is masked on every object
  except `managedBy: 'better-auth'` ones. Each masked type carries its own
  `exemptManagedBy` list, typed against `ObjectSchema.managedBy`'s enum.
- `isMaskedOnReadFieldType(fieldType, managedBy)` — the one reading of that
  table. `managedBy` is a required argument (pass `undefined` when the object
  has none), and exemptions fail closed: an absent or unlisted `managedBy`
  never unmasks a masked type.

`@objectstack/objectql`: `collectMaskedReadFields` and
`collectMaskedPasswordFields` now ask `isMaskedOnReadFieldType` instead of
carrying their own `type === 'secret'` / `'password'` arms. No behaviour
change: the masked-on-read answer is identical for every `FieldType` ×
`managedBy` cell, pinned by a table test.

A client that renders credential fields (show the mask, offer no copy) should
derive its set from `isMaskedOnReadFieldType` rather than keep its own list,
so the server's mask and the client's cannot drift apart.
