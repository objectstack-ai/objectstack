// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10724 — ADR-0049 enforce-or-remove on the plugin manifest's `contributes`
// block; one of NINE members tombstoned together. Census, registration major,
// and the why-no-D2-conversion reasoning are recorded once in the sibling
// entry `kernel/Manifest:contributes.events` (this family) and in
// `kernel/Manifest:loading` (the precedent); the D3 semantic entry is
// `plugin-manifest-contributes-dead-members-retired`.
//
// `themes` here was a `{ id, label, path }` shape with no reader anywhere. It
// is UNRELATED to the stack-level `themes` collection (a `ThemeSchema`
// surface, itself retired as a carrier by `stack-themes-carrier-retired`):
// stack-level theme hits reach the registry through top-level metadata
// collections, never through `contributes.themes`.
export const entry = 'kernel/Manifest:contributes.themes';
