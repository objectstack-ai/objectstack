// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { MetadataConversion } from '../../types.js';
import { mapCollection, renameKey } from '../../walk.js';

type Dict = Record<string, unknown>;
const isDict = (v: unknown): v is Dict => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * `knowledgeSources[].source.contentFields` → `source.content` (protocol 19,
 * ADR-0161 K5 and K6).
 *
 * A list of field names moves as it is: the rename is lossless, and it changes
 * no document, so no index is rebuilt (K6 item 4).
 *
 * The `'*'` member is the part with no mapping. It asked for every non-system
 * field of the object, and `content` is the list of fields whose text is sent
 * to the embedding provider: which fields those should be is the author's
 * decision, never the tool's. So the key is renamed, the member is left where
 * it stood, and the site is reported through `context.reportTodo`; the parse
 * then refuses the member with K5's prescription until the author lists the
 * fields.
 *
 * **Retired from the load path**: `ObjectKnowledgeSourceSchema` tombstones
 * `contentFields` with the rename. No stored row carries the key. The entry
 * keeps the rewrite for `os migrate meta --from 18`.
 */
const knowledgeSourceContentFieldsToContent: MetadataConversion = {
  id: 'knowledge-source-content-fields-to-content',
  toMajor: 19,
  retiredFromLoadPath: true,
  retiredAfter: '18.6.0',
  surface: 'knowledge_source.source.contentFields',
  summary:
    "knowledge source key 'source.contentFields' → 'source.content' (the list of fields whose text is embedded; a "
    + "list of field names moves unchanged. A '*' member is kept and reported as a TODO: it has no mapping, and "
    + 'the parse refuses it until the author lists the fields)',
  apply(stack, emit, context) {
    return mapCollection(stack, 'knowledgeSources', (item, path) => {
      const source = item.source;
      if (!isDict(source)) return item;
      const renamed = renameKey(source, 'contentFields', 'content');
      if (!renamed) return item;
      emit({ from: 'contentFields', to: 'content', path: `${path}.source.content` });
      const content = renamed.content;
      if (Array.isArray(content) && content.includes('*')) {
        context?.reportTodo?.({
          path: `${path}.source.content`,
          from: JSON.stringify(content),
          reason:
            "The list holds '*', which asked for every non-system field of the object. `content` takes field "
            + 'names only, because each listed field is sent to the embedding provider. Replace the member with '
            + 'the names of the fields whose text should be searchable.',
        });
      }
      return { ...item, source: renamed };
    });
  },
  fixture: {
    before: {
      knowledgeSources: [
        // Minimal by the disjointness contract: the retired key and nothing the
        // major's other `knowledgeSources[]` entries walk.
        { name: 'support_articles', adapter: 'memory', source: { kind: 'object', object: 'article', contentFields: ['title', 'body'] } },
        // A source already on `content` keeps its identity (copy-on-write).
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

export { knowledgeSourceContentFieldsToContent };
