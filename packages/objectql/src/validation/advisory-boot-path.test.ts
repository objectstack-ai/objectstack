// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13889] Advisory rules on the seed / bootstrap load path — the BEHAVIOURAL
 * pins for maintainer ruling B (2026-09-01, verbatim 「同意」).
 *
 * The acceptance anchor is hotcrm#1203's measured record, and it is behavioural,
 * so these pins are too: a REAL `ObjectQL` engine, a REAL object declaring a
 * REAL `severity: 'warning'` rule, the REAL `SeedLoaderService`, and the REAL
 * write shape `claimSeedOwnership` issues. Nothing below asserts against a
 * hand-built double of the thing under test.
 *
 * The two halves of the ruling, and the pin for each:
 *
 *  1. 「⛔ 不改规则语义,只改日志形状」 — the seed load reports advisory hits as
 *     ONE summary line per rule, not one line per row (PIN 2).
 *  2. 「同一行清库首启只响一次,按行不按写入」 — a system write-back whose
 *     business fields did not change does not re-evaluate advisory rules, so a
 *     row rings ONCE across a clean first boot rather than once per write
 *     (PIN 1).
 *
 * And the control that catches the most likely way to get B wrong: rule
 * SEMANTICS must not move. An ordinary interactive write reports exactly what it
 * always did, and `error`-severity rules are untouched by both halves (PIN 3).
 *
 * ## The boot this reproduces
 *
 * A clean-database first boot runs, in order:
 *
 *   1. `SeedLoaderService.load()` — writes the seeded rows. `owner_id` is left
 *      unset on purpose: no human user exists yet.
 *   2. `claimSeedOwnership` (`@objectstack/plugin-security`) — the first-admin
 *      handoff, one predicate write per unowned shape:
 *
 *        ql.update(name, { owner_id: adminUserId },
 *                  { where: { owner_id: null }, multi: true,
 *                    context: { isSystem: true } })
 *
 * Step 2 is issued verbatim below rather than by calling `claimSeedOwnership`
 * itself: `@objectstack/plugin-security` does not depend on `@objectstack/
 * objectql` (its deps are core / formula / metadata-core / platform-objects /
 * spec / types), so it cannot be driven against a real engine from this side of
 * the graph. What CAN be wrong about a re-spelling is the payload, and the
 * payload is the whole predicate under test — so it is quoted from the source
 * above and kept to one key, exactly as that function writes it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SeedLoaderService } from '@objectstack/metadata-protocol';
import { ObjectQL } from '../engine.js';

const ADVISORY_RULE = 'related_to_required';
const ADVISORY_MESSAGE = 'At least one related record should be selected.';

/**
 * The hotcrm shape: an internal task may legitimately have no parent record, and
 * the rule that says otherwise is written for a person filling in a form.
 *
 * `adv_task` is ownership-eligible (no `managedBy`, not `sys_*`), so
 * `resolveInjectedSystemColumns` reports `owner_id` for it — which is what makes
 * the claim scan's payload a system-column-only write.
 */
const TASK = {
  name: 'adv_task',
  label: 'Task',
  fields: {
    name: { name: 'name', label: 'Name', type: 'text' },
    related_to: { name: 'related_to', label: 'Related to', type: 'text' },
  },
  validations: [
    {
      type: 'script' as const,
      name: ADVISORY_RULE,
      severity: 'warning' as const,
      condition: { dialect: 'cel', source: 'record.related_to == null' },
      message: ADVISORY_MESSAGE,
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
    {
      // The `error`-severity control. Keyed on `owner_id` DELIBERATELY: that is
      // the one column the claim scan writes, so this rule is evaluated by
      // exactly the write the advisory half stops evaluating. If the by-row gate
      // ever widened from "advisory" to "all rules", this is what goes red.
      type: 'script' as const,
      name: 'owner_must_not_be_forbidden',
      severity: 'error' as const,
      condition: { dialect: 'cel', source: 'record.owner_id == "usr_forbidden"' },
      message: 'That owner may not hold records.',
      events: ['insert', 'update'] as Array<'insert' | 'update'>,
    },
  ],
};

const SEED_CONFIG = {
  dryRun: false, haltOnError: false, multiPass: true,
  defaultMode: 'upsert', batchSize: 1000, transaction: false,
};

function makeMemoryDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$and' && Array.isArray(v)) {
        if (!v.every((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k === '$or' && Array.isArray(v)) {
        if (!v.some((w: any) => matchesWhere(row, w))) return false;
        continue;
      }
      if (k.startsWith('$')) continue;
      const rowVal = row[k];
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        const list = (v as any).$in as unknown[];
        if (!list.includes(rowVal)) return false;
        continue;
      }
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      const a = rowVal === undefined ? null : rowVal;
      const b = expected === undefined ? null : expected;
      if (a !== b) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {} as any,
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
      // Hold the caller's bound, AFTER the filter and by PRESENCE. Not
      // decoration: `claimSeedOwnership`'s paged fallback reads with
      // `limit: CLAIM_PAGE_ROWS`, so a limit-blind double would answer a paged
      // read with the whole table and quietly test a different function.
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return updated;
    },
    /** The predicate write `claimSeedOwnership` issues; resolves a COUNT (#4639). */
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const [id, row] of [...s.entries()]) {
        if (!matchesWhere(row, ast?.where)) continue;
        s.set(id, { ...row, ...data, id });
        count += 1;
      }
      return count;
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

/** Every `warn` line either the engine or the loader emitted, in order. */
type WarnLog = string[];

function makeLogger(warns: WarnLog) {
  return {
    info() {}, debug() {}, error() {},
    warn(message: string) { warns.push(String(message)); },
  };
}

/** Lines that report an advisory hit, by either shape (per-row or summary). */
function advisoryLines(warns: WarnLog): string[] {
  return warns.filter((line) => line.includes(ADVISORY_RULE));
}

/** The per-row shape the evaluator has always used off the machine path. */
function perRowLines(warns: WarnLog): string[] {
  return warns.filter((line) => line.startsWith(`Validation rule '${ADVISORY_RULE}'`));
}

/** The aggregated shape (#13889). */
function summaryLines(warns: WarnLog): string[] {
  return warns.filter((line) => line.includes('[SeedLoader]') && line.includes('advisory rule'));
}

describe('[#13889] advisory rules on the seed / bootstrap load path', () => {
  let engine: ObjectQL;
  let warns: WarnLog;
  let loader: SeedLoaderService;
  let storeFor: ReturnType<typeof makeMemoryDriver>['storeFor'];

  beforeEach(async () => {
    warns = [];
    const logger = makeLogger(warns);
    // ONE logger for both, exactly as the boot has it: the engine's advisory
    // lines and the loader's summary land in the same startup log, which is the
    // log the ruling is about.
    engine = new ObjectQL({ logger });
    const d = makeMemoryDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject(TASK as never, 'com.objectstack.test.13889');
    const metadata = { getObject: async () => TASK, listObjects: async () => [TASK] };
    loader = new SeedLoaderService(engine as never, metadata as never, logger as never);
  });

  const seed = (records: Record<string, unknown>[]) => loader.load({
    seeds: [{
      object: 'adv_task',
      externalId: 'name',
      mode: 'upsert',
      env: ['prod', 'dev', 'test'],
      records,
    }],
    config: SEED_CONFIG,
  } as never);

  /** The claim scan's write, verbatim in shape. */
  const claimSeedOwnership = (adminUserId: string) => engine.update(
    'adv_task',
    { owner_id: adminUserId },
    { where: { owner_id: null }, multi: true, context: { isSystem: true } } as never,
  );

  it('PIN 1 — one row rings ONCE across a clean first boot (seed insert, then the claim scan)', async () => {
    // Step 1: the seed writes one legitimately parentless row.
    const result = await seed([{ name: 'Internal chore', related_to: null }]);
    expect(result.summary.totalInserted).toBe(1);

    // Step 2: the first-admin handoff re-owns it. Business fields did not move.
    const claimed = await claimSeedOwnership('usr_admin_1');
    expect(claimed).toBe(1);
    // …and it really landed, so this is not a pin over a write that never happened.
    expect([...storeFor('adv_task').values()][0].owner_id).toBe('usr_admin_1');

    // THE ANCHOR: the row rang exactly once for the whole boot. Before this
    // card it rang twice — once on the seed insert, once more when the claim
    // scan rewrote `owner_id` and every rule was re-evaluated.
    const reports = advisoryLines(warns);
    expect(reports).toHaveLength(1);
    // Counted BY ROW: the one report is about one row, not two writes.
    expect(reports[0]).toContain('1 row(s)');
  });

  it('PIN 2 — a seed load reports ONE summary line for N rows, not N lines', async () => {
    const result = await seed([
      { name: 'Chore A', related_to: null },
      { name: 'Chore B', related_to: null },
      { name: 'Chore C', related_to: null },
    ]);
    expect(result.summary.totalInserted).toBe(3);

    // The shape from the ruling: 「N 行触发 advisory 规则 X,详见…」.
    const summaries = summaryLines(warns);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('3 row(s)');
    expect(summaries[0]).toContain(ADVISORY_RULE);
    expect(summaries[0]).toContain('warning');
    expect(summaries[0]).toContain('adv_task');
    // The rule's own sentence survives — aggregating must not cost the reader
    // WHAT the advisory said, or the summary is a count with no remedy.
    expect(summaries[0]).toContain(ADVISORY_MESSAGE);
    // …and the 「详见…」 half points at real rows.
    expect(summaries[0]).toMatch(/Example row\(s\):/);

    // ⛔ And NOT one line per row — that is the defect.
    expect(perRowLines(warns)).toHaveLength(0);
    expect(advisoryLines(warns)).toHaveLength(1);
  });

  it('PIN 3a — CONTROL: an ordinary interactive write still reports its advisory, unchanged', async () => {
    await seed([{ name: 'Chore A', related_to: null }]);
    const id = [...storeFor('adv_task').keys()][0];
    warns.length = 0;

    // A human edits the row's business content. No aggregation scope is open
    // and the payload names a business field, so BOTH halves must stand aside.
    await engine.update('adv_task', { id, name: 'Chore A (renamed)' } as never);

    const perRow = perRowLines(warns);
    expect(perRow).toHaveLength(1);
    // Byte-for-byte the historical sentence — the rule's semantics AND its
    // report off the machine path are what this card must not move.
    expect(perRow[0]).toBe(
      `Validation rule '${ADVISORY_RULE}' (warning): ${ADVISORY_MESSAGE}`,
    );
    expect(summaryLines(warns)).toHaveLength(0);
  });

  it('PIN 3b — CONTROL: an `error` rule is untouched by the by-row gate', async () => {
    await seed([{ name: 'Chore A', related_to: null }]);
    warns.length = 0;

    // A system-column-only write — the exact shape the advisory half skips —
    // that violates an ERROR rule. It must still be rejected: an invariant is an
    // invariant on every write, however little it moved.
    await expect(
      engine.update(
        'adv_task',
        { owner_id: 'usr_forbidden' },
        { where: { owner_id: null }, multi: true, context: { isSystem: true } } as never,
      ),
    ).rejects.toThrow(/That owner may not hold records/);

    // …and it was the error rule that refused it, not an advisory turning into
    // a rejection.
    expect(advisoryLines(warns)).toHaveLength(0);
  });

  it('PIN 3c — CONTROL: an `error` rule still rejects an ordinary interactive write', async () => {
    await seed([{ name: 'Chore A', related_to: null }]);
    const id = [...storeFor('adv_task').keys()][0];

    await expect(
      engine.update('adv_task', { id, owner_id: 'usr_forbidden', name: 'edited' } as never),
    ).rejects.toThrow(/That owner may not hold records/);
  });
});
