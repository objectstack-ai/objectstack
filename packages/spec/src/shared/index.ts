// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared Schemas and Utilities
 * Common schemas used across multiple modules
 */

export * from './identifiers.zod';
export * from './mapping.zod';
export * from './http.zod';
export * from './enums.zod';
export * from './metadata-types.zod';
// [#13612] `branded-types.zod` (the six branded identifier schemas) was retired
// under ADR-0049 enforce-or-remove — no schema ever composed a brand, so the
// promised compile-time safety was unobtainable. The real identifier contracts
// live at the surfaces themselves: inline regexes on object/field/flow names,
// bare `SnakeCaseIdentifierSchema` on app and position names.
export * from './suggestions.zod';
export * from './error-map.zod';
export * from './external-errors';
export * from './metadata-collection.zod';
// [#7894] The URL-spelling half of the metadata type key, split OUT of
// metadata-collection.zod's manifest-collection map. Read by the `/meta`
// boundary fold only.
export * from './metadata-url-spelling';
export * from './lazy-schema';
export * from './expression.zod';
export * from './visibility';
export * from './protection.zod';
export * from './resilient-fetch';
