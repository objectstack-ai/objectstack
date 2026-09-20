// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16885 — the list view's `navigation.view` binding, retired under ADR-0049
// enforce-or-remove by maintainer ruling 2026-09-13 (director decision batch
// #126 item 4, verbatim 「同意」, option B). The key's describe promised "the
// form view to use for details" and no layer from spec to console ever
// resolved a view BY NAME: its one read in the shipped console passed the
// value into the SECOND argument of `onNavigate` — the slot that otherwise
// carries the navigation-mode token — so an authored name substituted for the
// mode rather than selecting a view, and a consumer reading that argument
// against its closed `edit`/`view` vocabulary matched neither branch. Zero
// authored instances in this repo; the one external author deleted its
// occurrence. ONE key and one entry: `NavigationConfigSchema` is reused BY
// REFERENCE (`ListViewSchema.navigation` is its only referent), so the walked
// shape has a single `ui/NavigationConfig` def and the baseline marks one line
// `[RETIRED]`.
//
// Registered here but NOT in `src/conversions/registry.ts`, and deliberately:
// the ruling's disposition is a D3 SEMANTIC entry
// (`list-view-navigation-view-retired`). A mechanical strip would delete the
// key without telling anyone which list view lost it, and an author who wrote
// it wanted a named detail layout — a want that page assignment serves and a
// stripped key does not record. So the prescription reaches consumers as that
// semantic TODO plus this tombstone.
export const entry = 'ui/NavigationConfig:view';
