// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15676 — the epoch-instant half of #14478 ruling B. `KernelContext.startTime`
// is the boot INSTANT: it moved onto the shared `EpochMs` schema and was renamed
// `startedAt`.
//
// Semantic entry rather than a D2 conversion, the same disposition
// `kernel/KernelContext:previewMode` already carries on this very def: a kernel
// context is constructed by HOST CODE at boot — not a stack collection member
// (`PLURAL_TO_SINGULAR` has no entry for it), never stored as a `sys_metadata`
// row — so the conversion chain has no seam that would ever see one.
//
// Registered under 18, not 17, for the reason that sibling entry records.
export const entry = 'kernel/KernelContext:startTime';
