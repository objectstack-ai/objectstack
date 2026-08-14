---
'@objectstack/objectql': patch
'@objectstack/spec': patch
---

A tenant's own object rename now wins over a package extension's scalar in the object fold (#8460).

`mergeObjectDefinitions` applied an `objectExtensions` entry's `label` /
`pluralLabel` / `description` last, onto whatever base it was handed — and
ADR-0029 D9.2 makes the tenant's overlay that base. So a rename saved through
Studio answered `200`, was visible under `?layers=true`, and was overwritten
inside the fold before any read served it.

Per the 2026-08-13 maintainer ruling (ADR-0029 D9.2a), an extender's scalar now
applies only while the fold's base still carries the packaged owner's value; a
base that has diverged was authored by the tenant, and the extender yields. This
is the same comparison-based mechanism #8284 established for the i18n catalog
one layer up — the same predicate, now exported from `@objectstack/spec` and
imported by the registry rather than re-spelled — so one rule covers both
layers: an explicit override beats a packaged default.

No provenance flags and no migration: the question is answered from two values
at fold time. The accepted cost is deliberate — a package can no longer relabel
an object a tenant has deliberately renamed.
