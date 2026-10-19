// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #24394 — `action:icon`'s own `patch`, retired with `action:button`'s for the
// same reason: the row's `operation: 'update'` runs the declared action its
// `name` names, and the platform action route writes THAT declaration's
// `patch` (ADR-0110 D2), never the row's. Same tombstone, conversion
// (`page-action-row-patch-removed`) and D3 record
// (`ui-page-action-row-patch-retired`) as `ui/ActionButtonProps:patch`.
export const entry = 'ui/ActionIconProps:patch';
