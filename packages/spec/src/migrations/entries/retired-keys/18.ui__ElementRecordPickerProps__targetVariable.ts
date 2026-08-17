// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #9198 — ADR-0049 enforce-or-remove. `targetVariable` on
// `element:record_picker` was a declarative hint with zero readers: the picker
// writes the selected record id through the reverse binding — the page
// variable whose `source` names this component's `id` (PageVariableSchema;
// `usePageVariableBinding(schema?.id)` in objectui's console renderer) — and
// nothing anywhere read this key. Measured (objectstack-ai/objectui#3834,
// re-verified at retirement time): zero production readers in objectui,
// framework and cloud; the only repo-wide hits were the reverse-parity gate's
// exemption block and spec's own accept tests. Same silent-no-op hazard and
// same disposition as the `element:text_input` twin registered beside this
// entry, and as the #5775 record-picker inert keys one shape over.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// Sources are rewritten by the D2 conversion
// `element-input-target-variable-removed`.
export const entry = 'ui/ElementRecordPickerProps:targetVariable';
