---
"@objectstack/spec": minor
---

fix(spec): an action param's `defaultValue` is validated against the param's own value contract (#6970)

`ActionParamSchema.defaultValue` was `z.unknown().optional()`, so a default that
could never satisfy its own param was accepted at authoring time with no warning,
prefilled into the dialog control, and refused only at submit — on a field the
user never touched, by a message that named the param but not the author's
default as the cause.

The default is now checked at parse time through the **same** `valueSchemaFor`
the dispatcher already runs at submit (ADR-0104 D2, `validateActionParams`) —
one rule set, two moments, no second vocabulary. `datetime` was the loudest
instance (`'2026-08-10T15:00'`, a wall clock `datetime-local` happily displays
and `InstantValueSchema` refuses), but the hole was every type: `number` +
`'abc'`, `select` + a non-member, a `multiple` param + a scalar.

The rejection names the param, its type, the offending literal, and why it
matters:

```
Action param "start" (datetime): the default "2026-08-10T15:00" cannot satisfy
this param's own value contract — expected an ISO-8601 instant with explicit
zone (e.g. 2026-03-15T14:30:00.000Z). The dialog would PREFILL this value and
the submit would then be refused with that same message (ADR-0104 D2), for a
field the user never touched …
```

**Acceptance tightening — what is NOT judged.** The gate only answers what the
declaration itself can answer, because an authoring gate that guesses rejects
valid metadata. A param with no `type` of its own keeps an open value shape (the
same default `validateActionParams` applies to an unresolvable type); a
field-backed param that inherits its arity or its option set is not held to
either; and `null` / `''` defaults are skipped exactly as the dispatcher's own
presence check skips them.

**Stock compatibility.** Already-stored action metadata carrying a nonconforming
default keeps loading and keeps working: the read path (`DatabaseLoader.rowToData`)
replays the ADR-0087 conversion chain but runs no Zod validation, and
`MetadataManager.validate` is deliberately a structural check only. Authoritative
spec validation lives on the WRITE path (`protocol.saveMetaItem`) and is surfaced
on reads as the advisory `_diagnostics` envelope — which now reports the
nonconforming default instead of staying silent about it. So this is loud at
authoring, non-fatal at rest, and no conversion is owed: there is no mechanical
rewrite for "the author meant some other instant", and inventing one would pick a
timezone the metadata never declared (the ambiguity #5061 refused to resolve
consumer-side).
