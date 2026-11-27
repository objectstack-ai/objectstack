// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K6, Consequences (ADR-0049, the #3950 rule: an exported value
// schema with no consumer reads as a capability) — its ONLY composer was
// `KnowledgeSource.embedding`, removed in this major, so the def leaves with
// the key. The embedder is deployment configuration, never authored metadata.
// D3: `knowledge-source-inert-keys-retired`.
export const entry = 'ai/EmbeddingModel';
