---
'@objectstack/cli': minor
'@objectstack/client': patch
---

feat(cli): `os meta delete` and `os meta register` take `--package <id>`, so a CLI user can follow the `409 RESOURCE_CONFLICT` remedy the metadata doors prescribe for an item two packages hold (#23350)

Clause-②: yes (widening)

**What is new.** Both commands declare an optional `--package` flag, a package id such as `com.acme.crm`, and forward it verbatim as the SDK's `packageId`, sent as `?package=<id>`:

```bash
os meta delete view shared_grid --package com.acme.crm              # removes com.acme.crm's row of the item, no other package's row
os meta register view --data view-def.json --package com.acme.crm   # writes com.acme.crm's row of the item
```

**Why.** A metadata item can hold one row per package (ADR-0048). When two or more packages hold an item, the reset door `DELETE /api/v1/meta/:type/:name` and the save door `PUT /api/v1/meta/:type/:name` both refuse a request that names no package, with `409 RESOURCE_CONFLICT`. The refusal names the packages and prescribes `?package=`. Neither command could send it, so a CLI user was told to do something the CLI could not do.

**Unchanged.** Without `--package`, both commands send the same request as before: `os meta delete` adds no query string unless `--draft` is given, and `os meta register` saves active with no query string. `--package` combines with `--draft` and `--if-match` on `os meta delete`. An empty `--package` (for example `--package "$PKG"` with `PKG` unset) is refused before anything is sent, as an empty `--if-match` already is, because a package-less request is not always refused: the server may resolve it to a row the operator did not mean.

**`@objectstack/client` (patch).** The `DeleteMetaItemOptions` docblock now names the reset door's carriers (`If-Match`, `state`, `package`, `dropStorage`, `member`) instead of stating a count that had gone stale. No type or behavior changes.
