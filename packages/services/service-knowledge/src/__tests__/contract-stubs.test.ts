// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The adapter contract suite (`../testing.ts`) run against two stub adapters
 * that implement only the required members, so both halves of the chunk
 * channel (ADR-0161 K8, item 5) are pinned outside any shipped adapter:
 *
 * - `whole-stub` declares no `capabilities` — an adapter written before the
 *   channel. It keeps receiving whole documents, without `chunks`.
 * - `chunk-stub` declares `capabilities.chunks` and stores each passage it is
 *   handed exactly as given, one hit per passage.
 *
 * Neither implements `listDocuments`, so the suite also runs its
 * "without listDocuments" cases against them. Neither applies
 * `AdapterSearchOptions.scope` (ADR-0161 K8, item 17), and their hits carry no
 * `metadata`: an adapter written before the member, over which the service's
 * check after the answer still answers no out-of-scope hit.
 */

import type { AdapterContext, AdapterSearchOptions, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit } from '@objectstack/spec/ai';
import { runKnowledgeAdapterContract } from '../testing.js';

interface Passage {
  chunkId: string;
  documentId: string;
  sourceRecordId?: string;
  headingPath?: string[];
  text: string;
}

const tokens = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1);

/**
 * Score: how many of the passage's tokens are query words, over the geometric
 * mean of the two lengths — a cosine over token counts, so a passage that
 * repeats the query outranks one that mentions it once, as a real index does.
 */
function rank(passages: Passage[], query: string, opts: AdapterSearchOptions): KnowledgeHit[] {
  const q = new Set(tokens(query));
  if (q.size === 0) return [];
  return passages
    .map((p) => {
      const t = tokens(p.text);
      const matches = t.filter((w) => q.has(w)).length;
      return { p, score: t.length === 0 ? 0 : matches / Math.sqrt(t.length * q.size) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.topK)
    .map(({ p, score }) => ({
      chunkId: p.chunkId,
      documentId: p.documentId,
      sourceId: opts.source.id,
      sourceRecordId: p.sourceRecordId,
      score,
      snippet: p.text,
      ...(p.headingPath === undefined ? {} : { headingPath: p.headingPath }),
    }));
}

class StubAdapter implements IKnowledgeAdapter {
  readonly id = 'under_test';
  readonly capabilities?: { chunks: boolean };
  private readonly store = new Map<string, Map<string, Passage[]>>();

  constructor(takesChunks: boolean) {
    if (takesChunks) this.capabilities = { chunks: true };
  }

  async upsert(docs: KnowledgeDocument[], ctx: AdapterContext): Promise<void> {
    const byDoc = this.store.get(ctx.source.id) ?? new Map<string, Passage[]>();
    for (const doc of docs) {
      if (this.capabilities?.chunks) {
        if (doc.chunks === undefined) throw new Error(`chunk-stub: document '${doc.id}' arrived without chunks`);
        byDoc.set(doc.id, doc.chunks.map((c) => ({
          chunkId: c.id,
          documentId: doc.id,
          sourceRecordId: doc.sourceRecordId,
          ...(c.headingPath === undefined ? {} : { headingPath: c.headingPath }),
          text: c.content,
        })));
      } else {
        if (doc.chunks !== undefined) throw new Error(`whole-stub: document '${doc.id}' arrived with chunks`);
        byDoc.set(doc.id, [{ chunkId: `${doc.id}#0`, documentId: doc.id, sourceRecordId: doc.sourceRecordId, text: doc.content }]);
      }
    }
    this.store.set(ctx.source.id, byDoc);
  }

  async search(query: string, opts: AdapterSearchOptions): Promise<KnowledgeHit[]> {
    return rank([...(this.store.get(opts.source.id)?.values() ?? [])].flat(), query, opts);
  }

  async delete(documentIds: string[], ctx: AdapterContext): Promise<void> {
    const byDoc = this.store.get(ctx.source.id);
    for (const id of documentIds) byDoc?.delete(id);
  }
}

runKnowledgeAdapterContract({
  name: 'whole-stub (no capabilities)',
  makeAdapter: () => new StubAdapter(false),
  implements: {
    listDocuments: false,
    chunks: false,
    organizationIds: false,
    indexStatus: false,
    builds: false,
    refusesOtherFingerprint: false,
    generations: false,
    scope: false,
  },
});

runKnowledgeAdapterContract({
  name: 'chunk-stub (capabilities.chunks)',
  makeAdapter: () => new StubAdapter(true),
  implements: {
    listDocuments: false,
    chunks: true,
    organizationIds: false,
    indexStatus: false,
    builds: false,
    refusesOtherFingerprint: false,
    generations: false,
    scope: false,
  },
});
