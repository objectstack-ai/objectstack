// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18682] The write PREVIEW and the write PATH agree about a payload the
 * field-level-security gate refuses — measured through both packages at once.
 *
 * ## Why this file exists, and why the unit suites could not hold it
 *
 * `ObjectQL.validate()` resolves a traversing validation rule's related row
 * under SYSTEM authority. The accepted cost is an inference channel bounded to
 * callers who could perform the write — a bound the real path gets from the
 * security middleware and the preview has to ask for, through
 * `registerWriteGateProbe`.
 *
 * The first probe asked an OBJECT-LEVEL question, and the write decision is not
 * object-level. Before `next()` the middleware also refuses PAYLOAD-dependent
 * writes, and the first of them is the field-level-security write gate: a
 * caller who holds the object's CRUD grant but is not `editable` on a field the
 * payload names is refused `PERMISSION_DENIED`. A probe carrying no payload
 * cannot ask it, so that caller — an editor of the child object who is
 * FLS-locked out of the lookup column, the common persona, not an exotic one —
 * was refused by `insert()` with ZERO related reads and answered by the preview
 * after ONE, receiving the rule's verdict about a row they may not point at.
 * On the real path such a caller can never choose which related row a rule is
 * judged against; through the preview they could choose any id they can name.
 * It is wire-reachable by the same door as the object-level classes:
 * `POST /data/:object/import` with `dryRun: true`.
 *
 * Neither package's own suite can see that. `can-write-object-admission.test.ts`
 * pins the METHOD against the middleware and knows nothing about how the engine
 * calls it; the engine's `engine-predicate-relationship.test.ts` drives a STUB
 * probe and would stay green against a probe that silently dropped the payload.
 * The seam is only observable by running both: here, as a preview answering a
 * caller the write path refuses.
 *
 * ## What is asserted
 *
 * For one caller and one payload, both doors, in both modes:
 *
 *   - `insert()` / `update()` refuse on the ADR-0112 `PERMISSION_DENIED`
 *     envelope, and the related object is never read;
 *   - `validate()` issues NO related read either, and the verdict it returns is
 *     NOT the traversing rule's — the rule's authored message must not appear,
 *     because that message IS the channel.
 *
 * Both controls run on the same harness, so this cannot pass by refusing
 * everything: the same caller with the column `editable` is admitted by both
 * doors, pays exactly ONE related read on each, and DOES receive the rule's
 * verdict.
 *
 * ⚠️ What this file does NOT claim. The gate is not a promise that the write
 * would succeed — the row-level pre-image (the middleware's step 2.7) judges a
 * row the preview does not name, and the static `readonly` strip runs inside
 * the write's executor and not here. Both are named limits on the engine seam
 * (`registerWriteGateProbe`), deliberately unpinned: a test asserting today's
 * answer there would advertise a guarantee the runtime does not deliver.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';

import '@objectstack/spec';
import '@objectstack/formula';

/** The rule's authored message — the verdict that must not cross the gate. */
const RULE_MESSAGE = 'Partner accounts are capped at 10000.';

const OPPORTUNITY = {
  name: 'crm_opportunity',
  fields: {
    name: { type: 'text' },
    amount: { type: 'number' },
    account: { type: 'lookup', reference: 'crm_account' },
  },
  validations: [{
    name: 'partner_cap', type: 'script', severity: 'error',
    message: RULE_MESSAGE,
    condition: "record.account.type == 'partner' && record.amount > 10000",
  }],
};

/** May create and edit opportunities — and may NOT repoint the account. */
const FLS_LOCKED: PermissionSet = {
  name: 'member_default',
  label: 'Opportunity editor, locked out of the lookup column',
  objects: { crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: { 'crm_opportunity.account': { readable: true, editable: false } },
} as unknown as PermissionSet;

/** The identical grant WITH the column editable — the control. */
const FLS_OPEN: PermissionSet = {
  name: 'member_default',
  label: 'Opportunity editor who may repoint the account',
  objects: { crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true } },
  fields: { 'crm_opportunity.account': { readable: true, editable: true } },
} as unknown as PermissionSet;

const CALLER = { userId: 'u_editor', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };
const SYS_CTX = { isSystem: true, userId: 'usr_system' };

/** The payload under test: it names the restricted column, and it trips the rule. */
const PARTNER_PAYLOAD = { name: 'A', amount: 50000, account: 'acc_p' };

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
      if (k === '$and') return (v as any[]).every((w) => matches(row, w));
      if (k === '$or') return (v as any[]).some((w) => matches(row, w));
      const cond = v as any;
      if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
        if ('$in' in cond) return Array.isArray(cond.$in) && cond.$in.includes(row?.[k]);
        if ('$eq' in cond) return row?.[k] === cond.$eq;
      }
      return row?.[k] === cond;
    });
  };
  const calls: Array<{ object: string; ast: any }> = [];
  let n = 0;
  const driver: any = {
    name: 'memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string, ast: any) {
      calls.push({ object, ast });
      const rows = Array.from(storeFor(object).values()).filter((r) => matches(r, ast?.where));
      // Hold the caller's bound: a double that ignores `limit` lets a real
      // double-limit defect through unnoticed (`check:objectql-double-limit`).
      const bounded = typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
      const fields: string[] | undefined = ast?.fields;
      if (!fields) return bounded;
      return bounded.map((r) => {
        const out: any = {};
        for (const f of fields) if (r[f] !== undefined) out[f] = r[f];
        return out;
      });
    },
    async findOne(object: string, ast: any) {
      calls.push({ object, ast });
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
    async updateMany() { return 0; },
    async delete(object: string, id: string) { return storeFor(object).delete(id); },
    async count() { return 0; },
    async bulkCreate(object: string, rows: Record<string, unknown>[]) {
      return Promise.all(rows.map((r) => this.create(object, r, undefined)));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return { driver, storeFor, calls };
}

interface Outcome { ok: boolean; code?: string; status?: number; message?: string }

const attempt = async (run: () => Promise<unknown>): Promise<Outcome> => {
  try {
    await run();
    return { ok: true };
  } catch (e) {
    const err = e as { code?: string; statusCode?: number; status?: number; message?: string };
    return {
      ok: false,
      code: err.code,
      status: err.statusCode ?? err.status,
      message: String(err.message ?? e),
    };
  }
};

async function boot(sets: PermissionSet[]) {
  const engine = new ObjectQL();
  const d = makeDriver();
  engine.registerDriver(d.driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'crm_account',
    fields: { name: { type: 'text' }, type: { type: 'text' } },
  } as any, 'test-package');
  engine.registry.registerObject(OPPORTUNITY as any, 'test-package');
  d.storeFor('crm_account').set('acc_p', { id: 'acc_p', name: 'P', type: 'partner' });
  d.storeFor('crm_account').set('acc_d', { id: 'acc_d', name: 'D', type: 'direct' });

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => sets,
    },
  };
  const ctx = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);

  // A row the caller may edit, seeded past every gate.
  await engine.insert(
    'crm_opportunity',
    { id: 'opp_1', name: 'seed', amount: 1, account: 'acc_d' },
    { context: SYS_CTX } as any,
  );
  d.calls.length = 0;
  return {
    engine,
    relatedReads: () => d.calls.filter((c) => c.object === 'crm_account').length,
    reset: () => { d.calls.length = 0; },
  };
}

describe('#18682 — the preview answers nobody the FLS write gate refuses', () => {
  describe('W6 — insert, a caller who may not edit the reference column', () => {
    let h: Awaited<ReturnType<typeof boot>>;
    beforeEach(async () => { h = await boot([FLS_LOCKED]); });

    it('insert() refuses on the PERMISSION_DENIED envelope, having read nothing related', async () => {
      const outcome = await attempt(
        () => h.engine.insert('crm_opportunity', { ...PARTNER_PAYLOAD }, { context: CALLER } as any),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(outcome.message).toMatch(/not permitted to edit/);
      expect(h.relatedReads()).toBe(0);
    });

    it('validate() reads nothing related either, and never returns the rule verdict', async () => {
      const preview = await h.engine.validate(
        'crm_opportunity', { ...PARTNER_PAYLOAD }, { mode: 'insert', context: CALLER } as any,
      );
      expect(h.relatedReads()).toBe(0);
      // Fail-closed, and — the whole point — NOT the rule's own answer about a
      // related row this caller may not point at.
      expect(preview.results?.[0]?.valid).toBe(false);
      expect(JSON.stringify(preview.results?.[0]?.errors ?? [])).not.toContain(RULE_MESSAGE);
    });
  });

  describe('W6u — update, the same caller against a row they may edit', () => {
    let h: Awaited<ReturnType<typeof boot>>;
    beforeEach(async () => { h = await boot([FLS_LOCKED]); });

    it('update() refuses on the same envelope, having read nothing related', async () => {
      const outcome = await attempt(() => h.engine.update(
        'crm_opportunity', { amount: 50000, account: 'acc_p' },
        { where: { id: 'opp_1' }, context: CALLER } as any,
      ));
      expect(outcome.ok).toBe(false);
      expect(outcome.code).toBe('PERMISSION_DENIED');
      expect(outcome.status).toBe(403);
      expect(h.relatedReads()).toBe(0);
    });

    it('validate({ mode: update }) reads nothing related and returns no rule verdict', async () => {
      const preview = await h.engine.validate(
        'crm_opportunity', { amount: 50000, account: 'acc_p' },
        { mode: 'update', context: CALLER } as any,
      );
      expect(h.relatedReads()).toBe(0);
      expect(preview.results?.[0]?.valid).toBe(false);
      expect(JSON.stringify(preview.results?.[0]?.errors ?? [])).not.toContain(RULE_MESSAGE);
    });
  });

  // ⭐ The controls. Same harness, same caller, same payload — the fixture
  // differs by `editable` alone. Without these the block above would pass on a
  // gate that refused everyone, which is the other way to get this wrong.
  describe('the control: the identical caller who MAY edit the column', () => {
    let h: Awaited<ReturnType<typeof boot>>;
    beforeEach(async () => { h = await boot([FLS_OPEN]); });

    it('insert() reaches the rule and refuses with the rule, after ONE related read', async () => {
      const outcome = await attempt(
        () => h.engine.insert('crm_opportunity', { ...PARTNER_PAYLOAD }, { context: CALLER } as any),
      );
      expect(outcome.ok).toBe(false);
      expect(outcome.message).toContain(RULE_MESSAGE);
      expect(h.relatedReads()).toBe(1);
    });

    it('validate() agrees with it, after ONE related read', async () => {
      const preview = await h.engine.validate(
        'crm_opportunity', { ...PARTNER_PAYLOAD }, { mode: 'insert', context: CALLER } as any,
      );
      expect(h.relatedReads()).toBe(1);
      expect(preview.results?.[0]?.valid).toBe(false);
      expect(JSON.stringify(preview.results?.[0]?.errors ?? [])).toContain(RULE_MESSAGE);
    });

    it('…and both doors ACCEPT the payload the rule allows', async () => {
      const preview = await h.engine.validate(
        'crm_opportunity', { name: 'B', amount: 50000, account: 'acc_d' },
        { mode: 'insert', context: CALLER } as any,
      );
      expect(preview.results?.[0]?.valid).toBe(true);
      await expect(h.engine.insert(
        'crm_opportunity', { name: 'B', amount: 50000, account: 'acc_d' }, { context: CALLER } as any,
      )).resolves.toBeTruthy();
    });
  });
});
