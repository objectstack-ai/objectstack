// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #29012 — the second drawer key, retired with `drawerSide` on the same
// evidence (no form view opens in a drawer since #27155). It was already
// `[DEPRECATED → size buckets]` and had no size-bucket conversion of its own:
// the D2 entry `form-view-drawer-keys-removed` deletes it, and a list's record
// drawer takes its starting width from `navigation.size`. D3:
// `ui-form-view-drawer-keys-retired`.
export const entry = 'ui/FormView:drawerWidth';
