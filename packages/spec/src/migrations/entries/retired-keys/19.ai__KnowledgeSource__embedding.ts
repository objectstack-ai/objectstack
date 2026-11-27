// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K4, K6 (ADR-0049 enforce-or-remove) — never read: the deployment
// configures one embedder. Tombstoned with `retiredKey()`. D2:
// `knowledge-source-inert-keys-removed`; D3: `knowledge-source-inert-keys-retired`.
export const entry = 'ai/KnowledgeSource:embedding';
