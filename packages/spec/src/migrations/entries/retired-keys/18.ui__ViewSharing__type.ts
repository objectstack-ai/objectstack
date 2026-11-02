// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #29037 — ADR-0049 enforce-or-remove on the view sharing block's ownership
// `type` (ruling of record 6570568131 on #28971, letter C). Its one reader was
// the console list toolbar's badge, and nothing restricted a `personal` view to
// one user. Tombstoned with `retiredKey()`, the released `collaborative`
// default accepted as residue. D2: `view-personal-declarations-removed`; D3:
// `ui-view-personal-declarations-retired`.
export const entry = 'ui/ViewSharing:type';
