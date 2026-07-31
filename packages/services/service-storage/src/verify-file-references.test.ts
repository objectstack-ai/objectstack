// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  verifyFileReferences,
  formatFileReferenceReport,
  BLOCKING_ISSUE_KINDS,
  type VerifyReferencesEngine,
} from './verify-file-references.js';

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

/**
 * Executes the subset of the query language this scan emits. Since #4363 that
 * is a KEYSET walk — `orderBy` on the key plus a `$gt` seek AND-ed onto the
 * caller's filter — so the fake grew `$and` and `$gt`, and `offset` is gone.
 *
 * `offset` now THROWS rather than being served: this scan decides which files
 * are still referenced, and an offset walk cannot promise it visited every row.
 * A fake that quietly honored one would let that regression back in with every
 * assertion still green.
 */
function fakeEngine(tables: Record<string, Array<Record<string, unknown>>>): VerifyReferencesEngine {
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (where == null) return true;
    const w = where as Record<string, any>;
    if (Array.isArray(w.$and)) return w.$and.every((c: unknown) => matches(row, c));
    return Object.entries(w).every(([k, v]) => {
      if (v && typeof v === 'object' && '$ne' in (v as any)) return row[k] !== (v as any).$ne;
      if (v && typeof v === 'object' && '$gt' in (v as any)) return String(row[k]) > String((v as any).$gt);
      return row[k] === v;
    });
  };
  return {
    getObject: (name) => REGISTRY[name],
    getConfigs: () => REGISTRY,
    async find(object, options: any) {
      if (options?.offset !== undefined) {
        throw new Error('offset paging cannot promise a full walk — expected a keyset seek (#4363)');
      }
      const key = options?.orderBy?.[0]?.field;
      const rows = (tables[object] ?? []).filter((r) => matches(r, options?.where));
      const ordered = key ? [...rows].sort((a, b) => String(a[key]).localeCompare(String(b[key]))) : rows;
      return typeof options?.limit === 'number' ? ordered.slice(0, options.limit) : ordered;
    },
  };
}

const file = (id: string, owner?: { object: string; recordId: string; field: string }) => ({
  id,
  status: 'committed',
  scope: 'user',
  ref_object: owner?.object ?? null,
  ref_id: owner?.recordId ?? null,
  ref_field: owner?.field ?? null,
});

describe('verifyFileReferences (ADR-0104 D3 wave 2 — R4 gate)', () => {
  it('reports a clean bill when ownership matches what records hold', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'file_a' }],
      sys_file: [file('file_a', { object: 'product', recordId: 'p1', field: 'image' })],
    });

    const report = await verifyFileReferences(engine);

    expect(report.ok).toBe(true);
    expect(report.blocking).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.scannedObjects).toEqual(['product']);
    expect(report.heldReferences).toBe(1);
    expect(report.ownedFiles).toBe(1);
    expect(formatFileReferenceReport(report)).toContain('No discrepancies');
  });

  it('only scans objects that declare a file-class field', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1' }],
      tag: [{ id: 't1', label: 'x' }],
      sys_file: [],
    });

    const report = await verifyFileReferences(engine);

    expect(report.scannedObjects).toEqual(['product']);
    expect(report.scannedRecords).toBe(1);
  });

  // ── Blocking: these would delete bytes something still holds ──────
  it('BLOCKS on a held file with no recorded owner', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'file_a' }],
      sys_file: [file('file_a')], // uploaded, never claimed
    });

    const report = await verifyFileReferences(engine);

    expect(report.ok).toBe(false);
    expect(report.counts.unowned_reference).toBe(1);
    expect(report.issues[0]).toMatchObject({
      kind: 'unowned_reference',
      fileId: 'file_a',
      object: 'product',
      recordId: 'p1',
      field: 'image',
    });
    expect(formatFileReferenceReport(report)).toContain('BLOCKING');
  });

  it('BLOCKS when a record holds a file owned by a different slot', async () => {
    const engine = fakeEngine({
      product: [
        { id: 'p1', image: 'file_a' },
        { id: 'p2', image: 'file_a' },
      ],
      sys_file: [file('file_a', { object: 'product', recordId: 'p1', field: 'image' })],
    });

    const report = await verifyFileReferences(engine);

    expect(report.ok).toBe(false);
    // p2's reference is invisible to the lifecycle: when p1 releases, the
    // bytes go while p2 still points at them.
    expect(report.counts.foreign_owner).toBe(1);
    expect(report.issues.find((i) => i.kind === 'foreign_owner')).toMatchObject({ recordId: 'p2' });
    // …and the exclusivity violation itself is reported too.
    expect(report.counts.shared_reference).toBe(1);
  });

  it('BLOCKS on a file held by two slots (exclusivity violated)', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'file_a', gallery: ['file_a'] }],
      sys_file: [file('file_a', { object: 'product', recordId: 'p1', field: 'image' })],
    });

    const report = await verifyFileReferences(engine);

    expect(report.counts.shared_reference).toBe(1);
    expect(report.ok).toBe(false);
  });

  // ── Advisory: safe directions ─────────────────────────────────────
  it('reports a stale owner as advisory, not blocking', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1' }], // field cleared without the release landing
      sys_file: [file('file_a', { object: 'product', recordId: 'p1', field: 'image' })],
    });

    const report = await verifyFileReferences(engine);

    expect(report.counts.stale_owner).toBe(1);
    // Fails toward retention — the file is simply never collected.
    expect(report.blocking).toBe(0);
    expect(report.ok).toBe(true);
  });

  it('reports unreferenced committed files only when asked, and never as blocking', async () => {
    const tables = {
      product: [{ id: 'p1' }],
      sys_file: [file('file_orphan')],
    };

    const without = await verifyFileReferences(fakeEngine(tables));
    expect(without.counts.unreferenced_file).toBe(0);

    const withSweep = await verifyFileReferences(fakeEngine(tables), { includeUnreferenced: true });
    expect(withSweep.counts.unreferenced_file).toBe(1);
    expect(withSweep.ok).toBe(true);
  });

  it('ignores attachments-scope files, which sys_attachment governs', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1' }],
      sys_file: [{ ...file('file_att'), scope: 'attachments' }],
    });

    const report = await verifyFileReferences(engine, { includeUnreferenced: true });

    expect(report.counts.unreferenced_file).toBe(0);
  });

  // ── Dual-mode ─────────────────────────────────────────────────────
  it('ignores inline blobs and URL values — a pre-cutover tenant reads clean', async () => {
    const engine = fakeEngine({
      product: [
        { id: 'p1', image: { url: 'https://cdn.example.com/a.png', name: 'a.png' } },
        { id: 'p2', image: 'https://cdn.example.com/b.png' },
        { id: 'p3', image: 'data:image/svg+xml,<svg/>' },
      ],
      sys_file: [],
    });

    const report = await verifyFileReferences(engine);

    expect(report.heldReferences).toBe(0);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  // ── Mechanics ─────────────────────────────────────────────────────
  // The fake engine refuses an `offset`, so this also asserts the walk seeks
  // (#4363) rather than counting from the start — which is what makes "every
  // row was visited" a promise rather than a hope.
  it('pages through records rather than reading one unbounded page', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: `p${i}`, image: `file_${i}` }));
    const engine = fakeEngine({
      product: many,
      sys_file: many.map((r, i) => file(`file_${i}`, { object: 'product', recordId: `p${i}`, field: 'image' })),
    });

    const report = await verifyFileReferences(engine);

    expect(report.scannedRecords).toBe(1200);
    expect(report.ownedFiles).toBe(1200);
    expect(report.ok).toBe(true);
  });

  it('marks the verdict truncated when a scan bound is hit', async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({ id: `p${i}` }));
    const engine = fakeEngine({ product: many, sys_file: [] });

    const report = await verifyFileReferences(engine, { maxRecordsPerObject: 500 });

    expect(report.truncated).toBe(true);
    expect(formatFileReferenceReport(report)).toContain('truncated');
  });

  it('can be scoped to specific objects', async () => {
    const engine = fakeEngine({
      product: [{ id: 'p1', image: 'file_a' }],
      sys_file: [file('file_a')],
    });

    const report = await verifyFileReferences(engine, { objects: ['tag'] });

    expect(report.scannedObjects).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('classifies exactly the data-loss kinds as blocking', () => {
    expect([...BLOCKING_ISSUE_KINDS].sort()).toEqual([
      'foreign_owner',
      'shared_reference',
      'unowned_reference',
    ]);
  });
});
