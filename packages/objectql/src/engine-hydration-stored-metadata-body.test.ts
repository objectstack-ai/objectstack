// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24358] The engine's two relationship hydrations outside the one-hop loader
 * never read the stored-metadata-body family (`STORED_METADATA_BODY_OBJECTS`):
 *
 *  - `expand` (`expandRelatedRecords`) — the REST read of a carrying object
 *    with `expand` / `$expand`, its `findOne`, the nested AST form, and a hook
 *    body's `ctx.api` read, which all reach the same loop through `find` /
 *    `findOne`;
 *  - the master-detail `parent` root (`resolveMasterDetailParent` /
 *    `resolveMasterDetailParents`) — a field rule's `requiredWhen` /
 *    `readonlyWhen` on insert and update, and the `validate()` preview, which
 *    binds through the same batch read.
 *
 * The family's projection runs at its doors, and only for the object a request
 * names, so either hydration would hand the caller (or a `parent.*` verdict)
 * the stored body and its content hash unprojected. Each case below asserts
 * that no family value is served, that no family read asks for more than the
 * `id` column, and that the answer is the one a reference the caller may not
 * hydrate already gets: the stored id for `expand`, an unbound `parent` for a
 * rule, identical whatever the header holds. A hydration into an ordinary
 * object, on the same objects, is still served.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

type Rec = Record<string, unknown>;

const silentLogger: any = {
  trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {},
  child() { return silentLogger; },
};

function makeDriver() {
  const stores = new Map<string, Map<string, Rec>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  const matches = (row: Rec, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where).every(([k, v]: [string, any]) => {
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        if ('$in' in v) return Array.isArray(v.$in) && v.$in.includes(row?.[k]);
        if ('$eq' in v) return row?.[k] === v.$eq;
      }
      return row?.[k] === v;
    });
  };
  const project = (r: Rec, fields: string[] | undefined): Rec => {
    if (!fields) return { ...r };
    const out: Rec = {};
    for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
    return out;
  };
  const calls: Array<{ object: string; ast: any }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      calls.push({ object, ast });
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      const offset = typeof ast?.offset === 'number' ? ast.offset : 0;
      const paged = typeof ast?.limit === 'number' ? rows.slice(offset, offset + ast.limit) : rows.slice(offset);
      return paged.map((r) => project(r, ast?.fields));
    },
    async findOne(object: string, ast: any) {
      calls.push({ object, ast });
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return project(r, ast?.fields);
      return null;
    },
    async create(object: string, data: Rec) {
      n += 1;
      const id = (data.id as string) ?? `r_${n}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return { ...row };
    },
    async update(object: string, id: string, data: Rec) {
      const s = storeFor(object);
      const row = { ...s.get(id), ...data, id };
      s.set(id, row);
      return { ...row };
    },
    async updateMany() { return 0; },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Rec[]) { return Promise.all(rows.map((r) => this.create(object, r))); },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, calls };
}

/** A synthetic stored datasource body with placeholder credential material, and a control body without it. */
const SECRET = 'PLACEHOLDER-SECRET';
const STORED_BODY = JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://x.invalid', authToken: SECRET } });
const CONTROL_BODY = JSON.stringify({ name: 'ds2', driver: 'turso', config: { url: 'libsql://y.invalid' } });
const MEMBER = { userId: 'u1', tenantId: 'org_1', positions: ['member'] } as any;
const SYSTEM = { isSystem: true } as any;
const servesNothing = (value: unknown) => {
  const text = JSON.stringify(value) ?? '';
  expect(text).not.toContain(SECRET);
  expect(text).not.toContain('PLACEHOLDER-HASH');
};
const failure = (p: Promise<unknown>) => p.then(() => undefined, (e: any) => ({ code: e?.code, message: String(e?.message) }));

for (const family of STORED_METADATA_BODY_OBJECTS) {
  describe(`[#24358] '${family}' is never hydrated`, () => {
    let engine: ObjectQL;
    let d: ReturnType<typeof makeDriver>;
    /** Every family read, and whether one asked for anything beyond the `id` column. */
    const familyReads = () => d.calls.filter((c) => c.object === family);
    const familyBodyReads = () => familyReads().filter((c) => !(Array.isArray(c.ast?.fields) && c.ast.fields.length === 1 && c.ast.fields[0] === 'id'));

    beforeEach(async () => {
      engine = new ObjectQL({ logger: silentLogger });
      d = makeDriver();
      engine.registerDriver(d.driver, true);
      await engine.init();
      engine.registry.registerObject({
        name: family,
        fields: { type: { type: 'text' }, name: { type: 'text' }, metadata: { type: 'textarea' }, checksum: { type: 'text' } },
      } as any, 'test-package');
      engine.registry.registerObject({
        name: 'probe_other',
        fields: { name: { type: 'text' }, meta: { type: 'lookup', reference: family } },
      } as any, 'test-package');
      engine.registry.registerObject({
        name: 'probe_carrier',
        fields: {
          meta: { type: 'lookup', reference: family },
          metas: { type: 'lookup', reference: family, multiple: true },
          other: { type: 'lookup', reference: 'probe_other' },
        },
      } as any, 'test-package');
      engine.registry.registerObject({
        name: 'probe_detail',
        fields: {
          hdr: { type: 'master_detail', reference: family },
          note: { type: 'text', requiredWhen: `parent.metadata.contains('${SECRET}')` },
          note2: { type: 'text', readonlyWhen: "parent.checksum.startsWith('sha256:')" },
        },
      } as any, 'test-package');
      engine.registry.registerObject({
        name: 'probe_ordinary_detail',
        fields: {
          hdr: { type: 'master_detail', reference: 'probe_other' },
          note: { type: 'text', requiredWhen: "parent.name == 'Other'" },
        },
      } as any, 'test-package');
      d.storeFor(family).set('m1', { id: 'm1', type: 'datasource', name: 'ds', metadata: STORED_BODY, checksum: 'sha256:PLACEHOLDER-HASH' });
      d.storeFor(family).set('m2', { id: 'm2', type: 'datasource', name: 'ds2', metadata: CONTROL_BODY, checksum: 'md5:PLACEHOLDER-HASH' });
      d.storeFor('probe_other').set('o1', { id: 'o1', name: 'Other', meta: 'm1' });
      d.storeFor('probe_carrier').set('c1', { id: 'c1', meta: 'm1', metas: ['m1', 'm2'], other: 'o1' });
      d.storeFor('probe_detail').set('dt1', { id: 'dt1', hdr: 'm1', note: 'n' });
      d.storeFor('probe_detail').set('dt2', { id: 'dt2', hdr: 'm2', note: 'n' });
      d.calls.length = 0;
    });

    for (const [who, context] of [['a member', MEMBER], ['SYSTEM', SYSTEM]] as const) {
      it(`expand as ${who}: a reference into the family keeps its stored id, single and multiple, and is never read`, async () => {
        const rows = await engine.find('probe_carrier', { expand: { meta: {}, metas: {}, other: {} } as any, context });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ meta: 'm1', metas: ['m1', 'm2'], other: { id: 'o1', name: 'Other' } });
        servesNothing(rows);
        expect(familyReads()).toHaveLength(0);
      });

      it(`expand as ${who}: a nested expansion into the family, and findOne, keep the stored id`, async () => {
        const nested = await engine.find('probe_carrier', { expand: { other: { expand: { meta: {} } } } as any, context });
        expect(nested[0]).toMatchObject({ other: { id: 'o1', name: 'Other', meta: 'm1' } });
        const one = await engine.findOne('probe_carrier', { where: { id: 'c1' }, expand: { meta: { fields: ['metadata', 'checksum'] } } as any, context });
        expect(one).toMatchObject({ meta: 'm1' });
        servesNothing([nested, one]);
        expect(familyReads()).toHaveLength(0);
      });

      it(`parent as ${who}: a requiredWhen over a family header has no verdict, the same refusal whatever the header holds`, async () => {
        const holding = await failure(engine.insert('probe_detail', { hdr: 'm1' }, { context }));
        const control = await failure(engine.insert('probe_detail', { hdr: 'm2' }, { context }));
        expect(holding).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(holding?.message).toContain("reads 'parent'");
        // The verdict does not depend on the row: the bit the body would decide is not served.
        expect(control).toEqual(holding);
        servesNothing([holding, control]);
        expect(familyBodyReads()).toHaveLength(0);
      });

      it(`parent as ${who}: a readonlyWhen over a family header answers the same whatever the header holds`, async () => {
        const answers: unknown[] = [];
        for (const id of ['dt1', 'dt2']) {
          answers.push(await engine.update('probe_detail', { id, note: 'n', note2: 'x' }, { context } as any)
            .then((r: any) => ({ note2: r?.note2 ?? null }), (e: any) => ({ code: e?.code })));
        }
        expect(answers[1]).toEqual(answers[0]);
        servesNothing(answers);
        expect(familyBodyReads()).toHaveLength(0);
      });

      it(`parent as ${who}: the validate() preview judges a family header the same whatever it holds`, async () => {
        const holding = await engine.validate('probe_detail', { hdr: 'm1' }, { context });
        const control = await engine.validate('probe_detail', { hdr: 'm2' }, { context });
        expect(JSON.stringify(control)).toBe(JSON.stringify(holding).replaceAll('m1', 'm2'));
        servesNothing([holding, control]);
        expect(familyBodyReads()).toHaveLength(0);
      });
    }

    it('an ordinary master still binds parent: its requiredWhen is judged on the header', async () => {
      const err = await failure(engine.insert('probe_ordinary_detail', { hdr: 'o1' }, { context: SYSTEM }));
      expect(err).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(err?.message).not.toContain("reads 'parent'");
      await expect(engine.insert('probe_ordinary_detail', { hdr: 'o1', note: 'n' }, { context: SYSTEM })).resolves.toMatchObject({ hdr: 'o1' });
    });
  });
}
