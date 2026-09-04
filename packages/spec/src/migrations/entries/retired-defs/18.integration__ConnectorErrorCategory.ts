// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14676 — `integration/ConnectorErrorCategory` (the 8-value connector-side
// error category enum) left with its two carriers: `ErrorMappingRule.targetCategory`
// and `ErrorMappingConfig.defaultCategory`, both retired in this same major
// (`RETIRED_DEFS_BY_MAJOR[18]`). Measured before removal: outside the declaring
// file its only references were a value round-trip in `connector.test.ts` and a
// type-identity pin — no runtime reader — so the enum had no remaining consumer,
// and an exported value schema with no consumer reads as a capability (#3950,
// the `api/HandlerStatus` precedent). `api/ErrorCategory` — the HTTP-response
// vocabulary this enum was deliberately kept from sharing a name with
// (ADR-0112 D9a) — is unaffected. See
// `retired-keys/18.integration__Connector__errorMapping.ts` for the retirement
// record.
export const entry = 'integration/ConnectorErrorCategory';
