---
'@objectstack/lint': patch
---

Derive the runtime publish gate's context-collection set from `RuntimeStackContext` instead of hand-listing it.

`CONTEXT_STACK_KEYS` carried `as const satisfies readonly (keyof RuntimeStackContext)[]`, which asks that every entry it names is a real context key (validity) and never that every context key has an entry (completeness) — while the docblock on `RuntimeStackContext` claimed it was "derived from this shape and keeps the two from drifting". A collection declared on the interface but missing from the list was never carried into the per-write snapshot: the host passed it in, the gate dropped it, and every rule resolving references into that collection judged an empty universe and emitted findings that look correct. Measured, adding a collection to the interface left the package building at exit 0 with nothing red inside it.

The set is now derived from a keyed record typed `{ [K in keyof RuntimeStackContext]-?: true }` — the `-?` mechanism already proven at `@objectstack/metadata-protocol`'s `protocol.ts` — so a new context collection without its row is a type error naming that collection at `tsc --noEmit` and at the build. Declaration order is preserved and pinned, since it feeds both the snapshot's key order and the derived top-level-index alternation. No behaviour change: the same five collections are carried, in the same order.
