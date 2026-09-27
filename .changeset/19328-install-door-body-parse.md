---
'@objectstack/runtime': minor
---

fix(runtime): `POST /api/v1/packages` parses the whole body through `PackageInstallBodySchema` instead of reading it key by key (#19328)

Clause-②: no (narrowing)

**BREAKING for callers of the install door.** Four shapes of body are now
refused with `400` / `VALIDATION_ERROR` and install nothing. Each used to
answer `201`, and two of them used to be honoured. For each one, change what
you send FROM the refused shape TO the declared one:

- **A manifest with no `type`, in either body form.** FROM
  `{ "manifest": { "id": …, "name": …, "version": … } }` (or the same manifest
  sent bare) TO the same manifest with a declared `type`: one of `app`,
  `plugin`, `ui`, `driver`, `server`, `theme`, `agent`, `objectql`, `module`,
  `gateway` or `adapter`, e.g. `"type": "app"`. It used to install anyway.
- **An unknown key inside the manifest, or on a bare body.** Example: a
  transposed `namesapce`. FROM a manifest carrying the undeclared key TO the
  manifest with that key removed, or spelled as the declared key it was meant
  to be (`namespace`). The refusal names the key. The key used to be STORED
  with the package.
- **A string-typed `enableOnInstall` or `overwrite`.** FROM
  `"enableOnInstall": "false"` / `"overwrite": "true"` TO JSON booleans,
  `"enableOnInstall": false` / `"overwrite": true`. `'false'` used to install a
  fresh package ENABLED, which is the opposite of what the caller asked for.
  `'true'` for `overwrite` was read as absent, which answered `409` on an
  installed id.
- **Install options spelled on the BARE form (`enableOnInstall`, `overwrite`,
  `settings`).** FROM `{ "id": …, …, "overwrite": true }` TO the wrapped form,
  `{ "manifest": { "id": …, … }, "enableOnInstall": …, "overwrite": …,
  "settings": … }`. `overwrite` may also go on the query string instead
  (`?overwrite=true`), which a bare body may keep using. Before this change the
  door handled these key by key: `enableOnInstall` was ignored, but
  **`overwrite: true` and `settings` were HONOURED** (an installed id was
  overwritten, and the settings reached the install). All three were also
  stored as manifest keys. They are refused now. This is the part of the
  change that removes behaviour a caller could have been relying on.

The accept set only shrinks back to what the published declaration has always
said. `PackageInstallBodySchema` in `@objectstack/spec` is a union of two
branches: the wrapped request, or a bare manifest as the whole body.
`ManifestSchema` requires `type` and closes the manifest against unknown keys.
The wrapped request types `enableOnInstall` and `overwrite` as booleans. Its
docblock says a bare manifest carries no install options: «a caller that needs
an option sends the wrapped form». Until now, the door parsed only two legs of
the manifest (`id` and `version`) and read every other key positionally off
the raw body. That is «declared ≠ enforced» on a published API contract. Now
the door parses the body once through the declared union and reads
`overwrite`, `settings` and `enableOnInstall` off the parsed request. Nothing
in `@objectstack/spec` moves, and neither branch of the union is relaxed.

**What is not affected.**

- A well-formed body installs exactly as before, in both forms and on both
  install limbs (the protocol primitive and the bare-registry fallback).
- The first-party SDK (`client.packages.install(m, { enableOnInstall,
  overwrite, settings })`) already sends the wrapped form with JSON booleans.
  Studio's create-package dialog sends `{ manifest }` with a declared `type`.
- The manifest is stored as sent, with no parse-time defaults added.
- The refusals for a missing or malformed `id` and `version` keep their own
  sentences and still come first.
- Every request-shape refusal is still answered ahead of the duplicate-id
  `409`.
- Boot-time and in-process installs reach `SchemaRegistry.installPackage` /
  `ObjectQL.registerApp` directly and never pass through this door.

**Still accepted, because the declaration accepts it.** An unknown key at the
top level of the wrapped form (`{ manifest, bogus }`) is dropped, not refused.
`PackageInstallRequestSchema` is declared in strip mode, and the door now does
exactly what the declaration says.

**If you are refused.** The refusal names the key and the form it read the body
as. A misplaced install option also gets the wrapped form (and, for
`overwrite`, `?overwrite=true`) spelled out. So the prescription arrives with
the `400` rather than in a changelog.

<!-- adr-0087: not-required (no-migration-prescription) Nothing authorable is removed, renamed or reshaped: no spec key, no export, no stored row. `objectstack migrate meta` has nothing to reach, because there is no old spelling that maps to a new one — every refused shape is one the published declaration already refused, and a caller repairs it by sending the declared shape (a declared `type`, the declared key, a JSON boolean, the wrapped form). The refusal itself carries the remedy. -->
