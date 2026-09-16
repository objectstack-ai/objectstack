// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #16059 — `PluginStartupResult.plugin` carried a nested
// `{ name, version } & Record<string, unknown>` plugin object. The kernel has
// never built one: `ObjectKernel.startPluginWithTimeout()` has always returned
// the plugin NAME, and the re-declaration of this schema against the shipped
// shape replaces the key with `pluginName`. Tombstoned rather than dropped
// because this def keeps emitting and its type is imported by
// `@objectstack/core`, so a construction site still writing `plugin` meets the
// prescription through tsc as well as through a parse.
export const entry = 'kernel/PluginStartupResult:plugin';
