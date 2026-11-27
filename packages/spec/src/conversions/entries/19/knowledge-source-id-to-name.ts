// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';

/**
 * `knowledgeSources[].id` → `name` (protocol 19, ADR-0161 K6).
 *
 * The knowledge source became a governed metadata type (ADR-0161 K4), and every
 * metadata item is identified by `name`. The value does not change, so a
 * document id — built from the source's name and the record id — and the index
 * fingerprint, computed over values, stay as they are: the rename starts no
 * rebuild (K6 item 4).
 *
 * **Retired from the load path**: `KnowledgeSourceSchema` tombstones `id` with
 * the rename, so a live parse refuses it at every door, the registration in
 * code included. No stored row carries the key, because a source was never
 * stored as metadata before this major. The entry keeps the rewrite for
 * `os migrate meta --from 18`. `renameKey` leaves an already-canonical `name`
 * alone and refuses a pair that disagrees.
 */
const knowledgeSourceIdToName: MetadataConversion = {
  id: 'knowledge-source-id-to-name',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'knowledge_source.id',
  summary:
    "knowledge source key 'id' → 'name' (a knowledge source is a metadata type from this major, and a metadata "
    + 'item is identified by its name; the value is unchanged, so no index is rebuilt)',
  apply(stack, emit) {
    return mapCollection(stack, 'knowledgeSources', (source, path) => {
      const renamed = renameKey(source, 'id', 'name');
      if (!renamed) return source;
      emit({ from: 'id', to: 'name', path: `${path}.name` });
      return renamed;
    });
  },
  fixture: {
    before: {
      knowledgeSources: [
        // Minimal by the disjointness contract: the retired key and nothing the
        // major's other `knowledgeSources[]` entries walk.
        { id: 'support_articles', adapter: 'memory', source: { kind: 'object', object: 'article', content: ['title', 'body'] } },
        // A source already on `name` keeps its identity (copy-on-write).
        { name: 'policy_clauses', adapter: 'memory', source: { kind: 'object', object: 'clause', content: ['text'] } },
      ],
    },
    after: {
      knowledgeSources: [
        { name: 'support_articles', adapter: 'memory', source: { kind: 'object', object: 'article', content: ['title', 'body'] } },
        { name: 'policy_clauses', adapter: 'memory', source: { kind: 'object', object: 'clause', content: ['text'] } },
      ],
    },
    expectedNotices: 1,
  },
};

export { knowledgeSourceIdToName };
