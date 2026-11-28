// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K6, Consequences (ADR-0049, the #3950 rule) — its ONLY composer was
// `KnowledgeSource.vectorStore`, removed in this major, so the def leaves with
// the key. The store is the adapter a deployment installs. D3:
// `knowledge-source-inert-keys-retired`.
export const entry = 'ai/VectorStore';
