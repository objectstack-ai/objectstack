// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8682 half A — an undeclared field must be refused by the SCHEMA, before the
// insert path produces anything for a request that is already refused.
//
// The client answer was never the defect: a mistyped field name has always come
// back as a clean `400 INVALID_FIELD`, because the DRIVER refused the statement
// and `mapDataError` translated `table X has no column named c` into that
// envelope. What this suite is about is everything that ran BEHIND that answer.
//
// Measured on `origin/main` @ 3508678, real `ObjectQL` + the recording driver
// below, one mistyped key on a single insert:
//
//   autonumber before the bad request   0001
//   the bad request                     refused — SQLITE_ERROR, from the driver
//   autonumber after the bad request    0003      ← gap of 1, permanently
//   beforeInsert hooks fired            ok-1, bad, ok-2   ← ran for the refused row
//   driver create() calls               3         ← the refused row reached the driver
//
// After the door: `0001` → refused → `0002`, hooks `ok-1, ok-2`, two creates.
//
// ## Why the AUTONUMBER is the pin and the log is not
//
// The card's own strongest evidence is the sequence gap, and it is the only
// observable here that does not depend on log contents — which matters
// especially in this PR, whose other half REWRITES what the write-path loggers
// emit. A pin that grepped log text would have rotted the moment half B landed,
// in the same commit that made it pass. So the refusal is asserted on the
// caller's error envelope (ADR-0112 `code` + `status`) and on three
// side-effect counters, and never on a log line.
//
// A sequence gap is not bookkeeping: `ACC-000014` is a document number an end
// user reads on an invoice, and nothing ever reissues it.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

/** Records everything that reached the driver — the counts are the point. */
function makeRecordingDriver(missingColumns: readonly string[] = []) {
  const writes: Array<{ fn: string; data: Record<string, unknown> }> = [];
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(object: string, data: Record<string, unknown>) {
      writes.push({ fn: 'create', data: { ...data } });
      const bad = missingColumns.find((c) => c in data);
      // The shape knex produces: the bound statement, then ` - `, then the
      // database's own diagnostic.
      if (bad) throw new Error(`insert into \`${object}\` (\`${bad}\`) values ('v') returning * - table ${object} has no column named ${bad}`);
      return { id: `rec_${writes.length}`, ...data };
    },
    async update(_o: string, id: string, data: Record<string, unknown>) { writes.push({ fn: 'update', data: { ...data } }); return { id, ...data }; },
    async updateMany() { return 0; },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => driver.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

/**
 * `account_number` is the autonumber whose gap is this suite's observable, and
 * the `beforeInsert` hook DERIVES a value the caller never sent — the
 * `period_label = 'Q3 2026'` shape the card measured on `crm_forecast`, which
 * is what makes "the hook ran" a fact about app behaviour and not just a
 * counter.
 */
async function makeEngine(options: { missingColumns?: readonly string[]; registerObject?: boolean } = {}) {
  const engine = new ObjectQL({ logger: silentLogger() });
  const { driver, writes } = makeRecordingDriver(options.missingColumns ?? []);
  engine.registerDriver(driver, true);
  await engine.init();
  if (options.registerObject !== false) {
    engine.registry.registerObject({
      name: 'acct',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
        name: { name: 'name', type: 'text' },
        description: { name: 'description', type: 'text' },
        account_number: { name: 'account_number', type: 'autonumber' },
      },
    } as any, 'test');
  }
  const hookRuns: string[] = [];
  engine.registerHook('beforeInsert', (ctx: any) => {
    hookRuns.push(String(ctx.input.data?.name ?? '?'));
    ctx.input.data.description = `derived-for-${ctx.input.data?.name}`;
  }, { object: 'acct' });
  return { engine, writes, hookRuns };
}

function silentLogger() {
  const logger: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return logger; },
  };
  return logger;
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return null;
}

describe('#8682 half A — the declared-field door', () => {
  it('REPRODUCED then FIXED: the rejected request consumes no autonumber', async () => {
    const { engine } = await makeEngine();

    const before: any = await engine.insert('acct', { name: 'ok-1' });
    await refusalOf(() => engine.insert('acct', { name: 'bad', zzz_nonexistent_field: 'x' } as any));
    const after: any = await engine.insert('acct', { name: 'ok-2' });

    // On `origin/main` this read 0001 → 0003. The refused request took 0002
    // into the void; the gap was permanent.
    expect(before.account_number).toBe('0001');
    expect(after.account_number).toBe('0002');
  });

  it('the app`s beforeInsert hook does not run for the refused row', async () => {
    const { engine, hookRuns } = await makeEngine();

    await engine.insert('acct', { name: 'ok-1' });
    await refusalOf(() => engine.insert('acct', { name: 'bad', zzz_nonexistent_field: 'x' } as any));
    await engine.insert('acct', { name: 'ok-2' });

    // `'bad'` between them on `origin/main`: the hook computed a derived value
    // for a request the server had already decided to refuse.
    expect(hookRuns).toEqual(['ok-1', 'ok-2']);
  });

  it('nothing reaches the driver', async () => {
    const { engine, writes } = await makeEngine();

    await refusalOf(() => engine.insert('acct', { name: 'bad', zzz_nonexistent_field: 'x' } as any));

    expect(writes).toHaveLength(0);
  });

  it('refuses in the ADR-0112 envelope, with the wire answer unchanged', async () => {
    const { engine } = await makeEngine();

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'bad', zzz_nonexistent_field: 'x' } as any));

    // `code` AND `status` — the envelope, not merely "it threw".
    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
    expect(refusal?.field).toBe('zzz_nonexistent_field');
    expect(refusal?.object).toBe('acct');
    // Byte-identical to the message `mapDataError`'s driver-string branch
    // produced before this door existed — the refusal moved, the answer did
    // not. `@objectstack/rest` re-emits this verbatim as the 400 body's
    // `error`, so a change here is a change to the public wire answer.
    expect(refusal?.message).toBe("Unknown field 'zzz_nonexistent_field' on object 'acct'");
  });

  it('names every undeclared key, not only the first', async () => {
    const { engine } = await makeEngine();

    const refusal = await refusalOf(() => engine.insert('acct', {
      name: 'bad', zzz_one: 1, zzz_two: 2,
    } as any));

    expect(refusal?.field).toBe('zzz_one');
    expect(refusal?.fields).toEqual(['zzz_one', 'zzz_two']);
  });

  it('a key holding `undefined` is still an undeclared key', async () => {
    // A spread of a partial object is the common way this arrives from code
    // rather than from JSON, and a mistyped key is a mistyped key whatever it
    // holds — the AI-authoring case this door is for. Declared fields holding
    // `undefined` are untouched: only the NAME is judged here.
    const { engine } = await makeEngine();

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'bad', zzz_typo: undefined } as any));

    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.field).toBe('zzz_typo');
  });

  it('a declared field whose physical column is missing still reaches the driver', async () => {
    // The door's scope is the SCHEMA's field map, so schema drift — declared
    // here, absent in the table — is invisible to it by construction and stays
    // the driver's to refuse, exactly as before. `mapDataError`'s driver-string
    // branch is what turns that into the caller's 400, and it is still needed.
    const { engine, writes } = await makeEngine({ missingColumns: ['description'] });

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'ok', description: 'v' } as any));

    expect(writes).toHaveLength(1);
    expect(String(refusal?.message)).toContain('has no column named description');
  });

  it('a batch refuses on the first bad row and writes none of it', async () => {
    const { engine, writes, hookRuns } = await makeEngine();

    const refusal = await refusalOf(() => engine.insert('acct', [
      { name: 'a' }, { name: 'b', zzz_nonexistent_field: 'x' }, { name: 'c' },
    ] as any));

    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
    expect(writes).toHaveLength(0);
    expect(hookRuns).toEqual([]);
  });

  it('insertMany culls the bad row and writes the good ones', async () => {
    // Partial-success mode's whole contract is that one bad row costs the
    // others nothing — and before this door an undeclared key defeated it
    // completely: the row travelled to `bulkCreate` with the rest and the
    // driver failed the WHOLE batch that partial mode exists to protect.
    const { engine, writes, hookRuns } = await makeEngine();

    const outcomes = await engine.insertMany('acct', [
      { name: 'a' }, { name: 'b', zzz_nonexistent_field: 'x' }, { name: 'c' },
    ] as any);

    expect(outcomes.map((o: any) => o.ok)).toEqual([true, false, true]);
    expect((outcomes[1] as any).error?.code).toBe('INVALID_FIELD');
    expect((outcomes[1] as any).error?.status).toBe(400);
    // The culled row ran no hook and consumed no sequence value: the two good
    // rows took 0001 and 0002 with nothing skipped between them.
    expect(hookRuns).toEqual(['a', 'c']);
    expect(writes.map((w) => w.data.account_number)).toEqual(['0001', '0002']);
  });

  it('a registry-less host gets no verdict — the driver stays the backstop', async () => {
    // Same discipline as the read path's doors: a door that cannot see the
    // field map must not invent an opinion about it.
    const { engine, writes } = await makeEngine({ registerObject: false, missingColumns: ['zzz_nonexistent_field'] });

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'x', zzz_nonexistent_field: 'x' } as any));

    expect(writes).toHaveLength(1);
    expect(String(refusal?.message)).toContain('has no column named zzz_nonexistent_field');
  });
});
