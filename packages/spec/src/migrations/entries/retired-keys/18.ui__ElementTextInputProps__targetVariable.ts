// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #9198 — ADR-0049 enforce-or-remove. `targetVariable` on `element:text_input`
// was a declarative hint with zero readers: its own describe text said the
// live binding "resolves via the variable whose `source` equals this component
// id" (PageVariableSchema), and that reverse lookup
// (`usePageVariableBinding(schema?.id)` in objectui's console renderer) is the
// only binding mechanism that exists. Measured (objectstack-ai/objectui#3834,
// re-verified at retirement time): no production reader in objectui, framework
// or cloud — the only repo-wide hits were the reverse-parity gate's exemption
// block (which cites the origin card) and spec's own accept tests. An author
// who wrote `targetVariable` and skipped the variable's `source` got an input
// that wrote nothing, with a success receipt — the ADR-0078 silent-no-op
// shape, on the exact surface AI authors write from. Same disposition as its
// sibling inert hint (objectui#3829, settled by retirement in objectui
// PR #4794).
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// tombstone ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
// Sources are rewritten by the D2 conversion
// `element-input-target-variable-removed` (a page component IS a stack
// collection member, unlike the `kernel/Manifest:loading` family).
export const entry = 'ui/ElementTextInputProps:targetVariable';
