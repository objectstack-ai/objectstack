// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// `integration/ConnectorStatus` (`active` / `inactive` / `error` /
// `configuring`) leaves with its only carrier, `ConnectorSchema.status`,
// tombstoned in this same major under ADR-0049 enforce-or-remove. Nothing read a
// connector's `status`; the runtime's dispatchability answer is the computed
// `ConnectorState` (`ready` / `degraded`, `integration/connector-descriptor.ts`),
// which is a TypeScript type and not a published def, so nothing replaces this
// one. See `retired-keys/18.integration__Connector__status.ts` for the
// retirement record.
export const entry = 'integration/ConnectorStatus';
