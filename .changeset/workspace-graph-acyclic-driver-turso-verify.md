---
"@objectstack/driver-turso": patch
---

chore(driver-turso): drop the `@objectstack/verify` devDependency — the one edge that made this workspace's manifest graph cyclic (#13513)

No runtime, API or type change: `dist` is byte-identical, and a consumer never
installs a devDependency. What changes is the workspace's own build graph.

**The defect.** `@objectstack/driver-turso` carried `@objectstack/verify` as a
devDependency so that one test file — `src/date-bucket-parity.test.ts` — could
import `checkDateBucketParity`. That closed a heterogeneous cycle across three
different declaration classes:

```
@objectstack/runtime      --peerDependencies(optional)-->  @objectstack/driver-turso
@objectstack/driver-turso --devDependencies----------->    @objectstack/verify
@objectstack/verify       --dependencies-------------->    @objectstack/runtime
```

pnpm walks all four declaration classes when it computes a `PKG^...` / `PKG...`
selection, so the cycle left those selections with no topological order. pnpm
does not refuse a cyclic selection — it schedules the members **concurrently**,
so `@objectstack/verify`'s DTS leg reads a sibling's `dist` while that sibling
is still emitting it. The run then dies with `TS2307`/`TS7016` naming a module
the author never imported, in a package the author never touched, which reads
exactly like "your branch broke an import". Seven seats paid for that
misattribution on unmodified trees. `pnpm install` had been printing
`WARN There are cyclic workspace dependencies` on every install throughout.

**Why this edge.** Measured over all 78 workspace manifests: this was the
**only single edge** whose removal makes the whole graph acyclic. Cutting the
`runtime → driver-turso` peer edge instead is not sufficient on its own — a
second optional-peer edge (`service-datasource → driver-turso`) closes the same
loop through `plugin-auth → rest → service-datasource`.

**Where the test went.** `date-bucket-parity.test.ts` moved to
`packages/qa/dogfood/test/date-bucket-parity-turso.test.ts`, which is where this
repo already keeps `@objectstack/verify`-based cross-package conformance —
`date-bucket-parity-conformance.test.ts` next door runs the same
`checkDateBucketParity` over `driver-sql` and `driver-sqlite-wasm`, both of them
`@objectstack/dogfood` devDependencies for exactly this reason. All five cases
moved intact and all five still run by name, negative control included.
