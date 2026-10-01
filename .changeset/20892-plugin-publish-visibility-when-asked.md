---
'@objectstack/cli': patch
---

fix(cli): `os plugin publish` sends `visibility` only when `--visibility` is passed, so re-publishing no longer moves a `marketplace` plugin to `private`

The `--visibility` flag of `os plugin publish` defaulted to `private`, and the CLI always
sent it in the package upsert (`POST /api/v1/cloud/packages`). That upsert is also the
re-publish path, and the control plane updates an existing package's visibility whenever
the request carries one. So re-publishing a new version of a `marketplace` plugin without
repeating `--visibility marketplace` silently set it to `private`. `os package publish`
already works this way; both commands now behave the same.

The flag no longer has a default, and an omitted flag is an omitted key:

- **Re-publish without the flag:** the package keeps its current visibility.
- **First publish without the flag:** the control plane applies its own default (`org` on
  ObjectStack Cloud), the default `PackageSchema.visibility` declares. Before this change
  `os plugin publish` sent `private` here; pass `--visibility private` to keep that.
- **With the flag:** unchanged. `--visibility private|org|marketplace` is sent and applied.

The publish summary gains a `Visibility` line showing the control plane's answer. When the
control plane does not report it and no flag was given, the line says
`not reported by the control plane`. The "Re-run with --submit" hint now follows that
answer too, so it also fires when a `marketplace` plugin is re-published without the flag.
