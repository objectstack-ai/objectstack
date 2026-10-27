// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — data/external-lookup.zod.ts, retired whole (ADR-0049
// enforce-or-remove; fork (b) of the #8075 census, accepted 2026-08-12). The
// external-data-source shape whose `authentication.config` record accepted
// inline OAuth client secrets and API keys — its own docblock example wrote
// `"clientSecret": "..."`. Zero consumers: no metadata-type binding, no stack
// collection, no object/field embedding (`object.external` binds
// `ObjectExternalBindingSchema`, which routes credentials through datasource
// config per ADR-0015/0062), and its only in-module consumer
// (`ExternalLookupSchema.dataSource`) was itself consumed by nothing. Route 3:
// no tombstone, no D2 conversion — this table plus the D3
// `external-lookup-message-queue-families-retired` are the declaration.
export const entry = 'data/ExternalDataSource';
