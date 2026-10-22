// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24822] `engine.update` leaves a non-system caller's `organization_id`
// re-point out of its static-`readonly` passes ONLY when the stored-image seam
// declares that it judges the write's organization:
// `PostHookWriteImageCheck.judgesOrganization`. The insert half is
// `engine-insert-wall-judged-organization.test.ts`; both read the one helper
// that decides the spare.
//
// The engine side of the seam, pinned with a stand-in installer. The installer
// in production is `@objectstack/plugin-security`'s step 3.7. Its side, and the
// two packages together on a real stack, are pinned in
// `plugin-security/src/update-seam-judges-organization.test.ts` and
// `organizations/src/update-repoint-organization-wall.test.ts`.
//
// What this file holds the engine to:
//  - the member SET, by id and by predicate: the re-point is stored as sent,
//    shown to `beforeUpdate`, handed to the seam on every stored image, not
//    reported, and not refused under `strictReadonlyWrites`. Every OTHER
//    read-only key is still taken, and so is an AUTHORED read-only
//    `organization_id`: only the platform's injected column is spared;
//  - ...and only on an object the INSERT strip judges. A `sys_` object and a
//    platform-internal `managedBy` bucket keep the update strip even with the
//    member set: the update spare covers exactly the objects the insert spare
//    covers;
//  - ONE read of the member for every pass: a `readonlyWhen` lock that reads
//    `record.organization_id` reads the organization the row is stored in;
//  - the member ABSENT or `false` on an installed seam, and no seam at all:
//    the strip takes the re-point exactly as before (withheld from the hook,
//    reported, WARNed, refused under strict), and `preserveAudit` does not
//    spare it either;
//  - `validate()` runs no middleware, so it holds no seam: its update preview
//    still reports the drop (wall-blind, as on insert).

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
const AUTHORED = 'qa_authored';
const LOCKED = 'qa_locked';
const SYS_OBJECT = 'sys_qa_ledger';
const ENGINE_OWNED = 'qa_engine_owned';
const ACTIVE = 'org_a';
const NAMED = 'org_c';
const SESSION = { userId: 'usr_member', tenantId: ACTIVE };
const SYSTEM = { isSystem: true };

/** How the stand-in installer behaves on this engine's next update. */
type SeamMode = 'judges' | 'judges-false' | 'no-member' | 'none';

describe('[#24822] engine.update spares an organization_id re-point only where the seam declares the organization judged', () => {
  let engine: ObjectQL;
  let storeFor: ReturnType<typeof makeDriver>['storeFor'];
  let seamMode: SeamMode;
  /** `organization_id` as `beforeUpdate` saw it: `'absent'` when the key was not on the payload. */
  let hookSaw: unknown[];
  /** `organization_id` on every stored image the seam judged. */
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
    // F4: an app object whose AUTHOR declares its own read-only organization_id.
    engine.registry.registerObject({
      name: AUTHORED,
      fields: { name: { type: 'text' }, organization_id: { type: 'text', readonly: true } },
    } as any);
    // A conditional lock that reads the organization the row is stored in.
    engine.registry.registerObject({
      name: LOCKED,
      fields: { name: { type: 'text' }, amount: { type: 'number', readonlyWhen: `record.organization_id == '${NAMED}'` } },
    } as any);
    // The two shapes the INSERT strip never judges, each carrying the injected
    // read-only column: the reserved `sys_` namespace, and a platform-internal
    // `managedBy` bucket.
    engine.registry.registerObject({ name: SYS_OBJECT, fields: { name: { type: 'text' } } } as any);
    engine.registry.registerObject({ name: ENGINE_OWNED, managedBy: 'engine-owned', fields: { name: { type: 'text' } } } as any);

    for (const object of [OBJECT, AUTHORED, LOCKED, SYS_OBJECT, ENGINE_OWNED]) {
      for (const id of ['r1', 'r2']) {
        await engine.insert(object, { id, name: 'seeded', organization_id: ACTIVE, ...(object === LOCKED ? { amount: 1 } : {}) } as any, { context: SYSTEM } as any);
      }
      engine.registerHook('beforeUpdate', async (ctx: any) => {
        const data = (ctx.input?.data ?? {}) as Record<string, unknown>;
        hookSaw.push(Object.prototype.hasOwnProperty.call(data, 'organization_id') ? data.organization_id : 'absent');
      }, { object });
    }

    // The stand-in installer: what an enforcement layer puts on an update.
    engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.operation === 'update' && seamMode !== 'none') {
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

  type Dropped = Array<{ fields: string[]; reason: string }>;
  /** One by-id re-point of `r1`, collecting what the write reports. */
  const repointById = async (object: string, extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) => {
    const dropped: Dropped = [];
    await engine.update(object, { id: 'r1', organization_id: NAMED, ...data } as any, {
      context: SESSION,
      onFieldsDropped: (e: any) => dropped.push({ fields: e.fields, reason: e.reason }),
      ...extra,
    } as any);
    return dropped;
  };
  /** One predicate re-point of every seeded row. */
  const repointByPredicate = async (object: string, extra: Record<string, unknown> = {}) => {
    const dropped: Dropped = [];
    await engine.update(object, { organization_id: NAMED } as any, {
      where: { name: 'seeded' },
      multi: true,
      context: SESSION,
      onFieldsDropped: (e: any) => dropped.push({ fields: e.fields, reason: e.reason }),
      ...extra,
    } as any);
    return dropped;
  };
  const stored = (object: string = OBJECT) => [...storeFor(object).values()].map((r) => r.organization_id);
  const readonlyWarns = () => warns.filter((w) => w.includes("Field 'organization_id'"));
  const strictRefusal = async (run: () => Promise<unknown>) => {
    let thrown: { code?: unknown; fields?: unknown; operation?: unknown } | undefined;
    try {
      await run();
    } catch (e) {
      thrown = e as typeof thrown;
    }
    return thrown;
  };

  it('PRECONDITION: the platform injects organization_id as a read-only column on every object here but the authored one', () => {
    for (const object of [OBJECT, LOCKED, SYS_OBJECT, ENGINE_OWNED]) {
      expect((engine.getSchema(object) as any)?.fields?.organization_id?.readonly, object).toBe(true);
    }
  });

  it('SET, by id: the re-point is stored as sent, shown to beforeUpdate, handed to the seam, and not reported', async () => {
    const dropped = await repointById(OBJECT);

    expect(stored()).toEqual([NAMED, ACTIVE]);
    expect(dropped).toEqual([]);
    expect(readonlyWarns()).toEqual([]);
    expect(hookSaw, 'the hook is shown the organization that will be stored').toEqual([NAMED]);
    expect(seamJudged, 'the seam judges the stored image').toEqual([NAMED]);
  });

  it('SET, by predicate: every matched row is stored with the re-point, and the seam judges every one of them', async () => {
    const dropped = await repointByPredicate(OBJECT);

    expect(stored()).toEqual([NAMED, NAMED]);
    expect(dropped).toEqual([]);
    expect(readonlyWarns()).toEqual([]);
    expect(seamJudged).toEqual([NAMED, NAMED]);
  });

  it('SET spares organization_id ONLY: another read-only key the caller sends is still taken and reported', async () => {
    const dropped = await repointById(OBJECT, {}, { created_by: 'usr_forged' });

    expect(stored()).toEqual([NAMED, ACTIVE]);
    expect(dropped).toEqual([{ fields: ['created_by'], reason: 'readonly' }]);
    expect(storeFor(OBJECT).get('r1')?.created_by, 'the forged audit value is not stored').not.toBe('usr_forged');
  });

  it('SET: strictReadonlyWrites does not refuse it, by id or by predicate, because strict refuses only what the strip takes', async () => {
    await repointById(OBJECT, { strictReadonlyWrites: true });
    expect(stored()).toEqual([NAMED, ACTIVE]);

    await repointByPredicate(OBJECT, { strictReadonlyWrites: true });
    expect(stored()).toEqual([NAMED, NAMED]);
  });

  it('SET: a readonlyWhen lock reading record.organization_id reads the organization the row is stored in', async () => {
    const dropped = await repointById(LOCKED, {}, { amount: 999 });

    expect(storeFor(LOCKED).get('r1'), 'stored in the re-pointed organization, where the lock holds').toMatchObject({ organization_id: NAMED, amount: 1 });
    expect(dropped).toEqual([{ fields: ['amount'], reason: 'readonly_when' }]);
  });

  it('SET, but an AUTHORED read-only organization_id: the author\'s declaration keeps the strip, and strict refuses it', async () => {
    const dropped = await repointById(AUTHORED);

    expect(stored(AUTHORED), 'the caller\'s re-point is not stored').toEqual([ACTIVE, ACTIVE]);
    expect(dropped).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);

    const thrown = await strictRefusal(() => repointById(AUTHORED, { strictReadonlyWrites: true }));
    expect(thrown?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    expect(thrown?.fields).toEqual(['organization_id']);
  });

  for (const [object, why] of [
    [SYS_OBJECT, 'a `sys_` object'],
    [ENGINE_OWNED, 'a platform-internal `managedBy` bucket'],
  ] as const) {
    it(`SET, but ${why}: the update strip keeps taking the re-point, by id and by predicate, as before`, async () => {
      const byId = await repointById(object);
      expect(hookSaw, 'withheld from the hook, as before').toEqual(['absent']);
      const byPredicate = await repointByPredicate(object);

      expect(stored(object), 'the row keeps its organization').toEqual([ACTIVE, ACTIVE]);
      expect(byId).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);
      expect(byPredicate).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);

      const thrown = await strictRefusal(() => repointById(object, { strictReadonlyWrites: true }));
      expect(thrown?.code).toBe('ERR_READONLY_FIELD_REJECTED');
    });
  }

  for (const mode of ['no-member', 'judges-false', 'none'] as const) {
    describe(`NOT SET (${mode === 'none' ? 'no seam at all' : mode === 'no-member' ? 'a seam that does not declare it' : 'the member false'}): the strip takes the re-point exactly as before`, () => {
      beforeEach(() => { seamMode = mode; });

      it('by id: taken, withheld from beforeUpdate, reported, and WARNed', async () => {
        const dropped = await repointById(OBJECT);

        expect(stored(), 'the row keeps its organization').toEqual([ACTIVE, ACTIVE]);
        expect(dropped).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);
        expect(readonlyWarns()).toHaveLength(1);
        expect(hookSaw, 'withheld from the hook, as #16344 requires').toEqual(['absent']);
        expect(seamJudged).toEqual(mode === 'none' ? [] : [ACTIVE]);
      });

      it('by predicate: taken and reported, and every matched row keeps its organization', async () => {
        const dropped = await repointByPredicate(OBJECT);

        expect(stored()).toEqual([ACTIVE, ACTIVE]);
        expect(dropped).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);
      });

      it('refused under strictReadonlyWrites, and nothing moves', async () => {
        const thrown = await strictRefusal(() => repointById(OBJECT, { strictReadonlyWrites: true }));

        expect(thrown, 'expected the strict write to be refused').toBeDefined();
        expect(thrown?.code).toBe('ERR_READONLY_FIELD_REJECTED');
        expect(thrown?.fields).toEqual(['organization_id']);
        expect(thrown?.operation).toBe('update');
        expect(stored()).toEqual([ACTIVE, ACTIVE]);
      });

      it('preserveAudit does not spare it: the historical-import exemption never reaches organization_id', async () => {
        const dropped = await repointById(OBJECT, { context: { ...SESSION, preserveAudit: true } });

        expect(stored()).toEqual([ACTIVE, ACTIVE]);
        expect(dropped).toEqual([{ fields: ['organization_id'], reason: 'readonly' }]);
      });
    });
  }

  it('a system context stores what it sends with or without the member: the strips never run for it', async () => {
    seamMode = 'none';
    await engine.update(OBJECT, { id: 'r1', organization_id: NAMED } as any, { context: SYSTEM } as any);
    seamMode = 'judges';
    await engine.update(OBJECT, { id: 'r2', organization_id: NAMED } as any, { context: SYSTEM } as any);

    expect(stored()).toEqual([NAMED, NAMED]);
  });

  it('validate() runs no middleware, so it holds no seam: its update preview still reports the strip (wall-blind)', async () => {
    const preview = await engine.validate(OBJECT, { id: 'r1', organization_id: NAMED }, { mode: 'update', context: SESSION as any });

    expect(preview.results[0]?.droppedFields).toEqual([{ object: OBJECT, fields: ['organization_id'], reason: 'readonly' }]);
  });
});
