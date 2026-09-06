// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B. `RouteDefinition.timeout` said
// "Execution timeout in ms" in prose and nothing else. Renamed to `timeoutMs`;
// the value is unchanged. Tombstoned with `retiredKey()`. No D2 conversion: a
// `RouteDefinition` is a router registration a host or plugin builds in code,
// never a stack collection member or a stored row; the semantic entry
// `api-runtime-config-durations-unit-in-key` carries the prescription. Note for
// anyone grepping: `packages/runtime/src/dispatcher-plugin.ts` declares its OWN
// local `RouteDefinition` interface for the `ai:routes` hook payload — a
// different type, with no duration key at all, and untouched by this rename.
export const entry = 'api/RouteDefinition:timeout';
