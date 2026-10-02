// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #21320 — `automation/ActionRef` (a named side effect, by name or parameterised) left with `automation/StateMachine`:
// every consumer it had was inside the retired state-machine family (the
// #3950 rule — an exported value schema with no consumer reads as a
// capability). See `18.automation__StateMachine.ts` for the retirement
// record and the ruling.
export const entry = 'automation/ActionRef';
