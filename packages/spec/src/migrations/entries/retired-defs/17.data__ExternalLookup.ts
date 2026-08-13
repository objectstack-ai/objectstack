// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #8075 — data/external-lookup.zod.ts, retired whole (ADR-0049). The root of
// the module's dependency shape: it embedded `ExternalDataSource` (the inline
// credential sink) and `ExternalFieldMapping`, and was itself referenced by no
// stack collection, metadata type or import outside packages/spec — the
// #5552 conversion's docblock had already recorded that no external-lookup
// document exists for the conversion walker to visit. Real-time external
// lookup returns via the enforce route of ADR-0049: the executor first, the
// vocabulary second.
export const entry = 'data/ExternalLookup';
