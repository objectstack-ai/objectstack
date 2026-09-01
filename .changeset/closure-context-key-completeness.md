---
'@objectstack/metadata-protocol': patch
---

runtime publish gate: assert that every context collection is routed by `CLOSURE_CONTEXT_KEY_BY_TYPE` (#13768)

The last hand-kept spelling of the runtime publish gate's snapshot collection
set now has a completeness guard. `CLOSURE_CONTEXT_KEY_BY_TYPE`'s `satisfies`
clause asks that every key it NAMES is a real `RuntimeStackContext` key —
validity. It never asked that every collection needing a row HAS one, which is
the asymmetry #13390 removed from the four sibling spellings in
`packages/lint/src/runtime-gate.ts` and explicitly left standing here.

Nothing was broken: the table is correct as it stands, and this ships no
behaviour change of any kind — it adds one exported type alias and no runtime
code. What changes is what happens NEXT time the set widens. Adding a key to
`RuntimeStackContext` without the row that routes a metadata type into it now
fails this package's build (`TS2344`, naming the unrouted collection), where
before it compiled clean and the collection silently stayed empty for every
batch — the shape #10377 was filed for.

The guard is an assertion rather than a derivation because the derivation is
not available: the context-collection set exists as a VALUE only in
`CONTEXT_STACK_KEYS`, which is module-private in `@objectstack/lint` and on
neither of that package's entries. Reaching it would mean widening the
deliberately narrow `@objectstack/lint/runtime` entry to buy a red the
already-imported TYPE gives for free.
