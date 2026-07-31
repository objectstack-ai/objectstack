// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `Field.datetime` has ONE storage form in the in-memory driver — canonical
 * UTC ISO text (#4047), the memory twin of ADR-0053 D-B (#3912).
 *
 * mingo compares across JS types the way MongoDB compares across BSON types:
 * a string comparand never matches a `Date` value, in either direction, for
 * EVERY operator — `$gte` included. And a datetime column really did hold
 * both: the driver's own `created_at`/`updated_at` defaults write
 * `new Date().toISOString()` (string) while `initialData` fixtures and direct
 * SDK callers hand it `Date` objects. So a date window answered with whichever
 * half matched the comparand's type and silently dropped the other.
 *
 * Canonical ISO TEXT is the right canon here — unlike mongo, this store has no
 * native instant type, and ISO-8601 UTC text sorts chronologically under plain
 * string comparison, which is exactly what mingo does. It is also the wire
 * form, so a value round-trips through JSON persistence unchanged.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

const ids = (rows: any[]) => rows.map((r: any) => r.id).sort();

/** The object declaration is what teaches the driver which fields are temporal. */
const TASK_SCHEMA = {
  name: 'task',
  fields: {
    title: { type: 'string' },
    created_at: { type: 'datetime' },
    due_at: { type: 'datetime' },
    created_on: { type: 'date' },
  },
};

describe('InMemoryDriver Field.datetime storage (#4047)', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({});
    await driver.connect();
    await driver.syncSchema('task', TASK_SCHEMA);
  });

  /** Both writer forms of the same instant, in one column. */
  async function seedMixed(): Promise<void> {
    const rows: Array<[string, unknown]> = [
      ['s_morning', '2026-07-28T09:15:00.000Z'],
      ['s_evening', '2026-07-28T21:40:00.000Z'],
      ['d_midnight', new Date('2026-07-28T00:00:00Z')],
      ['d_yesterday', new Date('2026-07-27T14:00:00Z')],
      ['d_next_day', new Date('2026-07-29T00:00:00Z')],
      ['s_old', '2026-04-19T10:00:00.000Z'],
    ];
    for (const [id, created_at] of rows) {
      await driver.create('task', { id, title: id, created_at });
    }
  }

  it('stores every writer form as canonical UTC ISO text', async () => {
    await seedMixed();
    const raw = await driver.find('task', { object: 'task' });
    for (const row of raw) {
      expect(typeof (row as any).created_at, `${(row as any).id} stored form`).toBe('string');
      expect((row as any).created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const midnight = raw.find((r: any) => r.id === 'd_midnight');
    expect(midnight.created_at).toBe('2026-07-28T00:00:00.000Z');
  });

  it('a date window reaches rows written in BOTH forms', async () => {
    await seedMixed();
    const found = await driver.find('task', {
      where: { created_at: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['d_midnight', 'd_yesterday', 's_evening', 's_morning']);
  });

  it('a Date-object comparand reaches the same rows', async () => {
    await seedMixed();
    const found = await driver.find('task', {
      where: {
        created_at: {
          $gte: new Date('2026-04-29T00:00:00Z'),
          $lt: new Date('2026-07-29T00:00:00Z'),
        },
      },
    } as any);
    expect(ids(found)).toEqual(['d_midnight', 'd_yesterday', 's_evening', 's_morning']);
  });

  it('keeps #3777/#4042 bound semantics on top of the converged storage', async () => {
    await seedMixed();
    const gte = await driver.find('task', { object: 'task', where: { created_at: { $gte: '2026-07-28' } } });
    expect(ids(gte)).toEqual(['d_midnight', 'd_next_day', 's_evening', 's_morning']);

    const lt = await driver.find('task', { object: 'task', where: { created_at: { $lt: '2026-07-28' } } });
    expect(ids(lt)).toEqual(['d_yesterday', 's_old']);

    const instant = await driver.find('task', {
      where: { created_at: { $lte: '2026-07-28T12:00:00.000Z' } },
    } as any);
    expect(ids(instant)).toEqual(['d_midnight', 'd_yesterday', 's_morning', 's_old']);
  });

  it('$between and the array spelling take the same coercion', async () => {
    await seedMixed();
    const between = await driver.find('task', {
      where: { created_at: { $between: ['2026-04-29', '2026-07-28'] } },
    } as any);
    expect(ids(between)).toEqual(['d_midnight', 'd_yesterday', 's_evening', 's_morning']);

    const array = await driver.find('task', {
      where: [['created_at', '>=', '2026-04-29'], 'and', ['created_at', '<=', '2026-07-28']],
    } as any);
    expect(ids(array)).toEqual(['d_midnight', 'd_yesterday', 's_evening', 's_morning']);
  });

  it('normalises rows supplied as initialData, not just ones written through create()', async () => {
    // A seeded fixture is a WRITE the driver never saw — but it is the shape
    // most tests and demos use, so leaving it un-normalised would keep the
    // mixed column alive on exactly the path people look at first.
    const seeded = new InMemoryDriver({
      initialData: {
        task: [
          { id: 'i_date', created_at: new Date('2026-07-28T09:15:00Z') },
          { id: 'i_iso', created_at: '2026-07-28T21:40:00.000Z' },
        ],
      },
    });
    await seeded.connect();
    await seeded.syncSchema('task', TASK_SCHEMA);

    const found = await seeded.find('task', {
      where: { created_at: { $gte: '2026-07-28', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['i_date', 'i_iso']);
  });

  it('update() puts the new value in the same form', async () => {
    // `created_at` is deliberately immutable in this driver (it re-preserves
    // the original on every update), so the mutable datetime field is the
    // honest subject for an update-path assertion.
    await driver.create('task', { id: 'u1', due_at: '2026-04-19T10:00:00.000Z' });
    await driver.update('task', 'u1', { due_at: new Date('2026-07-28T09:15:00Z') });
    const row: any = (await driver.find('task', { object: 'task', where: { id: 'u1' } }))[0];
    expect(row.due_at).toBe('2026-07-28T09:15:00.000Z');

    // …and the converged value is reachable by a date window, which is the
    // point of converging it.
    const found = await driver.find('task', {
      where: { due_at: { $gte: '2026-07-28', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['u1']);
  });

  it('a Field.date column stays calendar-day text — not widened into an instant', async () => {
    for (const [id, created_on] of [
      ['on_early', '2026-04-19'],
      ['on_mid', '2026-07-28'],
      ['on_late', '2026-07-29'],
      // A Date written to a `date` field collapses to its UTC calendar day.
      ['on_obj', new Date('2026-07-28T21:40:00Z')],
    ] as const) {
      await driver.create('task', { id, created_on });
    }
    const all = await driver.find('task', { object: 'task' });
    for (const row of all) expect(typeof (row as any).created_on).toBe('string');
    expect((all.find((r: any) => r.id === 'on_obj')).created_on).toBe('2026-07-28');

    const found = await driver.find('task', {
      where: { created_on: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['on_mid', 'on_obj']);
  });

  it('an undeclared object is left alone (no schema → no coercion)', async () => {
    await driver.create('freeform', { id: 'f1', when: new Date('2026-07-28T09:15:00Z') });
    const row: any = (await driver.find('freeform', { object: 'freeform' }))[0];
    expect(row.when).toBeInstanceOf(Date);
  });
});
