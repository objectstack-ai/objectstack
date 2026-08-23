// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #9249 — ADR-0049 enforce-or-remove at ELEMENT grain. `element:form` never
// had a renderer or reader anywhere — the #9220 shape one element over,
// recorded by that card's own verdict sweep. objectui registers none (its
// renderers/basic/elements.tsx header deferred the element to "owning plugins"
// that never materialized), Studio's designer palette carries it as a
// no-renderer PALETTE_EXCLUSIONS entry naming the live replacement ("no
// renderer — use the object-bound `object-form` block"), and the 2026-06
// page-liveness audit recorded it rendering "Unknown component type". Measured
// at retirement time (objectstack @dd84ddd796, objectui @3ece13e33; cloud per
// the card's two recorded readings @5f1bf23f / @a11458b): zero production
// readers of any `element:form` key — so every key, this one included, was a
// capability claim nothing kept. Per-key retirement would have been the wrong
// grain (the #9198 lesson, two elements over); all six authorable keys are
// tombstoned together.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstones ship on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// Sources are rewritten by the D2 conversion `element-form-removed`, which
// strips all six keys and leaves the bare node — inert as it always was.
export const entry = 'ui/ElementFormProps:onSubmit';
