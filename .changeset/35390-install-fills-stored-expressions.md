---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection): a managed install or upgrade fills the stored computed fields it makes live

Clause-②: no
Metadata-protocol: none

A package version that adds a stored computed field (a non-`formula` field declaring `expression`), changes one's expression, stored type or scale, or turns a `formula` field into one used to leave every existing row `NULL` (or holding the old value) after `os package install` / `POST /api/v1/marketplace/install-local`: the metadata doors filled such a change, the install door did not, and a boot never fills. On a hosted tenant nothing could fill them.

The managed install door now does what the metadata doors do: it captures the stored computed fields of every object the version contributes to (its own objects and the objects its extensions extend, every unit of a composed artifact) before it registers anything, and after its schema sync fills each field the version changed — every existing row, every organization, keeping each row's `updated_at` — through the data engine's own walk (the one `os migrate stored-expressions --changed --apply` runs). Each field is reported on the answer's new `advisories` (omitted when there is nothing to report), with the metadata doors' rule ids: `stored-expression-filled`, or `stored-expression-fill-incomplete` naming what is left and the command that fills it. A version that changes no stored computed field, a refused install and a fresh install over new tables write no row and add no key to the answer. The fill never fails the install.
