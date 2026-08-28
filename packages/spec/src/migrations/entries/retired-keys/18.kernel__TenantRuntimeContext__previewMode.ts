// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #11846 — the `TenantRuntimeContextSchema` copy of
// `kernel/KernelContext:previewMode`: the def is `KernelContextSchema.extend(…)`,
// so the tombstone lands in this walked shape too and `authorable-surface/`
// marks it `[RETIRED]` separately. Registered per key, as gate (b) reads them —
// nothing radiates from the base (the `shared/FieldMapping:transform`
// precedent). See the base entry for the full record and the
// no-D2-conversion reasoning.
export const entry = 'kernel/TenantRuntimeContext:previewMode';
