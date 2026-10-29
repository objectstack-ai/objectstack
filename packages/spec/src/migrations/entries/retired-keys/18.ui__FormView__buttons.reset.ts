// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #27153 — ADR-0049 enforce-or-remove on the form view's `buttons` block: six
// console form button bars draw submit and cancel and none drew a reset button;
// `reset.label` had no reader. Tombstoned with `retiredKey()` inside the live
// `buttons` block, so `submit` and `cancel` keep parsing. D2:
// `form-view-buttons-reset-removed`; D3: `ui-form-view-buttons-reset-retired`.
// Nested key of an inline block — no `authorable-surface/` line of its own.
export const entry = 'ui/FormView:buttons.reset';
