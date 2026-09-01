// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13657 — the declared-field door's POST-HOOK half.
//
// #8682 / #8738 put the door in and PR #8737 moved it AHEAD of the `before*`
// hooks and ahead of statement construction, so that no work (above all, no
// autonumber) is consumed by a payload about to be refused. That is correct and
// this suite does not move it — `engine-undeclared-field-preflight.test.ts` and
// `engine-undeclared-update-field.test.ts` still pin it where it is.
//
// What that placement left uncovered is the payload the HOOKS produce. The door
// judged the caller's keys; `beforeInsert` then ran and could add any key at
// all; and from there the three shipped drivers did three different things —
// measured on `@objectstack/*` 17.1.0, one `beforeInsert` hook setting
// `ctx.input.tax_rate = 10` on an object that does not declare it:
//
//   memory        ACCEPTED — `tax_rate: 10` stored and returned on read
//   driver-sql    refused  — raw `SQLITE_ERROR`, no `status`
//   sqlite-wasm   refused  — a bare `Error`, no `code` and no `status`
//
// One app, one hook, three meanings decided by which driver a deployment
// happens to run, and nothing in the app can tell which one it is. The
// `memory` outcome is the security half: `fieldPermissions` is a POSITIVE
// declaration keyed by field name (`FieldMasker.detectForbiddenWrites` reports
// only fields explicitly `editable: false`), so a key the object never declares
// can carry no entry, is never an offender, and lands in storage outside
// field-level security — where no view, formula, index or permission can name
// it.
//
// ## What this suite pins, and how it reads the drivers
//
// The repair is an engine-level refusal, so the claim under test is
// UNREACHABILITY: after the door, no driver is reached at all, which is why all
// three answer identically. The three doubles below reproduce the three
// measured post-door behaviours — accept-and-store, raw `SQLITE_ERROR`, bare
// `Error` — and every convergence test asserts BOTH halves: one identical
// ADR-0112 envelope out, and zero writes recorded on each double. ⚠️ Stated
// honestly: these are the three doors this suite EXERCISES (the engine's
// `create` / `bulkCreate` / `update` / `updateMany` dispatches through
// `IDataDriver`). It does not boot the real `driver-sql` or `sqlite-wasm`
// packages — objectql depends on neither — so the claim pinned here is that the
// engine refuses before any driver dispatch, not that those two packages were
// re-measured.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

function silentLogger() {
  const logger: any = {
    trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
    child() { return logger; },
  };
  return logger;
}

/**
 * The three post-door driver behaviours the card measured, as doubles.
 *
 * `writes` is the load-bearing observable: a refusal that merely produced the
 * right envelope while still dispatching would leave the divergence — and
 * #8682's Half B statement leak — exactly where they were.
 */
type Flavour = 'memory' | 'sql' | 'wasm';

function makeDriver(flavour: Flavour) {
  const writes: Array<{ fn: string; data: Record<string, unknown> }> = [];
  const stored = new Map<string, Record<string, unknown>>();

  /**
   * What each flavour does when an undeclared key reaches it.
   *
   * Takes only the object and the offending key: the SQL arm quotes a fixed
   * value in its statement string on purpose, because the point of that arm is
   * the shape driver-sql used to leak (`insert into … values (10)`), not this
   * double's own payload.
   */
  const refuse = (object: string, undeclared: string): never => {
    if (flavour === 'sql') {
      // driver-sql / knex: the bound statement AND its values, then the
      // database's own diagnostic. `code` is the backend's, `status` absent.
      const err: any = new Error(
        `insert into \`${object}\` (\`${undeclared}\`) values (10) returning * - table ${object} has no column named ${undeclared}`,
      );
      err.code = 'SQLITE_ERROR';
      throw err;
    }
    // sqlite-wasm: a bare Error — no `code`, no `status`.
    throw new Error(`no such column: ${undeclared}`);
  };

  const declaredByThisDouble = new Set(['id', 'name', 'description', 'account_number', 'created_at', 'updated_at']);

  const driver: any = {
    name: flavour, version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(_o: string) { return [...stored.values()]; },
    async findOne(_o: string, ast: any) {
      const id = ast?.where?.id;
      return (typeof id === 'string' ? stored.get(id) : [...stored.values()][0]) ?? null;
    },
    async create(object: string, data: Record<string, unknown>) {
      writes.push({ fn: 'create', data: { ...data } });
      const bad = Object.keys(data).find((k) => !declaredByThisDouble.has(k));
      // `memory` is the ACCEPTING flavour: it spreads the payload, so the stray
      // key is persisted and read back — the shadow column.
      if (bad && flavour !== 'memory') refuse(object, bad);
      const id = (data.id as string) ?? `rec_${writes.length}`;
      const row = { id, ...data };
      stored.set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      writes.push({ fn: 'update', data: { ...data } });
      const bad = Object.keys(data).find((k) => !declaredByThisDouble.has(k));
      if (bad && flavour !== 'memory') refuse(object, bad);
      const row = { ...(stored.get(id) ?? { id }), ...data, id };
      stored.set(id, row);
      return row;
    },
    async updateMany(object: string, _ast: any, data: Record<string, unknown>) {
      writes.push({ fn: 'updateMany', data: { ...data } });
      const bad = Object.keys(data).find((k) => !declaredByThisDouble.has(k));
      if (bad && flavour !== 'memory') refuse(object, bad);
      for (const [id, row] of stored) stored.set(id, { ...row, ...data, id });
      return stored.size;
    },
    async delete() { return true; },
    async deleteMany() { return 0; },
    async count() { return stored.size; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      const out: Record<string, unknown>[] = [];
      for (const r of rows) out.push(await driver.create(object, r));
      return out;
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, writes, stored };
}

interface EngineOptions {
  flavour?: Flavour;
  /** What the `beforeInsert` / `beforeUpdate` hook stamps onto the payload. */
  hookWrites?: Record<string, unknown>;
  /** Register the hook against `'*'` (the platform's own audit-hook shape). */
  wildcard?: boolean;
}

async function makeEngine(options: EngineOptions = {}) {
  const engine = new ObjectQL({ logger: silentLogger() });
  const { driver, writes, stored } = makeDriver(options.flavour ?? 'memory');
  engine.registerDriver(driver, true);
  await engine.init();
  // Two objects, because the registry's own injection decides which half of the
  // door a key meets. Measured on this engine, `registerObject` returns `acct`
  // with `created_at, created_by, organization_id, owner_id,
  // owning_business_unit_id, updated_at, updated_by` ADDED to the authored
  // three — so on an ordinary object the audit family is DECLARED and the
  // door's own tolerance never has to carry it.
  engine.registry.registerObject({
    name: 'acct',
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
      name: { name: 'name', type: 'text' },
      description: { name: 'description', type: 'text' },
      account_number: { name: 'account_number', type: 'autonumber' },
    },
  } as any, 'test');
  // `bare` takes the `systemFields: false` hard opt-out (seed / migration
  // tables — `resolveInjectedSystemColumns` injects NOTHING for it). This is
  // the object on which the platform's own unconditional `created_at` /
  // `updated_at` stamp actually meets the door, so it is where the
  // `PLATFORM_PROVISIONED_COLUMNS` tolerance is load-bearing rather than
  // shadowed by injection.
  engine.registry.registerObject({
    name: 'bare',
    systemFields: false,
    fields: {
      id: { name: 'id', type: 'text', primaryKey: true, readonly: true },
      name: { name: 'name', type: 'text' },
      description: { name: 'description', type: 'text' },
    },
  } as any, 'test');

  const hookRuns: string[] = [];
  if (options.hookWrites) {
    const stamp = (ctx: any) => {
      hookRuns.push(String(ctx.input.data?.name ?? ctx.input.id ?? '?'));
      Object.assign(ctx.input.data, options.hookWrites);
    };
    const scope = options.wildcard ? {} : { object: 'acct' };
    engine.registerHook('beforeInsert', stamp, scope as any);
    engine.registerHook('beforeUpdate', stamp, scope as any);
  }
  return { engine, writes, stored, hookRuns };
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (e) {
    return e;
  }
  return null;
}

const FLAVOURS: Flavour[] = ['memory', 'sql', 'wasm'];

// ───────────────────────────────────────────────────────────────────────────
describe('#13657 — a beforeInsert-written undeclared key is refused', () => {
  it.each(FLAVOURS)('%s: the ADR-0112 envelope, identical on every driver', async (flavour) => {
    const { engine, writes } = await makeEngine({ flavour, hookWrites: { tax_rate: 10 } });

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'ok' }));

    // The caller path's answer, not any driver's. On `origin/main` this read:
    // memory -> no refusal at all; sql -> code 'SQLITE_ERROR', status
    // undefined; wasm -> code undefined, status undefined.
    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
    expect(refusal?.field).toBe('tax_rate');
    expect(refusal?.object).toBe('acct');
    expect(refusal?.message).toBe("Unknown field 'tax_rate' on object 'acct'");
    // Unreachability — the reason all three agree.
    expect(writes).toHaveLength(0);
  });

  it('memory no longer stores the shadow column', async () => {
    const { engine, stored } = await makeEngine({ flavour: 'memory', hookWrites: { tax_rate: 10 } });

    await refusalOf(() => engine.insert('acct', { name: 'ok' }));

    // The card's headline `memory` reading: `tax_rate: 10` stored and returned
    // on read, outside `fieldPermissions` by construction.
    expect(stored.size).toBe(0);
  });

  it('A2.5 — the refusal carries no bound statement and no values', async () => {
    const { engine } = await makeEngine({ flavour: 'sql', hookWrites: { tax_rate: 10 } });

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'ok' }));

    // #8682 Half B: both SQL refusals used to carry the full bound INSERT with
    // its values. Refusing pre-statement puts that out of reach on this path.
    expect(refusal?.message).not.toMatch(/insert into/i);
    expect(refusal?.message).not.toMatch(/values/i);
    expect(refusal?.message).not.toContain('10');
  });

  it('refusing costs no autonumber — #8737`s rule, one step in', async () => {
    const { engine } = await makeEngine({ flavour: 'memory' });
    const before: any = await engine.insert('acct', { name: 'ok-1' });

    // Bind the offending hook only now, so the first two writes are clean.
    engine.registerHook('beforeInsert', (ctx: any) => {
      if (ctx.input.data?.name === 'bad') ctx.input.data.tax_rate = 10;
    }, { object: 'acct' });

    await refusalOf(() => engine.insert('acct', { name: 'bad' }));
    const after: any = await engine.insert('acct', { name: 'ok-2' });

    // No gap: the refused row never reached `applyAutonumbers`.
    expect(before.account_number).toBe('0001');
    expect(after.account_number).toBe('0002');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('#13657 — a beforeUpdate-written undeclared key is refused', () => {
  it.each(FLAVOURS)('%s: by-id update answers the same envelope', async (flavour) => {
    const { engine, writes } = await makeEngine({ flavour });
    const row: any = await engine.insert('acct', { name: 'ok' });
    writes.length = 0;

    engine.registerHook('beforeUpdate', (ctx: any) => { ctx.input.data.tax_rate = 10; }, { object: 'acct' });
    // `update(object, data, options)` — the id rides INSIDE the payload.
    const refusal = await refusalOf(() => engine.update('acct', { id: row.id, name: 'renamed' }));

    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
    expect(refusal?.field).toBe('tax_rate');
    expect(refusal?.message).toBe("Unknown field 'tax_rate' on object 'acct'");
    expect(writes).toHaveLength(0);
  });

  it.each(FLAVOURS)('%s: the PREDICATE (multi) branch answers it too', async (flavour) => {
    const { engine, writes } = await makeEngine({ flavour });
    await engine.insert('acct', { name: 'a' });
    await engine.insert('acct', { name: 'b' });
    writes.length = 0;

    // The per-row before dispatch accumulates each row's payload back onto the
    // batch context, so the door at the confluence sees the final payload.
    engine.registerHook('beforeUpdate', (ctx: any) => { ctx.input.data.tax_rate = 10; }, { object: 'acct' });
    const refusal = await refusalOf(() =>
      engine.update('acct', { description: 'x' }, { multi: true, where: {} } as any),
    );

    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.status).toBe(400);
    expect(writes).toHaveLength(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
// A2.2 — the census control. These are the writes shipped hooks actually make;
// refusing any of them would turn a hole-closing fix into a regression.
describe('#13657 — what shipped before-hooks write still passes', () => {
  it('the platform audit stamp survives on a `systemFields: false` object', async () => {
    // Faithful to `ObjectQLPlugin.registerAuditHooks` (`plugin.ts`), whose
    // `sys_stamp_audit_insert` is registered with `object: '*'` and writes
    // `created_at` / `updated_at` UNCONDITIONALLY — deliberately, because
    // driver-sql creates those two as built-in columns on every table whether
    // or not the object declares them.
    //
    // `bare` is the case that would break: `systemFields: false` means the
    // registry injects nothing, so these two keys are undeclared at the door
    // and are carried solely by `PLATFORM_PROVISIONED_COLUMNS`. A post-hook
    // check on the RAW declared set would refuse the platform's own hook here
    // and turn this fix into a regression on every seed and migration table.
    const now = new Date().toISOString();
    const { engine, stored } = await makeEngine({
      flavour: 'memory', wildcard: true, hookWrites: { created_at: now, updated_at: now },
    });

    const row: any = await engine.insert('bare', { name: 'ok' });

    expect(row.name).toBe('ok');
    expect(stored.size).toBe(1);
  });

  it('the tolerated set is EXACTLY `id`, `created_at`, `updated_at` — nothing wider', async () => {
    // Measured on the object where injection cannot mask the answer.
    for (const key of ['id', 'created_at', 'updated_at']) {
      const { engine } = await makeEngine({
        flavour: 'memory', wildcard: true,
        hookWrites: { [key]: key === 'id' ? 'rec_fixed' : new Date().toISOString() },
      });
      const refusal = await refusalOf(() => engine.insert('bare', { name: 'ok' }));
      expect(refusal, `platform-provisioned '${key}' must pass the post-hook door`).toBeNull();
    }
    // …and nothing else. `tenant_id` is the NEAREST MISS and the reason this
    // assertion is not decorative: the platform's own audit hook writes it —
    // but only behind an explicit `hasField(objectName, 'tenant_id')` guard,
    // and the registry does not inject it under any setting. So on an object
    // that does not declare it the key must be REFUSED, which is exactly what
    // makes that guard in `plugin.ts` load-bearing rather than incidental.
    for (const key of ['tenant_id', 'created_by', 'tax_rate']) {
      const { engine } = await makeEngine({
        flavour: 'memory', wildcard: true, hookWrites: { [key]: 'v' },
      });
      const refusal = await refusalOf(() => engine.insert('bare', { name: 'ok' }));
      expect(refusal?.code, `undeclared '${key}' must be refused`).toBe('INVALID_FIELD');
      expect(refusal?.field).toBe(key);
    }
  });

  it('on an ORDINARY object the injected audit family is DECLARED, so it passes as such', async () => {
    // The other half of the same fact: `acct` gets `created_by` / `updated_by`
    // / `owner_id` / `organization_id` injected by `registerObject`, so the
    // platform's `hasField`-guarded stamps meet a declared field and never
    // depend on the tolerance above.
    const { engine, stored } = await makeEngine({
      flavour: 'memory', wildcard: true, hookWrites: { created_by: 'usr_1', owner_id: 'usr_1' },
    });

    await engine.insert('acct', { name: 'ok' });

    expect(stored.size).toBe(1);
    expect([...stored.values()][0]?.created_by).toBe('usr_1');
  });

  it('POSITIVE CONTROL — a hook writing a DECLARED key is accepted and stored', async () => {
    // The shape every shipped app hook has (`input.probability = 100` in
    // app-crm, `data.priority = 'normal'` in app-todo, `ctx.input.title = …` in
    // app-showcase). If this ever fails, the door is refusing app code.
    const { engine, stored } = await makeEngine({
      flavour: 'memory', hookWrites: { description: 'derived-by-hook' },
    });

    const row: any = await engine.insert('acct', { name: 'ok' });

    expect(row.description).toBe('derived-by-hook');
    expect([...stored.values()][0]?.description).toBe('derived-by-hook');
  });

  it('POSITIVE CONTROL — the door still fires for a CALLER-supplied key (#8682 unmoved)', async () => {
    const { engine, hookRuns } = await makeEngine({
      flavour: 'memory', hookWrites: { description: 'derived-by-hook' },
    });

    const refusal = await refusalOf(() => engine.insert('acct', { name: 'bad', zzz_nope: 1 } as any));

    expect(refusal?.code).toBe('INVALID_FIELD');
    expect(refusal?.field).toBe('zzz_nope');
    // Still refused BEFORE the hooks — the pre-hook door has not moved.
    expect(hookRuns).toEqual([]);
  });
});
