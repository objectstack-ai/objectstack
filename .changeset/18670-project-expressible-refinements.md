---
"@objectstack/spec": minor
---

**BREAKING (published artifact narrows)** — `packages/spec/json-schema/**` now states two of the rules it used to leave entirely to the runtime, so a validator reading the published files stops answering PASS on metadata the platform then refuses (#18670 item 2).

Clause-②: yes (narrowing)

`z.toJSONSchema()` has no arm for a `custom` check: on zod 4.4.3 a plain record, the same record with a `.refine()`, and the same record with an **aborting** `.refine()` all project byte-identically. Every rule written as a refinement was therefore enforced by the runtime and absent from the published file — the direction in which an author's, or an AI's, validator says yes right up to the moment the platform says no.

Two named patterns now project, and only those two:

- **at least one of these keys is present** — emitted as `anyOf` of one `required` per key. `shared/Expression.json` states the source-or-ast rule, so `{ "dialect": "cel" }` is refused by the published file exactly as the runtime already refused it.
- **a string with at least one non-whitespace character** — emitted as `minLength: 1` plus the pattern `\S`. Every evaluated and typed expression slot states it, so a whitespace-only `source` is refused at the door.

**⛔ Not a behaviour change, and no document the runtime accepts becomes refused.** Both patterns are EXACT rather than approximate: a key absent from a JSON object is the only way for its value to read `undefined`, and `String.prototype.trim` removes exactly the ECMA-262 whitespace set that `\S` is the complement of. Both equalities are pinned over their whole input space in `packages/spec/scripts/refinement-projection.test.ts`, including every ECMA-262 WhiteSpace and LineTerminator code point. No refinement was weakened, removed or added; the runtime accepts and refuses exactly what it did before.

**The list is CLOSED.** `packages/spec/src/shared/refinement-projection.ts` declares the vocabulary and builds each predicate from its own declaration, so the rule the runtime enforces and the keywords the file publishes cannot name different things. A refinement outside that list stays unprojected and keeps its `x-dropped-refinements` annotation. Adding an arm is a public-contract decision with its own measurement, never a refactor — and ⛔ never an open-ended zod-to-JSON-Schema translator over the whole population.

**Proof of work, in the shrink-only ledger.** `packages/spec/dropped-refinements.baseline.json` reads 201 published schemas / 553 dropped sites, from 246 / 750: 45 rows deleted, 75 rows shrunk, 197 sites closed, zero sites added anywhere. The generator now prints the closed population per pattern on every run (137 `required-one-of`, 60 `non-blank-string`), and reports a site that projects with no declared pattern on its own line.

<!-- adr-0087: not-required (no-migration-prescription) Nothing an author can write is removed, renamed or re-spelled: no spec key, no export and no config field changes, and the accepted set of metadata documents is byte-for-byte what it was. What changed is a machine-readable DECLARATION catching up with the runtime it always described, so there is nothing for `objectstack migrate meta` to rewrite and no stored representation to convert. -->
