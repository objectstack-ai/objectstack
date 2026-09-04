// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14676 — the same tombstone seen through the second carrier.
// `DeclarativeConnectorEntrySchema` is `ConnectorSchema.superRefine(...)`, so the
// `errorMapping` tombstone on the base is inherited by the shape that
// `stack.connectors[]` (`stack.zod.ts`) and the `PUT /meta/connector/:name` door
// (`kernel/metadata-type-schemas.ts`) actually parse, and the authorable-surface
// walk publishes the `[RETIRED]` row under this def key as well. One tombstone,
// two registered keys: gate (b) of `scripts/build-schemas.ts` reads EXACT
// `${defKey}:${name}` membership per def, never by radiating from a neighbour.
// See `18.integration__Connector__errorMapping.ts` for the retirement record.
export const entry = 'integration/DeclarativeConnectorEntry:errorMapping';
