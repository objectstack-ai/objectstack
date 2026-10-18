---
'@objectstack/spec': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@objectstack/service-package': patch
'@objectstack/cloud-connection': patch
'@objectstack/client': patch
---

feat(spec)!: every installed-package row declares where it came from, a closed `source: 'code' | 'marketplace' | 'authored'`, and the `GET /packages` rows declare the `writable` verdict they already served (#23972)

Clause-②: yes (narrowing — the served row gains two declared keys, and the record schema, the served-row union and the registry's installPackage signature each refuse what they accepted before)

**BREAKING** — three published accept sets narrow. `InstalledPackageSchema` refuses a row without `source`, or with a value outside `code` / `marketplace` / `authored`. The served-row union `InstalledPackageAtEitherStageSchema` refuses a row without a boolean `writable`. `SchemaRegistry.installPackage` and `EngineSchemaRegistryView.installPackage` take `source` as their second argument and refuse a call without it. The migration is below. None of it is mechanically convertible, because only the door that registers a package knows where it came from.

**What is new on the wire.** `GET /api/v1/packages` and `GET /api/v1/packages/:id` serve two declared keys on every row:

- `source` names the package's origin. `code` means the deployment's own code registered it (a `defineStack()` host, a plugin's bundled manifest, a platform package). `marketplace` means the marketplace install-local plugin installed it, and that holds after a restart too, when the plugin rehydrates it from its ledger. `authored` means it is a database-authored package (a Studio base, a duplicate, an HTTP install), including after the restart that rehydrates it from `sys_packages`. The door that registers the package stamps the value. No reader derives it.
- `writable` is the server's own writability verdict (ADR-0070 D2), served on these rows since #14375 and now declared. It is computed per read and never stored, so it is declared on the served row (`InstalledPackageAtEitherStageSchema`) and not on the registry record.

FROM → TO for a reader of these rows:

| you did | do instead |
| --- | --- |
| treated `writable: true` as authored, and looked up each non-writable row in the marketplace's installed list (the control plane's, else install-local's) to tell marketplace from code | read `row.source` |
| read the undeclared `writable` | read the declared `writable` (unchanged value) |

The two keys are separate statements: `source` says where the package came from, and `writable` says what this server lets an org do to it.

**`InstalledPackageSchema` requires `source`.** It is `InstalledPackageSourceSchema`, exported from `@objectstack/spec/kernel`. A row without it, or with a value outside the closed set, is refused at the `source` key.

**API change for code that registers packages (`@objectstack/objectql`).** The registry records the origin and never infers it:

| you wrote | write instead |
| --- | --- |
| `registry.installPackage(manifest)` | `registry.installPackage(manifest, 'code')` (or `'marketplace'` / `'authored'`, whichever is where the package came from) |
| `registry.installPackage(manifest, settings, scope)` | `registry.installPackage(manifest, source, settings, scope)` |
| `ctx.getService('manifest').register(artifact)` for a marketplace install | `ctx.getService('manifest').register(artifact, { source: 'marketplace' })` |

`SchemaRegistry.installPackage` throws a `TypeError` naming the closed set when `source` is missing or unknown, before anything is recorded. `ObjectQL.registerApp(body, scope?, source?)` and the `manifest` service record `'code'` when no source is given. They accept `'code'` or `'marketplace'` and refuse `'authored'`. The `IObjectQLEngine` registry contract (`@objectstack/spec/contracts`) declares the same `installPackage(manifest, source, settings?)`.

**The one-line fix:** pass the package's origin as `installPackage`'s second argument.

Readers: objectui's Setup → Packages Source column and its `?source=` filter (it switches from the two-read join to `source` in its own follow-up), and the client SDK's `packages.list()` / `packages.get()` row types.

<!-- adr-0087: registered installed-package-row-source-required, registry-install-package-source-argument -->
