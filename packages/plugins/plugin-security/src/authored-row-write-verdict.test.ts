// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5493 step 1] `ISecurityService.checkAuthoredRowWrite` — "does an APP-AUTHORED
// row-level policy admit this row for this write, on its own?"
//
// The whole reason this method exists rather than the caller asking a cheaper
// question is a MEASURED hole, and the cases below are that measurement turned
// into pins.
//
// #5493's fix needs the sharing middleware to defer, before hard-refusing a
// by-id write, to "a declared, app-authored RLS update-widener admits this row".
// The obvious proxy — "the COMPOSED RLS admits this row" — is not a cheaper
// spelling of that question. Sitting inside the composed answer is the
// platform's OWN wildcard write floor (`owner_only_writes` /
// `owner_only_deletes`, `created_by == current_user.id`), shipped on
// `member_default`, the additive baseline every authenticated member resolves.
// So the composed answer is `true` for a row's CREATOR whether or not any app
// policy mentions the row at all.
//
// Probe E-A (#5493 comment 5226364929) is where that costs something real: a
// **creator who is no longer the owner** — a record transferred away from them —
// is admitted by the platform floor and refused by sharing with an envelope
// byte-identical to #5493's own. A deferral keyed on the composed answer would
// hand transferred records back to their former creators.
//
// `TRANSFERRED_UPDATE_IS_ADMITTED_BY_THE_COMPOSED_PATH` below is not decoration:
// it drives the REAL middleware and proves the composed path really does admit
// the very row this method abstains on. Without it the E-A pins would be
// asserting `abstain` against a row nothing admits, which is no pin at all.
//
// Everything here runs the REAL SecurityPlugin, the REAL RLS compiler and the
// REAL `member_default` seed — the floor has to be the shipped one, because the
// separation under test is PROVENANCE (`platform-ownership-policies.ts`), not
// shape: an app policy spelling the identical predicate is app-authored and must
// keep counting.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata ───────────────────────────────────────────────────────────────

/**
 * An ORDINARY tenant business object: `sharingModel: 'private'` but NO
 * `access.default: 'private'`. That omission is load-bearing — it is what
 * withholds the ADR-0066 ① Layer-1 superuser short-circuit, so the platform
 * ownership floor is really in play for every principal here.
 */
const OPPORTUNITY_SCHEMA = {
  name: 'crm_opportunity',
  sharingModel: 'private',
  fields: {
    id: { name: 'id' },
    name: { name: 'name' },
    next_step: { name: 'next_step' },
    stage: { name: 'stage' },
    owner_id: { name: 'owner_id' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

/**
 * A PRIVATE-posture object — `access.default: 'private'` — which is exactly the
 * posture that ENABLES the ADR-0066 ① superuser short-circuit. Used for the one
 * case that pins "Layer 1 came back null" as an abstention rather than an
 * admission.
 */
const VAULT_SCHEMA = {
  name: 'sys_vault_entry',
  sharingModel: 'private',
  access: { default: 'private' },
  fields: {
    id: { name: 'id' },
    label: { name: 'label' },
    stage: { name: 'stage' },
    created_by: { name: 'created_by' },
    organization_id: { name: 'organization_id' },
  },
};

const SCHEMAS: Record<string, any> = {
  crm_opportunity: OPPORTUNITY_SCHEMA,
  sys_vault_entry: VAULT_SCHEMA,
};

/** The platform seed under test — the source of `owner_only_writes/deletes`. */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/** Ordinary CRUD, no authored RLS at all, no bypass of any kind. */
const CRM_REP: PermissionSet = PermissionSetSchema.parse({
  name: 'crm_rep',
  objects: {
    crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
});

/**
 * The same profile PLUS an app-authored RLS update-widener: "anyone may update
 * an opportunity still in `prospecting`". Declared for `update` ONLY — the verb
 * boundary case below reads that directly.
 */
const CRM_REP_WIDENED: PermissionSet = PermissionSetSchema.parse({
  name: 'crm_rep_widened',
  objects: {
    crm_opportunity: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
  },
  rowLevelSecurity: [
    {
      name: 'app_open_stage_updates',
      object: 'crm_opportunity',
      operation: 'update',
      using: "stage == 'prospecting'",
    },
  ],
});

/**
 * A Modify-All profile on the PRIVATE-posture object, carrying an authored
 * policy so the provenance pre-check passes and the case really reaches the
 * compiler — where the superuser short-circuit then withholds Layer 1.
 */
const VAULT_ADMIN: PermissionSet = PermissionSetSchema.parse({
  name: 'vault_admin',
  objects: {
    sys_vault_entry: {
      allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
      viewAllRecords: true, modifyAllRecords: true,
    },
  },
  rowLevelSecurity: [
    {
      name: 'app_vault_open_stage',
      object: 'sys_vault_entry',
      operation: 'update',
      using: "stage == 'prospecting'",
    },
  ],
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, CRM_REP, CRM_REP_WIDENED, VAULT_ADMIN];

// ── rows ───────────────────────────────────────────────────────────────────

const U_CREATOR = 'u_creator';
const U_OTHER = 'u_other';
const U_VAULT_ADMIN = 'u_vault_admin';

/**
 * ⭐ The E-A row. Created by `U_CREATOR`, since TRANSFERRED to `U_OTHER`, and in
 * a stage the authored widener does NOT name. So:
 *   • the platform floor matches it   (`created_by == U_CREATOR`)
 *   • the authored policy does not    (`stage != 'prospecting'`)
 * An implementation that reads the composed RLS answer says "admitted"; the
 * ruled semantics says `abstain`.
 */
const OPP_TRANSFERRED = {
  id: 'opp_transferred', name: 'Transferred', next_step: 'call', stage: 'closed_won',
  owner_id: U_OTHER, created_by: U_CREATOR, organization_id: 'org1',
};

/**
 * The positive control: nobody's creation, nobody's property, but in the stage
 * the authored policy names — so the ONLY thing that can admit it is the
 * app-authored declaration. `admit` here cannot come from the floor.
 */
const OPP_OPEN = {
  id: 'opp_open', name: 'Open', next_step: 'call', stage: 'prospecting',
  owner_id: U_OTHER, created_by: U_OTHER, organization_id: 'org1',
};

/** Same shape as OPP_OPEN but in ANOTHER tenant — the Layer 0 case. */
const OPP_OTHER_TENANT = {
  id: 'opp_other_tenant', name: 'Elsewhere', next_step: 'call', stage: 'prospecting',
  owner_id: U_OTHER, created_by: U_OTHER, organization_id: 'org2',
};

/** The private-posture row for the superuser short-circuit case. */
const VAULT_ROW = {
  id: 'vault_1', label: 'secret', stage: 'prospecting',
  created_by: U_OTHER, organization_id: 'org1',
};

// ── in-memory engine ───────────────────────────────────────────────────────

function makeEngine(opts: { findOneThrows?: boolean } = {}) {
  const tables: Record<string, any[]> = {
    crm_opportunity: [{ ...OPP_TRANSFERRED }, { ...OPP_OPEN }, { ...OPP_OTHER_TENANT }],
    sys_vault_entry: [{ ...VAULT_ROW }],
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or)) return filter.$or.some((f: any) => matches(row, f));
    if (Array.isArray(filter.$and)) return filter.$and.every((f: any) => matches(row, f));
    for (const [k, v] of Object.entries(filter)) {
      if (k === '$or' || k === '$and') continue;
      if (v != null && typeof v === 'object' && '$in' in (v as any)) {
        if (!(v as any).$in.includes(row[k])) return false;
        continue;
      }
      if (row[k] !== v) return false;
    }
    return true;
  };
  const middlewares: any[] = [];
  return {
    _tables: tables,
    _middlewares: middlewares,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => SCHEMAS[name],
    async find(object: string, options: any = {}) {
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      // The fail-closed case drives the probe itself into a throw — the method
      // must swallow it into `abstain` and never reject outward.
      if (opts.findOneThrows) throw new Error('engine exploded');
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
    // Both write verbs open with the PRODUCER's own dispatch predicate
    // (#4550 / #5480 / #6277), never a hand-mirrored guard.
    async update(object: string, data: any, options?: any) {
      const dispatch = assertEngineUpdateDispatch(data, options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      for (const r of targets) Object.assign(r, data);
      return dispatch.kind === 'by-id' ? (targets[0] ?? null) : targets.length;
    },
    async delete(object: string, options?: any) {
      const dispatch = assertEngineDeleteDispatch(options);
      const rows = (tables[object] ??= []);
      const targets = dispatch.kind === 'by-id'
        ? rows.filter((r) => r.id === dispatch.id)
        : rows.filter((r) => matches(r, options?.where));
      tables[object] = rows.filter((r) => !targets.includes(r));
      return dispatch.kind === 'by-id' ? targets.length > 0 : targets.length;
    },
  };
}

// ── the stack ──────────────────────────────────────────────────────────────

interface Stack {
  security: any;
  engine: ReturnType<typeof makeEngine>;
  /** Drive a by-id UPDATE through the REAL security middleware. */
  update: (object: string, recordId: string, context: any) => Promise<{ ok: boolean; message: string }>;
}

async function makeStack(engineOpts: { findOneThrows?: boolean } = {}): Promise<Stack> {
  const engine = makeEngine(engineOpts);
  const metadata = {
    get: async (_type: string, name: string) => SCHEMAS[name] ?? null,
    list: async () => PERMISSION_SETS,
  };
  let security: any;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    // Org scoping active, exactly as a multi-tenant deployment wires it — so
    // Layer 0 contributes a real tenant predicate this verdict must preserve.
    'org-scoping': { name: 'org-scoping' },
  };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: (name: string, impl: any) => { if (name === 'security') security = impl; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx);
  await plugin.start(ctx);
  if (!security) throw new Error('SecurityPlugin did not register the security service');

  const securityMw = engine._middlewares[0];
  return {
    security,
    engine,
    async update(object, recordId, context) {
      const opCtx: any = {
        object,
        operation: 'update',
        context: { ...context },
        data: { id: recordId, next_step: 'updated' },
      };
      let reached = false;
      try {
        await securityMw(opCtx, async () => {
          await engine.update(opCtx.object, opCtx.data, opCtx.options);
          reached = true;
        });
      } catch (e: any) {
        return { ok: false, message: String(e?.message ?? e) };
      }
      return reached
        ? { ok: true, message: 'written' }
        : { ok: false, message: 'middleware swallowed the write' };
    },
  };
}

/**
 * The execution-context shape `resolveAuthzContext` hands the middleware. The
 * `org_member` position is not decoration: it is the applicability domain of
 * `owner_only_writes` / `owner_only_deletes`, i.e. the platform floor these
 * cases have to see.
 */
const ctxFor = (userId: string, ...permissions: string[]) => ({
  userId, tenantId: 'org1', positions: ['org_member'], permissions,
});

/** The creator of the transferred row, holding an APP-AUTHORED widener. */
const CREATOR_WIDENED_CTX = ctxFor(U_CREATOR, 'crm_rep_widened');
/** The same creator, holding NO authored policy at all. */
const CREATOR_PLAIN_CTX = ctxFor(U_CREATOR, 'crm_rep');
/** A stranger holding the authored widener. */
const OUTSIDER_WIDENED_CTX = ctxFor('u_outsider', 'crm_rep_widened');
const VAULT_ADMIN_CTX = ctxFor(U_VAULT_ADMIN, 'vault_admin');

// ───────────────────────────────────────────────────────────────────────────

describe('[#5493] checkAuthoredRowWrite is registered on the security service', () => {
  it('is present as a function, so a consumer feature-detecting it finds it', async () => {
    const stack = await makeStack();
    expect(typeof stack.security.checkAuthoredRowWrite).toBe('function');
  });
});

describe('[#5493 probe E-A] the platform ownership floor is NOT an authored admission', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('TRANSFERRED_UPDATE_IS_ADMITTED_BY_THE_COMPOSED_PATH — the control that gives E-A its teeth', async () => {
    // The creator of a since-transferred row still passes the REAL by-id write
    // pre-image gate, because the platform floor (`created_by ==
    // current_user.id`) matches. This is the composed answer a naive deferral
    // would key on — measured here, not assumed, so the `abstain` pins below
    // are known to be refusing something that is genuinely on offer.
    const out = await stack.update('crm_opportunity', OPP_TRANSFERRED.id, CREATOR_WIDENED_CTX);
    expect(out.ok, out.message).toBe(true);
  });

  it('⭐ a creator-but-no-longer-owner whose authored policy does NOT match the row → abstain', async () => {
    // The E-A hole itself. The floor admits (proved above); the app policy
    // `stage == 'prospecting'` says nothing about a `closed_won` row. Only the
    // authored half may count, so the verdict is `abstain` — never `admit`.
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', OPP_TRANSFERRED.id, 'update', CREATOR_WIDENED_CTX,
      ),
    ).resolves.toBe('abstain');
  });

  it('⭐ a creator holding NO authored policy at all → abstain (nothing could admit by declaration)', async () => {
    // Same row, same creator, a profile that authors no RLS whatsoever. The
    // floor is the ONLY applicable policy, and a floor is not a declaration.
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', OPP_TRANSFERRED.id, 'update', CREATOR_PLAIN_CTX,
      ),
    ).resolves.toBe('abstain');
    // …and the composed path still admits that same principal on that same row,
    // so this case too is refusing something genuinely on offer.
    const out = await stack.update('crm_opportunity', OPP_TRANSFERRED.id, CREATOR_PLAIN_CTX);
    expect(out.ok, out.message).toBe(true);
  });
});

describe('[#5493] an app-authored policy that DOES match is the one thing that admits', () => {
  let stack: Stack;
  beforeEach(async () => { stack = await makeStack(); });

  it('admit — a stranger to the row, admitted purely by the declared widener', async () => {
    // Neither owner nor creator of OPP_OPEN, so the floor contributes nothing:
    // an `admit` here can only be the app-authored `stage == 'prospecting'`.
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', OPP_OPEN.id, 'update', OUTSIDER_WIDENED_CTX,
      ),
    ).resolves.toBe('admit');
  });

  it('abstain — the same policy, the same row, the OTHER verb (a widener widens rows, not verbs)', async () => {
    // `app_open_stage_updates` is declared `operation: 'update'`. Delete is not
    // in its applicability domain, so nothing authored applies at all.
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', OPP_OPEN.id, 'delete', OUTSIDER_WIDENED_CTX,
      ),
    ).resolves.toBe('abstain');
  });

  it('abstain — the matching row in ANOTHER tenant (Layer 0 stays AND-ed in)', async () => {
    // OPP_OTHER_TENANT satisfies `stage == 'prospecting'` exactly as OPP_OPEN
    // does. Only the tenant wall separates them, and this surface must not be
    // the one place in the plugin that answers across it.
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', OPP_OTHER_TENANT.id, 'update', OUTSIDER_WIDENED_CTX,
      ),
    ).resolves.toBe('abstain');
  });

  it('abstain — a superuser short-circuit is not an authored admission either', async () => {
    // ADR-0066 ①: on a PRIVATE posture a Modify-All holder skips business RLS
    // wholesale, so Layer 1 comes back null even though the caller authors a
    // policy that would match this row. Null Layer 1 means "no authored
    // predicate is gating this write" — reading it as `admit` would re-open
    // E-A from the other side, on the very objects that need it least.
    await expect(
      stack.security.checkAuthoredRowWrite(
        'sys_vault_entry', VAULT_ROW.id, 'update', VAULT_ADMIN_CTX,
      ),
    ).resolves.toBe('abstain');
  });
});

describe('[#5493] fail-closed: every failure is `abstain`, and nothing throws outward', () => {
  it('a probe that THROWS resolves to abstain rather than rejecting', async () => {
    // The method is consumed by a gate composing a refusal; a rejection there
    // would be an outage, and a rejection read as "no opinion" would be a
    // widening. It returns a value.
    const stack = await makeStack({ findOneThrows: true });
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', OPP_OPEN.id, 'update', OUTSIDER_WIDENED_CTX,
      ),
    ).resolves.toBe('abstain');
  });

  it('an unknown record id → abstain', async () => {
    const stack = await makeStack();
    await expect(
      stack.security.checkAuthoredRowWrite(
        'crm_opportunity', 'no_such_row', 'update', OUTSIDER_WIDENED_CTX,
      ),
    ).resolves.toBe('abstain');
  });

  it('a principal-less context → abstain', async () => {
    const stack = await makeStack();
    await expect(
      stack.security.checkAuthoredRowWrite('crm_opportunity', OPP_OPEN.id, 'update', {}),
    ).resolves.toBe('abstain');
  });

  it('an on-behalf-of context → abstain (ADR-0090 D10: no delegator intersection on this path)', async () => {
    // Same fail-closed stance `hasWriteBypass` and `resolveWriteScope` take on
    // a delegated context: an answer computed here would be resolved against
    // the wrong identity, so there is no answer.
    const stack = await makeStack();
    await expect(
      stack.security.checkAuthoredRowWrite('crm_opportunity', OPP_OPEN.id, 'update', {
        ...OUTSIDER_WIDENED_CTX,
        onBehalfOf: { userId: 'u_delegator' },
      }),
    ).resolves.toBe('abstain');
  });

  it('an unknown object → abstain', async () => {
    const stack = await makeStack();
    await expect(
      stack.security.checkAuthoredRowWrite('no_such_object', 'r1', 'update', OUTSIDER_WIDENED_CTX),
    ).resolves.toBe('abstain');
  });
});

// ───────────────────────────────────────────────────────────────────────────

/**
 * [#7281] The probe read runs ELEVATED — and the elevation is confined to it.
 *
 * An elevated read inside a permission check is exactly the shape that has to
 * be proven not to widen anything, so these cases measure the confinement
 * rather than asserting it. What a fake engine can legitimately pin here is the
 * CALL SHAPE — which context each engine call carries, what the query asks for,
 * and whether anything is written — and that is precisely what these cases pin.
 * What it cannot pin is the effect of the elevation on a `private`-OWD object,
 * because this file's engine has no middleware chain: that lives on the real
 * stack, in `packages/qa/dogfood/test/authored-row-write-scope.dogfood.test.ts`.
 */
describe('[#7281] the probe read is elevated, and the elevation is confined to the probe', () => {
  /** Wrap every engine verb so the probe's own traffic is observable. */
  const instrument = (engine: any) => {
    const calls: { op: string; object: string; options: any }[] = [];
    for (const op of ['find', 'findOne', 'insert', 'update', 'delete'] as const) {
      const original = engine[op].bind(engine);
      engine[op] = async (object: string, a?: any, b?: any) => {
        // `update` is (object, data, options); the rest carry options second.
        calls.push({ op, object, options: op === 'update' ? b : a });
        return original(object, a, b);
      };
    }
    return calls;
  };

  it('the probe reads under an elevated, PRINCIPAL-LESS context — and reads only', async () => {
    const stack = await makeStack();
    const calls = instrument(stack.engine);

    await expect(
      stack.security.checkAuthoredRowWrite('crm_opportunity', OPP_OPEN.id, 'update', OUTSIDER_WIDENED_CTX),
    ).resolves.toBe('admit');

    const onTarget = calls.filter((c) => c.object === 'crm_opportunity');
    expect(onTarget.length, 'the probe touched the target object').toBeGreaterThan(0);
    expect(
      onTarget.filter((c) => c.op === 'insert' || c.op === 'update' || c.op === 'delete'),
      'a permission PROBE writes nothing, ever',
    ).toEqual([]);
    for (const call of onTarget) {
      expect(call.options?.context?.isSystem, `${call.op} runs elevated`).toBe(true);
      expect(call.options?.context?.userId, `${call.op} carries no principal`).toBeUndefined();
      expect(
        call.options?.context,
        'the elevated context is the probe\'s own object, never the caller\'s',
      ).not.toBe(OUTSIDER_WIDENED_CTX);
    }
  });

  it('the elevated scope carries the WHOLE question in the query: id AND the tenant wall AND the authored predicate', async () => {
    // This is why elevating the read cannot widen the answer. Layer 0 (the
    // tenant wall) and Layer 1 (the app-authored policies) are compiled from
    // the CALLER's permission sets and the CALLER's tenant BEFORE the read and
    // travel in the `where`. Delete either from the composed `parts` and the
    // cross-tenant / non-matching-row cases above go red — which is exactly
    // what makes them pins rather than decoration.
    const stack = await makeStack();
    const calls = instrument(stack.engine);

    await stack.security.checkAuthoredRowWrite('crm_opportunity', OPP_OPEN.id, 'update', OUTSIDER_WIDENED_CTX);

    const read = calls.find((c) => c.object === 'crm_opportunity' && c.options?.where);
    const where = JSON.stringify(read?.options?.where ?? {});
    expect(where, 'the record id').toContain(OPP_OPEN.id);
    expect(where, 'Layer 0 — the tenant wall, from the caller\'s own tenant').toContain('organization_id');
    expect(where, 'Layer 1 — the app-authored predicate').toContain('prospecting');
    expect(
      read?.options?.fields,
      'projected to existence: the probe can learn THAT the row matches, never what is in it',
    ).toEqual(['id']);
  });

  // ⚠️ GUARD, NOT A MEASUREMENT — this case is green against the pre-#7281
  // producer too, and says so on purpose. It cannot bite on the scope change
  // itself (the old code passed the caller's context straight through and
  // mutated nothing either); what it bites on is the WRONG WAY to implement
  // the elevation — stamping `isSystem` onto the caller's own object, which
  // would silently elevate every later use of that context. Reverse-verified
  // by mutation, not by reverting the fix.
  it('the caller\'s own context object is not mutated by the probe', async () => {
    const stack = await makeStack();
    const before = JSON.parse(JSON.stringify(OUTSIDER_WIDENED_CTX));
    await stack.security.checkAuthoredRowWrite('crm_opportunity', OPP_OPEN.id, 'update', OUTSIDER_WIDENED_CTX);
    expect(JSON.parse(JSON.stringify(OUTSIDER_WIDENED_CTX))).toEqual(before);
    expect((OUTSIDER_WIDENED_CTX as any).isSystem, 'no elevation is stamped onto the caller').toBeUndefined();
  });

  // ⚠️ GUARD, NOT A MEASUREMENT — green on both sides of #7281, deliberately.
  // The write path never carried an elevated read before this change and must
  // never carry one after it; the case exists so that a future widening of the
  // probe's scope into the enforcement path goes red the day it is written,
  // rather than the day someone measures a production leak.
  it('the elevation does not reach the WRITE path: the by-id gate still resolves the row as the caller', async () => {
    // The ruling leaves the write decision with the pre-image gate, and that
    // gate reads as the CALLER. If the elevation ever leaked into it, a caller
    // who cannot see a row would start writing it — so this case exists to go
    // red the moment that happens.
    const stack = await makeStack();
    const calls = instrument(stack.engine);

    await stack.update('crm_opportunity', OPP_OPEN.id, OUTSIDER_WIDENED_CTX);

    const reads = calls.filter((c) => c.object === 'crm_opportunity' && c.op !== 'update');
    expect(reads.length, 'the write path read the target row').toBeGreaterThan(0);
    for (const call of reads) {
      expect(call.options?.context?.isSystem, 'no elevated read on the write path').toBeFalsy();
      expect(call.options?.context?.userId, 'the write path reads as the caller').toBe('u_outsider');
    }
  });
});
