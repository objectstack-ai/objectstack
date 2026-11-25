// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SemanticMigration } from '../../types.js';

export const entry: SemanticMigration = {
  id: 'knowledge-chunk-metadata-retired',
  surface: 'KnowledgeChunk.metadata (a passage the knowledge service hands an adapter in `KnowledgeDocument.chunks`)',
  replacement:
    'nothing to re-declare — delete the key. A passage takes its document\'s `metadata` '
    + '(`KnowledgeDocument.metadata`), which every adapter stores beside each passage and filters on',
  reason:
    'ADR-0049 enforce-or-remove, as ADR-0161 K8 item 5 asks of the splitter: the key had no '
    + 'producer and no reader. The knowledge service cuts every passage and sets no per-passage '
    + 'metadata, and no adapter in the platform read one, so a value written there was stripped in '
    + 'silence and never reached a filter. Why D3 semantic and not a D2 conversion: a chunk is a '
    + 'runtime contract shape — built by the service and by tests, never stored in stack metadata — '
    + 'so there is no source for the chain to rewrite and `os migrate meta` cannot reach it. The '
    + 'schema tombstones it via `retiredKey()`; the rejection (a `tsc` error at the literal and a '
    + 'parse error) is the channel an adapter or test author actually meets. The '
    + '`ActionDescriptor.isAsync` disposition.',
  acceptanceCriteria:
    'No `KnowledgeChunk` literal — in an adapter, a test or a fixture — writes `metadata`. An adapter '
    + 'that filtered on per-passage metadata now filters on the document\'s `metadata` and returns the '
    + 'same hits, since no producer ever set a different value per passage. Authoring the key fails '
    + '`tsc` at the literal and fails `KnowledgeChunkSchema.parse()` with the prescription, instead of '
    + 'parsing clean and being stripped.',
};
