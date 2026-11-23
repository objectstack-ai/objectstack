/**
 * objectstack-ai/objectstack#36554 — the step set a drilled record's page is
 * handed (`drillRecordOrigin`): the drill's whole result, read by the drill
 * list's own query for ids alone, bounded; the rows drawn when nothing more
 * is owed or the read cannot be trusted.
 */
import { describe, it, expect, vi } from 'vitest';
import { DRILL_RECORD_STEP_CAP, drillRecordOrigin } from '../drillRecordSteps';

/** A data source over `count` rows d1…dN that honours `$top` / `$skip` and answers the match count. */
function source(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `d${i + 1}`);
  return {
    find: vi.fn(async (_object: string, params: { $top?: number; $skip?: number } = {}) => {
      const skip = params.$skip ?? 0;
      const top = params.$top ?? count;
      return { data: ids.slice(skip, skip + top).map((id) => ({ id })), total: count };
    }),
  };
}

const QUERY = {
  $filter: ['stage', '=', 'negotiation'],
  $orderby: [{ field: 'amount', order: 'desc' }],
  $search: 'acme',
  $searchFields: ['name'],
  $select: ['name', 'stage', 'amount'],
  $expand: ['account'],
  $top: 2,
  $skip: 0,
};

describe('drillRecordOrigin (#36554)', () => {
  it('reads the whole result by the list\'s query, ids only, when the count exceeds the rows drawn', async () => {
    const ds = source(40);
    const origin = await drillRecordOrigin({
      dataSource: ds, objectName: 'deal', recordId: 'd2', drawn: ['d1', 'd2'], total: 40, findParams: QUERY,
    });
    expect(origin).toEqual({ siblings: Array.from({ length: 40 }, (_, i) => `d${i + 1}`), total: 40 });
    expect(ds.find).toHaveBeenCalledTimes(1);
    const [object, params] = ds.find.mock.calls[0];
    expect(object).toBe('deal');
    expect(params).toEqual({
      $filter: QUERY.$filter,
      $orderby: QUERY.$orderby,
      $search: 'acme',
      $searchFields: ['name'],
      $select: ['id'],
      $top: 100,
    });
  });

  it('reads from the start when the rows drawn are a later page, so the count says where the record sits', async () => {
    const ds = source(6);
    const origin = await drillRecordOrigin({
      dataSource: ds, objectName: 'deal', recordId: 'd5', drawn: ['d5', 'd6'], total: 6, findParams: { ...QUERY, $skip: 4 },
    });
    expect(origin.siblings).toEqual(['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);
    expect(origin.siblings.indexOf('d5')).toBe(4);
  });

  it('walks a wide result window by window and stops at the cap', async () => {
    const ds = source(DRILL_RECORD_STEP_CAP + 500);
    const origin = await drillRecordOrigin({
      dataSource: ds, objectName: 'deal', recordId: 'd1', drawn: ['d1', 'd2'], total: DRILL_RECORD_STEP_CAP + 500, findParams: QUERY,
    });
    expect(origin.siblings).toHaveLength(DRILL_RECORD_STEP_CAP);
    expect(origin.total).toBe(DRILL_RECORD_STEP_CAP + 500);
    const skips = ds.find.mock.calls.map(([, params]) => (params as { $skip?: number }).$skip ?? 0);
    expect(skips).toEqual(Array.from({ length: DRILL_RECORD_STEP_CAP / 100 }, (_, w) => w * 100));
  });

  it('asks for the list\'s own window when it is wider than the floor', async () => {
    const ds = source(400);
    await drillRecordOrigin({
      dataSource: ds, objectName: 'deal', recordId: 'd1', drawn: ['d1'], total: 400, findParams: { ...QUERY, $top: 250 },
    });
    expect(ds.find.mock.calls.map(([, params]) => (params as { $top?: number }).$top)).toEqual([250, 250]);
  });

  it('control: a result all drawn reads nothing and hands the rows drawn with the count, at once', () => {
    const ds = source(3);
    const origin = drillRecordOrigin({
      dataSource: ds, objectName: 'deal', recordId: 'd2', drawn: ['d1', 'd2', 'd3'], total: 3, findParams: QUERY,
    });
    // No read owed, so no promise: the record page opens on the click itself.
    expect(origin).not.toBeInstanceOf(Promise);
    expect(origin).toEqual({ siblings: ['d1', 'd2', 'd3'], total: 3 });
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('keeps the rows drawn when there is no query, no count, or no read to make', async () => {
    const ds = source(40);
    const drawn = ['d1', 'd2'];
    expect(await drillRecordOrigin({ dataSource: ds, objectName: 'deal', recordId: 'd1', drawn, total: 40, findParams: null }))
      .toEqual({ siblings: drawn, total: 40 });
    expect(await drillRecordOrigin({ dataSource: ds, objectName: 'deal', recordId: 'd1', drawn, findParams: QUERY }))
      .toEqual({ siblings: drawn });
    expect(await drillRecordOrigin({ dataSource: {}, objectName: 'deal', recordId: 'd1', drawn, total: 40, findParams: QUERY }))
      .toEqual({ siblings: drawn, total: 40 });
    expect(ds.find).not.toHaveBeenCalled();
  });

  it('keeps the rows drawn when the read fails or no longer holds the record opened', async () => {
    const failing = { find: vi.fn(async () => { throw new Error('offline'); }) };
    expect(await drillRecordOrigin({
      dataSource: failing, objectName: 'deal', recordId: 'd1', drawn: ['d1', 'd2'], total: 40, findParams: QUERY,
    })).toEqual({ siblings: ['d1', 'd2'], total: 40 });

    const moved = source(40);
    expect(await drillRecordOrigin({
      dataSource: moved, objectName: 'deal', recordId: 'gone', drawn: ['gone', 'd2'], total: 40, findParams: QUERY,
    })).toEqual({ siblings: ['gone', 'd2'], total: 40 });
  });
});
