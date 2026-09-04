---
"@objectstack/spec": patch
---

fix(spec): `ActionEngineFacade.find` declares its second parameter as a FILTER, not an ObjectQL envelope (#14175)

`find(object, query: Record<string, unknown>)` documented nothing, and its
parameter carried the name of the envelope every other read on the platform
takes. The runtime (`buildActionEngineFacade`,
`packages/runtime/src/action-execution.ts`) treats the argument as the bare
`where` half — wrapping a non-empty one as `{ where: filter }` and passing
`{}` through unwrapped — so a handler that passed the envelope got
`{ where: { where: … } }`, matched nothing and returned `[]` with no error,
while its one unfiltered read kept working. A hand-written test double built
on the same belief passed every assertion; an application's headline action
was a silent no-op for its whole life under a green suite.

The member is now `find(object, filter: FilterCondition)` — the published
`QueryAST.where` type — with a doc comment stating the contract, the runtime's
wrap, and both limbs (envelope wrapped; empty passed through); the facade
docblock points at it. The parameter's TYPE now says what the runtime does
at the one place a handler author reads.

Compile-layer signal only, shipped as `patch` (the #12615 precedent — a
compile-time narrowing with no change in what parses or runs): no runtime
behaviour changes, nothing changes in what the facade accepts or returns, and
the narrowing bites only a primitive or a mistyped `$and` / `$or` / `$not`.
⚠️ It does NOT refuse `{ where: … }` at compile time — `FilterCondition`'s
string index signature admits `where` as a field name — so the compile-time
bar is partial and the doc comment is the contract of record. An
implementation typed with the old `Record<string, unknown>` still satisfies
the interface (method parameters are bivariant), so nothing constructing the
facade changes.
