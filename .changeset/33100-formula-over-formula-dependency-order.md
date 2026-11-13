---
'@objectstack/objectql': minor
'@objectstack/lint': minor
'@objectstack/formula': minor
---

fix(objectql): a formula that reads another formula field reads its computed value; a cycle of formulas is refused where it is authored (#33100)

Clause-②: no (narrowing) — `os build`, `os validate` and the object save and publish door refuse a `formula` field that reads its own value, itself or through the formulas it reads, where they accepted it. First-party: a source scan of `examples/**`, `packages/**` and HotCRM finds no formula reading another formula, so no first-party stack moves.
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-formula` teaches no rule about one formula reading another; `content/docs/data-modeling/formulas.mdx` already said not to create circular references and now says they are refused.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored shape changes. A formula on a cycle never had a value (it read null on every row), so there is nothing for a migration to rewrite; the author breaks the cycle. -->

**BREAKING** accept-set narrowing of `os build` / `os validate` / the object door (`validateStackExpressions`).

The engine computed an object's formula fields in the order they were declared, or the order a projection named them, over the same row. A formula reading another formula (`f_total = record.f_sibling * 2`) therefore read null with "No such key: f_sibling" whenever it came first: when it was declared before the formula it reads, and on every projection naming it without that formula. The authoring doors accepted the expression.

- The read plan now carries every formula a planned formula reads, transitively, and computes each formula after the formulas it reads (`formulaReadOrder` in `@objectstack/formula`). It holds on `find`, `findOne`, a projection (a formula computed only because another reads it is cut back off the answer), the write response, `evaluateFormulaField` and `serveFormulaField`. A field that is not a formula reads exactly as before.
- A formula on a cycle (`f_total = record.f_total * 2`, or `f_x` and `f_y` reading each other) has no order to be computed in. The engine never evaluates it: it reads null, as before, and its fault now names the cycle instead of "No such key". A formula that reads a cycle member is computed over that null.
- The build and the object door refuse each declared formula on a cycle with the same sentence, located on its `expression` (`object 'x_job' · field 'f_total' expression`).

Migration: break the cycle. Have one of the formulas read the stored fields the other formula reads, instead of the other formula.
