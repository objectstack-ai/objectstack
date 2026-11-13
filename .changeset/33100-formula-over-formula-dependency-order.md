---
'@objectstack/objectql': minor
'@objectstack/lint': minor
'@objectstack/formula': minor
'@objectstack/spec': minor
---

fix(objectql): a formula that reads another formula field reads its computed value; a cycle of formulas is refused where it is authored (#33100)

Clause-②: no (narrowing) — `os build`, `os validate` and the object save and publish door refuse a `formula` field that reads its own value, itself or through the formulas it reads, where they accepted it. First-party: a source scan of `examples/**`, `packages/**` and HotCRM finds no formula reading another formula, so no first-party stack moves.
Metadata-protocol: narrowed
Skills-docs: none — `skills/objectstack-formula` teaches no rule about one formula reading another; `content/docs/data-modeling/formulas.mdx` already said not to create circular references and now says they are refused.

<!-- adr-0087: registered formula-cycle-refused -->

**BREAKING** accept-set narrowing of `os build` / `os validate` / the object door (`validateStackExpressions`), and one read answer: a formula on a cycle whose read of the cycle is guarded (`has(record.f_self) ? record.f_self : 1`, or an optional spelling such as `record.?f_self.orValue(1)`) could evaluate before, to a value that depended on the order its formulas were computed in; it now reads null with the cycle fault, like every other member.

The engine computed an object's formula fields in the order they were declared, or the order a projection named them, over the same row. A formula reading another formula (`f_total = record.f_sibling * 2`) therefore read null with "No such key: f_sibling" whenever it came first: when it was declared before the formula it reads, and on every projection naming it without that formula. The authoring doors accepted the expression.

- The read plan now carries every formula a planned formula reads, transitively, and computes each formula after the formulas it reads (`formulaReadOrder` in `@objectstack/formula`). It holds on `find`, `findOne`, a projection (a formula computed only because another reads it is cut back off the answer), the write response, `evaluateFormulaField` and `serveFormulaField`. A field that is not a formula reads exactly as before.
- A formula on a cycle (`f_total = record.f_total * 2`, or `f_x` and `f_y` reading each other) has no order to be computed in. The engine never evaluates it: it reads null, and its fault names the cycle instead of "No such key". An unguarded member read null before too; a guarded one is the read answer named above. Every formula of a strongly connected component of more than one formula, or reading itself, is a member, whatever order the formulas are declared or requested in. A formula that reads a cycle member without being read back is computed over that null.
- A read that admits a formula by what the formula reads judges the whole plan the read will run, the formulas it reads included, and answers what it answered before.
- The build and the object door refuse each declared formula on a cycle with the same sentence, located on its `expression` (`object 'x_job' · field 'f_total' expression`).

Migration: break the cycle. Have one of the formulas read the stored fields the other formula reads, instead of the other formula.
