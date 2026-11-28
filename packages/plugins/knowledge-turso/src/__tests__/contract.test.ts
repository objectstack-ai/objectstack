// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The `IKnowledgeAdapter` contract suite (ADR-0161 K8, rule 1) on libSQL, on
// `:memory:` and on a `file:` URL: the same suite every adapter runs, each case
// on a fresh adapter with a database of its own. This store builds a second
// generation beside the first, so every member is declared.

import { afterAll, describe } from 'vitest';
import { runKnowledgeAdapterContract } from '@objectstack/service-knowledge/testing';
import { storeOf } from './turso.testkit.js';

for (const kind of ['memory', 'file'] as const) {
  describe(`knowledge-turso on ${kind === 'memory' ? ':memory:' : 'a file: URL'}`, () => {
    const store = storeOf(kind);
    afterAll(() => store.closeAll());

    runKnowledgeAdapterContract({
      name: `knowledge-turso (${kind})`,
      makeAdapter: () => store.adapter(),
      implements: {
        listDocuments: true,
        chunks: true,
        organizationIds: true,
        indexStatus: true,
        builds: true,
        refusesOtherFingerprint: true,
        generations: true,
        scope: true,
        dropSource: true,
      },
    });
  });
}
