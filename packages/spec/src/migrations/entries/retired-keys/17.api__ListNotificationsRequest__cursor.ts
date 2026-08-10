// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #6361 — the notification-inbox pagination key, tombstoned on BOTH halves
// of `GET /api/v1/notifications` because one capability is never half-
// deleted (maintainer ruling 2026-08-07, ruled jointly with #6363). Two
// keys, one prescription: `NOTIFICATIONS_CURSOR_REMOVED` in
// `api/protocol.zod.ts` is the single string both rejection sites raise.
//
// Registered here but NOT in `src/conversions/registry.ts`, and that
// asymmetry is the point rather than an omission: a D2 conversion rewrites
// an authored source or a stored `sys_metadata` row, and these two shapes
// are HTTP-only — nobody authors a `ListNotificationsRequest` and nothing
// persists one. The prescription reaches consumers as the D3 semantic entry
// `notification-list-cursor-retired` plus this tombstone, which is the
// disposition `BatchOptions.validateOnly` and the `AnalyticsQueryRequest`
// envelope keys already take in this major ("a semantic TODO for API
// callers rather than a stack conversion").
export const entry = 'api/ListNotificationsRequest:cursor';
