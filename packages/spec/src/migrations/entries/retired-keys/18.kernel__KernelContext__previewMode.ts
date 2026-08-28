// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11846 — ADR-0049 enforce-or-remove on the preview-mode block (maintainer
// ruling 2026-08-27, Option A: remove). The key was declared as an auth bypass
// — its docstring promised auto-login as a simulated admin and named a
// production guard "the runtime must enforce" — and NOTHING implemented any of
// it: zero consumers measured in objectstack, objectui and cloud (cloud#1651,
// 2026-08-26, with positive controls; `ArtifactKernelFactory` — where serve.ts
// predicted preview auto-login would live if anywhere — never touches it). An
// author could write the six-key block today, parse cleanly, and get no
// behaviour and no diagnostic, while the reference docs said the capability
// existed. Tombstoned with `retiredKey()` — `KernelContextSchema` is not
// `.strict()`, so a bare deletion would be a silent strip (#3733, ADR-0104).
//
// Registered here but NOT in `src/conversions/registry.ts`, the
// `kernel/Manifest:loading` reasoning: a kernel context is constructed by HOST
// CODE at boot — it is not a stack collection member (`PLURAL_TO_SINGULAR` has
// no entry for it) and nothing stores one as a `sys_metadata` row, so a
// MetadataConversion would be a transform with no seam that ever runs. The
// prescription reaches authors through the tombstone plus the D3 semantic
// entry `kernel-context-preview-mode-retired`.
//
// Registered under 18, not 17: v17.0.0 was cut before this landed, so the
// removal ships on the 17.x line (launch-window convention: accept-set
// narrowings ride minor releases) and the prescription lives at the major
// boundary where `migrate meta` users look (the #8495 / PR #8666 precedent).
export const entry = 'kernel/KernelContext:previewMode';
