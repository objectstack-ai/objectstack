// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The same `health` tombstone seen through the second carrier.
// `DeclarativeConnectorEntrySchema` and `ConnectorSchema` are SIBLINGS: each
// wraps the shared private `ConnectorBaseSchema` in the retired-default residue
// stage, so the tombstone is carried by the shape that `stack.connectors[]`
// (`stack.zod.ts`) and the `PUT /meta/connector/:name` door
// (`kernel/metadata-type-schemas.ts`) actually parse, and the authorable-surface
// walk publishes the `[RETIRED]` row under this def key as well. One tombstone,
// two registered keys: gate (b) of `scripts/build-schemas.ts` reads EXACT
// `${defKey}:${name}` membership per def. See
// `18.integration__Connector__health.ts` for the retirement record.
export const entry = 'integration/DeclarativeConnectorEntry:health';
