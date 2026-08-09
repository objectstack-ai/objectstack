// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4619 (ADR-0119 D1 follow-up, engine half) — `transaction()` carries two
// caveats that are part of its DECLARED meaning, not hidden behaviour:
//
//   1. when the default driver has no `beginTransaction`, the callback runs
//      with no transaction and no rollback;
//   2. the transaction covers the DEFAULT datasource only, so an object routed
//      elsewhere by `setDatasourceMapping` is written outside it.
//
// Declaring them is not the same as being able to observe them. Both used to be
// completely mute: a caller asking for atomicity and not getting it had no way
// to find out, and a multi-datasource "atomic" unit of work that partially
// committed reported nothing at all. These tests pin the diagnostics that make
// the two DISCOVERABLE.
//
// ⚠️ SCOPE UPDATE (#5351 / #5696, 2026-08-06 ruling). This file originally
// pinned BOTH caveats and pinned neither's behaviour, on the standing note that
// tightening either would change the declared contract and was spec-lane work.
// That work landed. Caveat 2's subject is gone — a cross-driver business write
// is now REFUSED and a system ledger is CARVED OUT, so there is no split left
// to report — and its section has moved wholesale to
// `engine-transaction-same-origin.test.ts`, re-asked against the decided
// verdict rather than re-spelled. Caveat 1 is untouched and still lives here:
// the degrade still happens and still warns once; `opts.require` (#5696) made
// refusing it a caller's OPTION without changing the default this section
// covers, and that option is pinned in `engine-transaction-contract.test.ts`.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

interface Recorded {
  level: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  /**
   * Everything after the message. The engine's logger contract is
   * `(msg, Error | undefined, meta)` for `error` and `(msg, meta)` for `warn`,
   * so the recorder keeps the raw tail and each assertion says which slot it
   * means — same reasoning as `schema-sync-durability-log-level.test.ts`.
   */
  args: unknown[];
}

function recordingLogger() {
  const records: Recorded[] = [];
  const push = (level: Recorded['level']) => (message: string, ...args: unknown[]) =>
    void records.push({ level, message: String(message), args });
  return {
    records,
    logger: { debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') },
    at(level: Recorded['level']) {
      return records.filter((r) => r.level === level);
    },
  };
}

/** Records that mention `needle` anywhere in the message. */
function matching(records: Recorded[], needle: string): Recorded[] {
  return records.filter((r) => r.message.includes(needle));
}

/** Meta object the engine passes in the trailing slot. */
function meta(r: Recorded): Record<string, unknown> {
  return (r.args.find((a) => a !== undefined && typeof a === 'object' && !(a instanceof Error)) ??
    {}) as Record<string, unknown>;
}

/**
 * A driver that records the writes it sees. `transactional: false` makes it a
 * driver WITHOUT `beginTransaction` — the shape the degrade path exists for
 * (test doubles and foreign engines; every in-tree driver implements it).
 */
function makeDriver(name: string, opts: { transactional?: boolean } = {}) {
  const writes: Array<{ object: string; op: 'create' | 'update' | 'delete'; transaction: unknown }> = [];
  const rows = new Map<string, Record<string, unknown>>();
  let nextId = 0;
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    writes,
    async connect() {},
    async disconnect() {},
    async checkHealth() { return true; },
    async execute() { return null; },
    async find() { return Array.from(rows.values()); },
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.find?.((c: any) => c?.field === 'id')?.value;
      if (id !== undefined) return rows.get(String(id)) ?? null;
      for (const r of rows.values()) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>, options: any) {
      writes.push({ object, op: 'create', transaction: options?.transaction });
      nextId += 1;
      const id = (data.id as string) ?? `${name}_${nextId}`;
      const row = { ...data, id };
      rows.set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>, options: any) {
      writes.push({ object, op: 'update', transaction: options?.transaction });
      const row = { ...rows.get(String(id)), ...data, id };
      rows.set(String(id), row);
      return row;
    },
    async delete(object: string, id: string, options: any) {
      writes.push({ object, op: 'delete', transaction: options?.transaction });
      return rows.delete(String(id));
    },
    async count() { return 0; },
    async bulkCreate(object: string, batch: Record<string, unknown>[]) {
      return Promise.all(batch.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async syncSchema() {},
  };
  if (opts.transactional !== false) {
    driver.beginTransaction = async () => ({ __trx: name });
    driver.commit = async () => {};
    driver.rollback = async () => {};
  }
  return driver;
}

// ---------------------------------------------------------------------------
// 1. Silent degrade → warn-once
// ---------------------------------------------------------------------------

describe('transaction() degrade with no beginTransaction warns once (#4619)', () => {
  async function engineWithoutTransactions() {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    const driver = makeDriver('memory', { transactional: false });
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, '__test__');
    return { rec, engine, driver };
  }

  it('warns — naming the driver, the consequence, and the fix — and still runs the callback', async () => {
    const { rec, engine } = await engineWithoutTransactions();

    let ran = false;
    const result = await engine.transaction(async () => {
      ran = true;
      return 'value';
    });

    // BEHAVIOUR IS UNCHANGED: the callback still runs and still returns.
    // Tightening this into a throw is the spec half of #4619, not this PR.
    expect(ran).toBe(true);
    expect(result).toBe('value');

    const warns = matching(rec.at('warn'), 'has no beginTransaction');
    expect(warns).toHaveLength(1);
    // Names the driver it is talking about.
    expect(warns[0].message).toContain("driver 'memory'");
    // The consequence, concretely (AGENTS.md: an operator log owes both).
    expect(warns[0].message).toContain('WITHOUT transaction or rollback');
    expect(warns[0].message).toMatch(/PERSISTED/);
    // The fix / the deliberate opt-out.
    expect(warns[0].message).toContain('beginTransaction for this datasource');
    expect(warns[0].message).toContain('fail');
    expect(meta(warns[0])).toMatchObject({ datasource: 'memory' });
  });

  it('is a WARN, not an error — nothing has been lost at the moment it fires', async () => {
    const { rec, engine } = await engineWithoutTransactions();
    await engine.transaction(async () => undefined);
    // AGENTS.md "Degradation log levels": this is the `if (!capability)`
    // composition branch — the capability is absent and every write still
    // lands. Escalating it to `error` is the mirror-image failure the same
    // section names (it trains readers to skim `error`).
    expect(matching(rec.at('error'), 'beginTransaction')).toHaveLength(0);
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);
  });

  it('does not repeat itself — five more calls add no further warnings', async () => {
    const { rec, engine } = await engineWithoutTransactions();

    for (let i = 0; i < 6; i += 1) {
      await engine.transaction(async () => {
        await engine.insert('thing', { name: `row_${i}` });
      });
    }

    // Six degrades, one line. The drivers that reach this path reach it on
    // EVERY call, so per-call would be unreadable — which is the #4420 `warn`
    // failure mode, not a fix for it.
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);
  });

  it('says nothing when the driver DOES support transactions', async () => {
    const rec = recordingLogger();
    const engine = new ObjectQL({ logger: rec.logger } as any);
    engine.registerDriver(makeDriver('memory'), true);
    await engine.init();
    engine.registry.registerObject({ name: 'thing', fields: { name: { type: 'text' } } }, '__test__');

    await engine.transaction(async () => {
      await engine.insert('thing', { name: 'A' });
    });

    expect(matching(rec.at('warn'), 'beginTransaction')).toHaveLength(0);
    expect(matching(rec.at('error'), 'beginTransaction')).toHaveLength(0);
  });

  it('shares one budget with ScopedContext.transaction (ctx.api.transaction) — said once, not once per surface', async () => {
    const { rec, engine } = await engineWithoutTransactions();

    // The sandbox surface (`ctx.api.transaction(fn)`) is a SECOND
    // implementation of the same degrade in the same file. It reports through
    // the same engine-side helper, so "say it once" holds across both.
    const scoped = (engine as any).createContext({ userId: 'u1' });
    let scopedRan = false;
    await scoped.transaction(async () => { scopedRan = true; });
    expect(scopedRan).toBe(true);
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);

    await engine.transaction(async () => undefined);
    expect(matching(rec.at('warn'), 'has no beginTransaction')).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Default-driver-only — MOVED. The subject of this section was decided.
// ---------------------------------------------------------------------------
//
// This file used to carry nine tests pinning the `error`-level diagnostic that
// PR #5724 added for a write routed off the transaction's datasource, under the
// standing note that reporting the split "does not fix it: refusing, or
// committing across drivers, would change the declared contract".
//
// The 2026-08-06 maintainer ruling on #5351 changed that contract. There is no
// longer a diagnostic to pin, because the engine no longer lets the write
// happen the way the diagnostic described: a BUSINESS write across drivers is
// refused (`CrossDatasourceTransactionWriteError`), and an append-only SYSTEM
// LEDGER is carved out and executed outside the transaction, with neither ever
// receiving the owner's handle.
//
// So this section did not become wrong — its subject moved. Every one of its
// facts is re-asked against the decided verdict in
// `engine-transaction-same-origin.test.ts`: the once-per-transaction budget
// (now on the carve-out note, since a refusal throws and a throw is never
// deduplicated), update/delete coverage, the joined-nested case, the
// `ScopedContext` surface, "no false positive outside a transaction", and "the
// scope does not leak". Leaving stubs behind here would pin nothing twice.
//
// Section 1 above stays exactly as it was: the warn-once degrade IS still
// observability-only, and `opts.require` (#5696) made it a caller's choice
// without changing the default it reports on.
