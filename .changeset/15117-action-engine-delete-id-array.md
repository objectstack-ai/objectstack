---
'@objectstack/spec': minor
---

fix(spec): `ActionEngineFacade.delete` declares the id ARRAY the runtime has always accepted, and says which convention is the contract (#15117)

`delete(object, id: string)` declared one id. The runtime facade
(`buildActionEngineFacade` in `packages/runtime`) has accepted `string | string[]`
all along — normalising the argument and issuing one `ql.delete` per id — and
described that in a comment as a tolerance two handler suites happened to cause.
The declaration was simply behind the behaviour, and the one first-party suite on
the array form could only reach it by hand-rolling a private copy of the
interface (a copy that had already drifted on `find`).

The slot is now `delete(object: string, idOrIds: string | string[])`, and the
member's doc comment states the contract instead of leaving it to be inferred
from a runtime comment two packages away:

- **Both spellings are contract.** One row is `delete(object, id)`; a set is
  `delete(object, ids)` — a handler holding a list does not have to unroll it
  into a loop to stay on the contract.
- **The array form is a convenience over the same per-row path** — not a bulk or
  atomic delete. There is no transaction around the set: a failure part-way
  leaves the ids before it deleted. An empty array deletes nothing and resolves.

Nothing is removed and nothing narrows: every existing single-id call still
type-checks, and no runtime behaviour changes — this release makes the published
type describe what was already being served. That makes it non-breaking, not a
patch: widening a published parameter is a purely additive widening of a public
surface, which takes at least `minor` whatever the commit type says. Handler authors who copied the
facade into a local context type to reach the array form can delete the copy and
annotate with `ActionHandlerContext` / `ActionHandler` from `@objectstack/spec/ui`.
