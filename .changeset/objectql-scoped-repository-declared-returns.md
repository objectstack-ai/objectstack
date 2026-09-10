---
"@objectstack/objectql": patch
---

fix(engine): `ObjectRepository` declares the `findOne` / `update` shapes it already published (#16786)

`ObjectRepository.findOne` and `.update` declared `Promise<any>` and now declare
what `IScopedObjectRepository` — the contract this class carries an `implements`
clause for — has declared since #16231's ruling A landed (PR #16783):

- `findOne` → `Promise<Record<string, any> | null>`
- `update` → `Promise<Record<string, any> | number | null>`

**Why this is a `patch` and not a `minor`.** Nothing is widened and no symbol is
added. `packages/spec/src/contracts/scoped-context.ts` already publishes the
narrower type, and `IDataEngine` — the call each of these two methods forwards to,
one line down — already publishes it too. This class sat between two narrow
declarations and re-widened the result back to `any` on the way out. `implements`
does not catch that, because a WIDER declared return always satisfies a narrower
one: `class ObjectRepository implements IScopedObjectRepository` compiled green
the whole time while the members it published were `any`. So this is an
implementation coming back to the declaration it had already published — the
repo's `patch` rung — and not a contract that moved. The recorded **WHICH LEVEL**
maintainer ruling of 2026-09-04 (decision batch #35, on #15294, recorded at
`.github/workflows/pr-automation.yml`) puts *additive widening* of a published
surface — a new exported symbol, a new accepted key or value — at `minor`; this
PR does none of those, and adds no exported symbol.

**Who has to change something, on the TYPE axis.** A TypeScript consumer that
typed against the concrete `ObjectRepository` / `ScopedContext` class — rather
than the `IScopedObjectRepository` contract, which already said this — and reads
a field off `findOne`'s result without a null check, or off `update`'s result
without separating the by-id record from the predicate-form count. Those call
sites were reading `any`; they now read the declared shape and the compiler asks
for the null check. Consumers already written against the contract, including
every hook whose `ctx` is typed `HookContext` (`HookContext.api` has been
`IScopedContext` since #5945), see no change: they were already narrow.

The in-repo census for this change was one file, repaired here.
