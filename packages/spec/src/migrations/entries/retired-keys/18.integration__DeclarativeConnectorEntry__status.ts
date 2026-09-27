// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The same `status` tombstone seen through the second carrier — the shape
// `stack.connectors[]` and the `PUT /meta/connector/:name` door parse, which
// also carries the `'inactive'` residue stage (both carriers wrap
// `ConnectorBaseSchema` with the same `CONNECTOR_RETIRED_KEY_RESIDUE`). One
// tombstone, two registered keys, EXACT per-def membership (gate (b)). See
// `18.integration__Connector__status.ts` for the retirement record.
export const entry = 'integration/DeclarativeConnectorEntry:status';
