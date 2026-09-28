// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #20289 (family `qa-runner`, verdict ENFORCE; the `requires` key ruled B) —
// `requires.plugins` could never be judged: `os test` reaches its target over
// HTTP and no served surface lists the loaded plugins. It retires into
// `requires.services`, judged against the services the target's discovery
// document declares enabled and available. Tombstoned with `retiredKey()` inside
// the live `requires` block, whose `params` and `services` keep parsing. No D2
// conversion: a QA suite is a loose JSON file `os test` loads, never a stack
// collection member or a stored row. D3 semantic entry
// `qa-scenario-requires-plugins-retired`. Registered under 18 for the
// launch-window reason its neighbours state.
//
// Nested key of an inline block — no `authorable-surface/` line of its own.
export const entry = 'qa/TestScenario:requires.plugins';
