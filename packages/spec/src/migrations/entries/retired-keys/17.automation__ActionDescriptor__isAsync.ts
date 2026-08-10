// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #6748 — ADR-0049 enforce-or-remove on the action-descriptor capability
// block. `isAsync` was a second spelling of `supportsPause` with ZERO
// readers on a fresh three-repo measurement; its sibling took the enforce
// leg in #6667 and this one takes the remove leg. Descriptors are published
// from executor TypeScript, not from stack metadata, so the D2 side is a D3
// `SemanticMigration` (`action-descriptor-is-async-retired`) rather than a
// MetadataConversion — there is no stored source for `os migrate meta` to
// rewrite. The `EnhancedApiError.fieldErrors` precedent.
export const entry = 'automation/ActionDescriptor:isAsync';
