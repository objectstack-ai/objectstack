// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `IKnowledgeAdapter` contract suite (ADR-0161 K8, rule 1) against a LIVE
// PostgreSQL with pgvector: the same suite the reference adapter runs, each
// case on a fresh adapter in a schema of its own. It does not build a second
// generation beside the first yet (#37101), so `generations` is false.

import { afterAll, describe } from 'vitest';
import { runKnowledgeAdapterContract } from '@objectstack/service-knowledge/testing';
import { PG_URL, liveStore, requireLiveCell } from './live-pg.testkit.js';

requireLiveCell('knowledge-pgvector contract');

const store = liveStore('kpg_contract');

describe.skipIf(!PG_URL)('knowledge-pgvector on a LIVE PostgreSQL', () => {
  afterAll(() => store.dropAll());

  runKnowledgeAdapterContract({
    name: 'knowledge-pgvector',
    makeAdapter: () => store.adapter(),
    implements: {
      listDocuments: true,
      chunks: true,
      organizationIds: true,
      indexStatus: true,
      builds: true,
      refusesOtherFingerprint: true,
      generations: false,
    },
  });
});
