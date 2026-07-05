---
'@objectstack/spec': minor
---

feat(spec): `deriveRecordFlowSurface(def, flow, opts)` — flow-aware record-surface derivation (#2604, extends #2578's `deriveRecordSurface`, ADR-0085 §5 one-shared-derivation).

Decides the default surface per record FLOW: `view` keeps the shipped behavior verbatim (field-heavy → `route`/page, light → drawer overlay); the task flows (`create` / `edit` / `child-create` / `child-edit`) are ALWAYS overlays — never routes — with the derived `'page'` mapped to a full-screen modal (`size: 'full'`) and light objects staying a drawer. `child-*` flows take the CHILD object's def (the overlay sizes to the record being edited; the return target is always the parent detail). Mobile task flows are full-screen modals.

Rationale: viewing a record is shareable state (deep-link belongs there); making/changing one is a transient task whose URL is a false promise (refresh loses the draft) and whose invariant is lossless return to the origin. Renderers treat the result as the DEFAULT only — explicit `navigation.mode`/`size`, `FormView.type`/`modalSize`, or an assigned page still win. No new authorable key (ADR-0085 §2). Additive, no breaking changes.
