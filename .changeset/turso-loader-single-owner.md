---
"@objectstack/runtime": patch
"@objectstack/cli": patch
---

refactor(runtime,cli): give the optional Turso/libSQL loader ONE owner (#6268)

`@objectstack/driver-turso` is an optional install, so neither host can let the
open-core datasource factory build the `default` datasource for a `libsql://`
selection — both inject a host driver factory instead. That loader was written
out **twice**: `packages/runtime/src/turso-driver-factory.ts` (`os migrate` /
`createStandaloneStack` / embedded hosts, #5820) and
`packages/cli/src/utils/storage-driver.ts` (`os serve` / `os start`, #5602). The
two were kept equal **by hand**, which is the #3741 → #3758 shape: one decision,
two implementations, one of them fixed and the other missed for three months.

It had already begun. #6345 moved the CLI's `isTursoDriverId` onto
`@objectstack/spec`'s shared driver vocabulary and left the runtime half on a
private `Set(['turso', 'libsql'])` — equal only because the spec table's `turso`
row happens to list exactly those two aliases today.

**The runtime now owns it and the CLI consumes it.** `@objectstack/runtime`
exports `loadTursoDriverFactory`, `isTursoDriverId`, `MissingDriverPackageError`,
`TURSO_DRIVER_PACKAGE` and `TURSO_DRIVER_INSTALL_COMMAND`;
`packages/cli/src/utils/storage-driver.ts` re-exports them, so every existing CLI
import site is unchanged. `UnsupportedDriverError` stays in the CLI — it is
CLI-only semantics (a `turso` selection with no URL), not a copy.

**One class identity, deliberately.** `serve.ts` decides whether a boot failure
is fatal with `e instanceof MissingDriverPackageError`. A convergence that left
two same-named classes would make that predicate silently stop matching and
degrade a fatal branch to a non-fatal one with no diagnostic anywhere, so the
CLI re-exports the runtime's class rather than declaring its own, and a test pins
that an error raised by the runtime loader still satisfies the CLI-side
`instanceof`.

**Behaviour, for operators:** unchanged, with one exception. Missing package
still fails loudly with the same `npm install @objectstack/driver-turso`, the
same error fields and no SQLite fallback; a present package still yields the same
factory handle shape. The exception is the missing-package **message**, which is
now one wording for both hosts and therefore names both consequences (a server
booted against an empty local database, and an `os migrate` DDL run against that
same one) instead of only the one its host used to mention.

Two things stay host-owned because moving them would change behaviour: the
dynamic `import()` specifier (it resolves from the node_modules tree of whichever
module evaluates it, and the package is an optional **peer** of
`@objectstack/cli` that `@objectstack/runtime` does not declare at all), and the
error TYPE for a url-less turso config. Only the message for the latter is
shared.
