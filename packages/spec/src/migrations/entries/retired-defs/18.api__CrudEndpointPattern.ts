// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #14691 — `api/CrudEndpointPattern` (the `{ method, path, summary, description }`
// value shape of `crud.patterns`) leaves with its carrier key: its ONLY consumer
// was `CrudEndpointsConfigSchema.patterns`, tombstoned in the same change under
// ADR-0049 enforce-or-remove, and an exported value schema with no consumer
// reads as a capability (#3950). `api/CrudOperation` stays —
// `GeneratedEndpointSchema.operation` still reads it. See
// `retired-keys/18.api__CrudEndpointsConfig__patterns.ts` for the retirement record.
export const entry = 'api/CrudEndpointPattern';
