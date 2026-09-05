// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15676 — the epoch-instant half of #14478 ruling B. `HealthStatus.timestamp`
// is the instant the health check RAN: it moved onto the shared `EpochMs` schema
// and was renamed `checkedAt`, which also states what the instant marks.
//
// Semantic entry rather than a D2 conversion, and registered under 18 rather
// than 17, for the reasons the sibling `api/WebSocketEvent:timestamp` entry
// records: a health report is emitted by the startup orchestrator at runtime,
// never authored into a metadata document.
export const entry = 'kernel/HealthStatus:timestamp';
