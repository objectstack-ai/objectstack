// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// ADR-0161 K4, point 1 as merged — the `file` source kind retired whole, with
// its keys `prefix` and `mimeTypes`: nothing read the arm, so there is nothing
// to convert it to. `ai/ObjectKnowledgeSource:kind` refuses the value with the
// prescription. D3: `knowledge-source-file-http-kinds-retired`.
export const entry = 'ai/FileKnowledgeSource';
