// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Approvals Inbox readability probe (objectui#5211) — cost model and
 * answer semantics.
 *
 * ## Why the cost is asserted rather than described
 *
 * The maintainer's ruling makes the probe's cost the thing that selects the
 * disposition: a probe that batches (no per-row round trip) suppresses the
 * dead-end link; a probe that costs a request per row does not ship at all.
 * `planReadabilityProbe` returns exactly the list reads a render performs, so
 * `groups.length` IS the call count — the number in the PR body is read off
 * these assertions, not estimated.
 *
 * ## What is deliberately NOT asserted here
 *
 * Nothing about the server's `404 RECORD_NOT_FOUND` vs `403`. That semantics
 * is the server's deliberate choice and is out of scope in both directions —
 * the probe never sees a by-id read, only a list read whose row set the server
 * has already filtered for this principal.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  planReadabilityProbe,
  probeRecordReadability,
  readabilityKey,
  READABILITY_PROBE_CHUNK,
  type ReadabilityProbeSource,
} from './recordReadability';

/** N rows of `object`, ids `<object>_0 … <object>_{n-1}`. */
function rowsFor(object: string, n: number) {
  return Array.from({ length: n }, (_, i) => ({ object_name: object, record_id: `${object}_${i}` }));
}

/**
 * A data source that records every call and answers with the rows whose ids
 * are in `readable` — which is precisely what the server does for a principal
 * whose grant filters the record out of the row set.
 */
function countingSource(readable: ReadonlySet<string>) {
  const calls: Array<{ object: string; ids: unknown }> = [];
  const source: ReadabilityProbeSource = {
    find: vi.fn(async (object: string, params?: Record<string, unknown>) => {
      const filter = params?.$filter as { id?: { $in?: string[] } } | undefined;
      const ids = filter?.id?.$in ?? [];
      calls.push({ object, ids });
      return { data: ids.filter((id) => readable.has(id)).map((id) => ({ id })) };
    }),
  };
  return { source, calls };
}

describe('planReadabilityProbe — the cost model', () => {
  it('costs one list read per distinct object, not one per row', () => {
    const groups = planReadabilityProbe([...rowsFor('showcase_invoice', 30), ...rowsFor('showcase_project', 20)]);

    // 50 rows, 2 objects => 2 calls. The measurement the ruling asked for.
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.objectName)).toEqual(['showcase_invoice', 'showcase_project']);
    expect(groups[0].ids).toHaveLength(30);
    expect(groups[1].ids).toHaveLength(20);
  });

  it('costs exactly one read for a page that names a single object', () => {
    expect(planReadabilityProbe(rowsFor('showcase_invoice', 50))).toHaveLength(1);
  });

  it('dedupes repeated targets — several requests about one record probe it once', () => {
    const target = { object_name: 'showcase_invoice', record_id: 'inv_1' };
    const groups = planReadabilityProbe([target, { ...target }, { ...target }]);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(['inv_1']);
  });

  it('skips targets it cannot address, and costs nothing for an empty page', () => {
    expect(planReadabilityProbe([])).toEqual([]);
    expect(planReadabilityProbe([
      { object_name: '', record_id: 'x' },
      { object_name: 'showcase_invoice', record_id: '' },
      { object_name: null, record_id: null },
    ])).toEqual([]);
  });

  it('splits only past the batch cap, so the call count stays O(objects)', () => {
    const groups = planReadabilityProbe(rowsFor('showcase_invoice', READABILITY_PROBE_CHUNK + 1));
    expect(groups).toHaveLength(2);
    expect(groups[0].ids).toHaveLength(READABILITY_PROBE_CHUNK);
    expect(groups[1].ids).toHaveLength(1);
  });
});

describe('probeRecordReadability — the answer', () => {
  it('answers every id from one batched read per object', async () => {
    const { source, calls } = countingSource(new Set(['showcase_invoice_0', 'showcase_project_1']));
    const map = await probeRecordReadability(source, [
      ...rowsFor('showcase_invoice', 2),
      ...rowsFor('showcase_project', 2),
    ]);

    expect(calls).toHaveLength(2);
    expect(source.find).toHaveBeenCalledTimes(2);
    expect(map.get(readabilityKey('showcase_invoice', 'showcase_invoice_0'))).toBe(true);
    expect(map.get(readabilityKey('showcase_invoice', 'showcase_invoice_1'))).toBe(false);
    expect(map.get(readabilityKey('showcase_project', 'showcase_project_1'))).toBe(true);
    expect(map.get(readabilityKey('showcase_project', 'showcase_project_0'))).toBe(false);
  });

  it('pins `$top` to the batch size so a default page size cannot forge an unreadable', async () => {
    const findCalls: Array<Record<string, unknown> | undefined> = [];
    const source: ReadabilityProbeSource = {
      find: async (_object: string, params?: Record<string, unknown>) => {
        findCalls.push(params);
        return { data: [] };
      },
    };
    await probeRecordReadability(source, rowsFor('showcase_invoice', 60));
    expect(findCalls).toHaveLength(1);
    expect(findCalls[0]?.$top).toBe(60);
    // Projected to the id column — the probe reads existence, never content.
    expect(findCalls[0]?.$select).toEqual(['id']);
  });

  it('leaves a failed group UNKNOWN (absent), never guessed, and keeps the others', async () => {
    const source: ReadabilityProbeSource = {
      find: async (object: string, params?: Record<string, unknown>) => {
        if (object === 'showcase_invoice') throw new Error('NETWORK');
        const ids = (params?.$filter as { id?: { $in?: string[] } })?.id?.$in ?? [];
        return { data: ids.map((id) => ({ id })) };
      },
    };
    const map = await probeRecordReadability(source, [
      ...rowsFor('showcase_invoice', 2),
      ...rowsFor('showcase_project', 1),
    ]);

    // Absent, not `false`: an unknown target keeps its link (fail open).
    expect(map.has(readabilityKey('showcase_invoice', 'showcase_invoice_0'))).toBe(false);
    // The healthy object still answered.
    expect(map.get(readabilityKey('showcase_project', 'showcase_project_0'))).toBe(true);
  });

  it('accepts a bare-array result as well as the `{ data }` envelope', async () => {
    const source: ReadabilityProbeSource = {
      find: async () => [{ id: 'showcase_invoice_0' }],
    };
    const map = await probeRecordReadability(source, rowsFor('showcase_invoice', 2));
    expect(map.get(readabilityKey('showcase_invoice', 'showcase_invoice_0'))).toBe(true);
    expect(map.get(readabilityKey('showcase_invoice', 'showcase_invoice_1'))).toBe(false);
  });
});
