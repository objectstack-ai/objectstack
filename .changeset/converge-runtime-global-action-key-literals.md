---
"@objectstack/runtime": patch
---

refactor(runtime): spell the object-less action key as `GLOBAL_ACTION_OBJECT_KEY` in `action-execution.ts` (#14678)

`GLOBAL_ACTION_OBJECT_KEY` exists so the object-less action-registration key is
written once. #14422 converged the owner-key LADDER and the ObjectQL plugin's
copy of it; three bare `'global'` spellings elsewhere in
`packages/runtime/src/action-execution.ts` were never in that card's path,
because the runtime fence it built was a re-export plus a delegating alias.
This converges those three. The constant was already imported in the file.

No behaviour moves — the constant is `'global'`, so every site is equal in
value before and after. That equality is the entire defect: it is what made the
three invisible to every test in the repo, and what would have let them part
from the constant in silence the day its value changes.

- `seedFlowActionParams` — a live comparison (`objectName !== 'global'`) that
  decides whether an object-derived `<object>Id` param key is seeded. The one
  site where a drifted literal would change what an action body receives.
- `enforceActionParams` — the warn-once dedup key, which is also interpolated
  into the operator-facing `[action-params] <key>: …` line. Converged rather
  than left: the argument for a literal here is that a log key must never fail
  to render, and that argument does not survive contact with the fact that
  `GLOBAL_ACTION_OBJECT_KEY` is a module-scope `const string` already imported
  into this file — it cannot fail to render either. What a drift there would
  actually cost is an operator grepping logs by the key the engine now uses and
  silently missing these lines.
- `collectActionDeclarations`'s docblock, which carried a second defect
  independent of the literal: it called the key "the `'global'` wildcard",
  contradicting `action-governance.ts` ("an exact-string `Map` lookup with no
  wildcard semantics"). It is now the phrasing the sibling docblock 48 lines
  below it already used — "the object-less `GLOBAL_ACTION_OBJECT_KEY`" — so the
  correction is copied from the file's own converged prose rather than invented.

`patch`, not `skip-changeset`: `packages/runtime` publishes `dist`, which is
built from this source, so the emitted bytes move even though the behaviour
does not. Nothing reaches the published entry — `action-execution.ts` is not
re-exported from `packages/runtime/src/index.ts` and no export, signature or
type changed here — which is what keeps it below `minor`.

The docblock that promised the lockstep is joined by a weld that enforces it:
`action-owner-key-single-source.test.ts` gains a half C that reads
`action-execution.ts` and fails if any quote spelling of the key is written out
by hand again. The forbidden spelling is DERIVED from the constant rather than
hard-coded, so the guard is not itself a fourth copy of the literal it forbids.
