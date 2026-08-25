---
"@objectstack/spec": minor
---

feat(spec): retire `contributes.kinds[].globs` — the declared file-type watch patterns nothing ever read (#11169, ADR-0049 enforce-or-remove; maintainer-ruled 2026-08-24)

<!-- adr-0087: registered plugin-manifest-kind-globs-retired -->

**BREAKING** accept-set narrowing, landing after the v17.0.0 cut (the lockstep
launch-window convention ships it as `minor`; the migration prescription is
registered under protocol major 18, where `os migrate meta` users will look).

**Removed key:** `manifest.contributes.kinds[].globs`.

The schema promised that declaring `globs` "enables the system to parse and
validate new file types" (its own example: a BI plugin handling
`*.report.ts`). The promise was never kept: real glob-driven artifact
discovery reads `filePatterns` off the metadata type registry — which
`contributes.kinds` does not extend, as `metadata-plugin.zod.ts` records
outright — so an authored `globs` was accepted, stored, served back through
`GET /metadata/kind`, and never consulted. Measured (PR #11168, re-verified
with positive control at claim): zero value reads anywhere; the only non-test
occurrences of the path were the schema declaration and two type positions.

**FROM → TO:** `kinds: [{ id, globs: […], description? }]` →
`kinds: [{ id, description? }]` — delete the `globs` key; the kind's `id` and
`description` are unchanged and still register. The key is a `retiredKey()`
tombstone, so authoring it is a `tsc` error and a parse error carrying this
prescription.

**What stays:** the `contributes.kinds` bucket itself and its `id` field
(live: engine → `registry.registerKind`, served via `GET /metadata/kind`).
File-type discovery remains single-channel on the metadata type registry's
`filePatterns`; if plugin-extensible discovery is ever wanted, it gets
designed against that registry, not revived here. The `registerKind` /
`getAllKinds` type positions drop `globs` (type-only; the parameter widens).

D3 semantic entry `plugin-manifest-kind-globs-retired`; no D2 conversion (a
manifest is not a stack collection member — no seam would ever run it).
