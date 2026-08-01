---
---

Regenerates `packages/spec/api-surface.json` so the committed baseline records the
four `./data` exports the percent-scale chain adds — `PercentScale`,
`PercentScaleFieldMeta`, `percentScaleOf` and `emptyGroupValueFor`.

Deliberately empty: this releases nothing. `api-surface.json` is a build-time
snapshot the `check:api-surface` gate diffs against, not shipped code, and the
exports it now records are already described by the changeset for the change that
introduced them. Declaring a bump here would double-count that release.
