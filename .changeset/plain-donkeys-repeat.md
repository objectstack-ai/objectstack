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
