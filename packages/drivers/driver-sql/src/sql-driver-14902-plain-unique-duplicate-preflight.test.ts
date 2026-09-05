// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * #14902 — a PLAIN unique index over existing duplicate rows.
 *
 * ## The defect, in the two shapes it was measured side by side
 *
 * Same fixture both times: a `crm_quote` table already holding two rows with
 * the same `quote_number`, then `initObjects` declaring that column unique.
 *
 * - **Path A — the NULL-safe organization composite.** The boot CONTINUES: the
 *   driver logs at `error` naming the index, the unenforced constraint and the
 *   remedy, and the ADR-0120 D4 pre-flight reports the blocked `create_index`
 *   as `category: 'destructive'` / `severity: 'error'` with the conflicting key
 *   groups and their row counts.
 * - **Path B — a plain unique, no organization key part.** The boot DIED:
 *   `initObjects` threw the database's own error, which names the index and the
 *   column and NO rows and NO remedy, nothing reached the durability channel,
 *   and `detectManagedDrift` — what `os migrate plan` reports — classified the
 *   very same op `category: 'safe'`, `severity: 'warning'`.
 *
 * Three properties stacked, and it is the combination that made it p1: the boot
 * is DOWN rather than degraded; the message is unactionable; and the instrument
 * an operator would reach for said `safe` about the op that was about to kill
 * the boot.
 *
 * ## Reachability — precisely, because the wider framing is wrong
 *
 * ⛔ NOT "every autonumber field". Since #13894 an `autonumber` field that omits
 * `unique` defaults to `unique: 'organization'`, and on an object that carries a
 * tenant column that lands on path A. Path B is reached by an object with
 * `tenancy: { enabled: false }` (no tenant column at all) or by any explicit
 * `unique: 'global'`. Narrower — and live: it is the self-hosted upgrade path,
 * a deployment with legacy duplicate rows and a tenancy-disabled object.
 *
 * ## What this suite pins
 *
 * Parity, in both halves, plus path A as the CONTROL. A change that quietly
 * moved path A while making path B loud would otherwise read as success, so the
 * last block asserts path A's message and classification are still their own —
 * the `#5030` framing, which is precisely what the plain path must NOT claim
 * (nothing ever admitted these rows; the constraint is simply newly declared
 * over data that does not satisfy it).
 *
 * ⛔ Nothing here pins the DATABASE's raw error text: the `catch` shape is
 * dialect-independent, that text is not. Assertions are on our own messages and
 * on the drift classification.
 */
describe('#14902 plain unique index over duplicate rows', () => {
  let driver: SqlDriver;
  let logs: Array<{ level: 'warn' | 'info' | 'error'; msg: string }>;

  const makeDriver = (opts: any = {}) =>
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
      ...opts,
    });

  const attachSpy = () => {
    logs = [];
    (driver as any).logger = {
      warn: (msg: string) => logs.push({ level: 'warn', msg }),
      info: (msg: string) => logs.push({ level: 'info', msg }),
      error: (msg: string) => logs.push({ level: 'error', msg }),
    };
  };

  beforeEach(() => {
    driver = makeDriver();
    attachSpy();
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  /**
   * A pre-existing table, no index on `quote_number` yet — the legacy database
   * this card is about. `withOrg` selects which path the declaration lands on.
   */
  const seed = async (
    withOrg: boolean,
    rows: Array<Record<string, unknown>>,
  ): Promise<any> => {
    const k = (driver as any).knex;
    await k.schema.createTable('crm_quote', (t: any) => {
      t.string('id').primary();
      t.timestamp('created_at');
      t.timestamp('updated_at');
      if (withOrg) t.string('organization_id');
      t.string('quote_number');
    });
    await k('crm_quote').insert(rows);
    return k;
  };

  /** The non-PK index names physically present on the table. */
  const indexNames = async (table: string): Promise<string[]> => {
    const k = (driver as any).knex;
    const list: any = await k.raw(`PRAGMA index_list(${table})`);
    return list.filter((i: any) => i.origin !== 'pk').map((i: any) => i.name);
  };

  /** Tenancy OFF — the plain single-column unique. */
  const PLAIN_META = [
    {
      name: 'crm_quote',
      tenancy: { enabled: false },
      fields: { quote_number: { type: 'autonumber', unique: true } },
    },
  ] as any[];

  /** Tenanted object, explicit platform-wide scope — also the plain shape. */
  const GLOBAL_META = [
    {
      name: 'crm_quote',
      fields: {
        organization_id: { type: 'string' },
        quote_number: { type: 'autonumber', unique: 'global' },
      },
    },
  ] as any[];

  const DUP_PLAIN = [
    { id: 'r1', quote_number: 'QUO-00009' },
    { id: 'r2', quote_number: 'QUO-00009' },
  ];

  describe('the boot survives and says what is not enforced', () => {
    it('does not throw the raw driver error — it logs on the durability channel, naming the rows and the remedy', async () => {
      await seed(false, DUP_PLAIN);

      // Before this fix: `initObjects` rejected with
      // "create unique index `uniq_crm_quote_quote_number` … UNIQUE constraint
      // failed: crm_quote.quote_number" and the whole boot went down.
      await expect(driver.initObjects(PLAIN_META)).resolves.not.toThrow();

      const durability = logs.filter((l) => l.level === 'error');
      expect(durability).toHaveLength(1);
      const msg = durability[0].msg;
      // Names the index…
      expect(msg).toContain("'uniq_crm_quote_quote_number'");
      // …the ROWS, which the database's own error never did…
      expect(msg).toMatch(/Conflicting group\(s\)/);
      expect(msg).toContain('quote_number="QUO-00009"');
      expect(msg).toMatch(/× 2 rows/);
      // …that the constraint is NOT enforced…
      expect(msg).toMatch(/NOT enforced/);
      // …and the remedy.
      expect(msg).toContain('os migrate plan');

      // The index really is absent: the log is not covering for a silent
      // success, and a duplicate write is still accepted (that is what "not
      // enforced" MEANS, and it is why the message is on the durability
      // channel rather than at `warn`).
      expect(await indexNames('crm_quote')).not.toContain('uniq_crm_quote_quote_number');
    });

    it("reaches the same disposition through an explicit unique: 'global' on a tenanted object", async () => {
      await seed(true, [
        { id: 'r1', organization_id: 'org_x', quote_number: 'QUO-00009' },
        { id: 'r2', organization_id: 'org_y', quote_number: 'QUO-00009' },
      ]);

      await expect(driver.initObjects(GLOBAL_META)).resolves.not.toThrow();

      const durability = logs.filter((l) => l.level === 'error');
      expect(durability).toHaveLength(1);
      // The key is the bare column — the organization is NOT part of it, which
      // is the whole point of `'global'`, and the two rows collide across
      // organizations.
      expect(durability[0].msg).toContain('quote_number="QUO-00009"');
      expect(durability[0].msg).not.toContain('organization_id');
    });

    it('still creates the index, silently, when the data is clean', async () => {
      await seed(false, [
        { id: 'r1', quote_number: 'QUO-00009' },
        { id: 'r2', quote_number: 'QUO-00010' },
      ]);

      await driver.initObjects(PLAIN_META);

      expect(await indexNames('crm_quote')).toContain('uniq_crm_quote_quote_number');
      expect(logs.filter((l) => l.level === 'error')).toHaveLength(0);
      // Healthy database: converged, zero drift. The pre-flight probes and gets
      // out of the way — it does not gate clean data.
      expect(await driver.detectManagedDrift()).toHaveLength(0);
      await expect(driver.create('crm_quote', { quote_number: 'QUO-00009' })).rejects.toThrow(
        /UNIQUE constraint failed|duplicate key value/,
      );
    });
  });

  describe("os migrate plan stops calling the blocked op `safe`", () => {
    it('classifies it destructive/error with the conflicting group and withdraws the safe claim', async () => {
      await seed(false, DUP_PLAIN);
      await driver.initObjects(PLAIN_META);

      const drift = await driver.detectManagedDrift();
      const entry = drift.find((d) => d.op.type === 'create_index');
      expect(entry).toBeDefined();

      // Before this fix: `category: 'safe'`, `severity: 'warning'`, message
      // "…the database has no such index — run "os migrate apply" to create
      // it." — an instrument saying nothing is wrong about the op that had just
      // taken the boot down.
      expect(entry!.category).toBe('destructive');
      expect(entry!.severity).toBe('error');
      expect(entry!.message).toMatch(/BLOCKED/);
      expect(entry!.message).toContain('quote_number="QUO-00009"');
      expect(entry!.message).toMatch(/× 2 rows/);
      expect(entry!.message).toMatch(/NOT enforced/);
      expect(entry!.message).toContain('os migrate plan');
      // ⛔ And it must NOT borrow path A's story: no prior index admitted these
      // rows, so #5030 is not what happened here.
      expect(entry!.message).not.toContain('#5030');
      expect(entry!.message).not.toContain('NULL-safe');
    });

    it('is not applied by a plain apply, and not created even under --allow-destructive', async () => {
      await seed(false, DUP_PLAIN);
      await driver.initObjects(PLAIN_META);
      const entry = (await driver.detectManagedDrift()).find((d) => d.op.type === 'create_index')!;

      // `destructive` is what keeps `os migrate apply` (and the artifact boot
      // gate, and dev autoMigrate) from walking into the raw failure.
      const plain = await driver.applyMigrationEntries([entry], { allowDestructive: false });
      expect(plain.applied).toHaveLength(0);
      expect(plain.skipped).toHaveLength(1);

      // …and forcing it does not produce a half-applied schema either: the
      // create is refused by the data, reported skipped, and no index appears.
      const forced = await driver.applyMigrationEntries([entry], { allowDestructive: true });
      expect(forced.applied).toHaveLength(0);
      expect(forced.skipped).toHaveLength(1);
      expect(await indexNames('crm_quote')).not.toContain('uniq_crm_quote_quote_number');
    });

    it("is not auto-applied at boot under dev autoMigrate: 'safe'", async () => {
      await driver.disconnect();
      driver = makeDriver({ autoMigrate: 'safe' });
      attachSpy();
      await seed(false, DUP_PLAIN);

      await expect(driver.initObjects(PLAIN_META)).resolves.not.toThrow();
      expect(await indexNames('crm_quote')).not.toContain('uniq_crm_quote_quote_number');
      expect(logs.some((l) => l.msg.includes('auto-reconciled'))).toBe(false);
    });

    it('unblocks once the duplicates are gone — the entry re-grades and a plain apply creates it', async () => {
      const k = await seed(false, DUP_PLAIN);
      await driver.initObjects(PLAIN_META);
      expect(
        (await driver.detectManagedDrift()).find((d) => d.op.type === 'create_index')!.category,
      ).toBe('destructive');

      await k('crm_quote').where({ id: 'r2' }).delete();

      const entry = (await driver.detectManagedDrift()).find((d) => d.op.type === 'create_index')!;
      expect(entry.category).toBe('safe');
      expect(entry.severity).toBe('warning');
      const res = await driver.applyMigrationEntries([entry], { allowDestructive: false });
      expect(res.applied).toHaveLength(1);
      expect(await indexNames('crm_quote')).toContain('uniq_crm_quote_quote_number');
      expect(await driver.detectManagedDrift()).toHaveLength(0);
    });
  });

  describe('CONTROL — path A is untouched', () => {
    it('still logs its own NULL-safe #5030 message and still reports destructive with the key groups', async () => {
      await seed(true, [
        { id: 'r1', organization_id: null, quote_number: 'QUO-00009' },
        { id: 'r2', organization_id: null, quote_number: 'QUO-00009' },
        { id: 'r3', organization_id: 'org_x', quote_number: 'QUO-00010' },
        { id: 'r4', organization_id: 'org_x', quote_number: 'QUO-00010' },
      ]);

      // `unique: true` on a tenanted object == `unique: 'organization'` — the
      // #13894 default, and the shape this card must not have disturbed.
      await expect(
        driver.initObjects([
          {
            name: 'crm_quote',
            fields: {
              organization_id: { type: 'string' },
              quote_number: { type: 'autonumber', unique: true },
            },
          },
        ] as any[]),
      ).resolves.not.toThrow();

      const durability = logs.filter((l) => l.level === 'error');
      expect(durability).toHaveLength(1);
      expect(durability[0].msg).toContain('NULL-safe unique index');
      expect(durability[0].msg).toContain('#5030');
      expect(durability[0].msg).toContain('ADR-0120 D4');
      expect(durability[0].msg).toContain("'organization_id, quote_number'");

      const entry = (await driver.detectManagedDrift()).find((d) => d.op.type === 'create_index')!;
      expect(entry.category).toBe('destructive');
      expect(entry.severity).toBe('error');
      expect(entry.message).toContain('#5030');
      expect(entry.message).toContain('__global__');
      // Both key groups, with counts — the NULL-organization bucket and a real
      // organization, which is what makes the COALESCE key self-describing.
      expect(entry.message).toContain('(organization_id="__global__", quote_number="QUO-00009")');
      expect(entry.message).toContain('(organization_id="org_x", quote_number="QUO-00010")');
    });
  });
});
