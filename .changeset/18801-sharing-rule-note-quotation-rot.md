---
"@objectstack/spec": patch
---

`liveness/sharing_rule.json` — the file `_note` stops quoting the `declarative-rbac-seeding` proof-registry entry VERBATIM, so the pointer it hands a reader survives the next rewrite of that entry's prose (#18801).

The ledgers ship inside this package, so this is a pointer a consumer can actually follow. The note said the entry's `blockedReason` "reads" a specific sentence and quoted it. PR #18797 (`ac720a9865`) rewrote that reason — correctly, because #18587 had made its premise false — and the quoted sentence stopped existing in the very file the note sends a reader to. Measured repo-wide with a fold-proof predicate (whitespace folds and TypeScript `' + '` concatenation seams dissolved before matching, because the registry splits every reason across source literals mid-phrase): the quoted string read **0** on `main`, while the entry id `declarative-rbac-seeding` read **18** in the same run.

- **The judgement was never wrong; the quotation was.** The seeding does falsify the entry's original premise, and the rewritten reason on the entry now records exactly that — as a real ADR-0054 §3 binding candidate held back by the adoption act. The note still asserts it, in its own words.
- **What replaces the quote is an id, not a better sentence.** `declarative-rbac-seeding` is the entry's key: exactly **1** of the registry's **42** `id:` declarations spells it, and it reads 6 occurrences across 5 lines of `scripts/liveness/proof-registry.mts` — so a reader who greps it lands on the entry rather than on nothing. Quoting prose that changes is what rotted; an id does not rot on someone else's schedule. ⚠️ Measured, not assumed: nothing *asserts* those ids unique — the one other declaration of this id in the tree is `packages/qa/dogfood/test/authz-conformance.matrix.ts`, which names the same proof on purpose.
- **The old premise is paraphrased, deliberately not re-quoted.** A paraphrase of a premise that has already been retired cannot rot: the text it describes is frozen in history and nothing will rewrite it again.
- **The two sibling ledgers already wrote it this way.** `liveness/api.json` and `liveness/qa.json` cite `proof-registry.mts` by name and claim, and quote none of its prose.

No verdict moved. Every `status`, `verifiedAt`, `evidence`, `producer` and per-row `note` in the file is byte-identical to `main`; the only changed field is `_note`, and `check:liveness` reports `sharing_rule 17 classified (live 16, planned 1)` before and after.
