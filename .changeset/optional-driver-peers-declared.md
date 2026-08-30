---
"@objectstack/service-datasource": patch
"@objectstack/runtime": patch
---

fix(datasource,runtime): declare the guarded optional-driver loads as optional peers, so a consumer is told at install time (#12943)

Five guarded `await import(...)` loads of workspace driver packages sat in
published `src/**` with no manifest declaration a consumer could see:
`@objectstack/service-datasource` reaches `driver-turso`, `driver-sqlite-wasm`
(twice) and `driver-mongodb`, and `@objectstack/runtime` reaches `driver-turso`.
`driver-mongodb` and `driver-sqlite-wasm` were `devDependencies` of
`service-datasource`, which tells an installing consumer nothing at all;
`driver-turso` was in no section of either manifest.

Each is now an optional `peerDependencies` entry with
`peerDependenciesMeta: { optional: true }` — the form `@objectstack/cli` already
uses for `driver-turso`. **Nothing is installed and no code path changes**: an
optional peer declares a relationship that already existed at runtime, so
`npm ls`, a lockfile, an audit tool and a reader of the manifest can all see the
driver a datasource may ask for, instead of learning about it only by hitting
the failure arm. The runtime errors were already good — each carries its install
command as data — but they arrive at the moment of failure rather than at
install time.

The `rest` to `objectql` occurrence of the same shape is deliberately left
alone: `@objectstack/rest`'s non-coupling to the data engine is a stated
architectural position, not a hygiene gap.

Three test pins had reached their missing-package arm with no stub, because the
undeclared package genuinely did not resolve from the importing package. pnpm
links an optional workspace peer, so that is no longer true, and each pin's own
comment had said in advance what to do about it. All three now stage the absence
(`vi.doMock` with the resolver's own `ERR_MODULE_NOT_FOUND`) and keep every
assertion, including the typed-identity ones that make `serve.ts`'s
`e instanceof MissingDriverPackageError` boot-fatality branch meaningful.
