// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20176] `temporalFilterValue` — this driver's `where` coercion of a temporal
 * comparand — IS `@objectstack/core`'s `temporalStorageForm`, the one rule
 * `driver-memory` and the engine's per-aggregation `filter` / `having` read
 * too, with MySQL's `datetime` then spelled as that dialect's literal.
 *
 * `canonicalUtcDatetime`, `toDateOnly` and `canonicalTimeOfDay` were a
 * word-for-word copy of the rule (and `driver-memory` carried a second); they
 * agreed with it on every shape measured when it was lifted, so re-pointing
 * them moved no `where`, write or read answer. The where half of the card's
 * rows on this driver is pinned through the REST door in
 * `packages/rest/src/aggregation-filter-temporal-storage-rule.test.ts`.
 *
 * No connection is opened: the field-type maps are seeded the way
 * `initObjects` would, as in `sql-driver-temporal-dialect.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { temporalStorageForm } from '@objectstack/core';
import { SqlDriver } from '../src/index.js';

class ProbeDriver extends SqlDriver {
  seed(kind: 'datetime' | 'date' | 'time', table: string, field: string): void {
    const map = kind === 'datetime' ? this.datetimeFields : kind === 'date' ? this.dateFields : this.timeFields;
    (map[table] ??= new Set()).add(field);
  }
}

function makeDriver(client: string): ProbeDriver {
  const d = new ProbeDriver({ client, connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
  d.seed('datetime', 't', 'at');
  d.seed('date', 't', 'on');
  d.seed('time', 't', 'clock');
  return d;
}

const SHAPES: ReadonlyArray<readonly [string, () => unknown]> = [
  ['Date', () => new Date('2026-02-01T10:00:00.000Z')],
  ['Invalid Date', () => new Date('nope')],
  ['epoch ms', () => 1769940000000],
  ['epoch ms string', () => '1769940000000'],
  ['bare day', () => '2026-02-01'],
  ['zone-naive', () => '2026-02-01 09:00'],
  ['ISO instant', () => '2026-02-01T10:00:00Z'],
  ['offset instant', () => '2026-02-01T18:00:00+08:00'],
  ['wall clock', () => '09:00'],
  ['wall clock .5', () => '09:00:00.5'],
  ['out-of-range wall clock', () => '25:00'],
  ['junk', () => 'not-a-date'],
  ['empty', () => ''],
  ['boolean', () => true],
];

const FIELD = { datetime: 'at', date: 'on', time: 'clock' } as const;

/** MySQL's spelling of a canonical instant (#3942) — the dialect half, which stays this driver's. */
const mysqlLiteral = (v: unknown): unknown => {
  const m = typeof v === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2}\.\d{3})Z$/.exec(v) : null;
  return m ? `${m[1]} ${m[2]}` : v;
};

describe('[#20176] temporalFilterValue is core\'s temporalStorageForm', () => {
  for (const client of ['better-sqlite3', 'pg', 'mysql2']) {
    for (const kind of ['datetime', 'date', 'time'] as const) {
      it(`${client} · ${kind}: every shape, and a list member by member`, () => {
        const d = makeDriver(client);
        const physical = (v: unknown): unknown => {
          const form = temporalStorageForm(v, kind);
          return client === 'mysql2' && kind === 'datetime' ? mysqlLiteral(form) : form;
        };
        for (const [name, make] of SHAPES) {
          expect(d.temporalFilterValue('t', FIELD[kind], make()), name).toStrictEqual(physical(make()));
        }
        const list = SHAPES.map(([, make]) => make());
        expect(d.temporalFilterValue('t', FIELD[kind], list)).toStrictEqual(list.map(physical));
      });
    }
  }

  it('a field that is not temporal passes through untouched', () => {
    const d = makeDriver('better-sqlite3');
    expect(d.temporalFilterValue('t', 'note', '2026-02-01T10:00:00Z')).toBe('2026-02-01T10:00:00Z');
  });
});
