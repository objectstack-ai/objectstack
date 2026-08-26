// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #12166 — the delete-time reference check runs under the SYSTEM identity.
 * Maintainer ruling 2026-08-26, option A, with four binding constraints.
 *
 * ## What was broken, and why this suite is HERE and not in objectql
 *
 * Deleting a record runs the platform's pre-delete reference check, which
 * issues a `find` against every referencing object. That probe ran as the
 * CALLING OPERATOR, so a caller with full delete rights on the target but no
 * read grant on any referencing object got a blanket 403 — whether or not a
 * reference existed, and with the referencing table EMPTY. Measured on a real
 * deployment (`@objectstack/*@17.2.0`) across 17 role×object pairs; its A/B
 * control was that granting read-only on the referencing object, touching
 * NOTHING about delete rights, turned the identical operation into a 200.
 *
 * The refusal is produced by plugin-security's CRUD middleware, and the fix is
 * in `objectql`'s engine. Neither package alone can ask the question: an
 * objectql-only suite would have to double the very middleware whose verdict is
 * the subject, and a plugin-security-only suite has no delete path to run. So
 * this suite drives the REAL `SecurityPlugin` middleware over a REAL `ObjectQL`
 * engine, and the 403 it starts from is the deployment's own, not a stand-in.
 * (`@objectstack/objectql` is aliased to the producer's SOURCE by this
 * package's `vitest.config.ts`, so these verdicts are about the tree in the
 * checkout rather than about the last build.)
 *
 * ## The contract pinned here is the TERMINAL STATE, not the call
 *
 * Deliberately NOT "the probe was issued with `isSystem`" — that pin goes green
 * the moment someone wraps the call differently while the caller still 403s.
 * What is pinned is the report's own A/B control:
 *
 *     empty referencing table + no read grant on it + full delete rights
 *     on the target  ⇒  the delete SUCCEEDS.
 *
 * …and its converse, because a relaxation must not become a hole: a caller
 * without delete rights on the target is still refused. Both directions, or the
 * first one alone would also be satisfied by deleting the permission check.
 */

import { describe, it, expect, vi } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SecurityPlugin } from './security-plugin.js';

// ---------------------------------------------------------------------------
// The three-part fixture from the report: object A, referenced by B's lookup,
// and a role with full delete on A and nothing at all on B.
// ---------------------------------------------------------------------------

/** A — the object being deleted. */
const PRODUCT = {
  name: 'os_ehr_product',
  label: 'Product',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    name: { name: 'name', type: 'text' as const },
    organization_id: { name: 'organization_id', type: 'text' as const },
    owner_id: { name: 'owner_id', type: 'text' as const },
  },
};

/**
 * B — the referencing object from the report's server log. Its lookup is
 * OPTIONAL, so the resolved behaviour is `set_null`: this is the shape whose
 * probe used to 403 while the table was empty.
 */
const ANDON = {
  name: 'os_ehr_andon_record',
  label: 'Andon Record',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    organization_id: { name: 'organization_id', type: 'text' as const },
    owner_id: { name: 'owner_id', type: 'text' as const },
    product: { name: 'product', type: 'lookup' as const, reference: 'os_ehr_product' },
  },
};

/**
 * C — a REQUIRED lookup, so a row here escalates `set_null` → `restrict` and
 * the delete is refused with `DELETE_RESTRICTED`. That is the branch ruling
 * constraint 2 governs: it is the only path on which the elevated probe's
 * findings reach the caller at all.
 */
const BATCH = {
  name: 'os_ehr_batch',
  label: 'Batch',
  sharingModel: 'private',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true },
    organization_id: { name: 'organization_id', type: 'text' as const },
    owner_id: { name: 'owner_id', type: 'text' as const },
    product: { name: 'product', type: 'lookup' as const, reference: 'os_ehr_product', required: true },
  },
};

/**
 * The reporting deployment's role: everything on A, NOTHING on B or C — not a
 * narrowed read, no entry at all. `modifyAllRecords` because the report's role
 * held full delete rights; the card is about object-level read on the
 * REFERENCING table, not about row scoping on the target.
 */
const LINE_LEAD: PermissionSet = {
  name: 'ehr_line_lead',
  label: 'Line Lead',
  objects: {
    os_ehr_product: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      modifyAllRecords: true, viewAllRecords: true,
    },
  },
} as unknown as PermissionSet;

/**
 * The A/B control's OTHER arm, and the disclosure control for constraint 2:
 * identical to `LINE_LEAD` plus read on C. Nothing about delete rights differs.
 */
const SIGHTED_LEAD: PermissionSet = {
  name: 'ehr_sighted_lead',
  label: 'Sighted Lead',
  objects: {
    os_ehr_product: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      modifyAllRecords: true, viewAllRecords: true,
    },
    os_ehr_batch: { allowRead: true, viewAllRecords: true },
  },
} as unknown as PermissionSet;

/**
 * The converse arm: may READ everything, may not DELETE the target. This is the
 * role that proves the relaxation did not become a hole — if the fix had
 * loosened the delete gate itself rather than the reference check, this one
 * would start succeeding.
 */
const READER: PermissionSet = {
  name: 'ehr_reader',
  label: 'Reader',
  objects: {
    os_ehr_product: { allowRead: true, viewAllRecords: true },
    os_ehr_andon_record: { allowRead: true, viewAllRecords: true },
    os_ehr_batch: { allowRead: true, viewAllRecords: true },
  },
} as unknown as PermissionSet;

function makeStubDriver() {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  const storeFor = (o: string) => {
    let s = stores.get(o);
    if (!s) { s = new Map(); stores.set(o, s); }
    return s;
  };
  let nextId = 0;
  // `$contains` / `$or` are answered because `referenceProbeFilter` spells a
  // `multiple: true` probe that way (#9362); a double that ignored them would
  // report "no dependents" and turn a refusal into a silent success — the
  // fail-OPEN direction #8895 ruled out for this guard.
  const matchOne = (stored: unknown, spec: unknown): boolean => {
    if (spec !== null && typeof spec === 'object' && !Array.isArray(spec)) {
      const [op, cmp] = Object.entries(spec as Record<string, unknown>)[0] ?? [];
      if (op === '$contains') {
        const values = Array.isArray(stored) ? stored : [stored];
        return values.some((v) => v != null && typeof v !== 'object' && String(v) === String(cmp));
      }
      if (op === '$eq') return (stored ?? null) === ((cmp as any) ?? null);
      return false;
    }
    return (stored ?? null) === ((spec as any) ?? null);
  };
  const matches = (row: Record<string, unknown>, where: any): boolean => {
    if (!where || typeof where !== 'object') return true;
    for (const [k, v] of Object.entries(where)) {
      if (k === '$or') { if (!(v as any[]).some((sub) => matches(row, sub))) return false; continue; }
      if (k === '$and') { if (!(v as any[]).every((sub) => matches(row, sub))) return false; continue; }
      if (k.startsWith('$')) continue;
      if (!matchOne(row[k], v)) return false;
    }
    return true;
  };
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    // The caller's bound is applied AFTER the filter and BY PRESENCE — a double
    // looser than the engine on `limit` would let a probe that relies on a bound
    // read as unbounded here (`check:objectql-double-limit`).
    async find(o: string, ast: any) {
      const rows = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
      return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
    },
    async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
    async create(o: string, data: Record<string, unknown>) {
      nextId += 1;
      const id = (data.id as string) ?? `r_${nextId}`;
      const row = { ...data, id };
      storeFor(o).set(id, row);
      return row;
    },
    async update(o: string, id: string, data: Record<string, unknown>) {
      const s = storeFor(o); const cur = s.get(id);
      if (!cur) throw new Error(`nf ${o}/${id}`);
      const up = { ...cur, ...data, id }; s.set(id, up); return up;
    },
    async upsert(o: string, data: Record<string, unknown>) {
      const id = data.id as string | undefined;
      return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
    },
    async delete(o: string, id: string) { return storeFor(o).delete(id); },
    async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
    async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, stores };
}

interface LogRecord { msg: string; meta?: Record<string, unknown> }

async function boot(sets: PermissionSet[] = [LINE_LEAD]) {
  const info: LogRecord[] = [];
  const engineLogger = {
    info: vi.fn((msg: string, meta?: Record<string, unknown>) => { info.push({ msg, meta }); }),
    warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
  };
  const engine = new ObjectQL({ logger: engineLogger });
  const { driver, stores } = makeStubDriver();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const o of [PRODUCT, ANDON, BATCH]) engine.registry.registerObject(o as any);

  const schemas: Record<string, unknown> = {
    os_ehr_product: PRODUCT, os_ehr_andon_record: ANDON, os_ehr_batch: BATCH,
  };
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: { get: async (n: string) => schemas[n], list: async () => sets },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ defaultPermissionSets: sets, fallbackPermissionSet: sets[0]!.name });
  await plugin.init(ctx);
  await plugin.start(ctx);

  const SYSTEM = { context: { isSystem: true } } as any;
  return {
    engine,
    stores,
    engineInfo: info,
    /** Seed rows past the middleware — fixture setup is not the subject. */
    seed: (object: string, row: Record<string, unknown>) => engine.insert(object, row, SYSTEM),
    caller: (userId = 'u_lead') => ({ userId, tenantId: 'org-1', positions: [], permissions: [] }),
    deleteAs: (object: string, id: string, context: any) =>
      engine.delete(object, { where: { id }, context } as any).then(() => null, (e: any) => e),
  };
}

// ---------------------------------------------------------------------------
// The contract: the report's A/B control, both directions.
// ---------------------------------------------------------------------------

describe('#12166 — pre-delete reference check runs as SYSTEM (ruling A)', () => {
  it('THE CONTRACT: empty referencing table + no read grant on it + full delete rights ⇒ the delete SUCCEEDS', async () => {
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });

    // `os_ehr_andon_record` is EMPTY and the caller has no grant on it at all.
    expect(h.stores.get('os_ehr_andon_record')?.size ?? 0).toBe(0);

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    // Before the fix this was:
    //   PERMISSION_DENIED / 403, developerMessage
    //   "[Security] Access denied: operation 'find' on object
    //    'os_ehr_andon_record' is not permitted for positions []"
    // — the report's log line, reproduced verbatim by this fixture.
    expect(err).toBe(null);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(false);
  });

  it('THE CONVERSE: a caller without delete rights on the TARGET is still refused', async () => {
    // The relaxation must not become a hole. If the fix had loosened the delete
    // gate rather than the reference check, this goes green and nobody notices:
    // the case above cannot tell the two apart on its own.
    const h = await boot([READER]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller('u_reader'));

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode ?? err.status).toBe(403);
    // …and refused about the TARGET, not about a referencing table.
    expect(err.details?.object).toBe('os_ehr_product');
    expect(err.details?.operation).toBe('delete');
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(true);
  });

  it('the elevation is the CHECK only — a non-empty referencing table still needs the caller\'s own write authority (constraint 1)', async () => {
    // Ruling constraint 1: "Nothing else about the delete path changes
    // identity." The `set_null` UPDATE below still runs as the caller, so a
    // caller with no grant on the referencing object is refused here — the
    // reference CHECK was relaxed, the caller's authority over the dependent
    // rows was not. Pinned so the boundary is visible rather than discovered:
    // a later edit that elevated the cleanup WRITES too would turn this green.
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    await h.seed('os_ehr_andon_record', { product: p.id });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    // The refusal now names the WRITE it could not perform, not the read the
    // check used to fail on.
    expect(err.details?.object).toBe('os_ehr_andon_record');
    expect(err.details?.operation).toBe('update');
  });
});

describe('#12166 constraint 2 — the refusal names the OBJECT and leaks nothing about rows', () => {
  it('a caller who cannot read the referencing object is told WHICH object blocks them, and no count', async () => {
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    await h.seed('os_ehr_batch', { product: p.id });
    await h.seed('os_ehr_batch', { product: p.id });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).not.toBe(null);
    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.status).toBe(409);
    // Constraint 2's REQUIRED half — the blocking object is named. This is the
    // fact the reporting deployment's admins had no way to obtain.
    expect(err.dependentObject).toBe('os_ehr_batch');
    expect(err.message).toContain('Batch');
    // …and its WITHHELD half. The probe saw two rows under an identity this
    // caller does not hold; saying "2" would hand them an exact cardinality
    // oracle over a table they may not read.
    expect(err.dependentCount).toBeUndefined();
    expect(err.message).not.toMatch(/\d/);
    expect(err.developerMessage).not.toMatch(/\d dependent/);
    // Nothing about the REFERENCING object's rows, in either sentence.
    //
    // Scoped to `os_ehr_batch`'s row ids deliberately. The target's own id DOES
    // appear in `developerMessage` ("Cannot delete os_ehr_product (r_2)") and is
    // not a disclosure at all: the caller passed it in. Constraint 2 is about
    // the rows the ELEVATION let the engine see, which are these.
    for (const rowId of h.stores.get('os_ehr_batch')!.keys()) {
      expect(err.message).not.toContain(rowId);
      expect(err.developerMessage).not.toContain(rowId);
    }
    // The user-facing sentence renders LABELS only — no API name, no id.
    expect(err.message).not.toContain(p.id);
    expect(err.message).not.toContain('os_ehr_batch');
  });

  it('CONTROL: a caller who CAN read the referencing object still gets the count', async () => {
    // Without this arm the case above is also satisfied by deleting the count
    // for everyone — which is a regression, not the ruling: the count predates
    // this card and is what makes the refusal actionable for a caller who could
    // always have computed it. The suppression is CONDITIONAL, and this is the
    // condition.
    const h = await boot([SIGHTED_LEAD]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    await h.seed('os_ehr_batch', { product: p.id });
    await h.seed('os_ehr_batch', { product: p.id });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller('u_sighted'));

    expect(err.code).toBe('DELETE_RESTRICTED');
    expect(err.dependentObject).toBe('os_ehr_batch');
    expect(err.dependentCount).toBe(2);
    expect(err.message).toContain('2');
  });
});

describe('#12166 constraint 3 — the ledger records BOTH halves', () => {
  it('triggered-by = the deleting operator, executed-as = system', async () => {
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });

    await h.deleteAs('os_ehr_product', p.id, h.caller('u_lead'));

    const filed = h.engineInfo.filter((r) => r.msg.includes('[reference-cleanup]'));
    expect(filed.length).toBeGreaterThan(0);
    const andon = filed.find((r) => r.meta?.referencedObject === 'os_ehr_andon_record');
    expect(andon).toBeDefined();
    expect(andon!.meta).toMatchObject({
      triggeredBy: 'u_lead',          // the operator who asked for the delete
      executedAs: 'system',           // the identity the check actually ran under
      object: 'os_ehr_product',
      recordId: p.id,
      referencedObject: 'os_ehr_andon_record',
      relationField: 'product',
    });
    // ⛔ The ledger names declared metadata only — never a row id, a value or a
    // count. Constraint 2 governs what the CALLER is told; the same rule is
    // held here so a support transcript cannot become the leak.
    expect(Object.keys(andon!.meta!)).not.toContain('dependentCount');
  });

  it('files the elevation even when the check then REFUSES the delete', async () => {
    // Filed before the probe, not after it: a record written only on the
    // success path would be missing exactly the runs an auditor looks for.
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    await h.seed('os_ehr_batch', { product: p.id });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller('u_lead'));
    expect(err.code).toBe('DELETE_RESTRICTED');

    expect(h.engineInfo.some(
      (r) => r.msg.includes('[reference-cleanup]') && r.meta?.referencedObject === 'os_ehr_batch',
    )).toBe(true);
  });
});
