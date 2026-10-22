// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24316] The one-hop loader never reads through a reference into the
 * stored-metadata-body family (`STORED_METADATA_BODY_OBJECTS`), under either
 * authority.
 *
 * The family's projection runs at its doors and never at the engine, so a hop
 * read through `find` would hand a formula — and a validation rule — the stored
 * body and its content hash unprojected, material the family's own door
 * withholds from the same reader. One guard in `resolveOneHopRelated` covers
 * every exit that reaches the loader, and these pins drive each of them
 * through the real engine:
 *
 *  - a formula read: `find` (the REST read of the carrying object, and a hook
 *    body's `ctx.api.object(...)` read of it), `findOne` and a write's response;
 *  - `serveFormulaField`, the seam a hook body's `ctx.title()` reads through;
 *  - a validation rule's hydrated condition, read as SYSTEM.
 *
 * Each asserts that no family value is served, that the related read was never
 * issued at all, and that the answer is the disclosure-safe `unreadable` shape
 * (a formula reads `null` with its reason; a rule has no verdict and refuses).
 * A hop into an ordinary object, on the same carrier, is still served.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STORED_METADATA_BODY_OBJECTS } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';

type Rec = Record<string, unknown>;

/** A logger that records `warn` — the level the engine reports a formula fault at. */
function makeRecordingLogger() {
  const warns: Array<{ message: string; meta: Rec | undefined }> = [];
  const l: any = {
    trace() {}, debug() {}, info() {}, error() {}, fatal() {},
    warn(message: string, meta?: Rec) { warns.push({ message: String(message), meta }); },
    child() { return l; },
  };
  return { logger: l, warns };
}

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
  const calls: Array<{ object: string; ast: any; options?: any }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any, options?: any) {
      calls.push({ object, ast, options });
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Hold the caller's page: `offset` then `limit`, as a real driver does.
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

/** A synthetic stored datasource body with placeholder credential material. */
const SECRET = 'PLACEHOLDER-SECRET';
const STORED_BODY = JSON.stringify({ name: 'ds', driver: 'turso', config: { url: 'libsql://x.invalid', authToken: SECRET } });
const STORED_HASH = 'sha256:PLACEHOLDER-HASH';
const MEMBER = { userId: 'u1', tenantId: 'org_1', positions: ['member'] } as any;
const SYSTEM = { isSystem: true } as any;

for (const family of STORED_METADATA_BODY_OBJECTS) {
  describe(`[#24316] a hop into '${family}' is never read`, () => {
    let engine: ObjectQL;
    let d: ReturnType<typeof makeDriver>;
    let warns: ReturnType<typeof makeRecordingLogger>['warns'];
    const familyReads = () => d.calls.filter((c) => c.object === family).length;
    const faultsOn = (field: string) => warns.filter((w) => w.meta?.object === 'probe_carrier' && w.meta?.field === field);
    const servesNothing = (value: unknown) => {
      const text = JSON.stringify(value);
      expect(text).not.toContain(SECRET);
      expect(text).not.toContain('PLACEHOLDER-HASH');
    };

    beforeEach(async () => {
      const rec = makeRecordingLogger();
      warns = rec.warns;
      engine = new ObjectQL({ logger: rec.logger });
      d = makeDriver();
      engine.registerDriver(d.driver, true);
      await engine.init();
      engine.registry.registerObject({
        name: family,
        fields: { type: { type: 'text' }, name: { type: 'text' }, metadata: { type: 'textarea' }, checksum: { type: 'text' } },
      } as any, 'test-package');
      engine.registry.registerObject({ name: 'probe_other', fields: { name: { type: 'text' } } } as any, 'test-package');
      engine.registry.registerObject({
        name: 'probe_carrier',
        fields: {
          meta: { type: 'lookup', reference: family },
          other: { type: 'lookup', reference: 'probe_other' },
          body_out: { type: 'formula', expression: 'record.meta.metadata' },
          hash_out: { type: 'formula', expression: 'record.meta.checksum' },
          type_out: { type: 'formula', expression: 'record.meta.type' },
          other_out: { type: 'formula', expression: 'record.other.name' },
        },
      } as any, 'test-package');
      d.storeFor(family).set('m1', { id: 'm1', type: 'datasource', name: 'ds', metadata: STORED_BODY, checksum: STORED_HASH });
      d.storeFor('probe_other').set('o1', { id: 'o1', name: 'Other' });
      d.storeFor('probe_carrier').set('c1', { id: 'c1', meta: 'm1', other: 'o1' });
      d.calls.length = 0;
    });

    for (const [who, context] of [['a member', MEMBER], ['SYSTEM', SYSTEM]] as const) {
      it(`find as ${who}: every formula through the hop reads null with its reason, and the hop is never read`, async () => {
        const rows = await engine.find('probe_carrier', { context });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ body_out: null, hash_out: null, type_out: null, other_out: 'Other' });
        servesNothing(rows);
        expect(familyReads()).toBe(0);
        for (const field of ['body_out', 'hash_out', 'type_out']) {
          const fault = faultsOn(field);
          expect(fault).toHaveLength(1);
          expect(fault[0].message).toContain(`\`meta\` (object '${family}')`);
          servesNothing(fault);
        }
      });
    }

    it('findOne and a write\'s response serve no family value either', async () => {
      const one = await engine.findOne('probe_carrier', { where: { id: 'c1' }, context: MEMBER });
      expect(one).toMatchObject({ body_out: null, hash_out: null, other_out: 'Other' });
      const created = await engine.insert('probe_carrier', { meta: 'm1', other: 'o1' }, { context: SYSTEM });
      expect(created).toMatchObject({ body_out: null, hash_out: null, other_out: 'Other' });
      servesNothing([one, created]);
      expect(familyReads()).toBe(0);
    });

    it('serveFormulaField (the ctx.title() seam) serves no family value', async () => {
      for (const field of ['body_out', 'hash_out']) {
        expect(await engine.serveFormulaField('probe_carrier', { id: 'c1', meta: 'm1' }, field, MEMBER)).toBeNull();
        expect(await engine.serveFormulaField('probe_carrier', { id: 'c1', meta: 'm1' }, field, SYSTEM)).toBeNull();
      }
      expect(await engine.serveFormulaField('probe_carrier', { id: 'c1', other: 'o1' }, 'other_out', MEMBER)).toBe('Other');
      expect(familyReads()).toBe(0);
    });

    it('a validation rule reading through the hop has no verdict: the write is refused, as SYSTEM too', async () => {
      engine.registry.registerObject({
        name: 'probe_ruled',
        fields: { meta: { type: 'lookup', reference: family } },
        validations: [{
          name: 'probe_rule', type: 'script', severity: 'error', message: 'probe hit',
          condition: `record.meta.metadata.contains('${SECRET}')`,
        }],
      } as any, 'test-package');
      for (const context of [MEMBER, SYSTEM]) {
        const err = await engine.insert('probe_ruled', { meta: 'm1' }, { context }).then(() => undefined, (e) => e);
        expect(err).toMatchObject({ code: 'VALIDATION_FAILED', fields: [expect.objectContaining({ field: '_record', code: 'rule_violation' })] });
        // No verdict over the body: the refusal is the unevaluable one, never the rule's own.
        expect(String(err.message)).not.toBe('probe hit');
        expect(String(err.message)).toContain(`could not read '${family}'`);
        servesNothing(err.message);
      }
      expect(familyReads()).toBe(0);
    });
  });
}
