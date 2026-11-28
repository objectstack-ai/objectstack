// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #36544 — ADR-0049 enforce-or-remove on the form view's `modalSize` (seat
// ruling on the card: retire). Its one form-view reader, the console's New /
// Edit record dialog, stopped loading a form view in #36425, and a form opened
// by name gets a page of its own, so no form-view surface read the key.
// Tombstoned with `retiredKey()`; the React `ObjectForm` block keeps its own
// `modalSize` overlay prop. D2: `form-view-modal-size-removed`; D3:
// `ui-form-view-modal-size-retired`. Registered under 19, the spec package's
// own major.
export const entry = 'ui/FormView:modalSize';
