// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #13613 — ADR-0049 enforce-or-remove (maintainer ruling 2026-09-01, director
// batch C: retire). `EventNameSchema` presented itself as the platform's
// event-name grammar while nothing that runs consumed it: its only three
// binding schemas (`EventTypeDefinitionSchema.name`, `EventSchema.name`,
// `EventMessageSchema.eventName`) have zero runtime consumers, and the
// vocabulary the platform actually checks is the closed literal enums
// `DataEventType` / `BulkDataEventType` (`api/events.zod.ts`), which never
// referenced it. The three fields stay as plain `z.string()`; the enums are
// the only event-name contract. `WebSocketEventSchema.channel` stays a
// deliberate `z.string()` — the ruling adds no constraint there. No authored
// document is invalidated (the accept set at the three fields widens), so no
// tombstone and no D2 conversion — this table plus the D3 semantic entry
// `event-name-schema-retired` are the declaration (the #8715 route-3 shape).
export const entry = 'shared/EventName';
