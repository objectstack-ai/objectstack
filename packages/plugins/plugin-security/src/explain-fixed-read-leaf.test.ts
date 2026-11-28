// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0155 plan step 5, Q2 as ruled] The explainer's record pass resolves the
// share-grant leaf (`SharedRecordIds`) AT THE RECORD: one read of
// `sys_record_share` under the leaf's own fixed predicate, keyed by the record
// ids it judges. The sharing layer's published `rowFilter` then has the two
// shapes today's filter has for a caller with one grant on the record (`[id]`)
// and with none (the share arm left out), and ⛔ never carries the leaf.
//
// The sharing service's read filter is the step-6 producer's own,
// `{ $or: [owner match, { id: { $in: leaf } }] }` (ADR-0155 plan step 6). The
// rest is the real SecurityPlugin and the real SharingService, over an engine
// double that records its reads.
import { describe, it, expect, vi } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SharingService } from '@objectstack/plugin-sharing';
import { ReadableIds, SharedRecordIds } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const OBJECT = 'srl_doc';
const U_OWNER = 'u_owner';
const U_READER = 'u_reader';
const fieldsOf = (...names: string[]) => Object.fromEntries(names.map((n) => [n, { name: n }]));
const SCHEMA = { name: OBJECT, fields: fieldsOf('id', 'name', 'owner_id', 'created_by', 'organization_id') };

const READER_SET: PermissionSet = PermissionSetSchema.parse({
  name: 'srl_reader',
  objects: { [OBJECT]: { allowRead: true, allowEdit: true, readScope: 'own', writeScope: 'own' } },
});
const PERMISSION_SETS = [defaultPermissionSets.find((p) => p.name === 'member_default')!, READER_SET];
const READER_CTX = { userId: U_READER, tenantId: 'org1', positions: ['org_member'], permissions: ['srl_reader'] };

const row = (id: string) => ({ id, name: id, owner_id: U_OWNER, created_by: U_OWNER, organization_id: 'org1' });
const SHARED = 'doc_shared';
const UNSHARED = 'doc_unshared';
const SHARE_ROWS = [
  { id: 's1', object_name: OBJECT, record_id: SHARED, recipient_type: 'user', recipient_id: U_READER, access_level: 'read' },
  // Two grant rows on one record are one member.
  { id: 's2', object_name: OBJECT, record_id: SHARED, recipient_type: 'user', recipient_id: U_READER, access_level: 'edit' },
  // Another recipient's grant is theirs alone.
  { id: 's3', object_name: OBJECT, record_id: UNSHARED, recipient_type: 'user', recipient_id: 'u_other', access_level: 'read' },
];

/** `legacy`: the object is stored by a driver that does not evaluate share grants (ADR-0155 R2). */
function makeEngine(storage: 'sql' | 'legacy' = 'sql') {
  const tables: Record<string, any[]> = {
    [OBJECT]: [row(SHARED), row(UNSHARED)],
    sys_record_share: SHARE_ROWS.map((r) => ({ ...r })),
  };
  const reads: Array<{ object: string; where: unknown }> = [];
  const matches = (r: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    for (const [k, v] of Object.entries(filter)) {
      if (k.startsWith('$')) throw new Error(`engine double: unsupported operator '${k}'`);
      if (v != null && typeof v === 'object') {
        if (Object.keys(v as object).join() !== '$in' || !Array.isArray((v as any).$in)) {
          throw new Error(`engine double: unsupported predicate on '${k}': ${JSON.stringify(v)}`);
        }
        if (!(v as any).$in.includes(r[k])) return false;
        continue;
      }
      if (r[k] !== v) return false;
    }
    return true;
  };
  return {
    reads,
    _middlewares: [] as any[],
    registerMiddleware(mw: any) { this._middlewares.push(mw); },
    getSchema: (name: string) => (name === OBJECT ? SCHEMA : undefined),
    getDriverForObject: () => (storage === 'legacy'
      ? { name: 'legacy', supports: {} }
      : { name: 'sql', supports: { fixedReadLeaves: ['SharedRecordIds'] } }),
    async find(object: string, options: any = {}) {
      reads.push({ object, where: options.where });
      const hits = (tables[object] ?? []).filter((r) => matches(r, options.filter ?? options.where));
      return typeof options.limit === 'number' ? hits.slice(0, options.limit) : hits;
    },
    async findOne(object: string, options: any = {}) {
      assertEngineFindOnePredicate(object, options);
      return (await this.find(object, { ...options, limit: 1 }))[0] ?? null;
    },
  };
}

async function makeStack(storage: 'sql' | 'legacy' = 'sql') {
  const engine = makeEngine(storage);
  let security: any;
  let sharing: SharingService;
  const errors: string[] = [];
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (_t: string, name: string) => (name === OBJECT ? SCHEMA : null), list: async () => PERMISSION_SETS },
    get sharing() { return sharing; },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: (m: string) => void errors.push(String(m)), debug: vi.fn() },
    registerService: (name: string, impl: any) => { if (name === 'security') security = impl; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  sharing = new SharingService({ engine: engine as any, securityService: () => security });
  const explain = (operation: 'read' | 'update', target: { recordId?: string; recordIds?: string[] }) =>
    security.explain({ object: OBJECT, operation, ...target }, { ...READER_CTX });
  return { engine, explain, errors, sharing };
}

const sharingLayer = (decision: any) => decision.layers.find((l: any) => l.layer === 'sharing');
const shareReads = (engine: ReturnType<typeof makeEngine>) => engine.reads.filter((r) => r.object === 'sys_record_share');
/** No trace of the leaf in what crosses the wire: its fields, its recipient, its brand. */
function expectNoLeafOnTheWire(decision: any): void {
  const wire = JSON.stringify(decision);
  expect(wire).not.toContain('"recipient"');
  expect(wire).not.toContain('sharedRecordIds');
  expect(JSON.stringify(sharingLayer(decision).record.rowFilter)).not.toContain(`"object":"${OBJECT}"`);
}

describe('[ADR-0155 Q2] the explainer resolves the share-grant leaf at the record', () => {
  for (const operation of ['read', 'update'] as const) {
    it(`${operation}: one grant admits the record, so the share arm is [id], and the record is visible`, async () => {
      const { engine, explain } = await makeStack();
      const decision = await explain(operation, { recordId: SHARED });
      const record = sharingLayer(decision).record;
      expect(record.rowFilter).toEqual({ $or: [{ owner_id: U_READER }, { id: { $in: [SHARED] } }] });
      expect(record.matchesRecord).toBe(true);
      expectNoLeafOnTheWire(decision);
      // One indexed read under the leaf's own fixed predicate, keyed by the judged id.
      expect(shareReads(engine).map((r) => r.where)).toContainEqual({
        object_name: OBJECT, recipient_type: 'user', recipient_id: U_READER, record_id: { $in: [SHARED] },
      });
      if (operation === 'read') expect(decision.record).toMatchObject({ recordId: SHARED, visible: true });
    });

    it(`${operation}: no grant admits the record, so the share arm is left out, and the record is excluded`, async () => {
      const { explain } = await makeStack();
      const decision = await explain(operation, { recordId: UNSHARED });
      const record = sharingLayer(decision).record;
      expect(record.rowFilter).toEqual({ owner_id: U_READER });
      expect(record.matchesRecord).toBe(false);
      expectNoLeafOnTheWire(decision);
      if (operation === 'read') expect(decision.record).toMatchObject({ recordId: UNSHARED, visible: false });
    });
  }

  it('nothing of the leaf crosses the wire, granted or not, single or batch: a pin of its own', async () => {
    const { explain } = await makeStack();
    for (const operation of ['read', 'update'] as const) {
      for (const recordId of [SHARED, UNSHARED]) expectNoLeafOnTheWire(await explain(operation, { recordId }));
    }
    const batch = JSON.stringify(await explain('read', { recordIds: [SHARED, UNSHARED] }));
    expect(batch).not.toContain('"recipient"');
    expect(batch).not.toContain('sharedRecordIds');
  });

  it('the batch form reads the leaf once, keyed by every id it judges, and answers each record its own shape', async () => {
    const { engine, explain } = await makeStack();
    const decision = await explain('read', { recordIds: [SHARED, UNSHARED, SHARED] });
    expect(decision.records.map((r: any) => r.visible)).toEqual([true, false, true]);
    const keyed = shareReads(engine).filter((r) => (r.where as any)?.record_id?.$in);
    expect(keyed).toHaveLength(1);
    expect((keyed[0]!.where as any).record_id.$in).toEqual([SHARED, UNSHARED]);
  });

  it('a leaf out of position is refused in D4\'s envelope, logged once, never matched or published', async () => {
    const { explain, sharing, errors } = await makeStack();
    (sharing as any).buildReadFilter = async (object: string, context: any) =>
      ({ $or: [{ owner_id: context.userId }, { id: { $nin: SharedRecordIds.read(object, context.userId) } }] });
    for (let i = 0; i < 2; i++) {
      const err = await explain('read', { recordId: SHARED }).then(() => null, (e: any) => e);
      expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
      expect(err?.message).toContain('[plugin-security explain]');
      expect(err?.message).not.toContain(U_READER);
    }
    expect(errors.filter((m) => m.includes('fixed read of'))).toHaveLength(1);
  });

  // A leaf is admitted by its role, as the engine's seam and the analytics
  // compiler admit it, never by the key it sits under: these sit under `id`
  // as $in's comparand and name the explained object, but not in its where.
  const MISPLACED: Array<[string, string, (object: string, userId: string) => unknown]> = [
    [
      'inside a relation condition (a self-relation)', 'rowFilter.$or[1].manager.id.$in',
      (object, userId) => ({ $or: [{ owner_id: userId }, { manager: { id: { $in: SharedRecordIds.read(object, userId) } } }] }),
    ],
    [
      'inside a composed ReadableIds scope', 'rowFilter.$or[1].id.$in.scope.id.$in',
      (object, userId) => ({
        $or: [
          { owner_id: userId },
          { id: { $in: ReadableIds.compose(ReadableIds.of(object), { id: { $in: SharedRecordIds.read(object, userId) } }) } },
        ],
      }),
    ],
  ];
  for (const [where, at, readFilter] of MISPLACED) {
    it(`a leaf ${where} is refused in D4's envelope, logged once, never resolved or published`, async () => {
      const { explain, sharing, errors, engine } = await makeStack();
      (sharing as any).buildReadFilter = async (object: string, context: any) => readFilter(object, context.userId);
      for (let i = 0; i < 2; i++) {
        const err = await explain('read', { recordId: SHARED }).then(() => null, (e: any) => e);
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'INTERNAL_ERROR', status: 500 });
        expect(err?.message).toContain(`[plugin-security explain] the sharing read filter of '${OBJECT}': ${at} holds a SharedRecordIds leaf`);
        expect(err?.message).not.toContain(U_READER);
      }
      expect(errors.filter((m) => m.includes('fixed read of'))).toHaveLength(1);
      // Refused before the leaf's own read: nothing resolved it at the record.
      expect(shareReads(engine).filter((r) => (r.where as any)?.recipient_id !== undefined)).toEqual([]);
    });
  }

  it('the share read failing is the read filter failing: the record is not visible, and no filter is published', async () => {
    const { explain, engine } = await makeStack();
    const find = engine.find.bind(engine);
    engine.find = async (object: string, options: any) => {
      if (object === 'sys_record_share') throw new Error('share store down');
      return find(object, options);
    };
    const decision = await explain('read', { recordId: SHARED });
    expect(decision.record).toMatchObject({ recordId: SHARED, visible: false, decidedBy: 'sharing' });
    expect(sharingLayer(decision).record.rowFilter).toBeUndefined();
  });
});

describe('[ADR-0155 ② ruled R2] the explainer says why a share on the record admits nothing', () => {
  it('on an object whose storage does not evaluate share grants: the shares are neutral, the record is excluded, and the detail names the reason', async () => {
    const { engine, explain } = await makeStack('legacy');
    const decision = await explain('read', { recordId: SHARED });
    const record = sharingLayer(decision).record;
    // The scope carries no share arm there, so nothing of the leaf is resolved.
    expect(record.rowFilter).toEqual({ owner_id: U_READER });
    expect(record.matchesRecord).toBe(false);
    expect(decision.record).toMatchObject({ recordId: SHARED, visible: false });
    const shares = record.rules.filter((r: any) => r.kind === 'record_share');
    expect(shares.map((r: any) => r.effect)).toEqual(['neutral', 'neutral']);
    expect(record.detail).toContain('Share grants do not count on this object, so no share attached to the record is consulted');
    expect(record.detail).toContain("stored by driver 'legacy'");
    expect(shareReads(engine).some((r) => JSON.stringify(r.where).includes('"recipient_id"'))).toBe(false);
  });

  it('CONTROL: where they count, the same shares admit the caller and no sentence is added', async () => {
    const { explain } = await makeStack('sql');
    const record = sharingLayer(await explain('read', { recordId: SHARED })).record;
    expect(record.rules.filter((r: any) => r.kind === 'record_share').map((r: any) => r.effect)).toEqual(['admits', 'admits']);
    expect(record.detail).not.toContain('Share grants do not count');
  });
});
