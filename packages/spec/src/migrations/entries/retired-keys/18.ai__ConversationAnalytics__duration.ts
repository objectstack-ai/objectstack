// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15680 (stack card 5/6 of #14478) — maintainer ruling 2026-09-02 ("ruled B"):
// a duration-shaped `z.number()` key carries its unit in its NAME, and no
// existing offender is grandfathered. `ConversationAnalytics.duration` said
// "Session duration in seconds" in prose and nothing else, on a shape where
// every OTHER number is a count (messages, tokens, pruning events) and the two
// neighbouring instants already spell themselves `firstMessageAt` /
// `lastMessageAt`. Renamed to `durationSeconds`; the value is unchanged.
// Tombstoned with `retiredKey()` — the shape is not `.strict()`, so a bare
// deletion would strip the key in silence and the analytics row would lose the
// one measurement it carries, with no error anywhere. No D2 conversion:
// conversation analytics are computed and emitted at runtime, never authored
// and never a stored `sys_metadata` row, so the chain has no seam that sees
// one. See `ai-conversation-analytics-duration-unit-in-key`.
export const entry = 'ai/ConversationAnalytics:duration';
