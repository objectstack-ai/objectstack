---
'@objectstack/runtime': patch
---

fix(runtime): `POST /api/v1/packages` parses the whole body through `PackageInstallBodySchema` instead of reading it key by key (#19328)

Clause-②: no

The install door parsed two legs of the manifest (`id`, `version`) and read
every other key positionally off the raw body. So four classes of body that
the published declaration, `PackageInstallBodySchema` (the wrapped request, or
a bare manifest as the whole body), has always refused still installed and
answered `201`. The door now parses the body once through that union and
answers a failure with the envelope its `id` and `version` refusals already
use: `400` / `VALIDATION_ERROR`, nothing installed. Nothing in
`@objectstack/spec` moves. The declaration was already right, and neither of
its branches is relaxed.

**What is now refused, and what to send instead.** Measured against the door
on `main` before the change, then after it:

- **A manifest with no `type`** (either body form). It used to install. Now:
  `400`. **Send instead:** a `type` from the declared set (`app`, `plugin`,
  `ui`, `driver`, `server`, `theme`, `agent`, `objectql`, `module`, `gateway`,
  `adapter`), e.g. `type: "app"`.
- **An unknown key inside the manifest, or on a bare body** (e.g. a transposed
  `namesapce`). It used to install and was STORED with the package. Now:
  `400`, and the refusal names the key. **Send instead:** the declared key
  spelled correctly, or no key at all.
- **A string-typed `enableOnInstall` or `overwrite`.** `enableOnInstall:
  'false'` used to install a fresh package ENABLED, the opposite of what the
  caller asked. `overwrite: 'true'` was read as absent (`409`). Now: `400`.
  **Send instead:** a JSON boolean, `enableOnInstall: false` /
  `overwrite: true`. The first-party SDK (`client.packages.install(m,
  { enableOnInstall, overwrite, settings })`) already sends booleans in the
  wrapped form and is unaffected.
- **Install options spelled on the BARE form** (`{ id, …, enableOnInstall }`).
  They were handled key by key: `enableOnInstall` ignored, `overwrite` and
  `settings` honoured, all three stored as manifest keys. Now: `400`, and the
  refusal names the misplaced keys and the wrapped form. **Send instead:** the
  wrapped form, `{ "manifest": { … }, "enableOnInstall": …, "overwrite": …,
  "settings": … }`. `overwrite` may also ride the query string
  (`?overwrite=true`), which a bare body may keep using.

**What does not change.** A well-formed body installs exactly as before, in
both forms and on both install limbs (the protocol primitive and the
bare-registry fallback). The manifest is stored as sent, with no parse-time
defaults added. The refusals for a missing or malformed `id`, and for a
missing or malformed `version`, keep their own sentences and still come
first. Every request-shape refusal is still answered ahead of the duplicate-id
`409`. Boot-time and in-process installs never pass through this door.

**Still accepted, because the declaration accepts it.** An unknown key at the
top level of the wrapped form (`{ manifest, bogus }`) is dropped, not refused:
`PackageInstallRequestSchema` is declared in strip mode, and the door now does
exactly what the declaration says.
