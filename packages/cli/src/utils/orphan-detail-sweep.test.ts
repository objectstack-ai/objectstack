// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24964] The plan behind `os db orphans`, away from a boot: the judgements
 * that decide what is deletable, each in its failing direction.
 *
 * The engine slice here is read-only (no write verb), so it stands in for the
 * three reads the plan makes and nothing else. The command against a real
 * engine and database is `../commands/db/orphans.integration.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import type { DanglingReference, DanglingReferenceReport } from '@objectstack/objectql';
import {
  buildOrphanDetailExport,
  objectsWithRequiredMaster,
  planOrphanDetailSweep,
  recordKey,
  recordsToDelete,
  type OrphanDetailEngine,
} from './orphan-detail-sweep.js';

const CONFIGS = {
  sw_master: { name: 'sw_master', fields: { name: { type: 'text' } } },
  sw_detail: {
    name: 'sw_detail',
    fields: {
      master: { type: 'master_detail', reference: 'sw_master', required: true },
      second: { type: 'master_detail', reference: 'sw_master', required: true },
      loose: { type: 'master_detail', reference: 'sw_master' },
      link: { type: 'lookup', reference: 'sw_master' },
    },
  },
  sw_absent: { name: 'sw_absent', fields: { master: { type: 'master_detail', reference: 'sw_master', required: true } } },
  sw_plain: { name: 'sw_plain', fields: { link: { type: 'lookup', reference: 'sw_master' } } },
};

const finding = (recordId: string, field: string, value: string): DanglingReference =>
  ({ objectName: 'sw_detail', recordId, field, target: 'sw_master', value });

function report(dangling: DanglingReference[], extra: Partial<DanglingReferenceReport> = {}): DanglingReferenceReport {
  return {
    scanned: 10, dangling, undetermined: 0, unreadableObjects: [], truncatedObjects: [],
    unscannedObjects: [], aborted: false, ...extra,
  };
}

function engineWith(rep: DanglingReferenceReport, cascade: (object: string, id: string | number) => Promise<Array<{ object: string; id: string }>>) {
  const inspectDanglingReferences = vi.fn(async () => rep);
  const engine = {
    getConfigs: () => CONFIGS,
    inspectDanglingReferences,
    inspectCascadeDelete: vi.fn(cascade),
  } as unknown as OrphanDetailEngine;
  return { engine, inspectDanglingReferences };
}

const rootOnly = async (object: string, id: string | number) => [{ object, id: String(id) }];

describe('[#24964] planOrphanDetailSweep', () => {
  it('reads only the objects that declare a REQUIRED master-detail, and not a table the boot measured absent', async () => {
    expect(objectsWithRequiredMaster(CONFIGS)).toEqual(['sw_detail', 'sw_absent']);
    const { engine, inspectDanglingReferences } = engineWith(report([]), rootOnly);

    const plan = await planOrphanDetailSweep({ engine, maxRows: 50, absent: (o) => o === 'sw_absent' });

    expect(inspectDanglingReferences).toHaveBeenCalledWith({ objects: ['sw_detail'], rowsPerObject: 50, maxRows: 50 });
    expect(plan.notRead).toEqual(['sw_absent']);
    expect(plan.objects).toEqual(['sw_detail']);
  });

  it('an orphan is a dangling REQUIRED master-detail; a lookup or an optional master-detail is named and never deletable', async () => {
    const { engine } = engineWith(report([
      finding('d1', 'master', 'gone_a'),
      finding('d1', 'second', 'gone_b'),
      finding('d2', 'loose', 'gone_c'),
      finding('d3', 'link', 'gone_d'),
    ]), rootOnly);

    const plan = await planOrphanDetailSweep({ engine, maxRows: 50 });

    // One row, both of its missing masters.
    expect(plan.orphans).toEqual([{
      object: 'sw_detail',
      recordId: 'd1',
      fields: [
        { field: 'master', master: 'sw_master', missingMasterId: 'gone_a' },
        { field: 'second', master: 'sw_master', missingMasterId: 'gone_b' },
      ],
      cascade: [],
    }]);
    expect(plan.otherDangling.map((d) => `${d.recordId}.${d.field}`)).toEqual(['d2.loose', 'd3.link']);
    expect(recordsToDelete(plan).map((r) => r.id)).toEqual(['d1']);
  });

  it('an orphan whose cascade cannot be read is WITHHELD, never deletable', async () => {
    const { engine } = engineWith(report([finding('d1', 'master', 'gone'), finding('d2', 'master', 'gone')]), async (object, id) => {
      if (id === 'd1') throw new Error('connection reset reading sw_line');
      return [{ object, id: String(id) }];
    });

    const plan = await planOrphanDetailSweep({ engine, maxRows: 50 });

    expect(plan.withheld).toEqual([expect.objectContaining({ recordId: 'd1', reason: expect.stringContaining('connection reset') })]);
    expect(plan.orphans.map((o) => o.recordId)).toEqual(['d2']);
    expect(recordsToDelete(plan).map((r) => r.id)).toEqual(['d2']);
  });

  it('undetermined and unread rows are reported as such: the plan is incomplete, and lists nothing for them', async () => {
    const { engine } = engineWith(report([], { undetermined: 3, truncatedObjects: ['sw_detail'] }), rootOnly);

    const plan = await planOrphanDetailSweep({ engine, maxRows: 50 });

    expect(plan.complete).toBe(false);
    expect(plan.undetermined).toBe(3);
    expect(plan.orphans).toEqual([]);
    expect(plan.notes.join(' ')).toMatch(/Unknown is not missing/);
    expect(plan.notes.join(' ')).toMatch(/--max-rows/);
  });
});

describe('[#24964] the records a run deletes, and the export that must hold them', () => {
  const plan = {
    orphans: [
      { object: 'sw_detail', recordId: 'd1', fields: [], cascade: [{ object: 'sw_line', id: 'l1' }, { object: 'sw_detail', id: 'd2' }] },
      // Reached by the first orphan's cascade too: deleted, and exported, once.
      { object: 'sw_detail', recordId: 'd2', fields: [], cascade: [{ object: 'sw_line', id: 'l2' }] },
    ],
  };

  it('every orphan and every deeper detail, each once', () => {
    expect(recordsToDelete(plan).map((r) => `${r.object}/${r.id}`))
      .toEqual(['sw_detail/d1', 'sw_line/l1', 'sw_detail/d2', 'sw_line/l2']);
  });

  it('the export refuses to leave a record out', () => {
    const rawRows = new Map<string, Record<string, unknown>>(
      ['sw_detail/d1', 'sw_line/l1', 'sw_detail/d2'].map((k) => {
        const [object, id] = k.split('/') as [string, string];
        return [recordKey(object, id), { id }];
      }),
    );
    expect(() => buildOrphanDetailExport({ plan, rawRows, producedBy: 'test' })).toThrow(/sw_line\/l2/);

    rawRows.set(recordKey('sw_line', 'l2'), { id: 'l2' });
    const doc = buildOrphanDetailExport({ plan, rawRows, producedBy: 'test' });
    expect(doc.rows.map((r) => `${r.object}/${r.id}`)).toEqual(['sw_detail/d1', 'sw_line/l1', 'sw_detail/d2', 'sw_line/l2']);
  });
});
