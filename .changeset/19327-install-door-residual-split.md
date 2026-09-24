---
'@objectstack/spec': patch
---

`PackageInstallBodySchema`'s residual docblock splits clause 1: a manifest missing `version` is refused by the install door now, and only the `type` half is still residual

Clause-②: no

The docblock lists the bodies `POST /api/v1/packages` answers `201` to while
the declaration refuses them. Its clause 1 recorded "a manifest missing `type`
and/or `version`" as ONE class. Since #19326 the door parses
`ManifestSchema.shape.version` by reference, so a manifest missing `version`
answers `400` / `VALIDATION_ERROR` and installs nothing; a manifest missing
`type` still answers `201`. Half of the clause had become false.

The clause is now split: **1a** (missing `version`) is marked CLOSED by #19326
and names the door-side pin, and **1b** (missing `type`) stays an open residual.
The count of five classes is unchanged and still true, because class 1 stays
open through its `type` half; the count sentence now says so. The paragraph
that quotes the runtime's two door drives is updated too. It quoted the
duplicate-id drive as `{ id: 'pkg-a', name: 'A' }`, but that drive has posted a
`version` since #19326 and the reverse-domain id `com.example.pkg-a` since
#19473, and the door answers `400` to `pkg-a`. The docblock now quotes the body
the drive posts, `{ id: 'com.example.pkg-a', name: 'A', version: '1.0.0' }`,
which the declaration refuses on `type` alone and the door answers `201`.

⛔ No behaviour changes. No schema, accept set, export or runtime code moves,
and the other four residual classes are untouched.

**Why this carries a changeset and not `skip-changeset`.** `@objectstack/spec`'s
`files[]` ships `src/**/*.zod.ts` verbatim, and the docblock is also emitted
into `dist/api/index.d.ts` and `dist/api/index.d.mts`. The published content
changes, even though no line of code does.
