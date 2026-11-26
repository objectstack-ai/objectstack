// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K4, point 1 as merged — the three-arm union of source kinds left
// with its `file` and `http` arms: `KnowledgeSource.source` is the one arm that
// remains, `ai/ObjectKnowledgeSource`. D3:
// `knowledge-source-file-http-kinds-retired`.
export const entry = 'ai/KnowledgeSourceKind';
