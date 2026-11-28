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
 * **One exception: an `id` that begins with an underscore.** `renameKey` copies
 * the value as it is, so `id: '_faq'` becomes `name: '_faq'`, and the parse
 * then refuses that `name` (`ROUTER_ADDRESSABLE_NAME_PATTERN`; its message says
 * to rename the item without the underscore). The conversion does not choose
 * the new name: only the author knows it. Such a source takes a new name, is
 * built again under it, and its old index is dropped with `dropSource`, which
 * the author runs — nothing drops it automatically. That is what the `id`
 * tombstone and the D3 entry `knowledge-source-registration-governed` (which
 * judges this conversion's edits, `conversionIds`) teach, and `summary` says
 * the same.
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
    + 'item is identified by its name; the value is unchanged, so no index is rebuilt, except for an id that '
    + 'begins with an underscore: `name` refuses the underscore, so that source takes a new name, is built again '
    + 'under it, and its old index is dropped with `dropSource`, which the author runs; the upgrade entry '
    + '`knowledge-source-registration-governed` says how)',
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
        // The exception: an underscore-led id is copied as it is, to a `name`
        // the parse refuses — the author picks the new name and drops the old
        // index (see the jsdoc above).
        { id: '_legacy_faq', adapter: 'memory', source: { kind: 'object', object: 'faq', content: ['answer'] } },
      ],
    },
    after: {
      knowledgeSources: [
        { name: 'support_articles', adapter: 'memory', source: { kind: 'object', object: 'article', content: ['title', 'body'] } },
        { name: 'policy_clauses', adapter: 'memory', source: { kind: 'object', object: 'clause', content: ['text'] } },
        { name: '_legacy_faq', adapter: 'memory', source: { kind: 'object', object: 'faq', content: ['answer'] } },
      ],
    },
    expectedNotices: 2,
  },
};

export { knowledgeSourceIdToName };
