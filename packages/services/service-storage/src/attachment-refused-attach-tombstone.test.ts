// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22466] A refused attach tombstones the caller's own never-attached file.
 *
 * The defect, measured on `main` before the change on every refusal leg of the
 * attach gate: the presigned upload has committed an `attachments`-scope
 * `sys_file`, the `sys_attachment` insert that would attach it is refused
 * (`403 ATTACHMENT_PARENT_ACCESS`), and the file is left `committed`, with a
 * NULL `deleted_at` and zero join rows. The hooks tombstone only a file that
 * LOSES its last join row and the declared lifecycle nominates only
 * `deleted_at` / `pending` rows, so nothing ever reclaimed it.
 *
 * What these pin, through a REAL `ObjectQL` engine over sqlite `:memory:` (the
 * package's ruled test backend; a real driver with real transactions on a
 * single-connection pool, which is the property the transaction pins turn on):
 *
 *  - one refusal per leg of the attach rule — sharing `deny`, a sharing
 *    non-verdict, the master-detail check's `deny` and `unresolvable` (the leg
 *    the `controlled_by_parent` fix added), and the degraded read probe's miss
 *    — each leaves the file tombstoned, and the platform sweep reclaims it;
 *  - the tombstone is written outside the refused write's unit of work: the
 *    generic insert opens no transaction, and inside a caller's transaction
 *    that rolls back, the tombstone survives the rollback;
 *  - the controls: an admitted attach leaves the file `committed`; a file in
 *    field-file lineage (`ref_*`) is never tombstoned by this path; nor is a
 *    file the refused caller did not upload, a file still held by another join
 *    row, or a file that is not a committed attachments-scope file;
 *  - a client retry of the same `file_id` inside the 30-day window gets a
 *    clear answer: admitted ⇒ attached and revived; refused ⇒ the same refusal,
 *    and the file stays tombstoned;
 *  - the refusal itself is unchanged and names nothing about the file.
 *
 * The tombstone runs DETACHED from the refusal (see
 * `createRefusedAttachTombstoner`), so every pin waits for the one debug line
 * each run ends on — the run's own verdict, tombstoned or kept and why —
 * rather than for a timer.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL, LifecycleService } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SystemFile } from './objects/system-file.object.js';
import { createSysFileReapGuard, installAttachmentLifecycleHooks } from './attachment-lifecycle.js';
import {
  installAttachmentAccessHooks,
  type AttachmentSecurityLike,
  type AttachmentSharingLike,
} from './attachment-access-hooks.js';

const DAY_MS = 86_400_000;
const SYS = { context: { isSystem: true } } as const;
const UPLOADER = 'usr_uploader';
const SOMEONE_ELSE = 'usr_someone_else';

type Verdict = Awaited<ReturnType<AttachmentSharingLike['checkEdit']>>;
type MasterOutcome = Awaited<ReturnType<NonNullable<AttachmentSecurityLike['checkControlledByParentWrite']>>>;

function recordingLogger() {
  const logger = {
    info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn(),
    trace: vi.fn(), fatal: vi.fn(),
    child() { return logger; },
  };
  return logger;
}

let engine: ObjectQL | undefined;

afterEach(async () => {
  // Closes the `:memory:` database with the engine that owns it.
  try { await engine?.destroy(); } catch { /* already torn down */ }
  engine = undefined;
});

/**
 * A real engine with the storage lifecycle hooks and the attach gate installed
 * exactly as `StorageServicePlugin` installs them. `sharing === null` is the
 * degraded mode (no sharing service at all). `gate.verdict` / `gate.master`
 * are read per check, so a test can change the answer between two attaches —
 * a grant that changes between a refusal and the client's retry.
 */
async function boot(opts: { verdict?: Verdict; master?: MasterOutcome; sharing?: null } = {}) {
  const gate = { verdict: opts.verdict ?? ('deny' as Verdict), master: opts.master };
  const logger = recordingLogger();
  const ql = new ObjectQL({ logger: recordingLogger() } as any);
  const driver = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  }) as any;
  const beginTransaction = vi.spyOn(driver, 'beginTransaction');
  ql.registerDriver(driver, true);
  await ql.init();
  engine = ql;

  // The REAL sys_file schema, so the sweep below reads its DECLARED lifecycle
  // (`ttl` on `deleted_at`, `retention` on `pending`) — not a copy of it.
  ql.registry.registerObject(SystemFile as any, 'test-22466');
  ql.registry.registerObject({
    name: 'sys_attachment',
    fields: {
      file_id: { type: 'text' }, parent_object: { type: 'text' }, parent_id: { type: 'text' },
      uploaded_by: { type: 'text' },
    },
  } as any, 'test-22466');
  ql.registry.registerObject({ name: 'att_parent', fields: { name: { type: 'text' } } } as any, 'test-22466');
  await ql.syncSchemas();

  installAttachmentLifecycleHooks(ql as any, logger);
  const sharing: AttachmentSharingLike | null =
    opts.sharing === null ? null : { checkEdit: async () => gate.verdict };
  const security: AttachmentSecurityLike = {
    checkControlledByParentWrite: async () => gate.master ?? { outcome: 'not_applicable' },
  };
  installAttachmentAccessHooks(ql as any, () => sharing, logger, undefined, () => security);

  await ql.insert('att_parent', { id: 'p1', name: 'parent' } as any, SYS as any);
  beginTransaction.mockClear();
  return { ql, gate, logger, beginTransaction };
}

/** A `sys_file` row as the presigned upload leaves it: committed, attachments-scope, uploader stamped. */
async function seedFile(ql: ObjectQL, id: string, extra: Record<string, unknown> = {}) {
  await ql.insert('sys_file', {
    id, key: `attachments/${id}.bin`, name: `${id}.txt`, scope: 'attachments',
    status: 'committed', owner_id: UPLOADER, ...extra,
  } as any, SYS as any);
}

const file = (ql: ObjectQL, id: string) => ql.findOne('sys_file', { where: { id }, ...SYS } as any) as Promise<any>;
const joinRows = (ql: ObjectQL, id: string) => ql.find('sys_attachment', { where: { file_id: id }, ...SYS } as any);

/** The generic insert the `/data` create door issues for the console's attach. */
const attach = (ql: ObjectQL, fileId: string, userId = UPLOADER, parentId = 'p1') =>
  ql.insert(
    'sys_attachment',
    { parent_object: 'att_parent', parent_id: parentId, file_id: fileId } as any,
    { context: { userId } } as any,
  );

const rejection = (p: Promise<unknown>) => p.then(() => { throw new Error('expected a refusal'); }, (e: any) => e);

/**
 * The verdict the detached run ends on for `fileId` — the debug line it
 * writes whichever way it went. Waiting on it is waiting on the run itself.
 * A run that FAILED writes a warn instead and no verdict; the wait then ends
 * (inside vitest's own test timeout) naming the warn, so a red here says why.
 */
async function runVerdict(logger: ReturnType<typeof recordingLogger>, fileId: string): Promise<string> {
  const marker = `refused attach of sys_file ${fileId} — `;
  return vi.waitFor(
    () => {
      const line = logger.debug.mock.calls.map((c) => String(c[0])).find((m) => m.includes(marker));
      if (!line) {
        const warns = logger.warn.mock.calls.map((c) => String(c[0]));
        throw new Error(`no run verdict for sys_file ${fileId}; warn lines: ${JSON.stringify(warns)}`);
      }
      return line.slice(line.indexOf(marker) + marker.length);
    },
    { timeout: 3_000, interval: 5 },
  );
}

const REFUSAL = { code: 'ATTACHMENT_PARENT_ACCESS', status: 403, object: 'att_parent' };

describe('a refused attach tombstones the uploader\'s never-attached file — one refusal per leg', () => {
  const LEGS: Array<{ leg: string; opts: Parameters<typeof boot>[0]; parentId?: string }> = [
    { leg: 'sharing deny', opts: { verdict: 'deny' } },
    { leg: 'sharing non-verdict (fail closed)', opts: { verdict: 'not-a-verdict' as unknown as Verdict } },
    {
      leg: 'master-detail check deny (controlled_by_parent)',
      opts: { verdict: 'abstain', master: { outcome: 'deny', leg: 'record_sharing' } as MasterOutcome },
    },
    {
      leg: 'master-detail check unresolvable (controlled_by_parent)',
      opts: { verdict: 'abstain', master: { outcome: 'unresolvable', reason: 'record_not_found' } as MasterOutcome },
    },
    // No sharing service: the gate asks parent READ visibility, and a parent
    // the caller cannot read (here: none by that id) is refused.
    { leg: 'degraded mode — no sharing service, parent not readable', opts: { sharing: null }, parentId: 'p_missing' },
  ];

  for (const { leg, opts, parentId } of LEGS) {
    it(`${leg}: refused 403, then the file is tombstoned with no join row`, async () => {
      const { ql, logger } = await boot(opts);
      await seedFile(ql, 'f1');

      const err = await rejection(attach(ql, 'f1', UPLOADER, parentId));
      expect(err).toMatchObject(REFUSAL);

      expect(await runVerdict(logger, 'f1')).toBe('tombstoned');
      const row = await file(ql, 'f1');
      expect(row).toMatchObject({ id: 'f1', status: 'deleted' });
      expect(row.deleted_at, 'deleted_at is what the declared ttl reads').toBeTruthy();
      expect(await joinRows(ql, 'f1')).toHaveLength(0);
    });
  }

  it('the platform sweep reclaims it: past the 30d ttl the reap guard deletes the bytes and the row', async () => {
    const { ql, logger, gate } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f_refused');
    await seedFile(ql, 'f_attached'); // control: attached, committed — must survive the sweep

    await rejection(attach(ql, 'f_refused'));
    expect(await runVerdict(logger, 'f_refused')).toBe('tombstoned');
    gate.verdict = 'allow';
    await attach(ql, 'f_attached');

    const storage = { delete: vi.fn(async () => {}) };
    const lifecycle = new LifecycleService({
      getEngine: () => ql as any,
      logger: { info: () => {}, warn: () => {}, debug: () => {} },
      now: () => Date.now() + 31 * DAY_MS,
      referenceAudit: { enabled: false },
    });
    lifecycle.registerReapGuard('sys_file', createSysFileReapGuard(ql as any, () => storage as any, logger));
    const report = await lifecycle.sweep();

    expect(report.errors, JSON.stringify(report.errors)).toEqual([]);
    expect(await file(ql, 'f_refused'), 'the row is reaped').toBeNull();
    expect(storage.delete).toHaveBeenCalledTimes(1);
    expect(storage.delete).toHaveBeenCalledWith('attachments/f_refused.bin');
    expect(await file(ql, 'f_attached')).toMatchObject({ status: 'committed' });
  });
});

describe('the tombstone is written outside the refused write\'s unit of work', () => {
  it('the generic insert opens no transaction: the refusal throws in `beforeInsert` with none open, and the tombstone lands', async () => {
    const { ql, logger, beginTransaction } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f1');

    await rejection(attach(ql, 'f1'));

    expect(beginTransaction, 'no transaction around the generic insert').not.toHaveBeenCalled();
    expect(await runVerdict(logger, 'f1')).toBe('tombstoned');
    expect(await file(ql, 'f1')).toMatchObject({ status: 'deleted' });
  });

  it('inside a CALLER\'s transaction that the refusal rolls back, the tombstone survives the rollback', async () => {
    const { ql, logger, beginTransaction } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f1');

    const err = await rejection(
      ql.transaction(async (trx: any) => {
        // A write the caller made in the same unit of work — the control that
        // the rollback is real.
        await ql.insert('att_parent', { id: 'p_in_tx', name: 'rolled back' } as any, { context: { ...trx, isSystem: true } } as any);
        return ql.insert(
          'sys_attachment',
          { parent_object: 'att_parent', parent_id: 'p1', file_id: 'f1' } as any,
          { context: { ...trx, userId: UPLOADER } } as any,
        );
      }),
    );
    expect(err).toMatchObject(REFUSAL);
    expect(beginTransaction, 'the caller really opened a transaction').toHaveBeenCalledTimes(1);

    expect(await runVerdict(logger, 'f1')).toBe('tombstoned');
    expect(await ql.findOne('att_parent', { where: { id: 'p_in_tx' }, ...SYS } as any), 'the caller\'s unit of work rolled back').toBeNull();
    expect(await file(ql, 'f1'), 'the tombstone was not in it').toMatchObject({ status: 'deleted' });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('controls — what this path never tombstones', () => {
  it('an ADMITTED attach leaves the file committed and attached', async () => {
    const { ql, logger } = await boot({ verdict: 'allow' });
    await seedFile(ql, 'f1');

    await expect(attach(ql, 'f1')).resolves.toBeDefined();
    // Two event-loop turns: past the turn a scheduled run would start on.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(await file(ql, 'f1')).toMatchObject({ status: 'committed' });
    expect((await file(ql, 'f1')).deleted_at ?? null).toBeNull();
    expect(await joinRows(ql, 'f1')).toHaveLength(1);
    expect(logger.debug.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('refused attach'))).toEqual([]);
  });

  it('a file referenced through `ref_*` (field-file lineage) is never tombstoned by this path', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f_ref', { ref_object: 'contract', ref_id: 'c1', ref_field: 'signed_pdf' });

    await rejection(attach(ql, 'f_ref'));

    expect(await runVerdict(logger, 'f_ref')).toBe('kept: still held (field-owner)');
    expect(await file(ql, 'f_ref')).toMatchObject({ status: 'committed' });
  });

  it('a field-file scope is never tombstoned by this path', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f_field', { scope: 'user' });

    await rejection(attach(ql, 'f_field'));

    expect(await runVerdict(logger, 'f_field')).toBe('kept: not a committed attachments-scope file');
    expect(await file(ql, 'f_field')).toMatchObject({ status: 'committed' });
  });

  it('a refused caller who is NOT the file\'s uploader moves nothing', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f1');

    await rejection(attach(ql, 'f1', SOMEONE_ELSE));

    expect(await runVerdict(logger, 'f1')).toBe('kept: the refused caller is not its uploader');
    expect(await file(ql, 'f1')).toMatchObject({ status: 'committed' });
  });

  it('a file still attached elsewhere is not tombstoned when another attach of it is refused', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f1');
    await ql.insert('sys_attachment', { parent_object: 'att_parent', parent_id: 'p1', file_id: 'f1' } as any, SYS as any);

    await rejection(attach(ql, 'f1'));

    expect(await runVerdict(logger, 'f1')).toBe('kept: still held (attachment)');
    expect(await file(ql, 'f1')).toMatchObject({ status: 'committed' });
  });

  it('a pending upload is left to its own retention, and an unknown file id writes nothing', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f_pending', { status: 'pending' });

    await rejection(attach(ql, 'f_pending'));
    await rejection(attach(ql, 'f_nowhere'));

    expect(await runVerdict(logger, 'f_pending')).toBe('kept: not a committed attachments-scope file');
    expect(await runVerdict(logger, 'f_nowhere')).toBe('kept: no such file');
    expect(await file(ql, 'f_pending')).toMatchObject({ status: 'pending' });
    expect(await file(ql, 'f_nowhere')).toBeNull();
  });
});

describe('a client retry of the same file_id inside the 30-day window gets a clear answer', () => {
  it('admitted on retry: attached, and the tombstone is revived — the re-attach revival, unchanged', async () => {
    const { ql, logger, gate } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f1');
    await rejection(attach(ql, 'f1'));
    expect(await runVerdict(logger, 'f1')).toBe('tombstoned');

    gate.verdict = 'allow'; // the grant changed between the refusal and the retry
    await expect(attach(ql, 'f1')).resolves.toBeDefined();

    const row = await file(ql, 'f1');
    expect(row).toMatchObject({ status: 'committed' });
    expect(row.deleted_at ?? null).toBeNull();
    expect(await joinRows(ql, 'f1')).toHaveLength(1);
  });

  it('refused on retry: the same refusal, and the file stays tombstoned — the first tombstone untouched', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f1');
    const first = await rejection(attach(ql, 'f1'));
    expect(await runVerdict(logger, 'f1')).toBe('tombstoned');
    const { deleted_at: firstTombstone } = await file(ql, 'f1');

    logger.debug.mockClear();
    const second = await rejection(attach(ql, 'f1'));

    expect({ code: second.code, status: second.status, message: second.message, object: second.object }).toEqual({
      code: first.code, status: first.status, message: first.message, object: first.object,
    });
    expect(await runVerdict(logger, 'f1')).toBe('kept: not a committed attachments-scope file');
    expect(await file(ql, 'f1')).toMatchObject({ status: 'deleted', deleted_at: firstTombstone });
  });
});

describe('the refusal itself is unchanged, and names nothing about the file', () => {
  it('the same envelope for the caller\'s own file, another user\'s file and an unknown id', async () => {
    const { ql, logger } = await boot({ verdict: 'deny' });
    await seedFile(ql, 'f_own');
    await seedFile(ql, 'f_theirs', { owner_id: SOMEONE_ELSE });

    const shape = (e: any) => ({
      name: e.name, code: e.code, status: e.status, message: e.message, object: e.object,
      keys: Object.keys(e).sort(),
    });
    const own = shape(await rejection(attach(ql, 'f_own')));
    const theirs = shape(await rejection(attach(ql, 'f_theirs')));
    const unknown = shape(await rejection(attach(ql, 'f_unknown')));

    expect(theirs).toEqual(own);
    expect(unknown).toEqual(own);
    for (const id of ['f_own', 'f_theirs', 'f_unknown']) {
      expect(JSON.stringify(own)).not.toContain(id);
    }
    // Only the caller's own file moved.
    expect(await runVerdict(logger, 'f_own')).toBe('tombstoned');
    expect(await runVerdict(logger, 'f_theirs')).toBe('kept: the refused caller is not its uploader');
    expect(await file(ql, 'f_theirs')).toMatchObject({ status: 'committed' });
  });
});
