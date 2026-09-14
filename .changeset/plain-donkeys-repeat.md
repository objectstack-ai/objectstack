---
'@objectstack/spec': minor
---

Declare the ASSEMBLED manifest stage on the installed-package read API.

**BREAKING** — a TYPE-level break on two PUBLISHED response types. It ships
`minor` under the pre-GA launch-window convention (ADR-0087, *Ratified: the
pre-launch launch-window exemption*), where the npm level is deliberately not the
carrier of breaking-ness; this banner and the ADR-0087 disposition at the bottom
are. Runtime is untouched and stays additive — every payload that parsed before
still parses — so the affected party is a TypeScript consumer and the channel is
the compiler at their own call site. Reading a manifest field off
`ListInstalledPackagesResponseSchema` or `GetInstalledPackageResponseSchema` can
stop compiling, and assigning a malformed manifest to either can start compiling
where the old annotation refused it. Both directions are measured against the
built `.d.ts` under *The STATIC gain is one-sided* below, which is also where the
point-of-use reading lives.

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

This is additive at runtime, and the runtime parse is where the gain is: every
payload that parsed before still parses, payloads that were refused for their
manifest stage now parse, and a row belonging to neither stage — an `objects`
array mixing globs with definitions — is still refused. `ManifestSchema` is
unchanged.

The STATIC gain is one-sided, and smaller than a union normally implies.
`AssembledPackageBodySchema` is annotated `z.ZodType<Record<string, unknown>, …>`
in `stack.zod.ts` — deliberately, for the declaration-size reasons recorded
there, and untouched by this change — so the assembled branch carries no field
typing. Measured against the built `.d.ts`: a plain `.manifest.version` read off
one of these two response types now yields `unknown` where it used to yield
`string`; narrowing toward the AUTHORING branch restores the whole of
`ManifestSchema` (`version: string`, `objects: string[]`), while narrowing away
from it yields `Record<string, unknown>` — every manifest field `unknown`. In the
assignment direction the assembled branch admits any object at `manifest`, so a
garbage manifest and the mixed-stage row named above both typecheck clean even
though the runtime union refuses both. So: narrow at the point of use for the
authoring stage, and treat an assembled manifest as a record the runtime — not
the compiler — has checked.

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

<!-- adr-0087: not-required (no-migration-prescription) nothing is removed or renamed: `ManifestSchema` is unchanged, no authorable key moves and no stored row shape moves, so `objectstack migrate meta` has nothing to rewrite and the ledger cannot carry this change. The break is confined to the declared TypeScript surface of two response schemas, where the compiler reaches every affected consumer. -->
