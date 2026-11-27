// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The service side of the chunk channel (#37098; ADR-0161 K1, K8 items 5, 6
 * and 10) — what the contract suite cannot see from an adapter:
 *
 * - the event path removes a `whole` document over the embedder's budget and
 *   reports it at `error`, naming the source, the record, the estimate and the
 *   limit;
 * - a reindex names at most `MAX_REINDEX_FAILURES` failures and counts them all;
 * - `maxChars` comes from the source's `split.maxChars`, else the settings
 *   page's `knowledge.chunk_target` (read through the real settings service),
 *   else 800, and the embedder limit is read from the adapter at use.
 */

import { describe, expect, it, vi } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { AdapterContext, IDataEngine, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeSource, KnowledgeSplit } from '@objectstack/spec/ai';
import { KNOWLEDGE_SERVICE } from '@objectstack/spec/contracts';
import { SettingsServicePlugin, type SettingsService } from '@objectstack/service-settings';
import { KnowledgeService, MAX_REINDEX_FAILURES } from '../knowledge-service.js';
import { KnowledgeServicePlugin } from '../knowledge-service-plugin.js';

/** A chunk-taking adapter that records what it is handed and deleted. */
function recordingAdapter(limit?: { maxInputTokens?: number }) {
  const upserted: KnowledgeDocument[] = [];
  const deleted: string[] = [];
  const adapter: IKnowledgeAdapter & { embedding?: { maxInputTokens?: number } } = {
    id: 'rec',
    capabilities: { chunks: true },
    embedding: limit,
    upsert: async (docs: KnowledgeDocument[]) => {
      upserted.push(...docs);
    },
    search: async () => [],
    delete: async (ids: string[], _ctx: AdapterContext) => {
      deleted.push(...ids);
    },
  };
  return { adapter, upserted, deleted };
}

function source(split?: KnowledgeSplit): KnowledgeSource {
  return {
    name: 'kb',
    label: 'kb',
    adapter: 'rec',
    source: { kind: 'object', object: 'article', content: ['body'], ...(split ? { split } : {}) },
  } as KnowledgeSource;
}

const LONG = '员工在出差期间应当遵守公司的各项规章制度。'.repeat(40); // 840 chars, ~1400 tokens

/**
 * A data-engine double for the walk and the re-read: equality on a field,
 * `$and`, and `id > cursor`; any other `where` shape throws, and the caller's
 * `limit` is applied after the filter.
 */
function rowsEngine(rows: Array<Record<string, unknown>>): IDataEngine {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean => {
    if (!where) return true;
    for (const [key, value] of Object.entries(where)) {
      if (key === '$and') {
        if (!Array.isArray(value)) throw new Error('engine double: $and takes an array');
        if (!value.every((c) => matches(row, c as Record<string, unknown>))) return false;
        continue;
      }
      if (key.startsWith('$')) throw new Error(`engine double: operator ${key} is not implemented`);
      if (value !== null && typeof value === 'object') {
        const ops = Object.keys(value);
        if (key !== 'id' || ops.length !== 1 || ops[0] !== '$gt') {
          throw new Error(`engine double: condition on '${key}' is not implemented`);
        }
        if (!(String(row.id) > String((value as { $gt: unknown }).$gt))) return false;
        continue;
      }
      if (row[key] !== value) return false;
    }
    return true;
  };
  return {
    find: async (_object: string, query: { where?: Record<string, unknown>; limit?: number }) => {
      const matched = rows
        .filter((r) => matches(r, query?.where))
        .sort((a, b) => (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));
      const page = typeof query?.limit === 'number' ? matched.slice(0, query.limit) : matched;
      return page.map((r) => ({ ...r }));
    },
    count: async (_object: string, query: { where?: Record<string, unknown> }) =>
      rows.filter((r) => matches(r, query?.where)).length,
  } as unknown as IDataEngine;
}

describe('chunk channel — whole over the budget', () => {
  it('the event path removes the document and reports it at error: source, record, estimate, limit', async () => {
    const { adapter, upserted, deleted } = recordingAdapter({ maxInputTokens: 512 });
    const logger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };
    const svc = new KnowledgeService({ logger });
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'whole' }));
    await svc.handleRecordUpsert('article', { id: 'r1', body: LONG });
    expect(upserted).toEqual([]);
    expect(deleted).toEqual(['kb:r1']);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const line = String(logger.error.mock.calls[0][0]);
    expect(line).toContain("record 'r1' of source 'kb'");
    expect(line).toMatch(/estimates \d+ tokens, over the budget of 409/);
    expect(line).toContain('512-token input limit');
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('a document that fits is written with its one passage', async () => {
    const { adapter, upserted, deleted } = recordingAdapter({ maxInputTokens: 8192 });
    const svc = new KnowledgeService({ logger: { warn: vi.fn() } });
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'whole' }));
    await svc.handleRecordUpsert('article', { id: 'r1', body: LONG });
    expect(deleted).toEqual([]);
    expect(upserted).toHaveLength(1);
    expect(upserted[0].chunks).toEqual([{ id: 'kb:r1#0', documentId: 'kb:r1', index: 0, content: LONG }]);
  });

  it(`a reindex counts every failure and names the first ${MAX_REINDEX_FAILURES}`, async () => {
    const { adapter, upserted } = recordingAdapter({ maxInputTokens: 512 });
    const rows = Array.from({ length: MAX_REINDEX_FAILURES + 5 }, (_, i) => ({ id: `r${String(i).padStart(2, '0')}`, body: LONG }));
    rows.push({ id: 'zz', body: 'short' });
    const svc = new KnowledgeService({ dataEngine: rowsEngine(rows), logger: { warn: vi.fn() } });
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'whole' }));
    const res = await svc.reindexSource('kb');
    expect(res).toMatchObject({ ok: true, discovered: rows.length, indexed: 1, failed: MAX_REINDEX_FAILURES + 5 });
    expect(res.failures).toHaveLength(MAX_REINDEX_FAILURES);
    expect(res.failures![0]).toEqual({ documentId: 'kb:r00', reason: expect.stringContaining("split 'whole'") });
    expect(res.message).toContain(`the first ${MAX_REINDEX_FAILURES} named in failures`);
    expect(upserted.map((d) => d.id)).toEqual(['kb:zz']);
  });

  it('no limit known: nothing is checked', async () => {
    const { adapter, upserted } = recordingAdapter(undefined);
    const svc = new KnowledgeService({ logger: { warn: vi.fn() } });
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'whole' }));
    await svc.handleRecordUpsert('article', { id: 'r1', body: LONG.repeat(20) });
    expect(upserted).toHaveLength(1);
  });
});

describe('chunk channel — what the split is resolved from, read at use', () => {
  const lengths = (docs: KnowledgeDocument[]) => docs.flatMap((d) => d.chunks ?? []).map((c) => c.content.length);

  it("the source's split.maxChars wins over chunk_target; chunk_target over 800", async () => {
    for (const [split, target, max] of [
      // minChars above maxChars reads as maxChars: pieces merge up to the cap.
      [{ strategy: 'recursive', maxChars: 100, minChars: 100_000 }, 300, 100],
      [{ strategy: 'recursive', minChars: 100_000 }, 300, 300],
      [{ strategy: 'recursive', minChars: 100_000 }, undefined, 800],
    ] as const) {
      const { adapter, upserted } = recordingAdapter(undefined);
      const svc = new KnowledgeService({ logger: { warn: vi.fn() }, resolveChunkTarget: async () => target });
      svc.registerAdapter('rec', adapter);
      svc.registerSource(source(split));
      await svc.handleRecordUpsert('article', { id: 'r1', body: LONG.repeat(3) });
      const ls = lengths(upserted);
      expect(Math.max(...ls)).toBeLessThanOrEqual(max);
      expect(Math.max(...ls)).toBeGreaterThan(max * 0.8);
    }
  });

  it('a chunk_target that cannot be read is reported at warn and the split goes on by 800', async () => {
    const { adapter, upserted } = recordingAdapter(undefined);
    const logger = { warn: vi.fn() };
    const svc = new KnowledgeService({ logger, resolveChunkTarget: async () => { throw new Error('store down'); } });
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'recursive', minChars: 0 }));
    await svc.handleRecordUpsert('article', { id: 'r1', body: LONG.repeat(3) });
    expect(Math.max(...lengths(upserted))).toBeLessThanOrEqual(800);
    expect(String(logger.warn.mock.calls[0][0])).toContain('knowledge.chunk_target could not be read (store down)');
  });

  it("the adapter's embedding descriptor is read at each write, never cached", async () => {
    let limit: number | undefined;
    const { adapter, upserted, deleted } = recordingAdapter(undefined);
    Object.defineProperty(adapter, 'embedding', { get: () => (limit === undefined ? undefined : { maxInputTokens: limit }) });
    const svc = new KnowledgeService({ logger: { warn: vi.fn(), error: vi.fn() } });
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'whole' }));
    await svc.handleRecordUpsert('article', { id: 'r1', body: LONG });
    expect(upserted).toHaveLength(1);
    limit = 512; // the embedder registered later
    await svc.handleRecordUpsert('article', { id: 'r1', body: LONG });
    expect(deleted).toEqual(['kb:r1']);
  });

  it('end to end: the plugin reads knowledge.chunk_target from the settings service at use', async () => {
    const kernel = new LiteKernel();
    kernel.use(new KnowledgeServicePlugin({ enableEventSync: false }));
    kernel.use(new SettingsServicePlugin({ env: {}, registerRoutes: false }));
    await kernel.bootstrap();
    const settings = kernel.getService<SettingsService>('settings');
    const svc = kernel.getService<KnowledgeService>(KNOWLEDGE_SERVICE);
    const { adapter, upserted } = recordingAdapter(undefined);
    svc.registerAdapter('rec', adapter);
    svc.registerSource(source({ strategy: 'recursive', minChars: 100_000 }));

    await svc.handleRecordUpsert('article', { id: 'a', body: LONG.repeat(3) });
    expect(Math.max(...lengths(upserted))).toBeGreaterThan(640); // 800, nothing stored
    upserted.length = 0;
    // Saved after boot: the next write is cut by it.
    await settings.set('knowledge', 'chunk_target', 200);
    await svc.handleRecordUpsert('article', { id: 'a', body: LONG.repeat(3) });
    expect(Math.max(...lengths(upserted))).toBeLessThanOrEqual(200);
    await kernel.shutdown();
  });
});
