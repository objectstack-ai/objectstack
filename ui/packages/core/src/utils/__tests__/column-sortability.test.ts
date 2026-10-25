/**
 * [#5729] The consumer half of objectstack#10235's ruling A: the grid reads
 * the platform's SERVED per-column sortability signal and never re-derives
 * "virtual ⇒ unsortable" from field type.
 *
 * The load-bearing assertions here are the two asymmetries the contract turns
 * on, both of which a reasonable-looking implementation gets backwards:
 *
 *  - ABSENT ENTRY inside a served projection means "no platform sort behind
 *    this name" and must answer `false`. The `!== false` spelling every other
 *    optional flag in this repo uses answers `true` for it.
 *  - ABSENT PROJECTION means "no signal was served", which is a different
 *    question with a different answer, and is typed differently
 *    (`undefined`) so the two cannot be conflated.
 *
 * AGREEMENT over hardcoding: the fixtures are produced by the platform's own
 * `resolveObjectSortability` from `@objectstack/spec/api` — the resolver the
 * REST layer serves this projection from — so these pins follow the runtime's
 * predicate rather than a copied verdict table.
 */
import { describe, it, expect } from 'vitest';
import { resolveObjectSortability } from '@objectstack/spec/api';
import {
  OBJECT_SORTABILITY_KEY,
  attachObjectSortability,
  readObjectSortability,
  normalizeObjectSortability,
  isPlatformSortableField,
  filterPlatformSortableSort,
  type ObjectSortability,
} from '../column-sortability';

/** The #10235 oracle shape: a formula column beside ordinary persisted ones. */
const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    name: { type: 'text' },
    amount: { type: 'currency' },
    owner: { type: 'lookup', reference_to: 'sys_user' },
    expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
  },
};

describe('the served projection agrees with the platform resolver (#5729 / objectstack#10235)', () => {
  it('marks the oracle formula column unsortable and its persisted siblings sortable', () => {
    const served = resolveObjectSortability(OPPORTUNITY) as ObjectSortability;

    expect(served.fields.expected_revenue).toEqual({ sortable: false, reason: 'virtual-type' });
    expect(served.fields.amount).toEqual({ sortable: true });
    expect(served.fields.name).toEqual({ sortable: true });
    // The driver-provisioned primary key is always in the projection's domain.
    expect(served.fields.id).toEqual({ sortable: true });
  });

  it('answers `sortable: true` for a RELATIONAL column — so the grid cannot delegate that rule here', () => {
    // Measured, not assumed: a `lookup` has a stored foreign-key column and
    // both runtime doors accept an ORDER BY over it. The grid still withholds
    // that header, for a reason the platform does not share (ordering a column
    // of names by an invisible id). Pinning it here is what stops someone
    // "simplifying" the grid into asking this signal the relational question.
    const served = resolveObjectSortability(OPPORTUNITY) as ObjectSortability;
    expect(served.fields.owner).toEqual({ sortable: true });
  });
});

describe('isPlatformSortableField — the contract, and its two asymmetries', () => {
  const served = resolveObjectSortability(OPPORTUNITY) as ObjectSortability;

  it('offers the affordance only when an entry EXISTS and says sortable: true', () => {
    expect(isPlatformSortableField(served, 'amount')).toBe(true);
    expect(isPlatformSortableField(served, 'expected_revenue')).toBe(false);
  });

  it('refuses an ABSENT entry — the case a `!== false` test gets exactly backwards', () => {
    // Three shapes the platform encodes as absence, all refused by the runtime
    // doors: an unknown name, a dotted path, an unprovisioned audit column.
    expect(isPlatformSortableField(served, 'not_a_field')).toBe(false);
    expect(isPlatformSortableField(served, 'account.name')).toBe(false);
    expect(isPlatformSortableField(served, 'created_at')).toBe(false);
    // The counter-probe that proves the three above are not just a broken
    // reader answering `false` to everything.
    expect(isPlatformSortableField(served, 'name')).toBe(true);
    // And the spelling this function exists to forbid, stated as a fact:
    // reading the same absence with `!== false` would have answered `true`.
    expect((served.fields as any).not_a_field?.sortable !== false).toBe(true);
  });

  it('refuses an empty / malformed field name and a malformed entry', () => {
    expect(isPlatformSortableField(served, undefined)).toBe(false);
    expect(isPlatformSortableField(served, '')).toBe(false);
    expect(isPlatformSortableField({ fields: { a: null as any } }, 'a')).toBe(false);
    expect(isPlatformSortableField({ fields: { a: { sortable: 'yes' } as any } }, 'a')).toBe(false);
  });

  it('KEEPS the click on `caveat: unprovisioned-anchor` — the platform does not refuse it', () => {
    // Default A of the #10235 affordance question, held until ruled: refusing
    // what the platform accepts would recreate declared-≠-enforced drift in
    // mirror image. The caveat is advisory; `sortable` is the enforcement fact.
    const withCaveat: ObjectSortability = {
      fields: { remote_anchor: { sortable: true, caveat: 'unprovisioned-anchor' } },
    };
    expect(isPlatformSortableField(withCaveat, 'remote_anchor')).toBe(true);
  });
});

describe('the carrier: attach / read, and what it deliberately hides', () => {
  it('round-trips the served projection through the schema object', () => {
    const schema: any = { name: 'crm_opportunity', fields: OPPORTUNITY.fields };
    attachObjectSortability(schema, resolveObjectSortability(OPPORTUNITY));

    const read = readObjectSortability(schema);
    expect(read?.fields.expected_revenue).toEqual({ sortable: false, reason: 'virtual-type' });
    expect(isPlatformSortableField(read!, 'amount')).toBe(true);
  });

  it('is invisible to JSON.stringify, Object.keys and spread — it can never reach a write body', () => {
    // The upstream change kept `sortability` OFF the document because
    // `FieldSchema` is a strict object and the server rejects an undeclared
    // key by name. A string key here would have undone that one repo away.
    const schema: any = { name: 'crm_opportunity', fields: {} };
    attachObjectSortability(schema, { fields: { id: { sortable: true } } });

    expect(JSON.parse(JSON.stringify(schema))).toEqual({ name: 'crm_opportunity', fields: {} });
    expect(Object.keys(schema)).toEqual(['name', 'fields']);
    expect(readObjectSortability({ ...schema })).toBeUndefined();
    // Counter-probe: it really is on the original object, so the three
    // assertions above are about invisibility, not about a failed attach.
    expect(readObjectSortability(schema)).toBeDefined();
    expect((schema as any)[OBJECT_SORTABILITY_KEY]).toBeDefined();
  });

  it('attaches NOTHING when the envelope carried no projection — absence stays absence', () => {
    // A backend older than objectstack#10235, an inline data source, a
    // fixture. Stamping an empty projection here would tell every consumer,
    // falsely, that no column on the object is sortable.
    for (const served of [undefined, null, {}, { fields: null }, [], 'nope']) {
      const schema: any = { name: 'x', fields: {} };
      attachObjectSortability(schema, served as any);
      expect(readObjectSortability(schema)).toBeUndefined();
    }
    // Counter-probe: a well-formed envelope value on the same helper attaches.
    const ok: any = { name: 'x', fields: {} };
    attachObjectSortability(ok, { fields: { id: { sortable: true } } });
    expect(readObjectSortability(ok)).toBeDefined();
  });

  it('normalizes a served envelope value, dropping only the unusable entries', () => {
    const normalized = normalizeObjectSortability({
      fields: {
        good: { sortable: true },
        refused: { sortable: false, reason: 'virtual-type' },
        caveated: { sortable: true, caveat: 'unprovisioned-anchor' },
        junk: { sortable: 'maybe' },
        alsoJunk: null,
      },
    });
    expect(normalized?.fields).toEqual({
      good: { sortable: true },
      refused: { sortable: false, reason: 'virtual-type' },
      caveated: { sortable: true, caveat: 'unprovisioned-anchor' },
    });
  });

  it('reads `undefined` off a schema that was never stamped', () => {
    expect(readObjectSortability({ name: 'x', fields: {} })).toBeUndefined();
    expect(readObjectSortability(undefined)).toBeUndefined();
    expect(readObjectSortability(null)).toBeUndefined();
  });
});

describe('filterPlatformSortableSort — the restore leg', () => {
  const served = resolveObjectSortability(OPPORTUNITY) as ObjectSortability;

  it('drops a persisted sort on a column the platform refuses, keeping its siblings', () => {
    const restored = [
      { field: 'expected_revenue', order: 'desc' },
      { field: 'amount', order: 'asc' },
      { field: 'not_a_field', order: 'asc' },
    ];
    expect(filterPlatformSortableSort(restored, served)).toEqual([
      { field: 'amount', order: 'asc' },
    ]);
  });

  it('is a no-op on a sort the platform honors, and total on a sort it does not', () => {
    const honored = [{ field: 'name', order: 'asc' }];
    expect(filterPlatformSortableSort(honored, served)).toEqual(honored);
    expect(filterPlatformSortableSort([{ field: 'expected_revenue', order: 'asc' }], served)).toEqual([]);
    expect(filterPlatformSortableSort(undefined, served)).toEqual([]);
  });
});
