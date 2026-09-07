// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #15676 — the epoch-instant half of #14478 ruling B.
// `SimplePresenceState.lastSeen` is an epoch INSTANT: it moved onto the shared
// `EpochMs` schema and was renamed `lastSeenAt`, joining this package's
// `lastAccessedAt` / `lastUsedAt` family.
//
// ⚠️ Not to be confused with `api/PresenceState:lastSeen`
// (`api/realtime-shared.zod.ts`), a DIFFERENT key of a different type — an
// ISO-8601 datetime string — which is untouched and stays live.
//
// Semantic entry rather than a D2 conversion, and registered under 18 rather
// than 17, for the reasons the sibling `api/WebSocketEvent:timestamp` entry
// records: a presence payload is runtime-emitted, never a stored metadata row.
export const entry = 'api/SimplePresenceState:lastSeen';
