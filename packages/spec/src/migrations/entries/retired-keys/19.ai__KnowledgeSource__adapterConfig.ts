// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K4 ("if no adapter reads `adapterConfig` then, the key does not enter
// v1") — its one reader, the `knowledge-ragflow` adapter, left with #37004.
// Tombstoned with `retiredKey()`. D2: `knowledge-source-inert-keys-removed`; D3:
// `knowledge-source-inert-keys-retired`.
export const entry = 'ai/KnowledgeSource:adapterConfig';
