---
'@objectstack/formula': minor
'@objectstack/lint': minor
---

fix(lint): `==` / `!=` between a list-valued field reached through a lookup hop and a scalar is refused, as the root-field case is

Clause-②: yes (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — the `objectstack-formula` skill already teaches that a list field compared with a scalar literal is refused and the `has()`-guarded `in` rewrite; a hop read of a list field takes the same rewrite

<!-- adr-0087: not-required (already-registered cel-list-equality-refused) the same list-equality refusal and membership rewrite, one hop away; that entry's acceptance check (no list-equality finding at os validate / os build) now covers the hop read too -->

**BREAKING** accept-set narrowing, shipped as `minor`; the new `@objectstack/formula` export `findHopListEquality` widens the package's public surface.

`record.labels == 'vip'` on a list-valued field has been refused as `list-equality` since the shared validator learned it, but the same comparison one hop away, `record.account.labels == 'vip'` where `account` is a lookup and `labels` a list-valued field of its target, was refused nowhere. A validation rule's `condition` / `when` and a formula's `expression` are the two sites that serve a hop: the engine hydrates the related row, so `record.account.labels` is the stored list, and comparing it with a scalar answers `false` (for `!=`, `true`) on every row. A rule written that way never fires and saves clean.

- **The refusal.** At those two sites, the publish lint (`os validate` / `os build`) and the object save door refuse a `==` / `!=` between a read of a hop target's list-valued field (an inherently multi-value type, or a multi-capable type declared `multiple: true`) and a non-null scalar literal, either operand order, in the root case's words, prescribing the root case's membership test on the hop read.
- **What carries it.** `@objectstack/formula` exports `findHopListEquality(source, listLeaves)`, which returns the `list-equality` refusals (same code and params as `validateExpression`'s) for the reference → list-valued-leaves map its caller hands in. `ExprSchemaHint` is unchanged.
- **Still accepted.** A hop to a scalar field (`record.account.tier == 'vip'`), `record.account.labels == null`, `'vip' in record.account.labels`, a hop through a reference that is itself multi-valued, and every site that serves no hop (an action's `visible`, a flow condition), where `record.account` is the stored id.

FROM → TO:

- `record.account.labels == 'vip'` → `(has(record.account.labels) && record.account.labels != null && "vip" in record.account.labels)`
- `record.account.labels != 'vip'` → `(!has(record.account.labels) || record.account.labels == null || !("vip" in record.account.labels))`

One-line fix: test membership with `in` on the hop read, guarded as the refusal prescribes.
