---
'@objectstack/runtime': patch
---

The `/packages` refusals of a read-only package name the customisation that works today, instead of the retired organization overlay (ADR-0131 D6)

Clause-②: no

`DELETE`, `PATCH /disable`, `POST /publish` and `POST /revert` on a package provided by code or an installed app answer `422 WRITABLE_PACKAGE_REQUIRED`, and `POST /packages/:id/duplicate` on one answers `422 DUPLICATE_SOURCE_NOT_A_BASE`. Both refusals told the caller to customise the package "in place, with an ADR-0005 org overlay". ADR-0131 D6 retired the per-organization overlay axis: no metadata write lands organization-scoped any more, and the protocol refuses one that names an organization with `403 NOT_OVERRIDABLE`. The remedy named a mechanism that no longer exists.

Both refusals now name the customisation that works: customise what the package provides beside it, as environment-level state. Saving an item under its own name overlays it where the item's type takes an environment overlay and the package's lock does not refuse it. Any other save is refused, and that refusal names the route the item's type has, or the lock. The duplicate refusal also names the editable copy of a whole package: install it unmanaged instead (`installMode: 'unmanaged'`), where its manifest's `installModes` permits that.

Only the message text changes. Each refusal's `code`, status, `details`, condition and order are unchanged.
