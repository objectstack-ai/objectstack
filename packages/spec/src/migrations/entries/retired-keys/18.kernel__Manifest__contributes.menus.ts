// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #10724 — ADR-0049 enforce-or-remove on the plugin manifest's `contributes`
// block; one of NINE members tombstoned together. Census, registration major,
// and the why-no-D2-conversion reasoning are recorded once in the sibling
// entry `kernel/Manifest:contributes.events` (this family) and in
// `kernel/Manifest:loading` (the precedent); the D3 semantic entry is
// `plugin-manifest-contributes-dead-members-retired`.
//
// `menus` had the tightest control in the census: the bare word has only three
// non-test hits monorepo-wide — this declaration plus two alias maps that
// redirect the spelling to `navigation`. The working surface is app
// `navigation` / `manifest.navigationContributions` (ADR-0029 D7), which the
// engine registers.
export const entry = 'kernel/Manifest:contributes.menus';
