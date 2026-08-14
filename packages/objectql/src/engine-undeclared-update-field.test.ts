// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #8738 — an undeclared field must be refused by the SCHEMA on the UPDATE path
// too, before the `beforeUpdate` hooks run. The sibling of #8682's insert door
// (`engine-undeclared-field-preflight.test.ts`), and deliberately the same
// door: one condition, one implementation, two callers.
//
// ## The card filed this half as INFERRED — here is the measurement
//
// #8738 says in as many words that nobody had run an update-path reproduction,
// and asks for one before anyone implements. Run on `origin/main` @ `e5eeb499c`
// with a real `ObjectQL` and the recording driver below, one mistyped key:
//
//   by-id    driver.update     received `zzz_nonexistent_field`  → refused THERE
//   multi    driver.updateMany received it likewise              → refused THERE
//   hooks    `beforeUpdate` ran FIRST on both branches
//   payload  {name, zzz_nonexistent_field, description:'derived-for-bad'}
//            ← `description` is the HOOK's derived value, not the caller's: it
//              was computed for, and travelled with, a request the server had
//              already decided to refuse.
//   envelope the thrown error carried NO `code` and NO `status` — the driver's
//            raw string, which `mapDataError` translated at the REST boundary.
//
// Both inferred claims reproduce. The premise stands.
//
// ## What the pin is, and what it deliberately is NOT
//
// The insert half pinned an AUTONUMBER GAP, because an insert issues a sequence
// value that a refused request consumed permanently. **Update has no such
// observable** — no autonumber, nothing durable consumed — so the card is
// milder by exactly that much, and the pin has to be the thing that IS at
// stake: the HOOK RUN. `beforeUpdate` stamping a ledger, calling out, or
// deriving a field for a request that is then refused is the whole defect here,
// so `hookRuns` is asserted directly rather than inferred from a counter.
//
// A suite that only asserted "an undeclared key is refused" would be satisfied
// by a door that refuses everything, so every case below has its positive
// twin: declared keys still update on both branches, and each of the three
// no-opinion cases is pinned as a CONTROL that must pass with the door removed
// as well as with it in place.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

/** Records everything that reached the driver — presence is the point. */
function makeRecordingDriver(missingColumns: readonly string[] = []) {
  const writes: Array<{ fn: string; data: Record<string, unknown> }> = [];
  const stored: Record<string, unknown> = { id: 'row-1', name: 'stored', description: 'd' };
  const driver: any = {
    name: 'recording', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return [{ ...stored }]; },
    async findOne() { return { ...stored }; },
    async create(object: string, data: Record<string, unknown>) {
      writes.push({ fn: 'create', data: { ...data } });
      return { id: 'rec_1', ...data };
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ fn: 'update', data: { ...data } });
      const bad = missingColumns.find((c) => c in data);
      // The shape knex produces: the bound statement, then ` - `, then the
      // database's own diagnostic.
      if (bad) throw new Error(`update \`${object}\` set \`${bad}\` = 'v' where \`id\` = '${id}' - table ${object} has no column named ${bad}`);
      return { ...stored, ...data, id };
    },
    async updateMany(object: string, _ast: unknown, data: Record<string, unknown>) {
      writes.push({ fn: 'updateMany', data: { ...data } });
      const bad = missingColumns.find((c) => c in data);
      if (bad) throw new Error(`update \`${object}\` set \`${bad}\` = 'v' - table ${object} has no column named ${bad}`);
      return 1;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return 1; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => driver.create(object, r)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes };
}

function silentLogger() {
  const logger: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return logger; },
  };
  return logger;
}

/**
 * The `beforeUpdate` hook DERIVES a value the caller never sent — the card's
 * `period_label = 'Q3 2026'` shape — so "the hook ran" is a fact about app
 * behaviour reaching the statement, not merely a counter ticking.
 */
async function makeEngine(options: {
  missingColumns?: readonly string[];
  /** `'declared'` (default) · `'none'` (registry-less) */
  registration?: 'declared' | 'none';
  /**
   * Replace what `getObject('acct')` answers, AFTER a normal registration.
   *
   * Necessary rather than decorative, and it is the shape the real fixtures
   * have: `registerObject({ fields: {} })` does NOT leave the map empty — the
   * registry INJECTS `organization_id`, `created_at`, `created_by`,
   * `updated_at`, `updated_by`, `owner_id` and `owning_business_unit_id` on
   * top, measured here. So an object registered with an empty map is not an
   * object whose map the door SEES as empty, and a control built that way
   * would pass for a reason that has nothing to do with the rule it claims to
   * pin. The 15 `fields: {}` fixtures #8737 triaged carry a registry STUB, not
   * a registration — this reproduces that, and only for `acct`.
   */
  stubFields?: Record<string, unknown>;
} = {}) {
  const engine = new ObjectQL({ logger: silentLogger() });
  const { driver, writes } = makeRecordingDriver(options.missingColumns ?? []);
  engine.registerDriver(driver, true);
  await engine.init();
  const registration = options.registration ?? 'declared';
  if (registration === 'declared') {
    engine.registry.registerObject({
      name: 'acct',
      fields: {
        id: { name: 'id', type: 'text', primaryKey: true },
        name: { name: 'name', type: 'text' },
        description: { name: 'description', type: 'text' },
      },
    } as any, 'test');
  }
  if (options.stubFields) {
    const inner = engine.registry.getObject.bind(engine.registry);
    (engine.registry as any).getObject = (name: string) =>
      (name === 'acct' ? { name: 'acct', fields: options.stubFields } : inner(name));
  }
  const hookRuns: string[] = [];
  engine.registerHook('beforeUpdate', (ctx: any) => {
    hookRuns.push(String(ctx.input.data?.name ?? '?'));
    ctx.input.data.description = `derived-for-${ctx.input.data?.name}`;
  }, { object: 'acct' });
  return { engine, writes, hookRuns };
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return null;
}

describe('#8738 — the declared-field door on update()', () => {
  describe('the ordering claim — the card`s actual subject', () => {
    it('by-id: the beforeUpdate hook does NOT run for a payload carrying an undeclared key', async () => {
      const { engine, hookRuns } = await makeEngine();

      await refusalOf(() => engine.update('acct', { id: 'row-1', name: 'bad', zzz_nonexistent_field: 'x' } as any));

      // `['bad']` on `origin/main`: the hook ran, and its derived `description`
      // reached the statement the driver then rejected. A hook is not a pure
      // function — it stamps ledgers and calls out — so running it for a
      // refused request is a side effect, not a wasted cycle.
      expect(hookRuns).toEqual([]);
    });

    it('multi: the beforeUpdate hook does NOT run either — the predicate branch has the same hole', async () => {
      const { engine, hookRuns } = await makeEngine();

      await refusalOf(() => engine.update(
        'acct',
        { name: 'bad', zzz_nonexistent_field: 'x' } as any,
        { where: { name: 'stored' }, multi: true } as any,
      ));

      expect(hookRuns).toEqual([]);
    });

    it('the hook still runs — and is still the last word — when every key is declared', async () => {
      // The other direction of the ordering pin: the door refuses a payload, it
      // does not suppress the hook phase. Without this, "the hook did not run"
      // is satisfied by a door that refuses everything.
      const { engine, writes, hookRuns } = await makeEngine();

      await engine.update('acct', { id: 'row-1', name: 'ok' } as any);

      expect(hookRuns).toEqual(['ok']);
      expect(writes).toHaveLength(1);
      expect(writes[0].data.description).toBe('derived-for-ok');
    });
  });

  describe('the refusal', () => {
    it('by-id: nothing reaches the driver', async () => {
      const { engine, writes } = await makeEngine();

      await refusalOf(() => engine.update('acct', { id: 'row-1', name: 'bad', zzz_nonexistent_field: 'x' } as any));

      // Zero, not one: the pre-update read is skipped too. A refused write
      // should not cost a driver round-trip, and `previous` / the not-found
      // gate / the `readonlyWhen` gate — the read's three consumers — are all
      // downstream of a payload this door never lets through.
      expect(writes).toHaveLength(0);
    });

    it('multi: nothing reaches the driver', async () => {
      const { engine, writes } = await makeEngine();

      await refusalOf(() => engine.update(
        'acct',
        { name: 'bad', zzz_nonexistent_field: 'x' } as any,
        { where: { name: 'stored' }, multi: true } as any,
      ));

      expect(writes).toHaveLength(0);
    });

    it('refuses in the ADR-0112 envelope, with the wire answer unchanged', async () => {
      const { engine } = await makeEngine();

      const refusal = await refusalOf(() => engine.update('acct', { id: 'row-1', name: 'bad', zzz_nonexistent_field: 'x' } as any));

      // `code` AND `status` — the envelope, not merely "it threw". On
      // `origin/main` both were `undefined` here: what the engine threw was the
      // driver's raw string, and only `mapDataError` at the REST boundary gave
      // it a shape.
      expect(refusal?.code).toBe('INVALID_FIELD');
      expect(refusal?.status).toBe(400);
      expect(refusal?.field).toBe('zzz_nonexistent_field');
      expect(refusal?.object).toBe('acct');
      // Byte-identical to what `mapDataError`'s driver-string branch produced
      // for the same mistake, so the caller reads exactly what it read before —
      // the refusal moved, the answer did not.
      expect(refusal?.message).toBe("Unknown field 'zzz_nonexistent_field' on object 'acct'");
    });

    it('names every undeclared key, not only the first', async () => {
      const { engine } = await makeEngine();

      const refusal = await refusalOf(() => engine.update('acct', {
        id: 'row-1', name: 'bad', zzz_one: 1, zzz_two: 2,
      } as any));

      expect(refusal?.field).toBe('zzz_one');
      expect(refusal?.fields).toEqual(['zzz_one', 'zzz_two']);
    });

    it('a key holding `undefined` is still an undeclared key', async () => {
      // `{ ...partial }` is how this arrives from code rather than from JSON,
      // and a mistyped key is a mistyped key whatever it holds.
      const { engine } = await makeEngine();

      const refusal = await refusalOf(() => engine.update('acct', { id: 'row-1', zzz_typo: undefined } as any));

      expect(refusal?.code).toBe('INVALID_FIELD');
      expect(refusal?.field).toBe('zzz_typo');
    });
  });

  describe('declared keys still update normally', () => {
    it('by-id: a declared payload lands on the driver untouched', async () => {
      const { engine, writes } = await makeEngine();

      await engine.update('acct', { id: 'row-1', name: 'renamed' } as any);

      expect(writes).toHaveLength(1);
      expect(writes[0].fn).toBe('update');
      expect(writes[0].data.name).toBe('renamed');
    });

    it('multi: a declared payload lands on the driver untouched', async () => {
      const { engine, writes } = await makeEngine();

      await engine.update(
        'acct',
        { name: 'renamed' } as any,
        { where: { name: 'stored' }, multi: true } as any,
      );

      expect(writes).toHaveLength(1);
      expect(writes[0].fn).toBe('updateMany');
      expect(writes[0].data.name).toBe('renamed');
    });
  });

  // The three no-opinion cases are #8737's, reused rather than re-derived —
  // settled rules from the sibling card. Each is a CONTROL: it asserts the door
  // has NO verdict, so it must pass with the door removed as well as with it in
  // place, and a reverse verification that turned one of these red would mean
  // the door had grown an opinion it is not allowed to have.
  describe('where the door deliberately has NO opinion (reused from #8737)', () => {
    it('a registry-less host gets no verdict — the driver stays the backstop', async () => {
      const { engine, writes } = await makeEngine({ registration: 'none', missingColumns: ['zzz_nonexistent_field'] });

      const refusal = await refusalOf(() => engine.update('acct', { id: 'row-1', zzz_nonexistent_field: 'x' } as any));

      expect(writes).toHaveLength(1);
      expect(String(refusal?.message)).toContain('has no column named zzz_nonexistent_field');
    });

    it('an EMPTY field map gets no verdict — an absence is not a prohibition', async () => {
      // A real registered object always carries at least its primary key and
      // the registry's injected audit columns, so a map the door sees as EMPTY
      // means the host did not fill it in. Refusing everything on that reading
      // would be a verdict made from an absence.
      const { engine, writes } = await makeEngine({ stubFields: {}, missingColumns: ['zzz_nonexistent_field'] });

      const refusal = await refusalOf(() => engine.update('acct', { id: 'row-1', zzz_nonexistent_field: 'x' } as any));

      expect(writes).toHaveLength(1);
      expect(String(refusal?.message)).toContain('has no column named zzz_nonexistent_field');
    });

    it('`id` / `created_at` / `updated_at` pass even when the declaration omits them', async () => {
      // Mirrors the three names `find()` / `findOne()` already add to their
      // known set: platform-provisioned rather than authored, so a key accepted
      // by a read is not refused by a write. Stubbed rather than registered
      // for the reason `stubFields` records — the registry would otherwise
      // inject `created_at` / `updated_at` itself and the case would prove
      // nothing about the door. `id` is the one name the registry does NOT
      // inject, so it is the door's tolerance being read here, and only its.
      const { engine, writes } = await makeEngine({
        stubFields: { name: { name: 'name', type: 'text' } },
      });

      const refusal = await refusalOf(() => engine.update('acct', {
        id: 'row-1', name: 'ok', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
      } as any));

      expect(refusal).toBeNull();
      expect(writes).toHaveLength(1);
    });

    it('schema drift — a DECLARED field whose column is missing — still reaches the driver', async () => {
      // The door's scope is the SCHEMA's field map, so drift is invisible to it
      // by construction and stays the driver's to refuse. `mapDataError`'s
      // driver-string branch is still needed and still fires.
      const { engine, writes } = await makeEngine({ missingColumns: ['description'] });

      const refusal = await refusalOf(() => engine.update('acct', { id: 'row-1', description: 'v' } as any));

      expect(writes).toHaveLength(1);
      expect(String(refusal?.message)).toContain('has no column named description');
    });
  });
});
