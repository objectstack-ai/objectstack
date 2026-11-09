// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Ruling 6677709817, step (b), first half: the drained-key scrub's read-only
 * COUNT, rehearsed on a copy.
 *
 * The copy is a real SQLite file (`driver-sqlite-wasm`) seeded the way a
 * deployment's history came to hold the key: rows inserted as the history
 * writers stored them BEFORE step (c), plus one row written through the
 * current `DatabaseLoader` writer AFTER it. The seeded file is then copied, and
 * only the copy is opened for the count — the shape an operator follows with a
 * restored backup.
 *
 * Pinned: (i) a connector snapshot holding an undeclared `auth` key is counted;
 * (ii) a connector snapshot holding only declared keys, (iii) a non-connector
 * snapshot and (iv) a snapshot written after step (c) are not; the run changes
 * no row; the result names no key or value; any mode but `count` is refused
 * before anything is read.
 *
 * The placeholder below is a fixture string, not a credential.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { DatabaseLoader } from '../loaders/database-loader.js';
import { scrubHistoryDrainedKeys, type HistoryDrainedKeysCount } from './history-drained-keys.js';

type Row = Record<string, unknown>;

const HISTORY = 'sys_metadata_history';
const LEGACY_AUTH_VALUE = 'TEST_PLACEHOLDER_LEGACY_AUTH_VALUE';

/** A connector whose `auth` holds a key its `bearer` kind does not declare. */
function legacyConnector(name: string): Row {
  return {
    name,
    label: 'Vendor API',
    type: 'api',
    provider: 'rest',
    providerConfig: { baseUrl: 'https://api.vendor.example/v1' },
    auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN', token: LEGACY_AUTH_VALUE },
  };
}

/** The same connector with declared `auth` keys only. */
function declaredConnector(name: string): Row {
  return { ...legacyConnector(name), auth: { type: 'bearer', credentialRef: 'VENDOR_API_TOKEN' } };
}

/** Pre-step-(c) rows, keyed by the fixture's own ids. */
const PRE_FIX = {
  // (i) the same item twice: two affected rows, one distinct item.
  legacyV1: { id: 'h_seed_01', type: 'connector', name: 'vendor_api', version: 1, body: legacyConnector('vendor_api') },
  legacyV2: { id: 'h_seed_02', type: 'connector', name: 'vendor_api', version: 2, body: { ...legacyConnector('vendor_api'), label: 'Vendor API v2' } },
  // (ii) CONTROL: declared keys only.
  declared: { id: 'h_seed_03', type: 'connector', name: 'declared_api', version: 1, body: declaredConnector('declared_api') },
  // (iii) CONTROL: a non-connector body carrying the same-looking `auth` shape.
  nonConnector: {
    id: 'h_seed_04', type: 'object', name: 'vendor_record', version: 1,
    body: { name: 'vendor_record', label: 'Vendor Record', auth: { type: 'bearer', token: LEGACY_AUTH_VALUE }, fields: {} },
  },
  // A delete event (no body), and a body that is not JSON.
  deleted: { id: 'h_seed_05', type: 'connector', name: 'gone_api', version: 2, body: null },
  unreadable: { id: 'h_seed_06', type: 'connector', name: 'broken_api', version: 1, body: 'not json {' },
} as const;

describe('[ruling 6677709817 (b), first half] scrubHistoryDrainedKeys count mode, rehearsed on a copy', () => {
  let dir: string;
  let copy: SqliteWasmDriver;
  let postFixId: string;
  let before: string;
  let report: HistoryDrainedKeysCount;

  async function allHistoryRows(driver: SqliteWasmDriver): Promise<Row[]> {
    return (await driver.find(HISTORY, { orderBy: [{ field: 'id', order: 'asc' }] })) as Row[];
  }

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'objectstack-history-drained-keys-'));
    const seededPath = join(dir, 'seeded.sqlite');
    const copyPath = join(dir, 'copy.sqlite');

    const seeded = new SqliteWasmDriver({ filename: seededPath, persist: 'on-disconnect' });
    await seeded.connect();
    // (iv) a row written AFTER step (c), through the current history writer,
    // from a body that still carries the key.
    const loader = new DatabaseLoader({ driver: seeded, trackHistory: true, cache: { enabled: false } });
    await loader.save('connector', 'post_fix_api', legacyConnector('post_fix_api'));
    const [template] = (await seeded.find(HISTORY, { where: { name: 'post_fix_api' } })) as Row[];
    postFixId = template!.id as string;

    // The rows the writers stored before step (c): the same columns, the body as it was handed in.
    let seq = 100;
    for (const r of Object.values(PRE_FIX)) {
      seq += 1;
      await seeded.create(HISTORY, {
        ...template,
        id: r.id,
        type: r.type,
        name: r.name,
        version: r.version,
        event_seq: seq,
        operation_type: r.body === null ? 'delete' : 'update',
        metadata: r.body === null ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body),
      });
    }
    await seeded.disconnect();

    copyFileSync(seededPath, copyPath);
    copy = new SqliteWasmDriver({ filename: copyPath, persist: 'on-disconnect' });
    await copy.connect();
    before = JSON.stringify(await allHistoryRows(copy));
    // A page smaller than the table, so the keyset paging is exercised.
    report = await scrubHistoryDrainedKeys(copy, { mode: 'count', pageSize: 2 });
  });

  afterAll(async () => {
    await copy?.disconnect();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('the copy holds every seeded row, and the post-step-(c) row was written without the key', async () => {
    const rows = await allHistoryRows(copy);
    expect(rows.map((r) => r.id).sort()).toEqual([...Object.values(PRE_FIX).map((r) => r.id), postFixId].sort());
    const postFix = rows.find((r) => r.id === postFixId)!;
    expect(postFix.metadata as string).not.toContain(LEGACY_AUTH_VALUE);
    expect(report.scanned).toBe(rows.length);
  });

  it('(i) counts each connector snapshot holding an undeclared `auth` key, and its item once', () => {
    expect(report.handles).toEqual([PRE_FIX.legacyV1.id, PRE_FIX.legacyV2.id]);
    expect(report.affectedRows).toBe(2);
    expect(report.distinctItems).toBe(1);
  });

  it('(ii) CONTROL: a connector snapshot with declared keys only is not counted', () => {
    expect(report.handles).not.toContain(PRE_FIX.declared.id);
  });

  it('(iii) CONTROL: a non-connector snapshot is not counted, whatever keys it holds', () => {
    expect(report.handles).not.toContain(PRE_FIX.nonConnector.id);
  });

  it('(iv) a snapshot written after step (c) is not counted', () => {
    expect(report.handles).not.toContain(postFixId);
  });

  it('a delete event is scanned, not counted; a body that is not JSON is reported, not counted', () => {
    expect(report.handles).not.toContain(PRE_FIX.deleted.id);
    expect(report.unreadable).toEqual([PRE_FIX.unreadable.id]);
    expect(report.unscrubbable).toEqual([]);
  });

  it('changes no row: every history row is byte-identical after the run', async () => {
    expect(JSON.stringify(await allHistoryRows(copy))).toBe(before);
  });

  it('the result names no key and no value: ids and numbers only', () => {
    const text = JSON.stringify(report);
    expect(text).not.toContain(LEGACY_AUTH_VALUE);
    expect(text).not.toContain('token');
    expect(Object.keys(report).sort()).toEqual(
      ['affectedRows', 'distinctItems', 'handles', 'mode', 'scanned', 'unreadable', 'unscrubbable'],
    );
  });

  it('refuses any mode but count, before anything is read', async () => {
    const find = vi.fn(async () => [] as Row[]);
    await expect(
      scrubHistoryDrainedKeys({ find }, { mode: 'apply' } as unknown as { mode: 'count' }),
    ).rejects.toThrow(Error);
    expect(find).not.toHaveBeenCalled();
  });
});
