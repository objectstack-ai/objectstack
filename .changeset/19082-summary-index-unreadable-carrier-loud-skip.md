---
"@objectstack/objectql": patch
---

`buildSummaryIndex` no longer drops a declared `summary` field silently when the roll-up's `reference` carrier cannot be read — the skip now reports itself at `error`, naming the field, the consequence and the fix (#19082).

The child→parent foreign key is resolved by scanning the child object's `master_detail` / `lookup` fields for one whose `reference` names the parent. That comparison read the carrier raw (`cd.reference === parent.name`), so a carrier **no reader can read** — a non-string, where `FieldSchema.reference` declares an optional string — compared `false` against every name, `fkField` stayed unset, and

```ts
if (!fkField) continue; // can't resolve the relationship — skip
```

removed the roll-up from **both** summary indexes. `recomputeSummaries()` then had nothing to do after every insert / update / delete of the child, so the parent's stored summary value kept whatever it held while each of those writes reported success, and nothing anywhere said so. It is the second way this one function invents *"nothing to recompute"*; the first, its registry read, was closed as #9154.

- **⛔ The resolution rule is deliberately unchanged.** Loosening the comparison would trade a silent stall for a **mis-matched foreign key**, which is more expensive: a roll-up quietly aggregating the wrong children reads exactly like a correct one. PR #18503 recorded this site in its C2 list and the #18550 round left it there on purpose; that boundary still stands. What ends is only the silence.
- **The carrier is read through the one arbiter**, `referenceCarrierOf` — the same accessor #19080 routed the two delete-cascade seams through. Its refusal is **caught** here rather than propagated, because this is a *scan* looking for the foreign key across every relation field: a propagating refusal on one unreadable field would hide a readable sibling that really is the FK, turning a roll-up that works today into a hard failure of every write to that child.
- **`error`, not `warn`**, and said once per index build rather than once per write. A persisted summary that silently stops tracking its children while every write keeps reporting success is the durability class, and the line it prints carries both halves an operator needs: what is not being maintained and will not recompute, and the two ways to fix it — spell the carrier as the target object's name, or name the FK explicitly with `summaryOperations.relationshipField`.
- **Absence is untouched.** `undefined`, `null` and `''` mean "this field names no target", which is a legal thing to declare; they skip silently exactly as before. Every readable carrier resolves exactly as before.

No schema changed, no key was added or removed, and nothing that resolved before resolves differently now. `engine-summary-index-unreadable-carrier.test.ts` pins both directions — the unreadable carrier reporting its skip, and a normal `reference` still resolving `fkField` — because without the second one, a change that simply stopped resolving anything would look identical to a fix.
