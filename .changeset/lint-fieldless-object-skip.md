---
"@objectstack/lint": patch
---

fix(lint): an object declaring no fields is unjudgeable, not "has no such field" (#4383)

`hook-body-write-unknown-field` and `action-body-write-unknown-field` reported
**every** field write to an object that declares no `fields` — an external
object, or a datasource-introspected schema whose columns are resolved at
runtime. Measured before the fix:

```
hook  : ["hook-body-write-unknown-field / warning"]     ← false
action: ["action-body-write-unknown-field / warning"]   ← false
flow  : []                                              ← correct
```

`indexObjectFields` returns an **empty Set** for such an object rather than
`undefined`, and both rules only asked "is this object in the stack?" —
`targetSets.every((s) => s !== undefined)` and `if (!known) continue`. An empty
Set is neither undefined nor falsy, so it became the answer to `has(field)`,
and the answer is always `false`.

That field map is not empty, it is **unknown**. The distinction already existed
in two other rules of the same family, each with its reason written down —
`validate-searchable-fields` skip #2 and `validate-flow-node-writes` (#4369,
which added the guard because it gates). Two of four had it; the drift shape
#3583 and #4330 exist to remove.

**Fixed once, not twice.** The guard now lives in a shared
`judgeableFieldsOf(index, objectName)` that returns the declared names only when
they are a sound basis for a "resolves to nothing" judgement, and `undefined`
for both unjudgeable cases — cross-package objects and fields-less ones. All
three write-set rules route their lookups through it, so a fourth cannot repeat
the omission. It is internal to the family (not re-exported from the package
barrel), same as `indexObjectFields` and `IMPLICIT_FIELDS`.

One semantic call worth naming: a **multi-target** hook where only *some*
targets are judgeable is now skipped entirely. The `ctx.input` finding fires
only when a field is missing from EVERY target, and an unjudgeable target is one
the field might well exist on — so judging the remainder would assert "missing
everywhere" on evidence that does not cover everywhere. Consistent with the
rule's stated asymmetry: prefer a missed finding to a false one.

No behaviour change for objects that declare fields: an unknown field on a
normal object still warns exactly as before, pinned by a test placed next to
each new skip so the guard cannot swallow the real finding.
