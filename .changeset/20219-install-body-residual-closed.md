---
'@objectstack/spec': patch
---

`PackageInstallBodySchema`'s docblock records its measured residual as closed: the install door answers every body the declaration refuses with `400`, not `201`

Clause-②: no

The docblock listed the bodies `POST /api/v1/packages` answered differently
from the declaration: a manifest with no `type`, unknown keys on either body
form, a string-typed `enableOnInstall` / `overwrite`, install options spelled on
the bare form, and (in the other direction) a whitespace-only `id`. It still said
the door answers `201` to the first four. Since the door parses its whole body
through `PackageInstallBodySchema` (#20218), it answers each of them `400` /
`VALIDATION_ERROR` and installs nothing. The whitespace-only `id` was already
refused by both, because `ManifestSchema.id` carries `MANIFEST_ID_PATTERN`.

The section now records every class as closed, names the door-side pin for
each, and says what the declaration's parsed value still does not describe:
the door stores the manifest it was SENT, so parse-time defaults (`scope`,
`defaultDatasource`) are not stored, and an unknown key nested in a manifest
block the declaration leaves in strip mode is stored as sent.

Two more sentences are corrected. The bare-form paragraph said the runtime's
two door drives post a manifest with no `type`; both have carried
`type: 'app'` since #20218 and parse green. The `enableOnInstall` docblock said
the door "reads the raw body"; it reads the key off the parsed wrapped request.

⛔ No behaviour changes. No schema, accept set, export or runtime code moves.

**Why this carries a changeset and not `skip-changeset`.** `@objectstack/spec`'s
`files[]` ships `src/**/*.zod.ts` verbatim, and the `PackageInstallBodySchema`
docblock is also emitted into `dist/api/index.d.ts` and `dist/api/index.d.mts`.
The published content changes, even though no line of code does.
