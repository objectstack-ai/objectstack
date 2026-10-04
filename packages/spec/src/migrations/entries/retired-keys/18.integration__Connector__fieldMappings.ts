// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The second key of the connector-attached sync family (see
// `18.integration__Connector__syncConfig.ts` for the retirement record):
// `ConnectorSchema.fieldMappings`, whose six live keys (`source`, `target`,
// `defaultValue`, `dataType`, `required`, `syncMode`) no engine ever read —
// the word appeared nowhere outside `packages/spec`. The target-side field map
// is `mapping.fieldMapping`, which the REST import path executes. The orphaned
// `integration/ConnectorFieldMapping` leaves via `RETIRED_DEFS_BY_MAJOR[18]`;
// the same D2 conversion strips the key.
export const entry = 'integration/Connector:fieldMappings';
