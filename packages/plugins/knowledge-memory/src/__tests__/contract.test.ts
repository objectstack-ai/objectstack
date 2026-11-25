// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `IKnowledgeAdapter` contract suite (ADR-0161 K8, rule 1), run against the
// reference adapter. Every adapter package runs the same suite with its own
// factory; a fresh adapter per case keeps the cases independent.

import { runKnowledgeAdapterContract } from '@objectstack/service-knowledge/testing';
import { KnowledgeMemoryAdapter } from '../index';

runKnowledgeAdapterContract({
  name: 'knowledge-memory',
  makeAdapter: () => new KnowledgeMemoryAdapter('under_test'),
  implements: { listDocuments: true },
});
