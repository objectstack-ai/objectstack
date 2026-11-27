// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K5, K6 — renamed `content`, the list of fields whose text is sent
// to the embedding provider; a `'*'` member has no mapping and is refused by the
// parse. Tombstoned with `retiredKey()`. D2:
// `knowledge-source-content-fields-to-content`; D3:
// `knowledge-source-content-lists-fields`.
export const entry = 'ai/ObjectKnowledgeSource:contentFields';
