// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24692 (ADR-0049 enforce-or-remove; ruling letter B′). `addRecord.formView`
// named a form view for the Add button to open, and no renderer read it: the
// create form is chosen by convention — `formViews.create` when the object's
// view container declares one, else the default form. Tombstoned with
// `retiredKey()` on `AddRecordConfigSchema` beside `mode`. D2:
// `add-record-mode-form-view-removed`.
export const entry = 'ui/AddRecordConfig:formView';
