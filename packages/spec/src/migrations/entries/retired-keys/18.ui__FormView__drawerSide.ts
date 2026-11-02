// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #29012 — ADR-0049 enforce-or-remove on the form view's drawer keys (triage
// ruling: retire). `type: 'drawer'` left the form view in #27155, so no form
// view opens in a drawer and no form-view surface read the key. Tombstoned
// with `retiredKey()`; the React `ObjectForm` block keeps its own `drawerSide`
// overlay prop. D2: `form-view-drawer-keys-removed`; D3:
// `ui-form-view-drawer-keys-retired`.
export const entry = 'ui/FormView:drawerSide';
