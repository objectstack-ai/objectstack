// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/ConnectorHealth` (`healthCheck`, `circuitBreaker`) leaves with its
// only carrier, `ConnectorSchema.health`, tombstoned in this same major under
// ADR-0049 enforce-or-remove (`RETIRED_KEYS_BY_MAJOR[18]`). Nothing outside the
// declaring file ever parsed or constructed one, and an exported value schema
// with no consumer reads as a capability (#3950). See
// `retired-keys/18.integration__Connector__health.ts` for the retirement record.
export const entry = 'integration/ConnectorHealth';
