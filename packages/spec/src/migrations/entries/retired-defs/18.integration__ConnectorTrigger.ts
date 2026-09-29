// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/ConnectorTrigger` (`key`, `label`, `description`,
// `type: 'polling' | 'webhook'`, `intervalSeconds`, and the `interval` tombstone
// of its unit rename) leaves with its only carrier, `ConnectorSchema.triggers`,
// tombstoned in this same major under ADR-0049 enforce-or-remove. Nothing read a
// connector trigger, so nothing replaces the shape: work starts from a flow that
// calls the connector's action. See
// `retired-keys/18.integration__Connector__triggers.ts` for the retirement
// record.
export const entry = 'integration/ConnectorTrigger';
