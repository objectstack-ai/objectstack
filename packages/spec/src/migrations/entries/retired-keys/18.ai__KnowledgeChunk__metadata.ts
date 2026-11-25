// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// #37098 — ADR-0049 enforce-or-remove, as ADR-0161 K8 item 5 asks of the
// splitter card: `KnowledgeChunk.metadata` had no producer and no reader. A
// chunk is a runtime contract shape the knowledge service hands an adapter,
// never stored in stack metadata, so the D2 side is a D3 `SemanticMigration`
// (`knowledge-chunk-metadata-retired`) rather than a MetadataConversion —
// there is no stored source for `os migrate meta` to rewrite. The
// `ActionDescriptor.isAsync` precedent.
export const entry = 'ai/KnowledgeChunk:metadata';
