// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15677 (stack card 2/6 of #14478) — ruling B. The server-side counterpart of
// the `WebSocketConfig` trio, with the same COUNT neighbour problem
// (`reconnectAttempts`). Renamed to `heartbeatIntervalMs`; the value is
// unchanged. Tombstoned with `retiredKey()`. No D2 conversion: server
// construction configuration, never a stored row; the semantic entry
// `websocket-durations-unit-in-key` carries the prescription.
export const entry = 'api/WebSocketServerConfig:heartbeatInterval';
