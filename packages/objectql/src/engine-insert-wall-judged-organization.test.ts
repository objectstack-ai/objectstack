// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24822] `engine.insert` leaves a non-system caller's explicit
// `organization_id` out of its static-`readonly` passes (the pre-hook withhold
// and the post-hook strip) ONLY when the stored-image seam declares that it
// judges the insert's organization: `PostHookWriteImageCheck.judgesOrganization`.
//
// The engine side of the seam, pinned with a stand-in installer. The installer
// in production is `@objectstack/plugin-security`'s step 3.7. Its side, and the
// two packages together on a real stack, are pinned in
// `plugin-security/src/insert-seam-judges-organization.test.ts` and
// `organizations/src/create-explicit-organization-wall.test.ts`.
//
// What this file holds the engine to:
//  - the member SET: the value is stored as sent, shown to `beforeInsert`,
//    handed to the seam, not reported, and not refused under
//    `strictReadonlyWrites`. Every OTHER read-only key is still taken, and so
//    is an AUTHORED read-only `organization_id`: only the platform's injected
//    column is spared;
//  - the member ABSENT or `false` on an installed seam, and no seam at all:
//    the strip takes the value exactly as before (reported, withheld from the
//    hook, refused under strict). Seam presence is not the signal: a business
//    `check` installs a seam with no wall behind it;
//  - `validate()` runs no middleware, so it holds no seam, and its preview is
//    unchanged.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver() {
  const stores = new Map<string, Map<string, any>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
      return row?.[k] === v;
    });
  };
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // The caller's bound, applied AFTER the filter and by PRESENCE
      // (`check:objectql-double-limit`).
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return r;
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return row;
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return row;
    },
    async updateMany(object: string, ast: any, data: Record<string, unknown>) {
      const s = storeFor(object);
      let count = 0;
      for (const row of [...s.values()]) {
        if (!matches(row, ast?.where)) continue;
        s.set(row.id, { ...row, ...data, id: row.id });
        count += 1;
      }
      return count;
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor };
}

const OBJECT = 'qa_ledger';
const ACTIVE = 'org_a';
const NAMED = 'org_c';
const SESSION = { userId: 'usr_member', tenantId: ACTIVE };
const AUTHORED = 'qa_authored';

/** How the stand-in installer behaves on this engine's next insert. */
type SeamMode = 'judges' | 'judges-false' | 'no-member' | 'none';

describe('[#24822] engine.insert spares organization_id only where the seam declares the organization judged', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let seamMode: SeamMode;
  /** `organization_id` as `beforeInsert` saw it: `'absent'` when the key was not on the row. */
  let hookSaw: unknown[];
  /** `organization_id` on every row the seam judged. */
  let seamJudged: unknown[];
  let warns: string[];

  beforeEach(async () => {
    warns = [];
    hookSaw = [];
    seamJudged = [];
    seamMode = 'judges';
    const logger: any = {
      warn: (m: string) => warns.push(String(m)),
      debug() {}, info() {}, error() {}, trace() {}, fatal() {},
      child() { return logger; },
    };
    engine = new ObjectQL({ logger });
    const d = makeDriver();
    storeFor = d.storeFor;
    engine.registerDriver(d.driver, true);
    await engine.init();
    engine.registry.registerObject({ name: OBJECT, fields: { name: { type: 'text' } } } as any);
    // [#24822] F4: an app object whose AUTHOR declares its own read-only
    // organization_id. The member alone does not spare it.
    engine.registry.registerObject({
      name: AUTHORED,
      fields: { name: { type: 'text' }, organization_id: { type: 'text', readonly: true } },
    } as any);

    engine.registerHook('beforeInsert', async (ctx: any) => {
      const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
      hookSaw.push(Object.prototype.hasOwnProperty.call(data, 'organization_id') ? data.organization_id : 'absent');
    }, { object: OBJECT });

    // The stand-in installer: what an enforcement layer puts on an insert.
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.operation === 'insert' && seamMode !== 'none') {
        opCtx.postHookWriteImageCheck = {
          evaluate: (rows: readonly Record<string, unknown>[]) => {
            for (const row of rows) seamJudged.push(row.organization_id);
          },
          ...(seamMode === 'judges' ? { judgesOrganization: true } : {}),
          ...(seamMode === 'judges-false' ? { judgesOrganization: false } : {}),
        };
      }
      await next();
    });
  });

  const insertReporting = async (data: unknown, extra: Record<string, unknown> = {}) => {
    const dropped: Array<{ fields: string[]; reason: string }> = [];
    await engine.insert(OBJECT, data as any, {
      context: SESSION,
      onFieldsDropped: (e: any) => dropped.push({ fields: e.fields, reason: e.reason }),
      ...extra,
    } as any);
    return dropped;
  };
  const stored = () => [...storeFor(OBJECT).values()].map((r) => r.organization_id);
  const readonlyWarns = () => warns.filter((w) => w.includes("Field 'organization_id'"));

  it('PRECONDITION: the platform injects organization_id as a read-only column on this object', () => {
    const field = (engine.getSchema(OBJECT) as any)?.fields?.organization_id;
    expect(field?.readonly, 'the strip has the column to take').toBe(true);
  });

  it('SET: the named organization is stored as sent, shown to beforeInsert, handed to the seam, and not reported', async () => {
    const dropped = await insertReporting({ name: 'one', organization_id: NAMED });

    expect(stored()).toEqual([NAMED]);
    expect(dropped).toEqual([]);
    expect(readonlyWarns()).toEqual([]);
    expect(hookSaw).toEqual([NAMED]);
    expect(seamJudged, 'the seam judges the value the driver stores').toEqual([NAMED]);
  });

  it('SET: an array insert keeps each row\'s named organization', async () => {
    const dropped = await insertReporting([
      { name: 'one', organization_id: NAMED },
      { name: 'two', organization_id: ACTIVE },
    ]);

    expect(stored()).toEqual([NAMED, ACTIVE]);
    expect(dropped).toEqual([]);
    expect(seamJudged).toEqual([NAMED, ACTIVE]);
  });

  it('SET spares organization_id ONLY: another read-only key the caller sends is still taken and reported', async () => {
    const dropped = await insertReporting({ name: 'one', organization_id: NAMED, created_by: 'usr_forged' });

    expect(stored()).toEqual([NAMED]);
    expect(dropped).toEqual([{ fields: ['created_by'], reason: 'readonly' }]);
    expect([...storeFor(OBJECT).values()][0]?.created_by, 'the forged audit value is not stored').not.toBe('usr_forged');
  });

  it('SET, but an AUTHORED read-only organization_id: the author\'s declaration keeps the strip, and strict refuses it', async () => {
    const dropped: Array<{ fields: string[]; reason: string }> = [];
    await engine.insert(AUTHORED, { name: 'one', organization_id: NAMED } as any, {
      context: SESSION,
      onFieldsDropped: (e: any) => dropped.push({ fields: e.fields, reason: e.reason }),
    } as any);

    expect([...storeFor(AUTHORED).values()].map((r) => r.organization_id), 'the caller\'s value is not stored').toEqual([undefined]);
    expect(dropped).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);

    let thrown: { code?: unknown; fields?: unknown } | undefined;
    try {
      await engine.insert(AUTHORED, { name: 'two', organization_id: NAMED } as any, { context: SESSION, strictReadonlyWrites: true } as any);
    } catch (e) {
      thrown = e as typeof thrown;
    }
    expect(thrown?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(thrown?.fields).toEqual(['organization_id']);
  });

  it('SET: strictReadonlyWrites does not refuse it, because strict refuses only what the strip takes', async () => {
    await insertReporting({ name: 'one', organization_id: NAMED }, { strictReadonlyWrites: true });

    expect(stored()).toEqual([NAMED]);
  });

  for (const mode of ['no-member', 'judges-false', 'none'] as const) {
    describe(`NOT SET (${mode === 'none' ? 'no seam at all' : mode === 'no-member' ? 'a seam that does not declare it' : 'the member false'}): the strip takes the value exactly as before`, () => {
      beforeEach(() => { seamMode = mode; });

      it('taken, withheld from beforeInsert, reported, and WARNed', async () => {
        const dropped = await insertReporting({ name: 'one', organization_id: NAMED });

        expect(stored(), 'the caller\'s organization is not stored').toEqual([undefined]);
        expect(dropped).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);
        expect(readonlyWarns()).toHaveLength(1);
        expect(hookSaw, 'withheld from the hook, as #22306 requires').toEqual(['absent']);
        expect(seamJudged).toEqual(mode === 'none' ? [] : [undefined]);
      });

      it('refused under strictReadonlyWrites, and nothing is stored', async () => {
        let thrown: { code?: unknown; fields?: unknown; operation?: unknown } | undefined;
        try {
          await insertReporting({ name: 'one', organization_id: NAMED }, { strictReadonlyWrites: true });
        } catch (e) {
          thrown = e as typeof thrown;
        }
        expect(thrown, 'expected the strict write to be refused').toBeDefined();
        expect(thrown?.code).toBe('ERR_READONLY_FIELD_REJECTED');
        expect(thrown?.fields).toEqual(['organization_id']);
        expect(thrown?.operation).toBe('insert');
        expect(stored()).toEqual([]);
      });
    });
  }

  it('a system context stores what it sends with or without the member: the strips never run for it', async () => {
    seamMode = 'none';
    await engine.insert(OBJECT, { name: 'one', organization_id: NAMED } as any, { context: { isSystem: true } } as any);
    seamMode = 'judges';
    await engine.insert(OBJECT, { name: 'two', organization_id: NAMED } as any, { context: { isSystem: true } } as any);

    expect(stored()).toEqual([NAMED, NAMED]);
  });

  it('validate() runs no middleware, so it holds no seam: its preview still reports the strip it always reported', async () => {
    const preview = await engine.validate(OBJECT, { name: 'one', organization_id: NAMED }, { mode: 'insert', context: SESSION as any });

    expect(preview.results[0]?.droppedFields).toEqual([{ object: OBJECT, fields: ['organization_id'], reason: 'readonly' }]);
  });
});
