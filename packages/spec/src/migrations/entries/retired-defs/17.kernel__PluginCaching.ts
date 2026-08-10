// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #4914 — the plugin manifest's `loading` block (ADR-0049 enforce-or-remove,
// maintainer ruling 2026-08-04). `PluginLoadingConfig` was reachable from
// authored metadata ONLY through `Manifest.loading`, and the ten members
// below were embedded only by it, so retiring the carrier key unpublishes
// the whole closure. The carrier itself is a `retiredKey()` tombstone
// registered one level up in `RETIRED_KEYS_BY_MAJOR`.
//
// ⚠️ `kernel/PluginLoadingEvent` and `kernel/PluginLoadingState` are
// deliberately NOT here. They live in the same module and share its prefix,
// but neither was ever embedded in `PluginLoadingConfig` — they are the
// observational half (a lifecycle event and a per-plugin state), they are
// not authorable, and they still emit. Module adjacency is not evidence,
// the `system/ServerRateLimitConfig` note above applies verbatim.
export const entry = 'kernel/PluginCaching';
