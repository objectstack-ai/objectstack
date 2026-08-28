---
"@objectstack/metadata-core": minor
"@objectstack/objectql": patch
"@objectstack/service-automation": patch
"@objectstack/service-datasource": patch
---

feat(devx,datasource,automation): published `src/**` may only import workspace packages it declares (#10062)

A package's non-test `src/**` was free to import any workspace package,
declared or not, and nothing checked it. The class was filed with one member
and a mitigation — the import was type-only, so nothing reached the emitted
JavaScript and rollup-plugin-dts inlined the declaration rather than naming an
unresolvable module. It grew to four members with no signal, and one of them
killed the mitigation: `service-automation/src/flow-precedence.ts` **value**
imports from `@objectstack/objectql`, which it does not declare, and because
the shared tsup config externalises only `dependencies`/`peerDependencies`, the
bundler answered by inlining objectql's implementation into
`service-automation/dist/index.js` — a second copy of another package's code,
kept correct by build configuration alone.

`pnpm check:undeclared-dep-imports` is the gate, and the per-member fixes here
are decided one at a time rather than by a uniform policy — declaring makes a
coupling real and installable, routing it away removes it, and the two are not
interchangeable:

* **`@objectstack/service-datasource`** now declares `@objectstack/driver-sql`
  and `@objectstack/driver-memory` as **dependencies**. Both are loaded through
  an *unguarded* `await import(...)` on the postgres, mysql, sqlite and memory
  arms, so a consumer reaching one of those paths needed a package it was never
  told to install, and would have met `ERR_MODULE_NOT_FOUND` rather than a
  diagnosis. The three *guarded* driver arms — `@objectstack/driver-sqlite-wasm`,
  `@objectstack/driver-mongodb`, `@objectstack/driver-turso` — are deliberately
  left undeclared: each load sits in a `try`/`catch` that answers an absent
  package with the fault, the consequence and the install command, and each
  rides as an optional install. Declaring them would install them (turso drags
  `@libsql/client`'s native bindings) and, measured on this branch, takes a live
  assertion out of the tree: `default-datasource-driver-factory.test.ts` reaches
  the missing-package arm with no stub precisely because the package does not
  resolve from here.
* **`@objectstack/metadata-core`** now owns the ADR-0029 D9.6 provenance pair,
  `isCodeArtifactBody` and `isTenantAuthored`, sunk out of
  `@objectstack/objectql`'s registry by the same criterion as the write-verb
  dispatch predicates and the audit governance table beside them: a second layer
  needs the answer and the reverse import would either close a cycle or make the
  consumer depend on the whole data engine for one predicate. `objectql`
  re-exports `isCodeArtifactBody` from its original path, so its public API is
  unchanged; `service-automation` imports it from `metadata-core`, which it
  already declared, and its bundle no longer carries a copy of objectql's code.

Two members stay recorded rather than remediated, because the tree already
carries the decision not to declare them together with its reason
(`@objectstack/runtime` → `@objectstack/driver-turso`, whose bare `import()` is
a host-replaceable default thunk under #6268; `@objectstack/rest` →
`@objectstack/objectql`, whose absence must degrade to `501 NOT_IMPLEMENTED`
rather than fail module load). Their ledger rows carry mechanical evidence and
go red the moment that evidence stops holding — in particular, a `type-only`
row reds on the day its import becomes a value import, which is exactly the
transition nothing caught the first time.
