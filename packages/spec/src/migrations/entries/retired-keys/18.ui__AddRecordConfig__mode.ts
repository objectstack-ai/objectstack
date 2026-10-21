// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24692 (ADR-0049 enforce-or-remove; ruling letter B′). `addRecord.mode`
// (`inline` / `form` / `modal`, default `inline`) was read by no renderer: the
// list's Add button always opens the object's create form. Tombstoned with
// `retiredKey()` on `AddRecordConfigSchema`, the one def every list-view door,
// the object's `listViews`, the page's `interfaceConfig` and a page
// `list-view` node share. D2: `add-record-mode-form-view-removed`.
export const entry = 'ui/AddRecordConfig:mode';
