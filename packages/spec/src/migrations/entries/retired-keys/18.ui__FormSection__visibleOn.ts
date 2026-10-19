// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #23543 F4 — the section half of `ui/FormField:visibleOn`, retired in the same
// change for the same reason: the form section's deprecated spelling of
// `visibleWhen` (ADR-0089 D2), folded at parse through 17, now a `retiredKey()`
// tombstone naming `visibleWhen`. Stored rows: `view-visibleOn-to-visibleWhen`;
// D3: `ui-visibility-alias-keys-retired`.
export const entry = 'ui/FormSection:visibleOn';
