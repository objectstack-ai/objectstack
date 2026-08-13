// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8214 — the strip's WARN line must not promise a commit that
// `strictReadonlyWrites` refuses.
//
// The strip logs from inside `stripReadonlyFields` / `stripRuntimeOwnedFields`;
// `assertNoStrictDrops()` (update) and the `ReadonlyFieldRejectedError` throw
// (insert) come AFTERWARDS, before any driver call. So a strict caller was told
// in prose that the write had been "COMMITTED WITHOUT IT" while nothing at all
// had been written — the #4632 shape inverted, sending a reader debugging from
// the log alone to hunt for a row that was never touched.
//
// Measured on `origin/main` @ 29488ccae, real `ObjectQL` + the recording driver
// below, before the fix:
//
//   UPDATE  { strictReadonlyWrites: true }, caller forges `locked_note`
//     refusedCode     ERR_READONLY_FIELD_REJECTED
//     driverWrites    0
//     warnLines       1
//     claimsCommitted true      ← the line said "COMMITTED WITHOUT IT"
//
//   INSERT  { strictReadonlyWrites: true }, caller seeds `account_number`
//     refusedCode     ERR_READONLY_FIELD_REJECTED
//     driverCreates   0
//     warnLines       1
//     claimsCommitted true      ← same claim, `runtimeOwnedStripWarning`
//
// The insert half was filed UNVERIFIED and is verified here: it reproduces, on
// the same sequencing, so it is the same defect and not a lookalike.
//
// ⛔ What this suite must never be read as licence for: DROPPING the line in
// strict mode. The level argument in `readonlyStripWarning`'s own docblock is
// that `warn` exists so real forgery attempts stay visible, and a forged write
// that got refused is the case that most deserves a line. Every case below that
// asserts the claim is gone has a sibling asserting the LINE is still there, at
// `warn`, naming the field. "Stopped lying" and "stopped warning" are the two
// outcomes this file exists to tell apart.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { readonlyStripWarning, runtimeOwnedStripWarning } from './validation/rule-validator.js';

function makeCapturingLogger() {
  const lines: Array<{ level: string; msg: string }> = [];
  const logger: any = {
    lines,
    trace() {}, fatal() {},
    debug(msg: string) { lines.push({ level: 'debug', msg: String(msg) }); },
    info(msg: string) { lines.push({ level: 'info', msg: String(msg) }); },
    warn(msg: string) { lines.push({ level: 'warn', msg: String(msg) }); },
    error(msg: string) { lines.push({ level: 'error', msg: String(msg) }); },
    child() { return logger; },
  };
  return logger;
}

/** Records every payload that actually reaches the driver — `0` is the point. */
function makeRecordingDriver() {
  const writes: Array<{ fn: string; data: Record<string, unknown> }> = [];
  const row = { id: 'rec_1', value: 'v0', locked_note: 'n0', title: 't0' };
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [{ ...row }]; },
    async findOne() { return { ...row }; },
    async create(_o: string, data: Record<string, unknown>) {
      writes.push({ fn: 'create', data: { ...data } });
      return { id: 'rec_1', ...data };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) {
      writes.push({ fn: 'update', data: { ...data } });
      return { ...row, ...data, id };
    },
    async updateMany(_o: string, _ast: unknown, data: Record<string, unknown>) {
      writes.push({ fn: 'updateMany', data: { ...data } });
      return 2;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 1; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => driver.create(o, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

/**
 * `id` is `readonly` and `locked_note` is an author-declared business readonly
 * field, mirroring every platform object (`sys_user_preference`'s `id` is
 * `Field.text({ …, readonly: true })`). `organization_id` is the `system`
 * tenancy column — the field `preserveAudit` does NOT rescue, which is what
 * makes it the control for the remedy half.
 */
async function makeEngine() {
  const logger = makeCapturingLogger();
  const engine = new ObjectQL({ logger });
  const { driver, writes } = makeRecordingDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'pref',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
      value: { name: 'value', type: 'text' },
      locked_note: { name: 'locked_note', type: 'text', readonly: true },
      organization_id: { name: 'organization_id', type: 'text', readonly: true, system: true },
      account_number: { name: 'account_number', type: 'autonumber' },
      title: { name: 'title', type: 'text' },
    },
  } as any, 'test');
  return { engine, writes, logger };
}

interface Observed {
  readonly refusedCode: string | null;
  readonly driverWrites: number;
  readonly warns: string[];
  /** Every non-debug/info line, level included. */
  readonly lines: Array<{ level: string; msg: string }>;
}

/**
 * The level of the STRIP's own line, isolated from the engine's pre-existing
 * `'Update operation failed'` / `'Insert operation failed'` ERROR — which a
 * strict refusal legitimately emits, because the caller really was handed a
 * failure. The two lines are different facts and this suite must not conflate
 * them: the strip's line stays at `warn` (its docblock argues that level), and
 * the operation-level error is nobody's business here.
 */
function stripLineLevels(o: Observed): string[] {
  return o.lines
    .filter((l) => !/^(Update|Insert) operation failed$/.test(l.msg))
    .map((l) => l.level);
}

async function observeUpdate(data: unknown, options: Record<string, unknown>): Promise<Observed> {
  const { engine, writes, logger } = await makeEngine();
  let refusedCode: string | null = null;
  try {
    await engine.update('pref', data as any, options as any);
  } catch (e: any) {
    refusedCode = e?.code ?? e?.name ?? null;
  }
  return {
    refusedCode,
    driverWrites: writes.length,
    warns: logger.lines.filter((l: any) => l.level === 'warn').map((l: any) => l.msg),
    lines: logger.lines.filter((l: any) => l.level !== 'debug' && l.level !== 'info'),
  };
}

async function observeInsert(data: unknown, options: Record<string, unknown> = {}): Promise<Observed> {
  const { engine, writes, logger } = await makeEngine();
  let refusedCode: string | null = null;
  try {
    await engine.insert('pref', data as any, options as any);
  } catch (e: any) {
    refusedCode = e?.code ?? e?.name ?? null;
  }
  return {
    refusedCode,
    driverWrites: writes.filter((w) => w.fn === 'create').length,
    warns: logger.lines.filter((l: any) => l.level === 'warn').map((l: any) => l.msg),
    lines: logger.lines.filter((l: any) => l.level !== 'debug' && l.level !== 'info'),
  };
}

describe('#8214 — a strict refusal is not reported as a commit (UPDATE)', () => {
  it('THE REPRO, inverted: refused, nothing written, and the line no longer claims a commit', async () => {
    const o = await observeUpdate(
      { id: 'rec_1', value: 'v1', locked_note: 'forged' },
      { where: { id: 'rec_1' }, strictReadonlyWrites: true },
    );
    // The three facts the log has to agree with, unchanged by this card.
    expect(o.refusedCode).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(o.driverWrites).toBe(0);
    // …and the fourth, which is what moved.
    expect(o.warns).toHaveLength(1);
    expect(o.warns[0]).not.toContain('COMMITTED WITHOUT IT');
    expect(o.warns[0]).toContain('REFUSED ENTIRELY');
    expect(o.warns[0]).toContain('ERR_READONLY_FIELD_REJECTED');
    // Byte-identical to the exported composer, so the wording lives in ONE
    // place and a future edit cannot drift the log away from its own pin.
    expect(o.warns[0]).toBe(
      readonlyStripWarning('locked_note', 'pref', { strict: true, preserveAuditApplies: true }),
    );
  });

  it('THE COUNTER-CASE: strict did not silence the forgery signal', async () => {
    // Without this, "the message stopped lying" is indistinguishable from "the
    // message stopped warning" — the failure the card explicitly forbids.
    const o = await observeUpdate(
      { id: 'rec_1', value: 'v1', locked_note: 'forged' },
      { where: { id: 'rec_1' }, strictReadonlyWrites: true },
    );
    expect(o.warns).toHaveLength(1);
    expect(stripLineLevels(o)).toEqual(['warn']); // the level its docblock argues
    // …and the refusal itself is reported separately, at `error`, by the
    // engine — two lines, two facts, neither pretending to be the other.
    expect(o.lines.some((l) => l.level === 'error' && l.msg === 'Update operation failed')).toBe(true);
    expect(o.warns[0]).toContain("Field 'locked_note'");  // the field, named
    expect(o.warns[0]).toContain('{ context: { isSystem: true } }'); // a remedy
  });

  it('the DEFAULT strip is untouched — "COMMITTED WITHOUT IT" is true there and stays', async () => {
    const o = await observeUpdate(
      { id: 'rec_1', value: 'v1', locked_note: 'forged' },
      { where: { id: 'rec_1' } },
    );
    expect(o.refusedCode).toBeNull();
    expect(o.driverWrites).toBe(1);
    expect(o.warns).toEqual([
      readonlyStripWarning('locked_note', 'pref', { preserveAuditApplies: true }),
    ]);
    expect(o.warns[0]).toContain('COMMITTED WITHOUT IT');
  });

  it('the MULTI branch reports strict the same way', async () => {
    // The multi branch runs its own strip call and its own `assertNoStrictDrops`
    // — a fix threaded through only the by-id call site would leave this one
    // still claiming a commit, so it is pinned separately rather than assumed.
    const o = await observeUpdate(
      { locked_note: 'forged', value: 'v1' },
      { multi: true, where: { title: 't0' }, strictReadonlyWrites: true },
    );
    expect(o.refusedCode).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(o.driverWrites).toBe(0);
    expect(o.warns).toEqual([
      readonlyStripWarning('locked_note', 'pref', { strict: true, preserveAuditApplies: true }),
    ]);
  });
});

describe('#8214 — the INSERT side carries the identical defect (the card marked it UNVERIFIED)', () => {
  it('REPRODUCED then FIXED: refused, zero creates, and no claim of a commit', async () => {
    const o = await observeInsert({ title: 't', account_number: 'ACC-888888' }, { strictReadonlyWrites: true });
    expect(o.refusedCode).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(o.driverWrites).toBe(0);
    expect(o.warns).toHaveLength(1);
    expect(o.warns[0]).not.toContain('COMMITTED WITHOUT IT');
    expect(o.warns[0]).toBe(
      runtimeOwnedStripWarning('account_number', 'autonumber', 'pref', {
        strict: true, preserveAuditApplies: true,
      }),
    );
    expect(stripLineLevels(o)).toEqual(['warn']);
    expect(o.lines.some((l) => l.level === 'error' && l.msg === 'Insert operation failed')).toBe(true);
  });

  it('the DEFAULT insert strip still says COMMITTED WITHOUT IT — and the row really does commit', async () => {
    // The control that makes the strict case meaningful: here the claim is TRUE
    // (the record lands, holding the sequence value, not the caller's), so the
    // wording must not have moved.
    const { engine, writes, logger } = await makeEngine();
    const row: any = await engine.insert('pref', { title: 't', account_number: 'ACC-888888' } as any);
    const warns = logger.lines.filter((l: any) => l.level === 'warn').map((l: any) => l.msg);
    expect(writes.filter((w) => w.fn === 'create')).toHaveLength(1);
    expect(row.account_number).toBe('0001');
    expect(warns).toEqual([
      runtimeOwnedStripWarning('account_number', 'autonumber', 'pref', { preserveAuditApplies: true }),
    ]);
    expect(warns[0]).toContain('COMMITTED WITHOUT IT');
  });
});

describe('#8214 — #8141 stays closed, in strict mode too', () => {
  it('a by-id ADDRESS write logs nothing under strictReadonlyWrites either', async () => {
    // The card's hard fence: if the addressing `id` starts printing again for a
    // by-id address write, the change went wrong. `addressKey` is consulted
    // before the message is composed, so the mode cannot reach it — pinned
    // rather than argued, and pinned in BOTH modes.
    const o = await observeUpdate(
      { value: 'v1', id: 'rec_1' },
      { where: { id: 'rec_1' }, strictReadonlyWrites: true },
    );
    expect(o.warns).toEqual([]);
    // …and it is not refused either: the address is excluded from the report
    // channel by the same predicate, so both channels still agree (#8141).
    expect(o.refusedCode).toBeNull();
    expect(o.driverWrites).toBe(1);
  });

  it('a forgery riding along with the address still logs, and still refuses', async () => {
    const o = await observeUpdate(
      { value: 'v1', id: 'rec_1', locked_note: 'forged' },
      { where: { id: 'rec_1' }, strictReadonlyWrites: true },
    );
    expect(o.refusedCode).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(o.warns).toHaveLength(1);
    expect(o.warns[0]).not.toContain("Field 'id'");
    expect(o.warns[0]).toContain("Field 'locked_note'");
  });
});

describe('#8214 — the preserveAudit remedy is offered per FIELD, never as a blanket', () => {
  it('offers it for a field it would really have kept (locked_note)', async () => {
    const o = await observeUpdate(
      { id: 'rec_1', value: 'v1', locked_note: 'forged' },
      { where: { id: 'rec_1' } },
    );
    expect(o.warns[0]).toContain('preserveAudit');
    expect(o.warns[0]).toContain('{ context: { preserveAudit: true } }');
  });

  it('WITHHOLDS it for a field it would NOT have kept (organization_id — tenancy)', async () => {
    // The case that makes "targeted" a correctness property rather than a
    // preference. `organization_id` is `system` and outside the audit family,
    // so `preserveAudit` strips it anyway (no tenancy-forging backdoor, #3493)
    // — advertising the flag here would repeat #8141's defect one exemption
    // over: a caller steered to a posture that does not help.
    const o = await observeUpdate(
      { id: 'rec_1', value: 'v1', organization_id: 'org_forged' },
      { where: { id: 'rec_1' } },
    );
    expect(o.warns).toEqual([readonlyStripWarning('organization_id', 'pref')]);
    expect(o.warns[0]).not.toContain('preserveAudit');
    // …while `isSystem`, which WOULD have kept it, is still offered.
    expect(o.warns[0]).toContain('{ context: { isSystem: true } }');
  });

  it('the remedy the line offers really works — following it makes the line stop', async () => {
    // The strongest form of "true for that case": take the advice and measure.
    // `locked_note` survives the strip under `preserveAudit`, so the warning it
    // was named in disappears and the value reaches the driver.
    const o = await observeUpdate(
      { id: 'rec_1', value: 'v1', locked_note: 'restored' },
      { where: { id: 'rec_1' }, context: { preserveAudit: true } },
    );
    expect(o.warns).toEqual([]);
    expect(o.driverWrites).toBe(1);
  });
});
