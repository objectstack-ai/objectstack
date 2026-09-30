// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/ConnectorFieldMapping` (the shared base `FieldMapping` extended
// with `dataType`, `required` and `syncMode`) leaves with its only carrier,
// `ConnectorSchema.fieldMappings`, tombstoned in this same major under
// ADR-0049. Nothing moved a value through it; the target-side field map is
// `mapping.fieldMapping`. The `integration/ConnectorFieldMapping:transform`
// retired-key row of the earlier `transform` retirement stays as its record.
// See `retired-keys/18.integration__Connector__fieldMappings.ts`.
export const entry = 'integration/ConnectorFieldMapping';
