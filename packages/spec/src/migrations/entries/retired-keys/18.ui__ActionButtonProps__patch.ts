// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24394 — ADR-0049 enforce-or-remove through the ADR-0087 D2 route. A page
// action row's own `patch` (here `action:button`'s) declared a write the
// platform never performs: the row's `operation: 'update'` posts to the
// platform action route under the row's `name`, and the route resolves that
// declaration by name (ADR-0110 D2) and writes the declaration's own `patch`.
// The row's `patch` reached no request; the console read it for its Undo
// snapshot only. Tombstoned with `retiredKey()` on the row and on
// `action:icon` and each `action:group` / `action:menu` member (the members'
// keys have no surface row of their own, so two keys are registered);
// `ActionSchema.patch` is untouched. Stored and built pages are stripped by the
// D2 conversion `page-action-row-patch-removed`, whose D3 record is
// `ui-page-action-row-patch-retired`.
export const entry = 'ui/ActionButtonProps:patch';
