// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * Auto-number format tokens — date interpolation, {field} interpolation, and
 * per-scope counter reset. These are the MES/eHR record-number shapes
 * (`AD{YYYYMMDD}{0000}`, `{section}{island_zone}{000}`, `{plan_no}{000}`) that
 * the persistent `_objectstack_sequences` table now backs natively.
 */

/** Today's date in UTC as YYYYMMDD — matches the driver's renderer with tz=UTC. */
function utcYmd(): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = p.find((x) => x.type === 'year')!.value;
  const m = p.find((x) => x.type === 'month')!.value;
  const d = p.find((x) => x.type === 'day')!.value;
  return `${y}${m}${d}`;
}

describe('SqlDriver auto_number format tokens', () => {
  let driver: SqlDriver;

  beforeEach(() => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('renders {YYYYMMDD} date tokens in the business timezone', async () => {
    await driver.initObjects([
      { name: 'andon', fields: { andon_no: { type: 'autonumber', format: 'AD{YYYYMMDD}{0000}' } } },
    ]);
    const r1 = await driver.create('andon', {}, { timezone: 'UTC' } as any);
    const r2 = await driver.create('andon', {}, { timezone: 'UTC' } as any);
    expect(r1.andon_no).toBe(`AD${utcYmd()}0001`);
    expect(r2.andon_no).toBe(`AD${utcYmd()}0002`);
  });

  it('resets the counter per day (prior-day rows do not bleed into today)', async () => {
    await driver.initObjects([
      { name: 'andon', fields: { andon_no: { type: 'autonumber', format: 'AD{YYYYMMDD}{0000}' } } },
    ]);
    // A row from a long-past day sits at 0099. Today's counter must ignore it.
    const k = (driver as any).knex;
    await k('andon').insert({ id: 'old', andon_no: 'AD202001010099' });

    const r = await driver.create('andon', {}, { timezone: 'UTC' } as any);
    expect(r.andon_no).toBe(`AD${utcYmd()}0001`); // fresh scope, not 0100
  });

  it('interpolates {field} values and counts independently per group', async () => {
    await driver.initObjects([
      {
        name: 'task',
        fields: {
          section: { type: 'string' },
          island_zone: { type: 'string' },
          task_no: { type: 'autonumber', format: '{section}{island_zone}{000}' },
        },
      },
    ]);
    const a1 = await driver.create('task', { section: 'JYG', island_zone: '1A' });
    const b1 = await driver.create('task', { section: 'JYG', island_zone: '2B' });
    const a2 = await driver.create('task', { section: 'JYG', island_zone: '1A' });
    const b2 = await driver.create('task', { section: 'JYG', island_zone: '2B' });

    expect(a1.task_no).toBe('JYG1A001');
    expect(a2.task_no).toBe('JYG1A002');
    expect(b1.task_no).toBe('JYG2B001'); // a different island resets to 001
    expect(b2.task_no).toBe('JYG2B002');
  });

  it('numbers child records per parent (dispatch order under a plan)', async () => {
    await driver.initObjects([
      {
        name: 'dispatch_order',
        fields: {
          plan_no: { type: 'string' },
          order_no: { type: 'autonumber', format: '{plan_no}{000}' },
        },
      },
    ]);
    const p1a = await driver.create('dispatch_order', { plan_no: 'JYG1A1PROD20260617001' });
    const p2a = await driver.create('dispatch_order', { plan_no: 'JYG1A1PROD20260617002' });
    const p1b = await driver.create('dispatch_order', { plan_no: 'JYG1A1PROD20260617001' });

    expect(p1a.order_no).toBe('JYG1A1PROD20260617001001');
    expect(p1b.order_no).toBe('JYG1A1PROD20260617001002');
    expect(p2a.order_no).toBe('JYG1A1PROD20260617002001');
  });

  it('combines field + date tokens and stays tenant-isolated', async () => {
    await driver.initObjects([
      {
        name: 'plan',
        fields: {
          organization_id: { type: 'string' },
          line: { type: 'string' },
          plan_no: { type: 'autonumber', format: '{line}{YYYYMMDD}{000}' },
        },
      },
    ]);
    const a = await driver.create('plan', { organization_id: 'orgA', line: 'PROD' }, { timezone: 'UTC' } as any);
    const b = await driver.create('plan', { organization_id: 'orgB', line: 'PROD' }, { timezone: 'UTC' } as any);
    const a2 = await driver.create('plan', { organization_id: 'orgA', line: 'PROD' }, { timezone: 'UTC' } as any);

    expect(a.plan_no).toBe(`PROD${utcYmd()}001`);
    expect(a2.plan_no).toBe(`PROD${utcYmd()}002`);
    // Same scope string, different tenant → independent counter.
    expect(b.plan_no).toBe(`PROD${utcYmd()}001`);
  });

  it('shares one counter when adjacent {field} values concat to the same prefix', async () => {
    await driver.initObjects([
      {
        name: 'task',
        fields: {
          a: { type: 'string' },
          b: { type: 'string' },
          task_no: { type: 'autonumber', format: '{a}{b}{000}' },
        },
      },
    ]);
    // ('AB','C') and ('A','BC') both render the prefix "ABC" and thus the same
    // visible number — they MUST share one counter so the numbers stay unique
    // (independent counters would mint two "ABC001"s).
    const x1 = await driver.create('task', { a: 'AB', b: 'C' });
    const y1 = await driver.create('task', { a: 'A', b: 'BC' });
    const x2 = await driver.create('task', { a: 'AB', b: 'C' });

    expect(x1.task_no).toBe('ABC001');
    expect(y1.task_no).toBe('ABC002'); // same namespace, keeps climbing (unique)
    expect(x2.task_no).toBe('ABC003');
  });

  it('handles a very long {field} scope (well past varchar(255))', async () => {
    await driver.initObjects([
      {
        name: 'doc',
        fields: {
          big: { type: 'string' },
          doc_no: { type: 'autonumber', format: '{big}{000}' },
        },
      },
    ]);
    const big = 'P'.repeat(400); // 400-char prefix → scope far exceeds 255
    const r1 = await driver.create('doc', { big });
    const r2 = await driver.create('doc', { big });
    expect(r1.doc_no).toBe(`${big}001`);
    expect(r2.doc_no).toBe(`${big}002`);
  });

  it('refuses to generate when an interpolated {field} is empty (no silent mis-scope)', async () => {
    await driver.initObjects([
      {
        name: 'dispatch_order',
        fields: {
          plan_no: { type: 'string' },
          order_no: { type: 'autonumber', format: '{plan_no}{000}' },
        },
      },
    ]);
    // plan_no left blank → the prefix would collapse to '' and merge this row
    // into the wrong counter scope, so generation must throw instead.
    await expect(driver.create('dispatch_order', {})).rejects.toThrow(/plan_no/);
  });

  it('leaves fixed-prefix formats on a single global counter (backward compatible)', async () => {
    await driver.initObjects([
      { name: 'invoice', fields: { invoice_number: { type: 'autonumber', format: 'INV-{0000}' } } },
    ]);
    const r1 = await driver.create('invoice', {});
    const r2 = await driver.create('invoice', {});
    expect(r1.invoice_number).toBe('INV-0001');
    expect(r2.invoice_number).toBe('INV-0002');
  });

  it('migrates a legacy 3-column _objectstack_sequences table to the key_hash shape', async () => {
    const k = (driver as any).knex;
    // Simulate a deployment whose sequence table predates the `scope` column.
    await k.schema.createTable('_objectstack_sequences', (t: any) => {
      t.string('object').notNullable();
      t.string('tenant_id').notNullable();
      t.string('field').notNullable();
      t.bigInteger('last_value').notNullable().defaultTo(0);
      t.timestamp('updated_at').defaultTo(k.fn.now());
      t.primary(['object', 'tenant_id', 'field']);
    });
    await k('_objectstack_sequences').insert({
      object: 'invoice',
      tenant_id: '__global__',
      field: 'invoice_number',
      last_value: 41,
    });

    await driver.initObjects([
      { name: 'invoice', fields: { invoice_number: { type: 'autonumber', format: 'INV-{0000}' } } },
    ]);
    // initObjects pre-ensures the table → the in-place migration runs at init,
    // before any write; the first create then reads the already-migrated counter.
    const r = await driver.create('invoice', {});

    const cols = await k('_objectstack_sequences').columnInfo();
    expect(Object.keys(cols)).toContain('scope');
    expect(Object.keys(cols)).toContain('key_hash');
    // The legacy counter continued rather than restarting.
    expect(r.invoice_number).toBe('INV-0042');
  });

  it('migrates an interim {scope}-column table (no key_hash) and preserves counters', async () => {
    const k = (driver as any).knex;
    // A table from an earlier build of this feature: has `scope`, no `key_hash`.
    await k.schema.createTable('_objectstack_sequences', (t: any) => {
      t.string('object').notNullable();
      t.string('tenant_id').notNullable();
      t.string('field').notNullable();
      t.string('scope').notNullable().defaultTo('');
      t.bigInteger('last_value').notNullable().defaultTo(0);
      t.timestamp('updated_at').defaultTo(k.fn.now());
      t.primary(['object', 'tenant_id', 'field', 'scope']);
    });
    await k('_objectstack_sequences').insert({
      object: 'invoice',
      tenant_id: '__global__',
      field: 'invoice_number',
      scope: '',
      last_value: 7,
    });

    await driver.initObjects([
      { name: 'invoice', fields: { invoice_number: { type: 'autonumber', format: 'INV-{0000}' } } },
    ]);
    const r = await driver.create('invoice', {});

    const cols = await k('_objectstack_sequences').columnInfo();
    expect(Object.keys(cols)).toContain('key_hash');
    expect(r.invoice_number).toBe('INV-0008'); // continued from the interim counter
  });
});
