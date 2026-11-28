// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K6 — the knowledge source became a governed metadata type (K4), and a
// metadata item is identified by `name`. Lossless rename, the value unchanged.
// Tombstoned with `retiredKey()`. D2: `knowledge-source-id-to-name`; D3:
// `knowledge-source-registration-governed`.
export const entry = 'ai/KnowledgeSource:id';
