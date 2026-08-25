// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10724 — ADR-0049 enforce-or-remove on the plugin manifest's `contributes`
// block; one of NINE members tombstoned together. Census, registration major,
// and the why-no-D2-conversion reasoning are recorded once in the sibling
// entry `kernel/Manifest:contributes.events` (this family) and in
// `kernel/Manifest:loading` (the precedent); the D3 semantic entry is
// `plugin-manifest-contributes-dead-members-retired`.
//
// `actions` declared invocable server actions nothing ever registered. The
// working surfaces are the stack `actions` collection (METADATA_ARRAY_KEYS,
// registered by the engine) and `engine.registerAction`.
export const entry = 'kernel/Manifest:contributes.actions';
