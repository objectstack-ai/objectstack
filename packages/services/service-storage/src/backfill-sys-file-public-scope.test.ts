// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #22443, ruling B — the `sys_file.scope` option `public` retires, and the
// rows already stored with it are rewritten to `user` by an operator-run
// sweep (`backfill-sys-file-public-scope.ts`).
//
// Every pin runs on a REAL ObjectQL over a REAL SqlDriver on sqlite `:memory:`
// (the project's ruled test backend), with the real `SystemFile` object and
// the real field-reference hooks: what retiring the option does to a stored
// row is the engine's select-option check, and a double would only restate
// what this file has to measure. A stored `public` row is seeded through the
// DRIVER, because the engine on this release refuses to write one — which is
// exactly the state a deployment upgrading from the previous release is in.
//
// What is pinned:
//
//   - the ruling's two pins — a copy of a rewritten row succeeds
//     (`copyOwnedFile`, reached through the copy-on-claim hook); a deployment
//     with no `public` rows runs clean, with zero writes;
//   - counts before it writes, dry run by default, and a second run writes zero;
//   - the operator step's reason, as behaviour: BEFORE the sweep runs, a copy
//     of a stored `public` row is refused, while reads and scope-free updates
//     of that row are unaffected;
//   - the rollback's precondition: on this release the inverse write
//     (`user` → `public`) is refused by the engine.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SystemFile } from './objects/system-file.object.js';
import { installFileReferenceHooks } from './file-reference-lifecycle.js';
import {
  REWRITTEN_SYS_FILE_SCOPE,
  RETIRED_SYS_FILE_SCOPE,
  applySysFilePublicScopeBackfill,
  formatSysFilePublicScopeBackfillReport,
  planSysFilePublicScopeBackfill,
  runSysFilePublicScopeBackfill,
} from './backfill-sys-file-public-scope.js';

const SYSTEM = { context: { isSystem: true } };

const silentLogger = () => ({
  info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
  trace: vi.fn(), fatal: vi.fn(), child() { return this; },
});

/** A stored row as the previous release wrote it: `public`, owned by `product/p0.image`. */
const legacyPublicRow = (id: string) => ({
  id,
  key: `public/${id}.png`,
  name: 'logo.png',
  mime_type: 'image/png',
  size: 5,
  scope: RETIRED_SYS_FILE_SCOPE,
  acl: 'private',
  status: 'committed',
  ref_object: 'product',
  ref_id: 'p0',
  ref_field: 'image',
});

describe('sys_file public-scope backfill (#22443 ruling B) — a real ObjectQL over SqlDriver (sqlite :memory:)', () => {
  let sql: SqlDriver;
  let engine: ObjectQL;
  let storage: { upload: ReturnType<typeof vi.fn>; download: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>; exists: ReturnType<typeof vi.fn> };
  /** `sys_file` writes that reached the engine, by verb. */
  let sysFileUpdates: number;

  beforeEach(async () => {
    sql = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    engine = new ObjectQL({ logger: silentLogger() } as any);
    engine.registerDriver(sql as any, true);
    await engine.init();
    engine.registry.registerObject(SystemFile as any, 'com.objectstack.storage');
    engine.registry.registerObject({
      name: 'product',
      fields: { title: { type: 'text' }, image: { type: 'image' } },
    } as any, 'test-22443');
    await engine.syncSchemas();

    storage = {
      upload: vi.fn(async () => {}),
      download: vi.fn(async () => Buffer.from('bytes')),
      delete: vi.fn(async () => {}),
      exists: vi.fn(async () => true),
    };
    installFileReferenceHooks(engine as any, () => storage as any, silentLogger());

    sysFileUpdates = 0;
    const realUpdate = engine.update.bind(engine);
    (engine as any).update = (object: string, data: any, options: any) => {
      if (object === 'sys_file') sysFileUpdates += 1;
      return realUpdate(object, data, options);
    };
  });

  afterEach(async () => {
    try { await engine?.destroy(); } catch { /* already torn down */ }
  });

  const sysFile = (id: string) => engine.findOne('sys_file', { where: { id } });
  const allFiles = () => engine.find('sys_file', { orderBy: [{ field: 'id', order: 'asc' }] });

  /**
   * A record write that names a file already owned by ANOTHER slot — the one
   * condition that reaches `copyOwnedFile` (copy-on-claim), which re-inserts
   * the source row's scope on the copy.
   */
  const copyBySecondReference = (recordId: string, fileId: string) =>
    engine.insert('product', { id: recordId, title: recordId, image: fileId });

  it('a deployment with no public rows runs clean: it counts zero and writes nothing', async () => {
    await engine.insert('sys_file', { ...legacyPublicRow('f_user'), scope: 'user' }, SYSTEM as any);
    await engine.insert('sys_file', { ...legacyPublicRow('f_att'), scope: 'attachments', ref_object: null, ref_id: null, ref_field: null }, SYSTEM as any);
    const before = await allFiles();
    sysFileUpdates = 0;

    const report = await runSysFilePublicScopeBackfill(engine as any, { dryRun: false });

    expect(report).toMatchObject({ dryRun: false, scanned: 0, planned: 0, written: 0, rows: [], failures: [], notes: [] });
    expect(sysFileUpdates).toBe(0);
    expect(await allFiles()).toEqual(before);
  });

  it('counts before it writes: the default run is a dry run that names every row and writes none', async () => {
    await sql.create('sys_file', legacyPublicRow('f_pub'));
    sysFileUpdates = 0;

    const dry = await runSysFilePublicScopeBackfill(engine as any);

    expect(dry).toMatchObject({ dryRun: true, scanned: 1, planned: 1, written: 0, failures: [], notes: [] });
    expect(dry.rows).toEqual([{ id: 'f_pub', key: 'public/f_pub.png', from: 'public', to: 'user' }]);
    expect(sysFileUpdates).toBe(0);
    expect((await sysFile('f_pub'))?.scope).toBe(RETIRED_SYS_FILE_SCOPE);
    expect(formatSysFilePublicScopeBackfillReport(dry)).toContain('f_pub');
  });

  it('before the sweep runs, a copy of a stored public row is refused — the operator step the changeset names', async () => {
    await sql.create('sys_file', legacyPublicRow('f_pub'));

    // The rest of the row's life is unaffected: it reads, and a scope-free
    // update lands.
    expect((await sysFile('f_pub'))?.scope).toBe(RETIRED_SYS_FILE_SCOPE);
    await engine.update('sys_file', { id: 'f_pub', name: 'renamed.png' }, SYSTEM as any);
    expect((await sysFile('f_pub'))?.name).toBe('renamed.png');

    // The copy re-inserts `scope: 'public'`, which the select no longer declares.
    await expect(copyBySecondReference('p1', 'f_pub')).rejects.toMatchObject({ code: 'ERR_FILE_REFERENCE_COPY' });
    expect((await allFiles()).map((f: any) => f.id)).toEqual(['f_pub']);

    // …and that refusal is the engine's option check on `scope`, the same one
    // an insert naming the retired value meets directly.
    await expect(
      engine.insert('sys_file', { ...legacyPublicRow('f_direct'), ref_object: null, ref_id: null, ref_field: null }, SYSTEM as any),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [expect.objectContaining({ field: 'scope', code: 'invalid_option' })],
    });
  });

  it('a copy of a rewritten row succeeds — scope user, the key and the bytes untouched (copyOwnedFile)', async () => {
    await sql.create('sys_file', legacyPublicRow('f_pub'));

    const plan = await planSysFilePublicScopeBackfill(engine as any);
    const applied = await applySysFilePublicScopeBackfill(engine as any, plan);
    expect(applied).toMatchObject({ dryRun: false, scanned: 1, planned: 1, written: 1, failures: [] });

    const rewritten = await sysFile('f_pub');
    expect(rewritten).toMatchObject({
      scope: REWRITTEN_SYS_FILE_SCOPE,
      key: 'public/f_pub.png',
      ref_object: 'product',
      ref_id: 'p0',
      ref_field: 'image',
      acl: 'private',
      status: 'committed',
    });

    const record = await copyBySecondReference('p1', 'f_pub');
    const copyId = (record as any).image;
    expect(copyId).not.toBe('f_pub');
    expect(storage.download).toHaveBeenCalledWith('public/f_pub.png');
    const copy = await sysFile(copyId);
    expect(copy).toMatchObject({ scope: REWRITTEN_SYS_FILE_SCOPE, ref_object: 'product', ref_id: 'p1', ref_field: 'image' });
    expect(String(copy?.key)).toMatch(/^user\//);
  });

  it('a second run writes zero', async () => {
    await sql.create('sys_file', legacyPublicRow('f_pub_1'));
    await sql.create('sys_file', legacyPublicRow('f_pub_2'));

    const first = await runSysFilePublicScopeBackfill(engine as any, { dryRun: false });
    expect(first).toMatchObject({ scanned: 2, written: 2, failures: [] });
    sysFileUpdates = 0;

    const second = await runSysFilePublicScopeBackfill(engine as any, { dryRun: false });
    expect(second).toMatchObject({ scanned: 0, planned: 0, written: 0, rows: [], failures: [], notes: [] });
    expect(sysFileUpdates).toBe(0);
  });

  it('pages through the population by id without skipping a row', async () => {
    for (const id of ['f_a', 'f_b', 'f_c', 'f_d', 'f_e']) await sql.create('sys_file', legacyPublicRow(id));

    const plan = await planSysFilePublicScopeBackfill(engine as any, { pageSize: 2 });

    expect(plan.rows.map((r) => r.id)).toEqual(['f_a', 'f_b', 'f_c', 'f_d', 'f_e']);
    expect(plan.notes).toEqual([]);
  });

  it('says so when the scan stops at its ceiling, and the next run picks up the rest', async () => {
    for (const id of ['f_a', 'f_b', 'f_c']) await sql.create('sys_file', legacyPublicRow(id));

    const first = await runSysFilePublicScopeBackfill(engine as any, { dryRun: false, pageSize: 2, maxRows: 2 });
    expect(first).toMatchObject({ scanned: 2, written: 2 });
    expect(first.notes).toHaveLength(1);

    const second = await runSysFilePublicScopeBackfill(engine as any, { dryRun: false, pageSize: 2, maxRows: 2 });
    expect(second).toMatchObject({ scanned: 1, written: 1, notes: [] });
  });

  it('reports a scan it could not make instead of reading as a clean deployment', async () => {
    const bare = new ObjectQL({ logger: silentLogger() } as any);
    bare.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    await bare.init();
    try {
      const report = await runSysFilePublicScopeBackfill(bare as any, { dryRun: false });
      expect(report).toMatchObject({ scanned: 0, written: 0 });
      expect(report.notes).toHaveLength(1);
    } finally {
      await bare.destroy();
    }
  });

  it('the rollback needs the previous release: on this one the inverse write is refused by the engine', async () => {
    await sql.create('sys_file', legacyPublicRow('f_pub'));
    const applied = await runSysFilePublicScopeBackfill(engine as any, { dryRun: false });
    expect(applied.rows.map((r) => r.id)).toEqual(['f_pub']);
    expect(formatSysFilePublicScopeBackfillReport(applied)).toContain('f_pub');

    await expect(
      engine.update('sys_file', { id: 'f_pub', scope: RETIRED_SYS_FILE_SCOPE }, SYSTEM as any),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      fields: [expect.objectContaining({ field: 'scope', code: 'invalid_option' })],
    });
    expect((await sysFile('f_pub'))?.scope).toBe(REWRITTEN_SYS_FILE_SCOPE);
  });
});
