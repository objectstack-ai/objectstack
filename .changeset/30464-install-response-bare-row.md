---
'@objectstack/spec': patch
---

fix(spec): `PackageInstallResponseSchema` declares the installed row that `POST /api/v1/packages` really answers

Clause-②: yes (narrowing)
Metadata-protocol: none

**BREAKING** accept-set narrowing at the install answer contract (`@objectstack/spec`): `PackageInstallResponseSchema` refuses the `{ package }` wrapper it accepted, and `PackageInstallResponse['data']` no longer declares `package`, `dependencyResolution`, `namespaceConflicts` or `message`.

`POST /api/v1/packages` answers `{ success: true, data: <row> }` with status `201`, where the row is the `InstalledPackage` the registry recorded. `PackageInstallResponseSchema` (the output `PackageApiContracts.installPackage` binds) declared `data: { package, dependencyResolution?, namespaceConflicts?, message? }` instead. No surface sent that wrapper, so code written against the contract read `data.package` and got `undefined`. The first-party client already followed the wire: `client.packages.install` resolves to `InstalledPackage`.

- **FROM** `data: { package: InstalledPackage, dependencyResolution?, namespaceConflicts?, message? }` **TO** `data: InstalledPackage`. The name, the type names (`PackageInstallResponse`, `PackageInstallResponseParsed`) and the binding are unchanged. The server's answer is unchanged.
- **Both directions.** The schema now accepts the bare row the door serves, which it refused, and refuses the `{ package }` wrapper no server sends. The type `PackageInstallResponse['data']` loses `package`, `dependencyResolution`, `namespaceConflicts` and `message`, so TypeScript code that reads them stops compiling. That code read `undefined` at runtime already.
- **Fix for a consumer:** read the row from `data` itself. Replace `response.data.package` with `response.data`. Drop any read of `data.dependencyResolution`, `data.namespaceConflicts` or `data.message` on this route: the door never sent them.
- **Level.** `patch`: this is the shape of an API answer, not anything a metadata author writes.

<!-- adr-0087: not-required (no-migration-prescription) an API answer shape, not metadata: no stored row or authored source holds it, so objectstack migrate meta has nothing to rewrite. The consumer line above is for integrator source code, which the compiler now flags (ADR-0087 D8); type-surface-only is closed to it only because the schema lives in packages/spec -->
