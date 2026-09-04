// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14676 — `integration/ErrorMappingConfig` (`rules`, `defaultCategory`,
// `unmappedBehavior`, `logUnmapped`) leaves with its only carrier:
// `ConnectorSchema.errorMapping`, tombstoned in this same major under ADR-0049
// enforce-or-remove (`RETIRED_KEYS_BY_MAJOR[18]`). Nothing outside the declaring
// file ever parsed or constructed one, and an exported value schema with no
// consumer reads as a capability (#3950). Its two `.default()`s
// (`defaultCategory: 'integration_error'`, `logUnmapped: true`) were only ever
// materialized INSIDE an authored `errorMapping` block, so there is no
// residue window on the carrier (#12840 does not apply: the key itself carried
// no default). See `retired-keys/18.integration__Connector__errorMapping.ts`
// for the retirement record.
export const entry = 'integration/ErrorMappingConfig';
