// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #27159 — the split form's pane orientation. It outlived `type: 'split'`
// (#27155) only because the React `ObjectForm` block read it, and that reader
// left with `SplitForm` (ADR-0050). Tombstoned with `retiredKey()`. D2:
// `form-view-presentation-types-removed`; D3: `ui-form-view-type-layout-only`.
export const entry = 'ui/FormView:splitDirection';
