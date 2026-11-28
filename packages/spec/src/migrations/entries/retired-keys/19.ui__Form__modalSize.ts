// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #36544 — the `form` item's row of the `modalSize` retirement. A `form`
// item's body keys are `FormViewSchema`'s shape by reference (ADR-0159 D2), so
// the tombstone `ui/FormView:modalSize` stands at this door too: a form opened
// by name or by a public link gets a page of its own, never a dialog. D2:
// `form-view-modal-size-removed` (it walks `forms[]`); D3:
// `ui-form-view-modal-size-retired`.
export const entry = 'ui/Form:modalSize';
