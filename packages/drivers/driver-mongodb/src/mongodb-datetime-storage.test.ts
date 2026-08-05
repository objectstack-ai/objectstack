// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `Field.datetime` has ONE storage form on MongoDB — BSON `Date` (#4047).
 *
 * The mongo twin of ADR-0053 D-B (#3912): before this, a datetime column held
 * whichever form the writer produced. The driver's own `created_at`/`updated_at`
 * defaults bind `new Date()` → BSON Date, while every REST/JSON write and every
 * relative-date token arrives as an ISO **string** → BSON String. MongoDB
 * compares across BSON types by *type bracket*, never by value, so a string
 * comparand matched no Date row and vice versa — for EVERY operator, `$gte`
 * included. The dashboard's default date window (`created_at`, a system
 * datetime) therefore returned **nothing at all** on mongo, which is worse than
 * #3777's "loses the final day".
 *
 * BSON Date is the right canon here for the same reason `timestamptz` is on
 * Postgres: it is the dialect's native instant type, indexable and
 * range-queryable. So the write path converges values to it and the filter path
 * coerces comparands to it — the two halves that must never disagree.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('datetime-storage');

const ids = (rows: any[]) => rows.map((r: any) => r.id).sort();

describe.skipIf(!sharedMongod)('MongoDB Field.datetime storage (#4047)', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    driver = new MongoDBDriver({ url: mongod.getUri(), database: 'dt_storage_db' });
    await driver.connect();
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    const db = driver.getDb();
    for (const col of await db.listCollections().toArray()) {
      await db.dropCollection(col.name);
    }
    // Declaring the object is what teaches the driver which fields are temporal
    // — the mongo analogue of `initObjects` populating `datetimeFields`.
    await driver.syncSchema('task', {
      name: 'task',
      fields: {
        title: { type: 'string' },
        created_at: { type: 'datetime' },
        created_on: { type: 'date' },
      },
    });
  });

  /** Insert the two writer forms of the SAME instant, plus neighbours. */
  async function seedMixed(): Promise<void> {
    const rows: Array<[string, unknown]> = [
      // ISO string — a REST/JSON write, the form that used to be unreachable
      // from a Date comparand.
      ['s_morning', '2026-07-28T09:15:00.000Z'],
      ['s_evening', '2026-07-28T21:40:00.000Z'],
      // JS Date — a direct SDK call / the driver's own timestamp defaults.
      ['d_midnight', new Date('2026-07-28T00:00:00Z')],
      ['d_yesterday', new Date('2026-07-27T14:00:00Z')],
      // Out of window on both sides.
      ['d_next_day', new Date('2026-07-29T00:00:00Z')],
      ['s_old', '2026-04-19T10:00:00.000Z'],
    ];
    for (const [id, created_at] of rows) {
      await driver.create('task', { id, title: id, created_at });
    }
  }

  it('stores every writer form as one BSON Date', async () => {
    await seedMixed();
    const raw = await driver.getDb().collection('task').find({}).toArray();
    for (const doc of raw) {
      expect(doc.created_at, `${doc.id} stored form`).toBeInstanceOf(Date);
    }
    // …and the instant survives the conversion, rather than being re-parsed
    // in the server's local zone.
    const morning = raw.find((d: any) => d.id === 's_morning')!;
    expect((morning.created_at as Date).toISOString()).toBe('2026-07-28T09:15:00.000Z');
  });

  it('a string date window reaches rows written in BOTH forms', async () => {
    await seedMixed();
    // The dashboard's shape: bare-day bounds as ISO strings, against a
    // system-injected datetime field. Pre-fix this returned [] on mongo.
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
    // Bare-day upper bound = the whole day (half-open), lower bound = midnight.
    const gte = await driver.find('task', { where: { created_at: { $gte: '2026-07-28' } } } as any);
    expect(ids(gte)).toEqual(['d_midnight', 'd_next_day', 's_evening', 's_morning']);

    const lt = await driver.find('task', { where: { created_at: { $lt: '2026-07-28' } } } as any);
    expect(ids(lt)).toEqual(['d_yesterday', 's_old']);

    // A full-ISO upper bound keeps instant semantics.
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

    // [#5158] The authored array form, lowered the declared way. The INFIX
    // join (`[condA, 'and', condB]`) has no lowering at all and is refused at
    // the door; the declared spelling of "both bounds" is the prefix group.
    const array = await driver.find('task', {
      where: parseFilterAST(
        ['and', ['created_at', '>=', '2026-04-29'], ['created_at', '<=', '2026-07-28']],
      ) as any,
    } as any);
    expect(ids(array)).toEqual(['d_midnight', 'd_yesterday', 's_evening', 's_morning']);
  });

  it('a Field.date column stays calendar-day TEXT — not widened into an instant', async () => {
    // `date` is timezone-naive by ADR-0053 Phase 1; converting it to a BSON
    // Date would invent a midnight instant and re-introduce the tz coupling
    // the calendar-day form exists to avoid.
    for (const [id, created_on] of [
      ['on_early', '2026-04-19'],
      ['on_mid', '2026-07-28'],
      ['on_late', '2026-07-29'],
    ] as const) {
      await driver.create('task', { id, title: id, created_on });
    }
    const raw = await driver.getDb().collection('task').find({}).toArray();
    for (const doc of raw) expect(typeof doc.created_on).toBe('string');

    const found = await driver.find('task', {
      where: { created_on: { $gte: '2026-04-29', $lte: '2026-07-28' } },
    } as any);
    expect(ids(found)).toEqual(['on_mid']);
  });

  it('an undeclared object is left alone (no schema → no coercion)', async () => {
    // Nothing declared this collection, so the driver has no field kinds for
    // it and must not guess: values pass through exactly as written.
    await driver.create('freeform', { id: 'f1', when: '2026-07-28T09:15:00.000Z' });
    const raw = await driver.getDb().collection('freeform').find({}).toArray();
    expect(typeof raw[0].when).toBe('string');
  });
});
