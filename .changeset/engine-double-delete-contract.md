---
"@objectstack/objectql": minor
---

feat(objectql): export the delete-dispatch contract so test doubles can be pinned to it (#4550)

A test double that is **looser** than the implementation it replaces converts a
green suite into no suite at all — silently, and on exactly the paths a double
was introduced for, which are the paths that were hard to test, which are
usually where the contract is densest. #4434 is the worked example:
`DELETE /api/v1/sharing/rules/:idOrName` answered 500 for every rule and both
address forms it advertises, from the day it was written, while
`deleteRule drops rule + all its grants` asserted success against it the whole
time — against a fake engine whose `delete` accepted the one call shape
`ObjectQL.delete` refuses.

`ObjectQL.delete`'s dispatch decision now lives in one exported place instead of
being re-derived by every fake:

```ts
import { assertEngineDeleteDispatch } from '@objectstack/objectql';

async delete(object: string, options?: any) {
  assertEngineDeleteDispatch(options);   // refuses what a real server refuses
  …
}
```

New exports, all pure and side-effect free:

- `resolveEngineDeleteDispatch(options)` → `{ kind: 'by-id', id }` |
  `{ kind: 'multi' }` | `{ kind: 'reject', message }` — what the engine will do
  with this call, without doing it.
- `assertEngineDeleteDispatch(options)` — throws exactly what the engine throws
  on `reject`, returns the dispatch otherwise. This is the line a fake engine's
  `delete` opens with.
- `scalarDeleteId(options)` — the SCALAR `where.id` or `undefined`. The half a
  hand-written mirror drops: `where: { id: { $in: [...] } }` looks like an id
  and is a multi-row predicate, so the engine rejects it without `multi`.
- `ENGINE_DELETE_REJECT_MESSAGE`, `ENGINE_DELETE_DISPATCH_CASES` — the message
  and the shared conformance case-set, the same role
  `packages/spec/src/data/*-conformance.ts` plays for drivers.

`ObjectQL.delete` itself reads `resolveEngineDeleteDispatch`, so a double that
imports it cannot be looser than the engine, ever — that is the property, and
it is the one a hand-mirrored `if` can only have until somebody edits one side.
No runtime behaviour changes: the same three verdicts, over the same inputs,
proved case-by-case against the real engine in
`engine-delete-dispatch.test.ts`.

Repo-side, `pnpm check:engine-double-contract` (wired into `lint.yml`) finds all
39 fake ObjectQL engines in the repo, holds new ones to this predicate, and
keeps the 30 not yet converted in a measured, shrink-only baseline.
