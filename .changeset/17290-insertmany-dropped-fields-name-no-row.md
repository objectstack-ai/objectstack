---
'@objectstack/metadata-protocol': minor
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

fix(metadata-protocol): `insertManyData` reports the dropped-field union at BATCH level instead of naming rows it cannot identify (#17290)

**BREAKING** — `insertManyData`'s response moves `droppedFields` from each
outcome to the response itself:

```
FROM  { object, outcomes: [{ ok, record, droppedFields? }, …] }
TO    { object, outcomes: [{ ok, record }, …], droppedFields? }
```

The set reported is the same set. What is gone is a per-row attribution that
could not be computed here and was wrong whenever it mattered.

**What it got wrong.** Every create-side strip is the engine's, and its
`onFieldsDropped` event is the UNION over the batch — the listener signature
carries no row index. This seam reconstructed a row set from that union by
asking which rows SUPPLIED each dropped name
(`[...engineDropped].filter((f) => f in supplied)`), on the stated premise that
"the strip only removes keys the ROW ITSELF supplied, so a dropped name belongs
to exactly the rows whose supplied payload carried it". Maintainer ruling C
falsifies the premise: the static-`readonly` strip runs INSIDE `engine.insert`,
AFTER the `beforeInsert` hooks, and exempts keys a hook itself assigned —
recorded per row (`hookWrittenKeys: rowHookWrittenKeys[i]`). So in a batch where
a hook stamps a protected key on some rows and not others:

- row A supplied `approval_status`, no hook write ⇒ stripped, enters the union;
- row B supplied `approval_status`, its hook re-assigned it ⇒ **kept and
  written**;
- and row B's outcome carried `droppedFields: [{ fields: ['approval_status'] }]`
  on a record that still held `approval_status`.

A row the batch culled before the strip ran (a per-row validation failure) was
named on the same test, having dropped nothing at all.

⇒ A wrong attribution costs the reader a wrong investigation, and the import
surface — which prefers this path over `createManyData` — is the consumer most
likely to act on it while reconciling what landed.

**Why not attribute per row instead.** The honest set is `{rows whose payload
carried N}` minus `{rows whose beforeInsert hook assigned N}`, and the second
half is computed per row upstream but does not cross this seam. The outcome's
own `record` cannot stand in for it: a stripped `readonly` field is RE-DEFAULTED
over exactly the keys the strip took, and a stripped `autonumber` is refilled by
`applyAutonumbers` — so on both, the key is PRESENT on the row that really did
drop it, and a post-hoc "is the key still there?" check would delete true
attributions while leaving the hook-exempt false one standing. Comparing values
fails on the very case `hookWrittenKeys` exists for: the hook assigning the
value the caller also sent. Restoring row precision means giving the engine's
drop report a per-row channel, not a reconstruction at the call site.

**Prose corrected with it**, by CLAIM rather than by spelling — the docblock
that authorised the inference is the thing that re-authorises the next author:
`insertManyData`'s own docblock and `createManyData`'s parenthetical
(`@objectstack/metadata-protocol`), `mergeDroppedFieldEvents`'s closing
sentence, `engine.insertMany`'s docblock claim that "a caller holding the input
rows can attribute each name back to the rows that carried it"
(`@objectstack/objectql`, TSDoc emitted into its published `.d.ts`), and
`CreateManyDataResponseSchema.droppedFields`'s `.describe()` parenthetical
(`@objectstack/spec`, a string printed AT the customer).

**Unchanged.** `updateManyData` and `batchData` keep per-row `droppedFields`,
and they always could: each row is its own `engine.update` / `engine.insert`
call, so that call's events are that row's — earned mechanically, not inferred.
`createManyData`'s aggregated shape is untouched. No strip changes, no row
changes, and the same field names are reported.
