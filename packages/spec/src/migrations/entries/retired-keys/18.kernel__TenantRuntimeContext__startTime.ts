// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15676 — the walked-shape copy of `kernel/KernelContext:startTime`.
// `TenantRuntimeContextSchema` extends `KernelContextSchema`, so it inherits
// both the renamed `startedAt` key and the tombstone; the authorable-surface
// ratchet records the two copies separately, so both are declared here. The
// `previewMode` retirement registered its two copies the same way.
export const entry = 'kernel/TenantRuntimeContext:startTime';
