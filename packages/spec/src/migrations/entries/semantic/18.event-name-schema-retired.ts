// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'event-name-schema-retired',
  surface:
    '`EventNameSchema` and its `EventName` type '
    + '(`@objectstack/spec/shared`, `shared/identifiers.zod.ts`), and the '
    + 'dot-notation grammar it imposed on its only three binding fields: '
    + '`EventTypeDefinitionSchema.name` and `EventSchema.name` '
    + '(`kernel/events/core.zod.ts`) and `EventMessageSchema.eventName` '
    + '(`api/websocket.zod.ts`).',
  replacement:
    '(removed — no replacement grammar layer. The three binding fields stay '
    + 'and widen to plain `z.string()`; the event vocabulary the platform '
    + 'actually checks is the closed literal enums `DataEventType` / '
    + '`BulkDataEventType` (`@objectstack/spec/api`, `api/events.zod.ts`), '
    + 'which stand as the only event-name contract. A caller that imported '
    + '`EventNameSchema` for standalone validation deletes the import; if it '
    + 'was validating platform event names, it parses through the enums '
    + 'instead.)',
  reason:
    'Maintainer ruling 2026-09-01 on #13613 (director decision batch C, '
    + 'verbatim 「同意」: retire) — ADR-0049 enforce-or-remove. The schema '
    + 'presented itself as the platform\'s event-name grammar while nothing '
    + 'that runs consumed its three binding schemas, and the closed enums '
    + 'that do the real checking never referenced it. The event surface is '
    + 'platform-defined, not author-extensible, so a grammar layer for a '
    + 'hypothetical extension surface is a trap, not a reserve: a generator '
    + 'satisfying `EventNameSchema` has satisfied nothing the platform will '
    + 'check, while one emitting outside the closed enums is refused by a '
    + 'rule the identifier file never mentioned.',
  acceptanceCriteria:
    'No code imports `EventNameSchema` or `EventName` from '
    + '`@objectstack/spec/shared` (TS2305 after upgrade); '
    + '`EventTypeDefinitionSchema.name`, `EventSchema.name` and '
    + '`EventMessageSchema.eventName` parse as plain strings (the accept set '
    + 'at those three fields widens — every previously valid document stays '
    + 'valid, so no source rewrite ships and `objectstack migrate meta` has '
    + 'nothing to visit); `DataEventType` / `BulkDataEventType` are '
    + 'byte-for-byte untouched; `WebSocketEventSchema.channel` remains a '
    + 'deliberate bare `z.string()` (the ruling adds no constraint there); '
    + 'the `shared/EventName` def key leaves '
    + '`json-schema.manifest/shared.json` in the same change that registers '
    + 'this entry.',
};
