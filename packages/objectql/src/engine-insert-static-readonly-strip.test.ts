// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #14147 — a static `readonly` field is stripped from a NON-SYSTEM caller's
// INSERT payload INSIDE `engine.insert`, exactly as on `engine.update`.
//
// ## The measurement this file inverts
//
// Reported from an application against 17.2.0, on a real booted kernel:
//
//   write face                             context           forged readonly col
//   ------------------------------------   ---------------   -------------------
//   MetadataProtocolService.createData     none              stripped
//   MetadataProtocolService.createData     { isSystem:false } stripped
//   MetadataProtocolService.createData     { isSystem:true }  preserved (intended)
//   engine.insert (the `data` service)     none              PRESERVED  ← the hole
//
// The create-side strip lived at the DataProtocol ingress
// (`stripReadonlyForInsert`, #3043) while the update-side one lived in the
// engine (`stripReadonlyFields`, #2948). So `readonly` meant one thing on
// insert and another on update, three consequences followed —
//
//   1. a non-system caller reaching `engine.insert` DIRECTLY wrote the column
//      with no refusal, no WARN and no `onFieldsDropped` event;
//   2. `assertReferencesResolve`'s own doc sentence ("like every other
//      write-path guard in this engine") was false about the create path;
//   3. `create_record` (`@objectstack/service-automation`) passes
//      `onFieldsDropped` to `data.insert` and surfaces `output.droppedFields` +
//      node `warnings` — a channel that could never carry a readonly drop.
//
// **Maintainer ruling, 2026-09-03 (option C)** — presented as overturning their
// own 2026-07-24 "INSERT (all callers) exempt" row, verbatim 「同意」: one
// semantics, one enforcement point. `stripReadonlyFields` runs on both write
// paths, `isSystem`-gated, with the same `onFieldsDropped` / warn behaviour;
// seeding a readonly column at create time is done under system context, the
// exemption the 2026-07-24 table already grants. The boundary copy is DELETED
// rather than kept as a second implementation.
//
// ## What this file must keep telling apart
//
// The strip is a FORGERY strip, not a column ban. Three exemptions are
// load-bearing and each has a pin below: `isSystem`; a server-side stamp (a
// `beforeInsert` hook's own write is not caller-supplied); and the platform
// objects whose own 403 guards a silent strip must not pre-empt (ADR-0086 /
// #3004 — carried over from the deleted copy, and NOT part of what ruling C
// superseded). Two neighbouring rules must stay where they are: `preserveAudit`
// is an UPDATE-path exemption (maintainer, 2026-08-08) and `readonlyWhen` has no
// prior record on a create, so both keep their INSERT posture unchanged.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import type { DroppedFieldsEvent } from '@objectstack/spec/data';

function makeCapturingLogger() {
  const lines: Array<{ level: string; msg: string }> = [];
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug() {}, info() {},
    warn(msg: string) { lines.push({ level: 'warn', msg: String(msg) }); },
    error(msg: string) { lines.push({ level: 'error', msg: String(msg) }); },
    child() { return logger; },
  };
  return logger;
}

/** Records what actually reaches the driver — the payload is the verdict. */
function makeRecordingDriver() {
  const creates: Array<Record<string, unknown>> = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) {
      creates.push({ ...data });
      return { id: 'rec_1', ...data };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => driver.create(o, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, creates };
}

/**
 * `completed_at` is the application-reported shape (an author-declared business
 * `readonly` column). `approval_status` is #3043's original attack target and
 * carries a `defaultValue`, so a stripped forgery falls back to the enforced
 * initial state rather than to NULL. `account_number` is the RUNTIME-owned type
 * whose own pass must keep owning it, and `locked_note` is the second
 * author-declared column used for the batch/multi-key cases.
 */
async function makeEngine(objectName = 'duly_task') {
  const logger = makeCapturingLogger();
  const engine = new ObjectQL({ logger });
  const { driver, creates } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: objectName,
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true },
      title: { name: 'title', type: 'text' },
      completed_at: { name: 'completed_at', type: 'datetime', readonly: true },
      approval_status: { name: 'approval_status', type: 'text', readonly: true, defaultValue: 'draft' },
      locked_note: { name: 'locked_note', type: 'text', readonly: true },
      account_number: { name: 'account_number', type: 'autonumber' },
      status: { name: 'status', type: 'text' },
      frozen_total: { name: 'frozen_total', type: 'number', readonlyWhen: "record.status == 'paid'" },
    },
  } as any, 'test');
  return { engine, creates, logger };
}

interface Observed {
  readonly created: Record<string, unknown> | undefined;
  readonly creates: number;
  readonly dropped: DroppedFieldsEvent[];
  readonly warns: string[];
  readonly refusedCode: string | null;
}

async function observeInsert(
  data: unknown,
  options: Record<string, unknown> = {},
  arrange?: (engine: ObjectQL) => void,
): Promise<Observed> {
  const { engine, creates, logger } = await makeEngine();
  arrange?.(engine);
  const dropped: DroppedFieldsEvent[] = [];
  let refusedCode: string | null = null;
  try {
    await engine.insert('duly_task', data as any, {
      onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); },
      ...options,
    } as any);
  } catch (e: any) {
    refusedCode = e?.code ?? e?.name ?? null;
  }
  return {
    created: creates[0],
    creates: creates.length,
    dropped,
    warns: logger.lines.filter((l: any) => l.level === 'warn').map((l: any) => l.msg),
    refusedCode,
  };
}

describe('#14147 — THE REPRO, inverted: engine.insert enforces static readonly', () => {
  it('a NO-CONTEXT caller no longer writes the readonly column — the application’s exact shape', async () => {
    const o = await observeInsert({ title: 'T', completed_at: '2019-04-01T00:00:00Z' });
    expect(o.creates, 'the write still succeeds — a strip shrinks the payload, it does not refuse').toBe(1);
    expect(o.created, 'the forged column never reaches the driver').not.toHaveProperty('completed_at');
    expect(o.created?.title).toBe('T');
  });

  it('an explicitly NON-system caller is judged identically', async () => {
    const o = await observeInsert(
      { title: 'T', completed_at: '2019-04-01T00:00:00Z' },
      { context: { isSystem: false, userId: 'u1' } },
    );
    expect(o.created).not.toHaveProperty('completed_at');
  });

  it('reports the drop through onFieldsDropped — the channel create_record was wired for', async () => {
    const o = await observeInsert({ title: 'T', completed_at: 'x', approval_status: 'approved' });
    expect(o.dropped).toHaveLength(1);
    expect(o.dropped[0].object).toBe('duly_task');
    expect(o.dropped[0].reason, 'the same vocabulary the update path reports under').toBe('readonly');
    expect([...o.dropped[0].fields].sort()).toEqual(['approval_status', 'completed_at']);
  });

  it('WARNs at `warn`, naming the field — and every claim the line makes is true of a CREATE', async () => {
    const o = await observeInsert({ title: 'T', completed_at: 'x' });
    const line = o.warns.find((m) => m.includes('completed_at'));
    expect(line, 'a silent drop is the #4632 second-class shape this ruling closes').toBeDefined();
    expect(line).toContain('duly_task');
    // The update-path message would have said three things that are false here.
    // #8141/#8214's rule: a strip line may state only what is true of the call
    // in front of it, and a remedy it names must be one that would have worked.
    expect(line, 'this is a create, and the column takes its default rather than keeping a stored value')
      .toContain('the create is being COMMITTED WITHOUT IT');
    expect(line).toContain('beforeInsert');
    expect(line, '⛔ preserveAudit is UPDATE-only — offering it here is the #8141 defect')
      .not.toContain('preserveAudit: true');
  });

  it('a stripped forgery falls back to the field’s defaultValue, not to NULL', async () => {
    const o = await observeInsert({ title: 'T', approval_status: 'approved' });
    expect(o.created?.approval_status, 'the enforced initial state, re-derived by the engine').toBe('draft');
  });
});

describe('#14147 — the exemptions, each one load-bearing', () => {
  it('isSystem seeds the readonly column — the exemption the ruling names', async () => {
    const o = await observeInsert(
      { title: 'T', completed_at: '2019-04-01T00:00:00Z' },
      { context: { isSystem: true } },
    );
    expect(o.created?.completed_at, 'seed replay / runAs:system / system hooks').toBe('2019-04-01T00:00:00Z');
    expect(o.dropped, 'nothing was dropped, so nothing is reported').toEqual([]);
  });

  it('a beforeInsert hook’s OWN stamp survives — only CALLER-supplied keys are candidates', async () => {
    const o = await observeInsert({ title: 'T' }, {}, (engine) => {
      engine.registerHook('beforeInsert', async (ctx: any) => {
        ctx.input.data.completed_at = '2026-01-01T00:00:00Z';
      });
    });
    expect(o.created?.completed_at, 'a server-side stamp is not a forgery').toBe('2026-01-01T00:00:00Z');
    expect(o.dropped).toEqual([]);
  });

  it('...and it survives even when the caller ECHOED the same key back (#14259’s record)', async () => {
    const o = await observeInsert({ title: 'T', completed_at: 'forged' }, {}, (engine) => {
      engine.registerHook('beforeInsert', async (ctx: any) => {
        ctx.input.data.completed_at = '2026-01-01T00:00:00Z';
      });
    });
    expect(o.created?.completed_at, 'the hook wrote it — provenance, not value equality').toBe('2026-01-01T00:00:00Z');
  });

  it('a PLATFORM object is left to its own 403 guard (ADR-0086 / #3004, carried over)', async () => {
    // `managedBy` / the reserved `sys_` namespace carry dedicated write
    // governance — a forged `managed_by: 'package'` is REFUSED, and silently
    // stripping it would swallow the payload that guard exists to reject. That
    // boundary was ruled on its own merits and is NOT the row ruling C
    // superseded, so it comes across with the strip.
    const logger = makeCapturingLogger();
    const engine = new ObjectQL({ logger });
    const { driver, creates } = makeRecordingDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'sys_permission_set',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        managed_by: { name: 'managed_by', type: 'text', readonly: true },
      },
    } as any, 'test');
    engine.registry.registerObject({
      name: 'crm_thing',
      managedBy: 'package',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        locked: { name: 'locked', type: 'text', readonly: true },
      },
    } as any, 'test');
    await engine.insert('sys_permission_set', { managed_by: 'package' }, { context: { userId: 'u1' } } as any);
    await engine.insert('crm_thing', { locked: 'forged' }, { context: { userId: 'u1' } } as any);
    expect(creates[0].managed_by, 'sys_ object: passed through to its guard').toBe('package');
    expect(creates[1].locked, 'managedBy object: passed through to its guard').toBe('forged');
  });
});

describe('#14147 — the neighbouring rules keep their INSERT posture', () => {
  it('preserveAudit does NOT exempt a static readonly on create (maintainer, 2026-08-08)', async () => {
    const o = await observeInsert(
      { title: 'T', completed_at: '2019-04-01T00:00:00Z' },
      { context: { userId: 'importer', preserveAudit: true } },
    );
    expect(o.created, 'the historical-import exemption is an UPDATE-path rule').not.toHaveProperty('completed_at');
    const line = o.warns.find((m) => m.includes('preserveAudit is UPDATE-only'));
    expect(line, 'the request is refused OUT LOUD, not silently').toBeDefined();
    expect(line).toContain('completed_at');
    expect(line).toContain('context.isSystem');
    expect(line).toContain('#6640');
  });

  it('...but preserveAudit still reinstates a RUNTIME-owned autonumber (#3493/#5503)', async () => {
    const o = await observeInsert(
      { title: 'T', account_number: 'LEGACY-7' },
      { context: { userId: 'importer', preserveAudit: true } },
    );
    expect(o.created?.account_number, 'the runtime-owned pass owns this key, with the wider whitelist')
      .toBe('LEGACY-7');
    expect(o.warns.filter((m) => m.includes('preserveAudit is UPDATE-only')),
      'nothing static was stripped, so the line has nothing to report').toEqual([]);
  });

  it('a caller-seeded autonumber is still reported as RUNTIME-owned, not as an author lock', async () => {
    const o = await observeInsert({ title: 'T', account_number: 'FORGED-1' });
    // Stripped and then RE-ISSUED from the sequence (`applyAutonumbers` runs
    // after validation), so the assertion is on the forgery, not on the key.
    expect(o.created?.account_number, 'the runtime-owned strip is unchanged by this card')
      .not.toBe('FORGED-1');
    const line = o.warns.find((m) => m.includes('account_number'));
    expect(line, 'its own message states the true, actionable reason — not an author-declared lock')
      .toContain('autonumber');
  });

  it('readonlyWhen stays INSERT-exempt — a conditional lock has no prior record on a create', async () => {
    const o = await observeInsert({ title: 'T', status: 'paid', frozen_total: 99 });
    expect(o.created?.frozen_total, 'unchanged by this card').toBe(99);
  });
});

describe('#14147 — strictReadonlyWrites refuses before any driver dispatch', () => {
  it('ERR_READONLY_FIELD_REJECTED, zero creates, and the listener deliberately silent', async () => {
    const o = await observeInsert(
      { title: 'T', completed_at: 'forged' },
      { strictReadonlyWrites: true },
    );
    expect(o.refusedCode).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(o.creates, 'refused BEFORE the driver — nothing was written').toBe(0);
    expect(o.dropped, 'a refused write did not complete, so `dropped and committed` must not fire').toEqual([]);
  });

  it('strict adds NO second policy — an isSystem write it would not strip is still accepted', async () => {
    const o = await observeInsert(
      { title: 'T', completed_at: 'x' },
      { strictReadonlyWrites: true, context: { isSystem: true } },
    );
    expect(o.refusedCode).toBeNull();
    expect(o.creates).toBe(1);
  });
});

describe('#14147 — the batch path is judged per row', () => {
  it('strips only the rows that forged, and reports the batch union once', async () => {
    const { engine, creates, logger } = await makeEngine();
    const dropped: DroppedFieldsEvent[] = [];
    await engine.insert('duly_task', [
      { title: 'A', completed_at: 'forged' },
      { title: 'B' },
      { title: 'C', locked_note: 'forged' },
    ] as any, { onFieldsDropped: (e: DroppedFieldsEvent) => { dropped.push(e); } } as any);
    expect(creates).toHaveLength(3);
    expect(creates[0]).not.toHaveProperty('completed_at');
    expect(creates[1].title).toBe('B');
    expect(creates[2]).not.toHaveProperty('locked_note');
    expect(dropped, 'one event per CALL — the listener signature carries no row index').toHaveLength(1);
    expect([...dropped[0].fields].sort()).toEqual(['completed_at', 'locked_note']);
    expect(logger.lines.filter((l: any) => l.level === 'warn').length).toBeGreaterThan(0);
  });
});
