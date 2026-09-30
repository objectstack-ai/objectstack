---
'@objectstack/cli': patch
---

fix(cli): `os package publish` sends `visibility` only when `--visibility` is passed, so re-publishing no longer moves a `marketplace` package to `org`

Clause-②: no

The `--visibility` flag defaulted to `org`, and the CLI always sent it in the package
upsert (`POST /api/v1/cloud/packages`). That upsert is also the re-publish path, and
the control plane updates an existing package's visibility whenever the request carries
one. So re-publishing a new version of a `marketplace` package without repeating
`--visibility marketplace` silently set it to `org` and took it out of the marketplace.

The flag no longer has a default, and an omitted flag is an omitted key:

- **Re-publish without the flag:** the package keeps its current visibility.
- **First publish without the flag:** the control plane applies its own default
  (`org` on ObjectStack Cloud), so a new package gets the same visibility as before.
- **With the flag:** unchanged. `--visibility private|org|marketplace` is sent and
  applied, as before.

The publish summary's `Visibility` line shows the control plane's answer. When the
control plane does not report it and no flag was given, the line says
`not reported by the control plane`. The "visibility is marketplace but the version is
still draft" hint now follows that answer too, so it also fires when a `marketplace`
package is re-published without the flag. The `--submit` help text now states its
precondition as the package's visibility being `marketplace` (already stored, or set
with `--visibility marketplace`), since the flag is no longer sent on every publish.
