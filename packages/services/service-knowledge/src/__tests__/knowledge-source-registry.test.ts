// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The knowledge service's registry of sources (#37304; ADR-0161 K4 and K6,
 * ADR-0150's addendum of 2026-11-25; rulings on #37304 of 2026-11-26):
 *
 * - both doors parse with `KnowledgeSourceSchema`, and the code door refuses a
 *   retired key with its prescription instead of converting it;
 * - one slot per `(package, name)`: a source registered in code takes the
 *   package-less slot, never replaced by — nor replacing — an item authored in
 *   the environment, and never colliding with a package's source of the name;
 * - a caller names a source by its face, a bare name resolves by ADR-0150 D3,
 *   and a name several sources answer to is refused, coded, never picked;
 * - an index is keyed by the source's index key, so two packages' sources of
 *   one name never share a document.
 */

import { describe, expect, it, vi } from 'vitest';
import type { AdapterContext, IKnowledgeAdapter } from '@objectstack/spec/contracts';
import type { KnowledgeDocument, KnowledgeHit, KnowledgeSource } from '@objectstack/spec/ai';
import { KnowledgeService } from '../knowledge-service.js';
import { indexKeyOf } from '../knowledge-source-registry.js';

const SYSTEM = { positions: [], permissions: [], isSystem: true };

function source(name: string, extra: Record<string, unknown> = {}): KnowledgeSource {
  return {
    name,
    label: `${name} label`,
    adapter: 'memory',
    source: { kind: 'object', object: 'note', content: ['body'] },
    ...extra,
  } as KnowledgeSource;
}

/** An adapter that records what it is handed, and answers one hit per source it is asked. */
function recordingAdapter() {
  const upserted: KnowledgeDocument[] = [];
  const searched: string[] = [];
  const dropped: Array<{ name: string; reason: string }> = [];
  const adapter: IKnowledgeAdapter = {
    id: 'memory',
    upsert: async (docs: KnowledgeDocument[]) => {
      upserted.push(...docs);
    },
    delete: async () => undefined,
    search: async (_query: string, opts: { source: KnowledgeSource }): Promise<KnowledgeHit[]> => {
      searched.push(opts.source.name);
      const documentId = `${opts.source.name}:r1`;
      return [{ chunkId: `${documentId}#0`, documentId, sourceId: opts.source.name, score: 1, snippet: 's', sourceRecordId: 'r1' }];
    },
    dropSource: async (opts: { source: KnowledgeSource; reason: string }, _ctx?: AdapterContext) => {
      dropped.push({ name: opts.source.name, reason: opts.reason });
    },
  } as unknown as IKnowledgeAdapter;
  return { adapter, upserted, searched, dropped };
}

function setup() {
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const recorded = recordingAdapter();
  const svc = new KnowledgeService({ logger });
  svc.registerAdapter('memory', recorded.adapter);
  return { svc, logger, ...recorded };
}

/** The refusal a call threw, or a failure when it threw none. */
function refusalOf(run: () => unknown): { code?: string; status?: number; message: string; candidates?: unknown } {
  try {
    run();
  } catch (err) {
    return err as { code?: string; status?: number; message: string };
  }
  throw new Error('expected a refusal, and the call returned');
}

describe('the code door — one schema, no conversion (ADR-0161 K6)', () => {
  it.each([
    ['the retired `id`', { id: 'notes', label: 'Notes', adapter: 'memory', source: { kind: 'object', object: 'note', content: ['body'] } }, '`id`'],
    ['the retired `source.contentFields`', { ...source('notes'), source: { kind: 'object', object: 'note', contentFields: ['body'] } }, 'contentFields'],
    ['an unknown key', source('notes', { colour: 'blue' }), 'colour'],
    ["a `'*'` content member", { ...source('notes'), source: { kind: 'object', object: 'note', content: ['*'] } }, 'content'],
    ['a `file` kind', { ...source('notes'), source: { kind: 'file', prefix: 'docs/' } }, 'kind'],
    ['an `http` kind', { ...source('notes'), source: { kind: 'http', urls: ['https://x.test'] } }, 'kind'],
    ['a name that is not snake_case', source('Notes'), 'name'],
  ])('refuses %s with VALIDATION_ERROR / 400, naming it, and registers nothing', (_label, input, named) => {
    const { svc } = setup();
    const refusal = refusalOf(() => svc.registerSource(input as unknown as KnowledgeSource));
    expect(refusal.code).toBe('VALIDATION_ERROR');
    expect(refusal.status).toBe(400);
    expect(refusal.message).toContain('registerSource refused');
    expect(refusal.message).toContain(named);
    expect(svc.listSources()).toEqual([]);
  });

  it('a retired key is answered with what to write instead, never converted', () => {
    const { svc } = setup();
    const refusal = refusalOf(() =>
      svc.registerSource({ id: 'notes', label: 'Notes', adapter: 'memory', source: { kind: 'object', object: 'note', content: ['body'] } } as unknown as KnowledgeSource));
    expect(refusal.message).toContain('`name`');
    expect(svc.getSource('notes')).toBeUndefined();
  });

  it('refuses a registration that names a package: a source registered in code belongs to none', () => {
    const { svc } = setup();
    const refusal = refusalOf(() => svc.registerSource(source('notes', { _packageId: 'com.acme.kb' })));
    expect(refusal.code).toBe('VALIDATION_ERROR');
    expect(refusal.status).toBe(400);
    expect(refusal.message).toContain('com.acme.kb');
    expect(refusal.message).toContain('knowledgeSources');
    expect(svc.listSources()).toEqual([]);
  });

  it('registering a name again through the same door replaces the earlier registration, said at warn', () => {
    const { svc, logger } = setup();
    svc.registerSource(source('notes'));
    svc.registerSource(source('notes', { label: 'Second' }));
    expect(svc.listSources().map((s) => s.label)).toEqual(['Second']);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('source overwritten: notes'));
  });
});

describe('one name, one source — the package-less slot across the two doors', () => {
  it('an environment-authored item under a name registered in code is refused, naming both doors; the code source stays', () => {
    const { svc } = setup();
    svc.registerSource(source('notes'));
    const refusal = refusalOf(() => svc.registerMetadataSource(source('notes', { label: 'Authored' })));
    expect(refusal.code).toBe('RESOURCE_CONFLICT');
    expect(refusal.status).toBe(409);
    expect(refusal.message).toContain('Held by: a registration in code');
    expect(refusal.message).toContain('Refused: a knowledge_source metadata item authored in this environment');
    expect(svc.describeSources().map((s) => [s.id, s.door, s.source.label])).toEqual([['notes', 'code', 'notes label']]);
  });

  it('a registration in code under a name an environment-authored item holds is refused, naming both doors; the item stays', () => {
    const { svc } = setup();
    svc.registerMetadataSource(source('notes', { label: 'Authored' }));
    const refusal = refusalOf(() => svc.registerSource(source('notes')));
    expect(refusal.code).toBe('RESOURCE_CONFLICT');
    expect(refusal.status).toBe(409);
    expect(refusal.message).toContain('Held by: a knowledge_source metadata item authored in this environment');
    expect(refusal.message).toContain('Refused: a registration in code');
    expect(svc.describeSources().map((s) => [s.id, s.door, s.source.label])).toEqual([['notes', 'metadata', 'Authored']]);
  });

  it('a metadata item that reloads replaces its own earlier version: no refusal, no second source', () => {
    const { svc, logger } = setup();
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.kb', namespace: 'acme' });
    svc.registerMetadataSource(source('notes', { label: 'Reloaded' }), { packageId: 'com.acme.kb', namespace: 'acme' });
    expect(svc.describeSources().map((s) => [s.id, s.source.label])).toEqual([['acme-notes', 'Reloaded']]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("a registration in code and a package's source of one name are two sources, both kept", () => {
    const { svc } = setup();
    svc.registerSource(source('notes'));
    svc.registerMetadataSource(source('notes', { label: 'Packaged' }), { packageId: 'com.acme.kb', namespace: 'acme' });
    expect(svc.describeSources().map((s) => ({ id: s.id, door: s.door, packageId: s.packageId }))).toEqual([
      { id: 'notes', door: 'code', packageId: undefined },
      { id: 'acme-notes', door: 'metadata', packageId: 'com.acme.kb' },
    ]);
    // The bare name answers the package-less one (ADR-0150 D3); the face answers the package's.
    expect(svc.getSource('notes')?.label).toBe('notes label');
    expect(svc.getSource('acme-notes')?.label).toBe('Packaged');
  });
});

describe('how a caller names a source — face, then bare name by ADR-0150 D3', () => {
  function twoPackages() {
    const h = setup();
    h.svc.registerMetadataSource(source('notes', { label: 'Acme' }), { packageId: 'com.acme.kb', namespace: 'acme' });
    h.svc.registerMetadataSource(source('notes', { label: 'Globex' }), { packageId: 'com.globex.kb', namespace: 'globex' });
    return h;
  }

  it('two packages may each hold a source of one name; each is named by its face', () => {
    const { svc } = twoPackages();
    expect(svc.describeSources().map((s) => s.id)).toEqual(['acme-notes', 'globex-notes']);
    expect(svc.getSource('acme-notes')?.label).toBe('Acme');
    expect(svc.getSource('globex-notes')?.label).toBe('Globex');
    expect(svc.describeSource('globex-notes')).toMatchObject({ id: 'globex-notes', packageId: 'com.globex.kb', door: 'metadata' });
  });

  it('a bare name two packages hold is refused RESOURCE_CONFLICT / 409, naming each candidate by its face', () => {
    const { svc } = twoPackages();
    const refusal = refusalOf(() => svc.getSource('notes'));
    expect(refusal.code).toBe('RESOURCE_CONFLICT');
    expect(refusal.status).toBe(409);
    expect(refusal.message).toContain("'acme-notes' (package \"com.acme.kb\")");
    expect(refusal.message).toContain("'globex-notes' (package \"com.globex.kb\")");
    expect(refusal.candidates).toEqual([
      { face: 'acme-notes', packageId: 'com.acme.kb' },
      { face: 'globex-notes', packageId: 'com.globex.kb' },
    ]);
  });

  it('a bare name one package alone holds answers that source', () => {
    const { svc } = setup();
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.kb', namespace: 'acme' });
    expect(svc.describeSource('notes')?.id).toBe('acme-notes');
  });

  it('a spelling no source answers to names none: undefined, never a guess', () => {
    const { svc } = twoPackages();
    expect(svc.getSource('acme-other')).toBeUndefined();
    expect(svc.getSource('other')).toBeUndefined();
    // An index key is no spelling of a source.
    expect(svc.getSource(indexKeyOf('com.acme.kb', 'notes'))).toBeUndefined();
  });

  it('a face two sources derive (two packages of one namespace) is refused, never picked', () => {
    const { svc } = setup();
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.one', namespace: 'acme' });
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.two', namespace: 'acme' });
    const refusal = refusalOf(() => svc.getSource('acme-notes'));
    expect(refusal.code).toBe('RESOURCE_CONFLICT');
    expect(refusal.status).toBe(409);
    expect(refusal.message).toContain('com.acme.one');
    expect(refusal.message).toContain('com.acme.two');
  });

  it("search: `sourceIds` takes a face, and a hit's `sourceId` is the face of the source it came from", async () => {
    const { svc, searched } = twoPackages();
    svc.registerSource(source('notes'));
    const hits = await svc.search('q', { sourceIds: ['globex-notes'], executionContext: SYSTEM });
    expect(searched).toEqual([indexKeyOf('com.globex.kb', 'notes')]);
    expect(hits.map((h) => h.sourceId)).toEqual(['globex-notes']);
    // Unnamed: every source, each hit under its own face.
    const all = await svc.search('q', { executionContext: SYSTEM });
    expect(all.map((h) => h.sourceId).sort()).toEqual(['acme-notes', 'globex-notes', 'notes']);
  });

  it('search: a bare name several packages hold is refused, coded, and no source is asked', async () => {
    const { svc, searched } = twoPackages();
    const refusal = await svc.search('q', { sourceIds: ['notes'], executionContext: SYSTEM }).then(
      () => { throw new Error('expected a refusal'); },
      (err: { code?: string; status?: number }) => err,
    );
    expect(refusal.code).toBe('RESOURCE_CONFLICT');
    expect(refusal.status).toBe(409);
    expect(searched).toEqual([]);
  });
});

describe('the index key — two sources of one name never share an index', () => {
  it('a package-less source is keyed by its name; a package\'s by a snake_case key that embeds no package id', () => {
    expect(indexKeyOf(undefined, 'notes')).toBe('notes');
    const key = indexKeyOf('com.acme.kb', 'notes');
    expect(key).toMatch(/^_p[0-9a-f]{16}_notes$/);
    expect(indexKeyOf('com.acme.kb', 'notes')).toBe(key);
    expect(indexKeyOf('com.globex.kb', 'notes')).not.toBe(key);
  });

  it('one written row is one document per source, each under its own key', async () => {
    const { svc, upserted } = setup();
    svc.registerSource(source('notes'));
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.kb', namespace: 'acme' });
    svc.registerMetadataSource(source('notes'), { packageId: 'com.globex.kb', namespace: 'globex' });
    await svc.handleRecordUpsert('note', { id: 'r1', body: 'hello' });
    const acme = indexKeyOf('com.acme.kb', 'notes');
    const globex = indexKeyOf('com.globex.kb', 'notes');
    expect(upserted.map((d) => [d.id, d.sourceId]).sort()).toEqual(
      [['notes:r1', 'notes'], [`${acme}:r1`, acme], [`${globex}:r1`, globex]].sort(),
    );
  });

  it('listSources answers each source as authored: its own name, never the key', () => {
    const { svc } = setup();
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.kb', namespace: 'acme' });
    expect(svc.listSources().map((s) => s.name)).toEqual(['notes']);
    expect(svc.indexedSources().map((s) => s.name)).toEqual([indexKeyOf('com.acme.kb', 'notes')]);
  });
});

describe('removal — each door removes its own', () => {
  it('unregisterSource removes a source registered in code and keeps its index', () => {
    const { svc, dropped } = setup();
    svc.registerSource(source('notes'));
    svc.unregisterSource('notes');
    expect(svc.listSources()).toEqual([]);
    expect(dropped).toEqual([]);
    // Naming no source is a no-op.
    expect(() => svc.unregisterSource('notes')).not.toThrow();
  });

  it('unregisterSource refuses a metadata item RESOURCE_CONFLICT / 409, naming what removes it; the source stays', () => {
    const { svc } = setup();
    svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.kb', namespace: 'acme' });
    const refusal = refusalOf(() => svc.unregisterSource('acme-notes'));
    expect(refusal.code).toBe('RESOURCE_CONFLICT');
    expect(refusal.status).toBe(409);
    expect(refusal.message).toContain('delete the item');
    expect(svc.describeSources().map((s) => s.id)).toEqual(['acme-notes']);
  });

  it('dropMetadataSource unregisters the item and drops its index, handing the adapter the keyed source', async () => {
    const { svc, dropped } = setup();
    svc.registerSource(source('notes'));
    const entry = svc.registerMetadataSource(source('notes'), { packageId: 'com.acme.kb', namespace: 'acme' });
    expect(await svc.dropMetadataSource(entry.key)).toMatchObject({ face: 'acme-notes' });
    expect(dropped).toEqual([{ name: entry.key, reason: 'manual' }]);
    expect(svc.describeSources().map((s) => s.id)).toEqual(['notes']);
    // Not this door's: a source registered in code is not dropped through it.
    expect(await svc.dropMetadataSource('notes')).toBeUndefined();
    expect(dropped).toHaveLength(1);
    expect(svc.listSources()).toHaveLength(1);
  });

  it('a dropSource that throws is reported once at warn, naming the source; the source is still removed', async () => {
    const { svc, adapter, logger } = setup();
    (adapter as { dropSource: unknown }).dropSource = async () => { throw new Error('store offline'); };
    const entry = svc.registerMetadataSource(source('notes'));
    await expect(svc.dropMetadataSource(entry.key)).resolves.toMatchObject({ face: 'notes' });
    const lines = logger.warn.mock.calls.map((c) => String(c[0]));
    expect(lines.filter((l) => l.includes("source 'notes' was removed, and its index was not dropped"))).toHaveLength(1);
    expect(lines.join('\n')).toContain('store offline');
    expect(svc.listSources()).toEqual([]);
  });
});

describe('onSourcesChanged — told after every change, through either door', () => {
  it('fires on a registration, a reload, a removal and a drop; not after the unsubscribe', async () => {
    const { svc } = setup();
    const listener = vi.fn();
    const off = svc.onSourcesChanged(listener);
    svc.registerSource(source('notes'));
    const entry = svc.registerMetadataSource(source('other'));
    svc.registerMetadataSource(source('other', { label: 'again' }));
    svc.unregisterSource('notes');
    await svc.dropMetadataSource(entry.key);
    expect(listener).toHaveBeenCalledTimes(5);
    off();
    svc.registerSource(source('notes'));
    expect(listener).toHaveBeenCalledTimes(5);
  });

  it('a listener that throws is reported at warn and does not stop the next one', () => {
    const { svc, logger } = setup();
    const second = vi.fn();
    svc.onSourcesChanged(() => { throw new Error('listener broke'); });
    svc.onSourcesChanged(second);
    expect(() => svc.registerSource(source('notes'))).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('listener broke'));
  });
});
