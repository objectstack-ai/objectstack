// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection } from '../../walk.js';
import { stripKeys } from '../shared.js';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `knowledgeSources[]`: `embedding`, `vectorStore`, `adapterConfig` and
 * `refresh.cron` removed (protocol 19, ADR-0161 K4 and K6; ADR-0049
 * enforce-or-remove).
 *
 * Four keys an author could write and nothing read:
 *
 * - `embedding` — the knowledge service embeds with the one embedder the
 *   deployment configures; no code read a per-source model.
 * - `vectorStore` — the store is the adapter the deployment installs; no code
 *   read a per-source store.
 * - `adapterConfig` — its one reader was the `knowledge-ragflow` adapter, which
 *   left the repository before this major (K4: with no adapter reading it, the
 *   key does not enter the type).
 * - `refresh.cron` — parsed, and it reached no scheduler.
 *
 * Each is a pure lossless delete, one notice per key per source: none of them
 * ever changed what was indexed or searched. What an author meant by one is
 * the D3 entry's subject (`knowledge-source-inert-keys-retired`).
 *
 * **Retired from the load path**: the schema tombstones all four, so a live
 * parse refuses them. No stored row carries any of them. The entry keeps the
 * delete for `os migrate meta --from 18`.
 */
const knowledgeSourceInertKeysRemoved: MetadataConversion = {
  id: 'knowledge-source-inert-keys-removed',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'knowledge_source.embedding / knowledge_source.vectorStore / knowledge_source.adapterConfig / knowledge_source.refresh.cron',
  summary:
    "knowledge source keys 'embedding', 'vectorStore', 'adapterConfig' and 'refresh.cron' removed (ADR-0049 — none "
    + 'was read: the deployment configures one embedder and installs one store adapter, no adapter in the '
    + 'repository reads a per-source config bag, and no scheduler read the cron expression. Schedule a rebuild '
    + 'from a flow or a job that calls the knowledge service instead)',
  apply(stack, emit) {
    return mapCollection(stack, 'knowledgeSources', (item, path) => {
      let next = stripKeys(item, ['embedding', 'vectorStore', 'adapterConfig'], emit, path);
      const refresh = next.refresh;
      if (isDict(refresh)) {
        const stripped = stripKeys(refresh, ['cron'], emit, `${path}.refresh`);
        if (stripped !== refresh) next = { ...next, refresh: stripped };
      }
      return next;
    });
  },
  fixture: {
    before: {
      knowledgeSources: [
        // Minimal by the disjointness contract: the four retired keys and
        // nothing the major's other `knowledgeSources[]` entries walk.
        {
          name: 'support_articles',
          adapter: 'memory',
          source: { kind: 'object', object: 'article', content: ['title', 'body'] },
          embedding: { provider: 'openai', model: 'text-embedding-3-small' },
          vectorStore: { provider: 'pgvector', collection: 'support_articles' },
          adapterConfig: { datasetId: 'ds_1' },
          refresh: { onRecordChange: true, cron: '0 3 * * *' },
        },
        // A source that never authored one keeps its identity (copy-on-write).
        { name: 'policy_clauses', adapter: 'memory', source: { kind: 'object', object: 'clause', content: ['text'] } },
      ],
    },
    after: {
      knowledgeSources: [
        {
          name: 'support_articles',
          adapter: 'memory',
          source: { kind: 'object', object: 'article', content: ['title', 'body'] },
          refresh: { onRecordChange: true },
        },
        { name: 'policy_clauses', adapter: 'memory', source: { kind: 'object', object: 'clause', content: ['text'] } },
      ],
    },
    // One per key carried: embedding, vectorStore, adapterConfig, refresh.cron.
    expectedNotices: 4,
  },
};

export { knowledgeSourceInertKeysRemoved };
