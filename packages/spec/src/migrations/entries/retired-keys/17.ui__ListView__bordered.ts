// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #7176 — pass-through-only (ADR-0049 enforce-or-remove, maintainer ruling
// 2026-08-10): every measured reader copied the key forward and the chain ends
// at ObjectGrid, which never spells it; the grid frame is the renderer's own
// constant (`borderless`), never this key. Distinct from the LIVE
// `ui/PageCardProps:bordered`, a different surface on the page-card container.
// Conversion `view-list-passthrough-keys-removed` strips it from sources.
export const entry = 'ui/ListView:bordered';
