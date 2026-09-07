// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15679 (stack card 4/6 of #14478) — ruling B. This is the live 1000x collision
// that got the whole population ruled: `CollaborationSessionConfig.idleTimeout`
// is MILLISECONDS while the tenant surface carried its own `idleTimeout` in
// SECONDS, so `idleTimeout: 300000` meant five minutes here and three and a half
// days there, with nothing at either authoring site to tell them apart. Renamed
// to `idleTimeoutMs`; the value and the 300000 default are unchanged. Tombstoned
// with `retiredKey()`. No D2 conversion: `stack.zod.ts` declares no
// `collaboration` collection and a session config is a runtime call argument,
// not a stored metadata row. See `system-collaboration-durations-unit-in-key`.
export const entry = 'system/CollaborationSessionConfig:idleTimeout';
