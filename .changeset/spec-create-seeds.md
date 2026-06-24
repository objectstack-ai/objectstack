---
'@objectstack/spec': minor
---

Add authoritative per-type create seeds (root-cause for the "designer shape ≠ spec" family)

New `metadata-create-seeds.ts`: a single source of truth for the minimal valid create shape of each metadata type (`getMetadataCreateSeed(type)`), co-located with the schemas and asserted valid against each type's schema by `metadata-create-seeds.test.ts`. This anchors the create-form's default shape to the spec so it can't drift — the root cause of the recurring family where a freshly-created item (dashboard without `layout`, script action without `body`, report with stale `objectName`/`columns`) failed validation on save (422) yet passed every other gate. Seeds the 9 core Studio-designer types (dashboard, action, page, view, flow, validation, hook, dataset, object); the test surfaces remaining schema-backed types still needing a seed. (Follow-up: expose `createSeed` via `/meta/types` so the Studio designer consumes it instead of hardcoding `createDefaults`.)
