/**
 * ObjectUI — ValueDataSource clones with `structuredClone` (objectui#9175)
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Maintainer ruling **A** on objectui#9061 (2026-09-11, decision batch #115):
 * the constructor and `getAll()` deep-clone with `structuredClone`, never with
 * `JSON.parse(JSON.stringify(...))`.
 *
 * ## Why the round-trip was a defect and not a detail
 *
 * The clone exists for exactly one reason, stated in the code it replaced:
 * "Deep clone to prevent external mutation". That is an ALIASING barrier on a
 * read-only query source. A JSON round-trip is an aliasing barrier too — but it
 * is also a SERIALIZATION boundary, and nothing asked for one. So every row
 * that reached `provider: 'value'` silently acquired a requirement the contract
 * never states: `ViewData.items` is `z.array(z.unknown())` in
 * `@objectstack/spec`, not `z.array(z.json())`, and objectui#6018 pinned the
 * consequence in words — an inline value never has to be serializable at all.
 *
 * The moment a renderer routes its inline rows THROUGH this adapter to honour
 * `filter` / `sort` / the objectui#7210 row ceiling (objectui#9061 for
 * ObjectCalendar and ObjectMap, objectui#9136 for ObjectTree), that hidden
 * requirement becomes the renderer's. Repairing it here is what lets those
 * repairs land unchanged.
 *
 * ## What this file pins, and what it deliberately does NOT
 *
 * Every case below is a BEFORE/AFTER pair in substance: the comment on each
 * says what the JSON round-trip produced, and the assertion says what the
 * structured clone produces. Restoring the round-trip reddens each one for the
 * reason named in its comment — that is the ablation this file is written for.
 *
 * It does NOT pin `structuredClone`'s own vocabulary for its own sake. Each
 * case is a shape a real consumer can put in `items`:
 *
 *   - `resolveDataSource({ provider: 'value' })` — the ONE production route
 *     into this constructor from a schema, reached by `useViewData`
 *     (`@object-ui/react`) and by `ObjectGantt`, and the route the inline arms
 *     of objectui#9061 / objectui#9136 add.
 *   - `new ValueDataSource({ items })` direct — `plugin-designer`'s
 *     `FieldDesigner` and `ObjectManager`, which hand it in-memory metadata
 *     objects rather than anything that came off a wire.
 *
 * ⛔ The failure on a function-valued row stays LOUD (`DataCloneError`). No
 * `try`/`catch` fallback to the round-trip: that would restore the silent
 * flattening, which is the whole defect.
 */

import { describe, it, expect } from 'vitest';
import { ValueDataSource } from '../ValueDataSource.js';
import { resolveDataSource } from '../resolveDataSource.js';

// ---------------------------------------------------------------------------
// (1) The guarantee the clone exists for — unchanged, and still deep.
// ---------------------------------------------------------------------------
describe('the aliasing barrier the clone exists for (unchanged)', () => {
  it('does not alias the caller’s array or its rows', async () => {
    const rows = [{ id: '1', name: 'Alice' }];
    const ds = new ValueDataSource({ items: rows });

    rows.push({ id: '2', name: 'Mallory' });
    rows[0].name = 'mutated';

    const result = await ds.find('people');
    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).name).toBe('Alice');
  });

  it('is DEEP — a nested object mutated by the caller does not reach the source', async () => {
    const rows = [{ id: '1', meta: { tag: 'original' } }];
    const ds = new ValueDataSource({ items: rows });

    rows[0].meta.tag = 'mutated';

    const result = await ds.find('people');
    expect((result.data[0] as any).meta.tag).toBe('original');
  });

  it('`getAll()` hands out a clone too, not the live rows', () => {
    const ds = new ValueDataSource({ items: [{ id: '1', meta: { tag: 'original' } }] });

    const snapshot = ds.getAll() as any[];
    snapshot[0].meta.tag = 'mutated';

    expect((ds.getAll() as any[])[0].meta.tag).toBe('original');
  });
});

// ---------------------------------------------------------------------------
// (2) What the round-trip destroyed and the structured clone preserves.
//     Each case names what `JSON.parse(JSON.stringify(...))` produced.
// ---------------------------------------------------------------------------
describe('values that survive the clone as themselves (objectui#9175)', () => {
  it('a `Date` survives as a `Date` — the round-trip handed back an ISO string', async () => {
    const when = new Date('2026-09-11T14:08:00.000Z');
    const ds = new ValueDataSource({ items: [{ id: '1', start: when }] });

    const [row] = (await ds.find('events')).data as any[];
    expect(row.start).toBeInstanceOf(Date);
    expect(row.start.getTime()).toBe(when.getTime());
    // …and it is a CLONE of that Date, not the caller's instance.
    expect(row.start).not.toBe(when);
    // The shape the round-trip produced, spelled out so the difference is
    // unmissable: `typeof` was `'string'`, and it was NOT a Date.
    expect(typeof row.start).not.toBe('string');
  });

  it('a key whose value is `undefined` keeps its key — the round-trip deleted it', async () => {
    const ds = new ValueDataSource({ items: [{ id: '1', owner: undefined }] });

    const [row] = (await ds.find('people')).data as any[];
    expect(Object.prototype.hasOwnProperty.call(row, 'owner')).toBe(true);
    expect(row.owner).toBeUndefined();
    expect(Object.keys(row)).toEqual(['id', 'owner']);
  });

  it('`Map` and `Set` survive as `Map` and `Set` — the round-trip flattened both to `{}`', async () => {
    const ds = new ValueDataSource({
      items: [{ id: '1', byKey: new Map([['a', 1]]), tags: new Set(['x']) }],
    });

    const [row] = (await ds.find('things')).data as any[];
    expect(row.byKey).toBeInstanceOf(Map);
    expect(row.byKey.get('a')).toBe(1);
    expect(row.tags).toBeInstanceOf(Set);
    expect(row.tags.has('x')).toBe(true);
  });

  it('a `BigInt` survives — the round-trip THREW `TypeError` on it', async () => {
    const ds = new ValueDataSource({ items: [{ id: '1', big: 10n ** 20n }] });

    const [row] = (await ds.find('things')).data as any[];
    expect(typeof row.big).toBe('bigint');
    expect(row.big).toBe(10n ** 20n);
  });

  it('a cyclic row graph survives — the round-trip threw "Converting circular structure to JSON"', async () => {
    const row: any = { id: '1', name: 'HQ' };
    row.self = row;

    const ds = new ValueDataSource({ items: [row] });

    const [clone] = (await ds.find('places')).data as any[];
    expect(clone.self).toBe(clone);
    expect(clone.self).not.toBe(row);
    expect(clone.name).toBe('HQ');
  });

  it('a `RegExp` survives as a `RegExp` — the round-trip flattened it to `{}`', async () => {
    const ds = new ValueDataSource({ items: [{ id: '1', pattern: /^a.c$/i }] });

    const [row] = (await ds.find('things')).data as any[];
    expect(row.pattern).toBeInstanceOf(RegExp);
    expect(row.pattern.source).toBe('^a.c$');
  });

  it('`NaN` and `Infinity` survive as numbers — the round-trip turned both into `null`', async () => {
    const ds = new ValueDataSource({ items: [{ id: '1', a: NaN, b: Infinity }] });

    const [row] = (await ds.find('things')).data as any[];
    expect(Number.isNaN(row.a)).toBe(true);
    expect(row.b).toBe(Infinity);
  });

  it('`getAll()` preserves the same shapes as `find()` — one clone rule, two call sites', () => {
    const when = new Date('2026-09-11T14:08:00.000Z');
    const ds = new ValueDataSource({ items: [{ id: '1', start: when, owner: undefined }] });

    const [row] = ds.getAll() as any[];
    expect(row.start).toBeInstanceOf(Date);
    expect(Object.prototype.hasOwnProperty.call(row, 'owner')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// (3) The boundary that stays LOUD. ⛔ Never softened with a fallback.
// ---------------------------------------------------------------------------
describe('the structured-clone boundary is loud, not silent (objectui#9175)', () => {
  it('a function-valued row THROWS instead of being silently stripped', () => {
    expect(() => new ValueDataSource({ items: [{ id: '1', onClick: () => 'hi' }] })).toThrow();
  });

  it('names the value it refused — the round-trip deleted the key and said nothing', () => {
    let caught: unknown;
    try {
      new ValueDataSource({ items: [{ id: '1', onClick: () => 'hi' }] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(String((caught as Error).message)).toMatch(/could not be cloned|DataCloneError/i);
  });
});

// ---------------------------------------------------------------------------
// (4) Per-consumer pins — the two production routes into this constructor.
// ---------------------------------------------------------------------------
describe('per-consumer shape, measured through the route each consumer uses', () => {
  /**
   * Route A — `resolveDataSource({ provider: 'value' })`.
   *
   * Reached by `useViewData` (`@object-ui/react`) and `ObjectGantt`, and the
   * route objectui#9061 / objectui#9136 add for the inline arms of
   * ObjectCalendar, ObjectMap and ObjectTree. `ViewData.items` is
   * `z.array(z.unknown())` in `@objectstack/spec` — the spec places no
   * serializability requirement on a row, so neither does this adapter.
   */
  it('route A — a `Date`-bearing inline row reaches the renderer as a `Date`', async () => {
    const when = new Date('2026-09-11T14:08:00.000Z');
    const ds = resolveDataSource({ provider: 'value', items: [{ id: '1', start: when }] } as any, null);

    expect(ds).not.toBeNull();
    const [row] = (await ds!.find('events')).data as any[];
    expect(row.start).toBeInstanceOf(Date);
    expect(row.start.getTime()).toBe(when.getTime());
  });

  it('route A — an inline row the serializer cannot handle is no longer refused', async () => {
    const row: any = { id: '1', name: 'HQ', latitude: 40, longitude: -74 };
    row.self = row; // what an expanded lookup looks like once a host inlines it

    const ds = resolveDataSource({ provider: 'value', items: [row] } as any, null);
    const result = await ds!.find('places');

    expect(result.data).toHaveLength(1);
    expect((result.data[0] as any).latitude).toBe(40);
  });

  /**
   * Route B — `new ValueDataSource({ items })` directly, which is what
   * `plugin-designer`'s `FieldDesigner` (`items: filteredFields`) and
   * `ObjectManager` (`items: displayObjects`) do. These rows are plain
   * in-memory metadata: strings, numbers, booleans, nested plain objects. That
   * population is EXACTLY the intersection where the two clones agree, which is
   * why this consumer's observable shape does not move at all.
   */
  it('route B — a designer-shaped row is byte-identical under either clone', async () => {
    const fieldRow = {
      name: 'amount',
      label: 'Amount',
      type: 'number',
      required: true,
      unique: false,
      group: 'Financials',
      options: [{ value: 'a', label: 'A' }],
    };
    const ds = new ValueDataSource({ items: [fieldRow] });

    const [row] = (await ds.find('field_definition')).data as any[];
    expect(row).toEqual(fieldRow);
    expect(row).not.toBe(fieldRow);
    // The discriminating half: this row survives a JSON round-trip unchanged,
    // so "identical under either clone" is a claim about THIS population and
    // not a general one.
    expect(row).toEqual(JSON.parse(JSON.stringify(fieldRow)));
  });
});

// ---------------------------------------------------------------------------
// (5) Downstream reads of the preserved shapes — measured, not assumed.
// ---------------------------------------------------------------------------
describe('what the preserved shapes change downstream', () => {
  /**
   * `getObjectSchema` infers field types from the first row with `typeof`.
   * A `Date` therefore used to infer as `'string'` (it WAS a string by then)
   * and now infers as `'object'`; a key whose value is `undefined` used to be
   * absent from the inferred schema entirely and is now present as
   * `'undefined'`. Both are consequences of the clone, pinned here so the move
   * is recorded rather than discovered.
   */
  it('`getObjectSchema` now sees the row as authored', async () => {
    const ds = new ValueDataSource({
      items: [{ id: '1', start: new Date('2026-09-11T14:08:00.000Z'), owner: undefined }],
    });

    expect(await ds.getObjectSchema('events')).toEqual({
      name: 'events',
      fields: {
        id: { type: 'string' },
        start: { type: 'object' },
        owner: { type: 'undefined' },
      },
    });
  });

  it('a `Date` sorts chronologically instead of lexically', async () => {
    const ds = new ValueDataSource({
      items: [
        { id: 'b', at: new Date('2026-01-02T00:00:00.000Z') },
        { id: 'a', at: new Date('2026-01-01T00:00:00.000Z') },
      ],
    });

    const result = await ds.find('events', { $orderby: { at: 'asc' } } as any);
    expect((result.data as any[]).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
