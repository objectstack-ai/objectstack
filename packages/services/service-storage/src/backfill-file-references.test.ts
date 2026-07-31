// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  backfillFileReferences,
  formatBackfillReport,
  type BackfillEngine,
} from './backfill-file-references.js';

const silentLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const REGISTRY: Record<string, any> = {
  sys_file: { fields: { id: { type: 'text' } } },
  product: {
    fields: {
      id: { type: 'text' },
      name: { type: 'text' },
      image: { type: 'image' },
      gallery: { type: 'image', multiple: true },
    },
  },
  tag: { fields: { id: { type: 'text' }, label: { type: 'text' } } },
};

function fakeEngine(tables: Record<string, Array<Record<string, unknown>>>) {
  const calls: Array<{ op: string; object: string; arg: any }> = [];
  const engine: BackfillEngine & { tables: typeof tables; calls: typeof calls } = {
    getObject: (name) => REGISTRY[name],
    getConfigs: () => REGISTRY,
    // Executes the KEYSET walk the backfill emits since #4363: `orderBy` on
    // the key plus a `$gt` seek. `offset` THROWS rather than being served —
    // this walk rewrites the rows it is reading, and an offset counts into a
    // set its own writes are changing, so rows slide past the cursor and never
    // get converted. A fake that honored an offset would let that back in with
    // every assertion still green.
    async find(object, options: any) {
      if (options?.offset !== undefined) {
        throw new Error('offset paging skips rows a mutating walk must visit — expected a keyset seek (#4363)');
      }
      const key = options?.orderBy?.[0]?.field;
      const seek = (options?.where as any)?.[key]?.$gt ?? (options?.where as any)?.$and?.[1]?.[key]?.$gt;
      let rows = tables[object] ?? [];
      if (seek !== undefined) rows = rows.filter((r) => String(r[key]) > String(seek));
      const ordered = key ? [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]))) : rows;
      return typeof options?.limit === 'number' ? ordered.slice(0, options.limit) : ordered;
    },
    async insert(object, data: any) {
      calls.push({ op: 'insert', object, arg: data });
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    async update(object, data: any) {
      calls.push({ op: 'update', object, arg: data });
      const row = (tables[object] ?? []).find((r) => String(r.id) === String(data.id));
      if (row) Object.assign(row, data);
      return row;
    },
    tables,
    calls,
  };
  return engine;
}

const fakeStorage = () =>
  ({
    upload: vi.fn(async () => {}),
    download: vi.fn(async () => Buffer.from('x')),
    delete: vi.fn(async () => {}),
    exists: vi.fn(async () => true),
    getInfo: vi.fn(async () => ({ key: 'k', size: 1, contentType: 'text/plain', lastModified: new Date() })),
  }) as any;

const run = (engine: any, opts: any = {}, storage: any = fakeStorage()) =>
  backfillFileReferences(engine, () => storage, silentLogger(), opts);

describe('backfillFileReferences (ADR-0104 D3 wave 2)', () => {
  it('rewrites a URL that already names a sys_file to the bare id, moving no bytes', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'https://app.example.com/api/v1/storage/files/file_a' }],
      sys_file: [],
    });
    const storage = fakeStorage();

    const report = await run(engine, { apply: true }, storage);

    expect(engine.tables.product[0].image).toBe('file_a');
    expect(report.converted).toBe(1);
    expect(storage.upload).not.toHaveBeenCalled();
    expect(report.actions[0].kind).toBe('resolved_local_url');
  });

  it('resolves the same URL when it is wrapped in a legacy inline blob', async () => {
    const engine = fakeEngine({
      product: [
        { id: 'p1', image: { url: '/api/v1/storage/files/file_b', name: 'b.png', size: 12 } },
      ],
      sys_file: [],
    });

    await run(engine, { apply: true });

    expect(engine.tables.product[0].image).toBe('file_b');
  });

  it('uploads inline data: bytes and rewrites the field to the new id', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: { url: 'data:image/png;base64,aGVsbG8=', name: 'hi.png' } }],
      sys_file: [],
    });
    const storage = fakeStorage();

    const report = await run(engine, { apply: true }, storage);

    expect(storage.upload).toHaveBeenCalledTimes(1);
    const created = engine.tables.sys_file[0];
    expect(created).toMatchObject({ name: 'hi.png', mime_type: 'image/png', status: 'committed' });
    expect(created.size).toBe(5); // "hello"
    expect(engine.tables.product[0].image).toBe(created.id);
    expect(report.converted).toBe(1);
  });

  /**
   * Converting an external URL would mean fetching third-party content and
   * silently re-hosting it — a bandwidth/licensing/privacy decision that is not
   * a migration's to make.
   */
  it('reports an external URL and never re-hosts it', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'https://cdn.example.com/logo.png' }],
      sys_file: [],
    });
    const storage = fakeStorage();

    const report = await run(engine, { apply: true }, storage);

    expect(engine.tables.product[0].image).toBe('https://cdn.example.com/logo.png');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(report.externalUrls).toBe(1);
    expect(report.converted).toBe(0);
    expect(formatBackfillReport(report)).toContain('NOT re-hosted');
  });

  it('handles a multiple:true field element-wise', async () => {
    const engine = fakeEngine({
      product: [
        {
          id: 'p1',
          gallery: [
            '/api/v1/storage/files/file_a',
            'https://cdn.example.com/x.png',
            'file_already',
          ],
        },
      ],
      sys_file: [],
    });

    const report = await run(engine, { apply: true });

    expect(engine.tables.product[0].gallery).toEqual([
      'file_a',
      'https://cdn.example.com/x.png',
      'file_already',
    ]);
    expect(report.converted).toBe(1);
    expect(report.externalUrls).toBe(1);
    expect(report.alreadyReferences).toBe(1);
  });

  // ── Dry run ───────────────────────────────────────────────────────
  it('writes nothing on a dry run but reports the same plan', async () => {
    const engine = fakeEngine({
      product: [
        { id: 'p1', image: '/api/v1/storage/files/file_a' },
        { id: 'p2', image: 'data:text/plain;base64,aGk=' },
      ],
      sys_file: [],
    });
    const storage = fakeStorage();

    const report = await run(engine, {}, storage);

    expect(report.applied).toBe(false);
    expect(report.converted).toBe(2);
    expect(engine.calls).toHaveLength(0);
    expect(engine.tables.product[0].image).toBe('/api/v1/storage/files/file_a');
    expect(storage.upload).not.toHaveBeenCalled();
    expect(formatBackfillReport(report)).toContain('DRY RUN');
  });

  // ── Idempotence / safety ──────────────────────────────────────────
  it('is idempotent — a second run converts nothing', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: '/api/v1/storage/files/file_a' }],
      sys_file: [],
    });

    await run(engine, { apply: true });
    const second = await run(engine, { apply: true });

    expect(second.converted).toBe(0);
    expect(second.alreadyReferences).toBe(1);
  });

  it('never writes the ref_* columns itself — claiming stays on one path', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: '/api/v1/storage/files/file_a' }],
      sys_file: [],
    });

    await run(engine, { apply: true });

    // The record write is what the claim hooks observe; the backfill must not
    // record ownership behind their back, or there would be two claiming paths
    // that could disagree.
    for (const c of engine.calls) {
      expect(c.arg).not.toHaveProperty('ref_object');
      expect(c.arg).not.toHaveProperty('ref_id');
      expect(c.arg).not.toHaveProperty('ref_field');
    }
    expect(engine.calls.filter((c) => c.object === 'sys_file')).toHaveLength(0);
  });

  it('leaves data: values alone when no storage service is available', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'data:text/plain;base64,aGk=' }],
      sys_file: [],
    });

    const report = await backfillFileReferences(engine, () => null, silentLogger(), { apply: true });

    expect(report.unresolvable).toBe(1);
    expect(report.converted).toBe(0);
    expect(engine.tables.product[0].image).toBe('data:text/plain;base64,aGk=');
  });

  it('skips objects with no file-class fields', async () => {
    const engine = fakeEngine({ tag: [{ id: 't1', label: 'x' }], product: [], sys_file: [] });

    const report = await run(engine, { apply: true });

    expect(report.scannedObjects).toEqual(['product']);
  });

  /**
   * The values scanned here come straight out of tenant records, so URL
   * matching must not be able to backtrack. A pattern anchored only at the tail
   * retries from every start position, which a value repeating the matched
   * prefix turns into a polynomial blowup (CodeQL js/polynomial-redos).
   */
  it('matches resolver URLs in linear time on an adversarial value', async () => {
    // Many repetitions of the matched prefix, ending in a segment that is not
    // an id token — the shape that makes a tail-anchored pattern retry from
    // every start position.
    const hostile = '/storage/files/'.repeat(6000) + '!';
    const engine = fakeEngine({ product: [{ id: 'p1', image: hostile }], sys_file: [] });

    const started = process.hrtime.bigint();
    const report = await run(engine, {});
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

    // Not a reference (the trailing segment is not an id token) — and reaching
    // that verdict must not depend on how many times the prefix repeats.
    expect(report.converted).toBe(0);
    expect(elapsedMs).toBeLessThan(1000);
  });

  it('accepts the resolver URL shapes and rejects near-misses', async () => {
    const engine = fakeEngine({
      product: [
        { id: 'p1', image: 'https://app.example.com/api/v1/storage/files/aaa' },
        { id: 'p2', image: '/api/v1/storage/files/bbb/url' },
        { id: 'p3', image: '/api/v1/storage/files/ccc?v=2' },
        { id: 'p4', image: '/api/v1/storage/files/ddd/' },
        { id: 'p5', image: 'https://cdn.example.com/files/eee' }, // no /storage
        { id: 'p6', image: '/api/v1/storage/files/' }, // no id
      ],
      sys_file: [],
    });

    await run(engine, { apply: true });

    expect(engine.tables.product.map((r) => r.image)).toEqual([
      'aaa',
      'bbb',
      'ccc',
      'ddd',
      'https://cdn.example.com/files/eee',
      '/api/v1/storage/files/',
    ]);
  });

  it('pages through large objects and flags truncation at the bound', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({
      id: `p${i}`,
      image: `/api/v1/storage/files/file_${i}`,
    }));
    const engine = fakeEngine({ product: many, sys_file: [] });

    const full = await run(engine, {});
    expect(full.scannedRecords).toBe(500);
    expect(full.truncated).toBe(false);

    const bounded = await run(fakeEngine({ product: many, sys_file: [] }), {
      maxRecordsPerObject: 200,
    });
    expect(bounded.truncated).toBe(true);
    expect(formatBackfillReport(bounded)).toContain('truncated');
  });
});
