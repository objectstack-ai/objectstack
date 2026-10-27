// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7176 — pass-through-only (ADR-0049 enforce-or-remove, maintainer ruling
// 2026-08-10): every measured reader copied the key forward and the chain ends
// at ObjectGrid, which never spells it. objectui's VirtualGrid genuinely
// virtualizes but is only exported, never instantiated by ObjectGrid, and its
// props carry no `virtualScroll` member — so no grid ever virtualized off this
// key. Conversion `view-list-passthrough-keys-removed` strips it from sources.
export const entry = 'ui/ListView:virtualScroll';
