---
'@objectstack/spec': minor
---

Declare the ASSEMBLED manifest stage on the installed-package read API.

`GET /api/v1/packages` and `GET /api/v1/packages/:packageId` serve whatever a
package was installed with, and two stages reach that table through declared
doors: `POST /api/v1/packages` installs an authoring manifest (`manifest.objects`
= glob patterns), while a `defineStack()` host installs the assembled body
(`manifest.objects` = object definitions). Both response schemas typed every row
at the authoring stage alone, so the shipped `defineStack()` path served a
payload its own declared contract refused.

Following the #14242 ruling — declare the assembled stage rather than widen the
authoring one — `@objectstack/spec/api` gains two exports:
`AssembledInstalledPackageSchema` (the assembled-stage counterpart of
`InstalledPackageSchema`) and `InstalledPackageAtEitherStageSchema`, a union
over the two whole closed stage declarations. `ListInstalledPackagesResponseSchema`
and `GetInstalledPackageResponseSchema` are bound to the union.

This is additive at runtime: every payload that parsed before still parses, and
payloads that were refused for their manifest stage now parse. `ManifestSchema`
is unchanged. A row belonging to neither stage — an `objects` array mixing globs
with definitions — is still refused. Consumers holding a value typed as one of
these two responses now see a union at `manifest` and narrow at the point of use.

`@objectstack/spec/api` also gains a `browser` export condition. Declaring the
assembled stage makes this entry's module graph reach the datasource
declaration and with it the driver-config validators, whose postgres URL
refinement links `pg-connection-string` — a package whose `parse` statically
resolves `require('fs')`, so a browser bundler that reaches it fails on
`Can't resolve 'fs'`. The entry now resolves, for browser consumers only, to a
build with the pg-grammar arm swapped for its dependency-free twin: exactly the
boundary the four entries that already carry the condition use. Node resolution
and the Node bundles are unchanged, byte for byte. For browser consumers the
postgres `url` refinement degrades to the shape-only checks it already performs
before `parse` — the unix-socket short-circuit and the refusal of the
filesystem-reading `?sslcert=` / `?sslkey=` / `?sslrootcert=` query parameters
are kept; the "is this a URL `pg` can open" arm answers "no findings". Datasource
publish is a server-side act, so that arm never legitimately ran in a browser.
