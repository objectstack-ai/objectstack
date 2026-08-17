---
"@objectstack/plugin-sharing": patch
---

fix(sharing): `publicSharing.eligibility` binds declared fields through the canonical `materializeDeclaredFields` instead of a local copy (#8489)

`share-link-service.ts` carried its own `bindDeclaredFields` — a hand-written
mirror of `@objectstack/objectql`'s `materializeDeclaredFields`, named as a copy
in its own doc comment. It is retired; `assertEligible` now imports the
canonical helper from `@objectstack/objectql/core` (already a runtime dependency
of this package), with a spread at the call site because the canonical
materialises in place.

**This changes eligibility verdicts on exactly one row shape**, and the change
was accepted knowingly (maintainer ruling, 2026-08-16). The retired mirror bound
a declared field by key PRESENCE (`!(name in record)`); the canonical binds by
VALUE (`record[name] === undefined`). They agree on every other input class,
including a missing or malformed `fields` map, where both return the record
untouched. Where they differ is a declared field held as an own key whose value
is `undefined` — a shape `InMemoryDriver` measurably produces (an explicit
`undefined` on `create` survives to `find`) and `SqlDriver` structurally cannot
(a SQL NULL arrives as `null`).

On that shape only, with a declared `status`:

| eligibility predicate         | before                         | after                    |
|:------------------------------|:-------------------------------|:-------------------------|
| `record.status == null`       | 422 `ELIGIBILITY_UNEVALUABLE`  | **link is minted**       |
| `has(record.status)`          | 422 `RECORD_NOT_ELIGIBLE`      | **link is minted**       |
| `!has(record.status)`         | **link was minted**            | 422 `RECORD_NOT_ELIGIBLE` |
| `record.status == 'published'`| 422 `ELIGIBILITY_UNEVALUABLE`  | 422 `RECORD_NOT_ELIGIBLE` |

The first two rows widen acceptance: the predicate is now *answered* rather than
faulting on a key CEL reads as absent, and on this fail-closed gate a fault was a
refusal. The third row is the one that mattered for the decision — it **closes an
over-acceptance**. `has()` guards an UNDECLARED key and never an empty value once
bindings are materialised, so `!has(record.<declared field>)` is false; the
mirror was minting share links there that every other server-side surface
refuses. The fourth row keeps its direction and changes only its ADR-0112 `code`.

The eligibility pin is rewritten to discriminate (#9085): its previous
declared-field case passed with the binder fully ablated, because every seeded
row carried the field it claimed was absent. The replacements use a declared
field the stored row genuinely does not carry, and fail in opposite directions
under ablation.
