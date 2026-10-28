// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #27155 — `section.pane` placed a form section in one pane of a split form,
// and `type: 'split'` left the form view (ADR-0050, ruling 6464210455 on
// #27032, letter A′), so no form view draws panes. Tombstoned with
// `retiredKey()`. D2: `form-view-presentation-types-removed`; D3:
// `ui-form-view-type-layout-only`.
export const entry = 'ui/FormSection:pane';
