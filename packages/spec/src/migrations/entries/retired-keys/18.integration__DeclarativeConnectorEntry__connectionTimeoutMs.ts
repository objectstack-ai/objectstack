// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The same tombstone seen through the second carrier.
// `DeclarativeConnectorEntrySchema` and `ConnectorSchema` are now SIBLINGS, not
// parent and child: each wraps the shared private `ConnectorBaseSchema` in the
// retired-default residue stage, the entry schema adding the ADR-0097
// cross-field rules on the base before wrapping. (Until this retirement the
// entry schema was literally `ConnectorSchema.superRefine(...)`; that spelling
// is gone with the pipe.) So the `connectionTimeoutMs` tombstone is carried by
// the shape that
// `stack.connectors[]` (`stack.zod.ts`) and the `PUT /meta/connector/:name` door
// (`kernel/metadata-type-schemas.ts`) actually parse, and the authorable-surface
// walk publishes the `[RETIRED]` row under this def key as well. One tombstone,
// two registered keys: gate (b) of `scripts/build-schemas.ts` reads EXACT
// `${defKey}:${name}` membership per def, never by radiating from a neighbour.
//
// This carrier is also what made the D2 conversion owed rather than optional:
// the door persists what it parses, so a stored `sys_metadata` connector row can
// carry the key — measured, not assumed, before the tombstone landed.
// See `18.integration__Connector__connectionTimeoutMs.ts` for the retirement record.
export const entry = 'integration/DeclarativeConnectorEntry:connectionTimeoutMs';
