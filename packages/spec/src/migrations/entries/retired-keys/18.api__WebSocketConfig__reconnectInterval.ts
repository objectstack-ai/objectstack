// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B. Three durations on
// `WebSocketConfig` named their unit only in prose, interleaved with a
// `maxReconnectAttempts` that is a COUNT — so `reconnectInterval: 5` beside
// `maxReconnectAttempts: 5` read as one kind of number and was two. Renamed to
// `reconnectIntervalMs`; the value is unchanged. Tombstoned with `retiredKey()`.
// No D2 conversion: a `WebSocketConfig` is a client connection argument, never a
// stored row; the semantic entry `websocket-durations-unit-in-key` carries the
// prescription for all four of this shape's renames.
export const entry = 'api/WebSocketConfig:reconnectInterval';
