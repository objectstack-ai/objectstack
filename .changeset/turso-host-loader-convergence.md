---
"@objectstack/service-datasource": minor
"@objectstack/runtime": patch
---

fix(runtime,service-datasource): a `default` libSQL datasource keeps its whole config, and one missing-package class (#7314)

Two loaders build the libSQL/Turso driver, and which one runs is decided by
something the author cannot see — whether the datasource happens to be the
host's `default`. `@objectstack/runtime`'s host loader serves that one;
`createDefaultDatasourceDriverFactory`'s `turso` arm in
`@objectstack/service-datasource` serves every other door (a datasource created
in Setup, `testConnection`, a declared non-default). #6268 converged the two
HOST loaders onto one owner; it could not reach the third, one layer down, and
the two had drifted in two ways.

**Half the config was silently dropped for `default`.** The host loader built
`new TursoDriver({ url, authToken })` — two keys — while the open-core arm read
nine. `TursoConfigSchema` accepts all nine, so an encrypted or
embedded-replica `default` lost `encryptionKey` / `syncUrl` / `sync` /
`concurrency` / `timeout` / `mode` / `schemaMode` with no diagnostic anywhere,
and got them back the moment the datasource was renamed. Both loaders now build
through one exported `buildTursoDriverConfig`, whose key set is derived from a
reader table rather than hand-listed — a corrected second copy would only have
agreed until the next key. A `packages/cli` pin fails to compile if that builder
and the driver's own `TursoDriverConfig` stop covering the same keys.

The host loader also now trims the url before testing it, as the open-core arm
always has: a whitespace-only url is refused by name instead of being handed to
`@libsql/client`.

**One `MissingDriverPackageError`, reachable from both sides.** The class was
declared in `@objectstack/runtime`, which `@objectstack/service-datasource`
cannot import (the dependency runs the other way), so the open-core arm raised a
plain `Error` — matched by no `instanceof`, and pinnable only by message text.
The declaration moves DOWN to `@objectstack/service-datasource`, the lowest
package that raises it, and both loaders now throw the same class object.

**No import changes.** `MissingDriverPackageError`, `TURSO_DRIVER_PACKAGE` and
`TURSO_DRIVER_INSTALL_COMMAND` are still exported from `@objectstack/runtime`
(and from `@objectstack/cli`'s `utils/storage-driver.ts` through it) — they are
re-exports now rather than declarations. Code written against either spelling
keeps compiling, and against the same class: `serve.ts`'s
`e instanceof MissingDriverPackageError` fatal-boot branch depends on that
identity, so it is asserted by object identity rather than by name or message.
`@objectstack/service-datasource` additionally exports the class, the builder
(`buildTursoDriverConfig`, `resolveTursoUrl`, `TURSO_DRIVER_CONFIG_KEYS`) and
`resolveDatasourceSchemaMode` for hosts that build their own driver factory.
