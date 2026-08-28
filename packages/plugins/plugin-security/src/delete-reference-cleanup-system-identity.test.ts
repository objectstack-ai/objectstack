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

// ---------------------------------------------------------------------------
// #12597 fixtures — one per guard that must SURVIVE the CRUD exemption.
//
// Each is `LINE_LEAD` plus exactly one guard, so a refusal can only come from
// that guard: the object-level CRUD check is exempted for this write, and every
// arm asserts the ADR-0112 envelope of the gate it names rather than the bare
// fact of a refusal (a suite that only asked "was it refused?" would stay green
// if the exemption regressed and the CRUD check answered instead).
// ---------------------------------------------------------------------------

/**
 * Guard 1 — FIELD-LEVEL security on the FK column itself. Nothing else about
 * `LINE_LEAD` changes: the caller still holds no object grant on B, so the CRUD
 * check is exempted exactly as in the positive case and FLS is the only gate
 * left that can speak.
 */
const FLS_LOCKED_LEAD: PermissionSet = {
  name: 'ehr_fls_lead',
  label: 'Line Lead (FK column locked by FLS)',
  objects: {
    os_ehr_product: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      modifyAllRecords: true, viewAllRecords: true,
    },
  },
  fields: {
    'os_ehr_andon_record.product': { readable: true, editable: false },
  },
} as unknown as PermissionSet;

/**
 * Guards 2 and 3 — the RLS pair. Both add READ on B, deliberately: the row
 * gates re-read the target row as the caller, so without a read grant the
 * refusal would be the read denial wearing the row gate's clothes — a phantom
 * pin that passes for the wrong reason. With read granted, the caller still
 * holds no EDIT bit, so the exemption is still what carries the write past
 * step 2 and the row gate is the only thing left that can refuse.
 */
const RLS_USING_LEAD: PermissionSet = {
  name: 'ehr_rls_using_lead',
  label: 'Line Lead (RLS `using` row scope on B)',
  objects: {
    os_ehr_product: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      modifyAllRecords: true, viewAllRecords: true,
    },
    os_ehr_andon_record: { allowRead: true, viewAllRecords: true },
  },
  rowLevelSecurity: [
    {
      name: 'andon_own_rows_only',
      object: 'os_ehr_andon_record',
      operation: 'update',
      using: 'owner_id == current_user.id',
    },
  ],
} as unknown as PermissionSet;

/**
 * Guard 3 — the RLS POST-IMAGE `check`. This is the sharpest of the three and
 * the reason the ruling narrowed: `check` is a data-SHAPE constraint, not a
 * reach question, so an FK-clear that empties `product` is precisely the write
 * a deployment declaring `product != null` means to forbid. Honouring that
 * intent when it is spelled as a `validations` entry and ignoring it when it is
 * spelled as an RLS `check` is the declared-not-enforced split this project
 * prices highest.
 */
const RLS_CHECK_LEAD: PermissionSet = {
  name: 'ehr_rls_check_lead',
  label: 'Line Lead (RLS post-image `check` on B)',
  objects: {
    os_ehr_product: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      modifyAllRecords: true, viewAllRecords: true,
    },
    os_ehr_andon_record: { allowRead: true, viewAllRecords: true },
  },
  rowLevelSecurity: [
    {
      name: 'andon_product_always_set',
      object: 'os_ehr_andon_record',
      operation: 'update',
      check: 'product != null',
    },
  ],
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
  for (const o of [PRODUCT, ANDON, BATCH]) engine.registry.registerObject(o as any, 'test');

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

  it('[#12597 — PIN INVERTED] a non-empty referencing table no longer needs the caller\'s own write authority on it', async () => {
    // ⚠️ THIS PIN WAS INVERTED, DELIBERATELY. It previously asserted the
    // opposite — `PERMISSION_DENIED` with `details.operation === 'update'` —
    // as #12166 ruling constraint 1's boundary ("nothing else about the delete
    // path changes identity"), and that assertion is what MEASURED the residue
    // this card was opened for: a role with full delete on A and no grant on B
    // could delete an A only while B was empty.
    //
    // The maintainer ruled that residue away on 2026-08-28 (#12597, second
    // round, option B): the FK-clear UPDATE is exempted from the object-level
    // CRUD check, scoped by the `__referentialFieldClear` marker. So the case
    // below now SUCCEEDS by ruling, and the old expectation is falsified rather
    // than merely stale. ⛔ The `cascade` arm is untouched and still requires
    // the caller's own delete authority on the child rows.
    //
    // The exemption's fences — FLS, the RLS `using` row scope and the RLS
    // post-image `check` all still refusing — are pinned one describe below.
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    const a = await h.seed('os_ehr_andon_record', { product: p.id });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).toBe(null);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(false);
    // set_null, not cascade: the referencing ROW survives with a cleared FK.
    expect(h.stores.get('os_ehr_andon_record')?.has(a.id)).toBe(true);
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product ?? null).toBe(null);
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

// ---------------------------------------------------------------------------
// #12597 — the FK-clear write is exempt from the object-level CRUD check, and
// from THAT CHECK ALONE (maintainer ruling 2026-08-28, second round, option B).
//
// The round-1 measurement is why the exemption is marker-scoped rather than
// `isSystem`: `security-plugin.ts`'s `isSystem` short-circuit is TOTAL (the
// repo's own page says so — `content/docs/permissions/system-context.mdx`:
// "Elevation is total, and it is not granular"), and it would have switched off
// three guards that answer questions referential integrity does not ask. Those
// three are the pins below; each names the gate's own envelope, so a refusal
// migrating between gates reddens instead of reading as "still refused".
// ---------------------------------------------------------------------------

describe('#12597 — the referential FK clear is exempt from the object-level CRUD check', () => {
  it('THE CONTRACT: full delete on A + NOTHING on B + a non-empty referencing table ⇒ the delete succeeds and the FK is cleared', async () => {
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    // Owned by somebody else and referencing the target: the reporting
    // deployment's shape, and the case that used to 403 on the UPDATE.
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_other' });
    expect(h.stores.get('os_ehr_andon_record')?.size).toBe(1);

    // Attribution is asserted on the CONTEXT the cleanup write actually carries
    // — the gate-(a) reading this card carries forward. The write must stay the
    // OPERATOR's own identity, because every attribution channel keys on
    // `session.userId`: `writeAudit`'s `user_id`/`actor` and the `updated_by`
    // stamp both read it, and a bare `isSystem` context was measured producing
    // `user_id: null, actor: null`. This exemption never touches identity, so
    // the pin is that the context reaching the engine is the caller's own.
    const cleanupContexts: any[] = [];
    h.engine.registerMiddleware(async (opCtx: any, next: () => Promise<void>) => {
      if (opCtx.object === 'os_ehr_andon_record' && opCtx.operation === 'update') {
        cleanupContexts.push(opCtx.context);
      }
      return next();
    });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).toBe(null);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(false);
    // `set_null`, not `cascade` — the referencing row survives, minus the FK.
    expect(h.stores.get('os_ehr_andon_record')?.has(a.id)).toBe(true);
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product ?? null).toBe(null);

    expect(cleanupContexts.length).toBe(1);
    expect(cleanupContexts[0]?.userId).toBe('u_lead');
    expect(cleanupContexts[0]?.isSystem).not.toBe(true);
    // …and it is the server-derived marker, not an identity switch, that the
    // exemption keys on (#3023; stamped in `cascadeDeleteRelations`).
    expect(cleanupContexts[0]?.__referentialFieldClear).toBe(true);
  });

  it('GUARD 1 — field-level security on the FK column still refuses, and the FK is unchanged', async () => {
    const h = await boot([FLS_LOCKED_LEAD]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_other' });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode ?? err.status).toBe(403);
    // The FLS gate's own envelope — it names the field it refused, which is what
    // distinguishes it from the CRUD denial the exemption removed.
    expect(err.details?.object).toBe('os_ehr_andon_record');
    expect(err.details?.forbiddenFields).toContain('product');
    // Nothing moved: neither the FK nor the delete it was blocking.
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product).toBe(p.id);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(true);
  });

  it('GUARD 2 — the RLS `using` row scope on the referencing object still refuses, and the FK is unchanged', async () => {
    const h = await boot([RLS_USING_LEAD]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    // Out of the caller's row scope: `owner_id == current_user.id` does not hold.
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_other' });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode ?? err.status).toBe(403);
    // The row gate's own envelope: it names the ROW, and its developer sentence
    // says row-level security — the CRUD denial says neither.
    expect(err.details?.object).toBe('os_ehr_andon_record');
    expect(err.details?.recordId).toBe(a.id);
    expect(err.developerMessage).toContain('row-level security');
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product).toBe(p.id);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(true);
  });

  it('GUARD 2 CONTROL — the same policy admits the write when the row IS in scope', async () => {
    // Without this arm, GUARD 2 is also satisfied by the exemption never firing
    // at all: "refused" would be indistinguishable from "the CRUD check answered
    // first". Here the ONLY thing that changes is the row's owner.
    const h = await boot([RLS_USING_LEAD]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_lead' });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).toBe(null);
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product ?? null).toBe(null);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(false);
  });

  it('GUARD 3 — the RLS post-image `check` still refuses, and the FK is unchanged', async () => {
    // The `check` is `product != null`, i.e. the deployment declared that this
    // FK may never be emptied. Under a blanket `isSystem` elevation the clear
    // went through and the declaration was silently ignored; under the ruled
    // narrowing the deployment gets a truthful refusal.
    const h = await boot([RLS_CHECK_LEAD]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_other' });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller());

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.statusCode ?? err.status).toBe(403);
    expect(err.details?.object).toBe('os_ehr_andon_record');
    // The check gate's own sentence — distinct from both the CRUD denial and
    // the row gate's "(row-level security)".
    expect(err.developerMessage).toContain('row-level CHECK');
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product).toBe(p.id);
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(true);
  });

  it('THE CONVERSE, again: the exemption is not a delete gate — a caller without delete rights on the TARGET is still refused', async () => {
    // The exemption widens which deletes SUCCEED; it must not widen who may ask.
    // This arm would go green if the exemption had been spelled anywhere that a
    // user-initiated write can reach.
    const h = await boot([READER]);
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_other' });

    const err = await h.deleteAs('os_ehr_product', p.id, h.caller('u_reader'));

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.details?.object).toBe('os_ehr_product');
    expect(err.details?.operation).toBe('delete');
    expect(h.stores.get('os_ehr_product')?.has(p.id)).toBe(true);
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product).toBe(p.id);
  });

  it('an ORDINARY update on the referencing object is untouched by the exemption', async () => {
    // The exemption keys on a marker the engine stamps on its own cleanup write
    // and nothing else. A caller who edits the same object directly, with the
    // same grants, still meets the object-level CRUD check — the marker is the
    // whole difference, so this is what proves the exemption is scoped to it.
    const h = await boot();
    const p = await h.seed('os_ehr_product', { name: 'Widget' });
    const a = await h.seed('os_ehr_andon_record', { product: p.id, owner_id: 'u_other' });

    const err = await h.engine
      .update('os_ehr_andon_record', { id: a.id, product: null }, { context: h.caller() } as any)
      .then(() => null, (e: any) => e);

    expect(err).not.toBe(null);
    expect(err.code).toBe('PERMISSION_DENIED');
    expect(err.details?.object).toBe('os_ehr_andon_record');
    expect(err.details?.operation).toBe('update');
    expect(h.stores.get('os_ehr_andon_record')?.get(a.id)?.product).toBe(p.id);
  });
});
