// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7728 — the `internal: true` field flag, against a REAL {@link ObjectQL}
 * engine + a minimal stub driver.
 *
 * The flag declares "the value is never returned on the generic data path". It
 * exists because the two credential collectors key off the field **TYPE**
 * (`secret` / `password`), so a one-way hash living in a `text` column —
 * ADR-0100's third channel — is collected by neither, regardless of `managedBy`.
 *
 * Every assertion here is paired with its negative, because a strip is trivially
 * satisfiable by breaking the feature:
 *
 *  - absent from the RESPONSE  ⇄  still present in STORAGE
 *  - absent from the RESPONSE  ⇄  still usable as a `where` FILTER (this is the
 *    verifier's `where: { key: <hash> }`, the thing that must not break)
 *  - the flagged field omitted  ⇄  every other field survives
 *
 * The `?select=` case is its own test rather than a variation: `select` gates
 * only on whether a field is KNOWN, so a projection-aware strip would leak to
 * any caller who spelled the column out.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, type EngineReadOptions } from './engine.js';
import { collectInternalReadFields, SECRET_MASK } from './secret-fields.js';
import type { EngineAggregateOptions, ServiceObject } from '@objectstack/spec/data';

// ---- minimal stub driver (equality-only WHERE) ----------------------------
// Rows leave the driver as COPIES, as a real driver's do — see the note in
// `secret-fields.test.ts` (#7799): handing out the live stored object would let
// the engine's own strip mutate storage, which reads exactly like an engine bug.
function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (obj: string) => {
    let s = stores.get(obj);
    if (!s) { s = new Map(); stores.set(obj, s); }
    return s;
  };
  let nextId = 0;
  const matches = (row: any, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k.startsWith('$')) continue;
      // `$in` — the batch shape `resolveInternalField` reads by (#8118).
      if (v && typeof v === 'object' && '$in' in (v as any)) {
        const members = (v as any).$in;
        if (!Array.isArray(members) || !members.includes(row[k] ?? null)) return false;
        continue;
      }
      const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
      if ((row[k] ?? null) !== (expected ?? null)) return false;
    }
    return true;
  };
  const copy = <T,>(r: T): T => (r == null ? r : ({ ...r } as T));
  const project = (row: any, fields?: string[]) => {
    if (!row || !Array.isArray(fields) || fields.length === 0) return copy(row);
    const out: Record<string, unknown> = {};
    for (const f of fields) if (f in row) out[f] = row[f];
    return out;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, ast: any) {
      return Array.from(storeFor(object).values())
        .filter((r) => matches(r, ast?.where))
        .map((r) => project(r, ast?.fields));
    },
    async findOne(object: string, ast: any) {
      for (const r of storeFor(object).values()) if (matches(r, ast?.where)) return project(r, ast?.fields);
      return null;
    },
    async create(object: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(object).set(id, row);
      return copy(row);
    },
    async update(object: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(object);
      const cur = s.get(id);
      if (!cur) throw new Error(`not found: ${object}/${id}`);
      const updated = { ...cur, ...data, id };
      s.set(id, updated);
      return copy(updated);
    },
    async upsert(object: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      if (id && storeFor(object).has(id)) return this.update(object, id, data);
      return this.create(object, data);
    },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r)));
    },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

/**
 * Shaped after `sys_api_key`: a one-way hash in a `text` column on a
 * better-auth-managed identity object. `managedBy` is set on purpose — it is
 * what makes `password` retyping inert, and the flag must work in spite of it.
 */
const tokenObject: ServiceObject = {
  name: 'itest_api_key',
  label: 'API Key',
  managedBy: 'better-auth',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    name: { name: 'name', label: 'Name', type: 'text' as const },
    prefix: { name: 'prefix', label: 'Prefix', type: 'text' as const },
    revoked: { name: 'revoked', label: 'Revoked', type: 'boolean' as const },
    key: {
      name: 'key', label: 'Hashed Key', type: 'text' as const,
      required: true, hidden: true, readonly: true, internal: true,
    },
  },
};

/** No flagged field — the fast path, and the proof the flag is opt-in. */
const plainObject: ServiceObject = {
  name: 'itest_plain',
  label: 'Plain',
  fields: {
    id: { name: 'id', label: 'ID', type: 'text' as const },
    key: { name: 'key', label: 'Key', type: 'text' as const },
  },
};

async function buildEngine() {
  const engine = new ObjectQL();
  const { driver, stores } = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  // `packageId` is required — these fixtures own their objects outright.
  engine.registry.registerObject(tokenObject, 'internal-fields-test');
  engine.registry.registerObject(plainObject, 'internal-fields-test');
  return { engine, stores };
}

const HASH = 'sha256:deadbeefcafe';

/**
 * Trailing read options for the aggregate cases below. Declared with its
 * contract type rather than inlined `as any`: erasing a read method's options
 * argument is what `query-options/no-any-erasure` bans and the #4918 ratchet
 * counts (`scripts/check-query-options-erasure-ratchet.mjs`).
 */
const SYSTEM: EngineReadOptions = { context: { isSystem: true } };

describe('#7728: the `internal` field flag omits a value from the generic data path', () => {
  let ctx: Awaited<ReturnType<typeof buildEngine>>;
  beforeEach(async () => { ctx = await buildEngine(); });

  const seed = async () =>
    ctx.engine.insert('itest_api_key', {
      name: 'k1', prefix: 'osk_', revoked: false, key: HASH,
    }, { context: { isSystem: true } } as any);

  describe('the collector', () => {
    it('collects by FLAG, not by type, and ignores `managedBy`', () => {
      // The two facts that make the flag necessary at all: the column is
      // `text` (so no type-keyed collector sees it) on a better-auth object
      // (so the password exemption would have skipped it anyway).
      expect(collectInternalReadFields(tokenObject as any)).toEqual(['key']);
      expect(collectInternalReadFields(plainObject as any)).toEqual([]);
      expect(collectInternalReadFields(undefined)).toEqual([]);
      expect(collectInternalReadFields({ name: 'x' } as any)).toEqual([]);
    });

    it('is strictly opt-in — a truthy-but-not-true value does not enrol a field', () => {
      // A non-exposure guarantee must not be switchable by accident. `1` /
      // `'false'` are the shapes a loose `!!def.internal` would silently accept.
      const loose = { name: 'o', fields: { a: { internal: 1 }, b: { internal: 'false' }, c: { internal: false } } };
      expect(collectInternalReadFields(loose as any)).toEqual([]);
    });
  });

  describe('the read path', () => {
    it('omits the flagged field from find and findOne — the key is absent, not null', async () => {
      const created = await seed();

      const viaFind = (await ctx.engine.find('itest_api_key', { where: { id: created.id } }))[0] as any;
      expect(Object.keys(viaFind)).not.toContain('key');
      // Not masked either — omit was ruled over mask (#7728 (b)).
      expect(Object.values(viaFind)).not.toContain(SECRET_MASK);
      // Falsifiability: this is a real row, not an emptied one.
      expect(viaFind.name).toBe('k1');
      expect(viaFind.prefix).toBe('osk_');

      const viaOne = await ctx.engine.findOne('itest_api_key', { where: { id: created.id } }) as any;
      expect(Object.keys(viaOne)).not.toContain('key');
      expect(viaOne.name).toBe('k1');
    });

    it('an EXPLICIT projection naming the field does not bypass the omit', async () => {
      // The #7823 bypass. `select`/`fields` only gates on whether a field is
      // KNOWN, and a flagged field is known — so naming it must be served
      // WITHOUT it rather than refused, and the rest of the projection honoured.
      const created = await seed();

      const rows = await ctx.engine.find('itest_api_key', {
        where: { id: created.id }, fields: ['id', 'key', 'prefix'],
      });
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] as any)).not.toContain('key');
      expect((rows[0] as any).id).toBe(created.id);
      expect((rows[0] as any).prefix).toBe('osk_');

      const one = await ctx.engine.findOne('itest_api_key', {
        where: { id: created.id }, fields: ['id', 'key'],
      }) as any;
      expect(Object.keys(one)).not.toContain('key');
      expect(one.id).toBe(created.id);
    });

    it('leaves an unflagged object completely alone (opt-in, and the fast path)', async () => {
      const created = await ctx.engine.insert('itest_plain', { key: 'visible' });
      const row = await ctx.engine.findOne('itest_plain', { where: { id: created.id } }) as any;
      expect(row.key).toBe('visible');
    });
  });

  describe('the write-response surfaces', () => {
    it('omits the flagged field from the create body', async () => {
      const created = await seed();
      expect(Object.keys(created)).not.toContain('key');
      // The create still returns a usable record — the mint path reads `id`
      // off exactly this value.
      expect(created.id).toBeTruthy();
    });

    it('omits the flagged field from the by-id update body', async () => {
      // The surface measured leaking on `sys_api_key` itself: that object has
      // `update` open (#7727) and its revoke/restore row actions PATCH it.
      const created = await seed();
      const updated = await ctx.engine.update('itest_api_key', { id: created.id, revoked: true }, {
        context: { isSystem: true },
      } as any);
      expect(Object.keys(updated)).not.toContain('key');
      expect(updated.revoked).toBe(true);
    });
  });

  describe('the negative direction — nothing below the response changes', () => {
    it('keeps the value in STORAGE', async () => {
      const created = await seed();
      await ctx.engine.find('itest_api_key', { where: { id: created.id } });
      await ctx.engine.findOne('itest_api_key', { where: { id: created.id } });

      // Read straight out of the driver's store, past the engine. If the strip
      // mutated the stored row instead of the response copy, the credential is
      // destroyed and the object is unrecoverable.
      const stored = ctx.stores.get('itest_api_key')!.get(created.id) as any;
      expect(stored.key).toBe(HASH);
    });

    it('keeps the field usable as a WHERE filter — the verifier lookup', async () => {
      // `resolveApiKeyPrincipal` does exactly this: match the at-rest hash,
      // then read `expires_at`/`user_id`/`scopes` off the row. If the flag were
      // implemented by dropping the column from the QUERY instead of from the
      // response, this returns nothing and authentication breaks platform-wide.
      const created = await seed();

      const found = await ctx.engine.find('itest_api_key', { where: { key: HASH, revoked: false }, limit: 1 });
      expect(found).toHaveLength(1);
      expect((found[0] as any).id).toBe(created.id);
      // …and the matched row still hands back the columns the verifier reads,
      // while withholding the one it only ever filters on.
      expect((found[0] as any).name).toBe('k1');
      expect(Object.keys(found[0] as any)).not.toContain('key');

      // A wrong hash still misses — the filter is real, not ignored.
      expect(await ctx.engine.find('itest_api_key', { where: { key: 'sha256:wrong' } })).toHaveLength(0);
    });

    it('survives repeated reads — the strip is not cumulative on storage', async () => {
      await seed();
      for (let i = 0; i < 3; i++) {
        await ctx.engine.find('itest_api_key', { where: { key: HASH } });
      }
      const found = await ctx.engine.find('itest_api_key', { where: { key: HASH } });
      expect(found).toHaveLength(1);
    });
  });

  /**
   * [#7922] `aggregate()` has no strip: it groups and reduces the driver's raw
   * rows, so a flagged column reached through `groupBy` or an aggregation
   * measure would surface the very value the flag promises is "never returned
   * on the generic data path". The type-keyed half of this guard has been in
   * place since #3171 (see the `ADR-0100 / #3171` block in
   * `secret-fields.test.ts`, which stays the floor for `secret` / `password`);
   * what is pinned here is the flag-keyed half, which did not exist.
   *
   * The FIRST case is deliberately the negative one. A guard that refuses too
   * much breaks analytics silently — nothing throws at the surface a reviewer
   * looks at, the numbers just stop arriving — so the control that an
   * unflagged column still aggregates has to be able to fail on its own.
   */
  describe('the aggregation guard', () => {
    /** Two rows sharing a prefix and one on its own — enough for real buckets. */
    const seedThree = async () => {
      await ctx.engine.insert('itest_api_key', { name: 'k1', prefix: 'osk_', revoked: false, key: HASH }, { context: { isSystem: true } } as any);
      await ctx.engine.insert('itest_api_key', { name: 'k2', prefix: 'osk_', revoked: false, key: `${HASH}-2` }, { context: { isSystem: true } } as any);
      await ctx.engine.insert('itest_api_key', { name: 'k3', prefix: 'svc_', revoked: true, key: `${HASH}-3` }, { context: { isSystem: true } } as any);
    };

    it('CONTROL: an unflagged column on an object that HAS a flagged one still aggregates', async () => {
      await seedThree();

      // `prefix` is an ordinary text column on the same object as the flagged
      // `key`. Grouping by it must keep working, and must return the real
      // buckets — asserting only "does not throw" would still pass if the
      // guard were replaced by a no-op that returned nothing.
      const rows = await ctx.engine.aggregate('itest_api_key', {
        aggregations: [{ function: 'count', alias: 'n' }],
        groupBy: ['prefix'],
      }, SYSTEM);

      const byPrefix = Object.fromEntries(rows.map((r: any) => [r.prefix, Number(r.n)]));
      expect(byPrefix).toEqual({ osk_: 2, svc_: 1 });
    });

    it('CONTROL: an object with NO flagged field aggregates untouched (the fast path)', async () => {
      await ctx.engine.insert('itest_plain', { key: 'visible' });
      await ctx.engine.insert('itest_plain', { key: 'visible' });
      await ctx.engine.insert('itest_plain', { key: 'other' });

      // `itest_plain.key` shares its NAME with the flagged column on the other
      // object — a guard that collected field names globally rather than
      // per-schema would refuse here.
      const rows = await ctx.engine.aggregate('itest_plain', {
        aggregations: [{ function: 'count', alias: 'n' }],
        groupBy: ['key'],
      });

      const byKey = Object.fromEntries(rows.map((r: any) => [r.key, Number(r.n)]));
      expect(byKey).toEqual({ visible: 2, other: 1 });
    });

    it('CONTROL: COUNT(*) on the flagged object is not a false positive', async () => {
      await seedThree();
      // The object merely HAS a flagged column; nothing references it.
      const rows = await ctx.engine.aggregate('itest_api_key', {
        aggregations: [{ function: 'count', alias: 'n' }],
      }, SYSTEM);
      expect(Number((rows[0] as any).n)).toBe(3);
    });

    it('rejects the flagged field as a string groupBy dimension', async () => {
      await seedThree();
      // The disclosure shape: one bucket per distinct hash, keyed BY the hash.
      await expect(
        ctx.engine.aggregate('itest_api_key', {
          aggregations: [{ function: 'count', alias: 'n' }],
          groupBy: ['key'],
        }, SYSTEM),
      ).rejects.toThrow(/key/);
    });

    it('rejects the flagged field as a structured {field} groupBy bucket', async () => {
      await seedThree();
      // `as unknown as` names the contract being bypassed rather than erasing
      // it: `EngineAggregateOptions.groupBy` is declared `string[]`, while the
      // engine reads structured `{ field, dateGranularity }` buckets too — so
      // this is deliberately off-contract input, and the guard must walk that
      // second spelling as well. (`as any` here would grow the #4918 ratchet.)
      await expect(
        ctx.engine.aggregate('itest_api_key', {
          aggregations: [{ function: 'count', alias: 'n' }],
          groupBy: [{ field: 'key' }],
        } as unknown as EngineAggregateOptions, SYSTEM),
      ).rejects.toThrow(/key/);
    });

    it('rejects the flagged field as an aggregation measure', async () => {
      await seedThree();
      // MIN/MAX over a credential is the inference oracle #3171 named.
      await expect(
        ctx.engine.aggregate('itest_api_key', {
          aggregations: [{ function: 'max', field: 'key', alias: 'x' }],
        }, SYSTEM),
      ).rejects.toThrow(/key/);
    });

    it('rejects even though the object is `managedBy: better-auth`', async () => {
      // The read path exempts better-auth from PASSWORD masking; neither
      // collector feeding this guard has an exemption, so the union does not
      // acquire one. `itest_api_key` is better-auth-managed and still refused.
      expect((tokenObject as any).managedBy).toBe('better-auth');
      await seedThree();
      await expect(
        ctx.engine.aggregate('itest_api_key', {
          aggregations: [{ function: 'count', alias: 'n' }],
          groupBy: ['key'],
        }, SYSTEM),
      ).rejects.toThrow(/itest_api_key\.key/);
    });

    it('names every refused field once, and only the refused ones', async () => {
      await seedThree();
      // Mixing a legitimate dimension with the flagged one refuses the whole
      // query (fail-closed) but must not slander `prefix`.
      const err = await ctx.engine.aggregate('itest_api_key', {
        aggregations: [{ function: 'count', alias: 'n' }],
        groupBy: ['prefix', 'key'],
      }, SYSTEM).then(
        () => null,
        (e: unknown) => e as Error,
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain('itest_api_key.key');
      expect(err!.message).not.toContain('prefix');
      // Deduped: a field must not be listed twice if it is reachable through
      // both collectors.
      expect(err!.message.match(/itest_api_key\.key/g)).toHaveLength(1);
    });
  });

  /**
   * [#8118] `resolveInternalField` — the purpose-built privileged accessor
   * #7728 itself named as the shape a legitimate system reader uses ("it reads
   * the column through a purpose-built privileged accessor, the way
   * `resolveSecret` does"). The omit above has NO system carve-out, so this is
   * the ONLY supported door to a flagged value; its first consumer is the
   * outbound-HTTP dispatcher's claim path, which must put
   * `sys_http_delivery.headers_json` on the wire verbatim while the data API
   * returns rows without it.
   *
   * Batch-shaped (ids in, `Map` out) because that consumer claims a batch per
   * dispatcher tick — #8118's triage rejected `Field.secret()` partly for
   * costing a per-row read on that tick, and the accessor must not re-acquire
   * the rejected cost.
   */
  describe('#8118: resolveInternalField — the privileged dereference', () => {
    it('resolves the flagged field for a batch of ids, straight from storage', async () => {
      const a = await seed();
      const b = await ctx.engine.insert('itest_api_key', {
        name: 'k2', prefix: 'svc_', revoked: false, key: `${HASH}-2`,
      }, { context: { isSystem: true } } as any);

      const resolved = await ctx.engine.resolveInternalField('itest_api_key', [a.id, b.id], 'key');
      expect(resolved.get(a.id)).toBe(HASH);
      expect(resolved.get(b.id)).toBe(`${HASH}-2`);
      expect(resolved.size).toBe(2);

      // …while the generic read path, asked in the same breath, still omits —
      // the accessor is a second DOOR, not a hole in the first one.
      const viaFind = (await ctx.engine.find('itest_api_key', { where: { id: a.id } }))[0] as any;
      expect(Object.keys(viaFind)).not.toContain('key');
    });

    it('an unset value resolves to null; a missing row is absent from the map', async () => {
      const a = await ctx.engine.insert('itest_api_key', {
        name: 'k-unset', prefix: 'osk_', revoked: false, key: null,
      }, { context: { isSystem: true } } as any);

      const resolved = await ctx.engine.resolveInternalField(
        'itest_api_key', [a.id, 'r_does_not_exist'], 'key',
      );
      // Unset ≠ missing: the caller can tell "row exists, nothing stored"
      // (null) from "no such row" (absent) — the dispatcher treats the latter
      // as a row deleted mid-claim.
      expect(resolved.has(a.id)).toBe(true);
      expect(resolved.get(a.id)).toBeNull();
      expect(resolved.has('r_does_not_exist')).toBe(false);
    });

    it('an empty batch resolves to an empty map without touching the driver', async () => {
      const resolved = await ctx.engine.resolveInternalField('itest_api_key', [], 'key');
      expect(resolved.size).toBe(0);
    });

    it('refuses a field not declared `internal: true` — ADR-0112 code AND status', async () => {
      const created = await seed();
      // `prefix` comes back on every find — dereferencing it here is not a
      // privilege, and an accessor that allowed it would be a generic
      // read-protection bypass one field-name away from `password`.
      const err = await ctx.engine.resolveInternalField('itest_api_key', [created.id], 'prefix').then(
        () => null,
        (e: unknown) => e as Error & { code?: string; status?: number; field?: string },
      );
      expect(err).toBeInstanceOf(Error);
      expect(err!.code).toBe('INVALID_FIELD');
      expect(err!.status).toBe(400);
      expect(err!.field).toBe('prefix');
      expect(err!.message).toContain('itest_api_key.prefix');
    });

    it('refuses on an object with no flagged fields at all (guard before fast path)', async () => {
      // The guard outranks the empty-ids fast path on purpose: a caller that
      // wired the wrong object name hears about it deterministically, not only
      // on the first non-empty batch.
      await expect(ctx.engine.resolveInternalField('itest_plain', [], 'key'))
        .rejects.toMatchObject({ code: 'INVALID_FIELD', status: 400 });
    });
  });
});
