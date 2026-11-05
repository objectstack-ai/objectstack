---
'@objectstack/spec': minor
---

fix(spec): `PackageInstallResponseSchema` declares the installed row that `POST /api/v1/packages` really answers

Clause-②: yes
Metadata-protocol: semantic

`POST /api/v1/packages` answers `{ success: true, data: <row> }` with status `201`, where the row is the `InstalledPackage` the registry recorded. `PackageInstallResponseSchema` (the output `PackageApiContracts.installPackage` binds) declared `data: { package, dependencyResolution?, namespaceConflicts?, message? }` instead. No surface sent that wrapper, so code written against the contract read `data.package` and got `undefined`. The first-party client already followed the wire: `client.packages.install` resolves to `InstalledPackage`.

- **FROM** `data: { package: InstalledPackage, dependencyResolution?, namespaceConflicts?, message? }` **TO** `data: InstalledPackage`. The name, the type names (`PackageInstallResponse`, `PackageInstallResponseParsed`) and the binding are unchanged. The server's answer is unchanged.
- **Both directions.** The schema now accepts the bare row the door serves, which it refused, and refuses the `{ package }` wrapper no server sends.
- **Fix for a consumer:** read the row from `data` itself. Replace `response.data.package` with `response.data`. Drop any read of `data.dependencyResolution`, `data.namespaceConflicts` or `data.message` on this route: the door never sent them.
