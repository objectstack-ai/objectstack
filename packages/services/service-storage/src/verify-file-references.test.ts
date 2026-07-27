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

function fakeEngine(tables: Record<string, Array<Record<string, unknown>>>): VerifyReferencesEngine {
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === 'object' && '$ne' in (v as any)) return row[k] !== (v as any).$ne;
      return row[k] === v;
    });
  return {
    getObject: (name) => REGISTRY[name],
    getConfigs: () => REGISTRY,
    async find(object, options: any) {
      const rows = (tables[object] ?? []).filter((r) => matches(r, options?.where ?? {}));
      const start = typeof options?.offset === 'number' ? options.offset : 0;
      const end = typeof options?.limit === 'number' ? start + options.limit : undefined;
      return rows.slice(start, end);
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
