// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16607] An RLS `check` clause that reads a membership-resolver key must
 * resolve on a BARE insert — the write path stages `rlsMembership` itself.
 *
 * MEASURED on 17.3.0 (the card's table, `--database-driver memory` and the
 * default sqlite driver alike): an app registers an `IRlsMembershipResolver`
 * (ADR-0105 D11) publishing `current_user.employer_org_ids` and authors
 * `using` + `check` twins reading it. Reads resolved the key — the employer
 * admin saw exactly its own rows — and EVERY bare insert was refused with the
 * check-gate envelope, with or without the value the policy wanted. Cause:
 * `stageRlsMembership` had exactly ONE call site, inside the read-filter
 * computation (`computeLayeredRlsFilter`), and `computeWriteCheckFilter`
 * compiled `check` against a context in which the key had never been staged:
 * unresolved variable → policy dropped → `RLS_DENY_FILTER` → refused.
 *
 * The two write shapes that DID pass did so by ACCIDENT of an earlier read on
 * the SAME context object: the by-id update's pre-image read (step 2.7) and
 * the controlled_by_parent master read both run the read-filter computation
 * first, which staged the key and flipped `context.__rlsMembershipStaged`.
 * "Sometimes passes" is evidence of the root cause, not of a per-object bug.
 *
 * ── HOW THIS FILE PINS IT ─────────────────────────────────────────────────
 *  • The repro: a bare insert on a FRESH context — the harness counts reads,
 *    so "no read preceded it" is measured, not assumed — whose value is in
 *    the resolved set must land. Red on the defect (check envelope), green
 *    on the fix.
 *  • The accidental paths are re-pinned WITHOUT the accident: the compiled
 *    check filter is asserted directly on a context nothing has read with,
 *    and equals what the `using` twin compiles to. That green cannot come
 *    from a pre-image or master read. The two middleware shapes are kept as
 *    regression pins beside it, each with the resolver consulted ONCE.
 *  • The fail-closed direction is pinned on every leg the fix could have
 *    relaxed: a value outside the set, no resolver registered, a resolver
 *    that throws — all refused with the CHECK envelope, and the row never
 *    lands. The fix OBTAINS the context the check should have had; it never
 *    degrades to permissive when membership is unavailable.
 *  • Every refusal is asserted on its ADR-0112 envelope (`code` + `status` +
 *    the catalog sentence + the developer line), never on a bare throw.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { SharingService, buildSharingMiddleware } from '@objectstack/plugin-sharing';
import { PermissionSetSchema } from '@objectstack/spec/security';
import type { PermissionSet } from '@objectstack/spec/security';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { RLS_MEMBERSHIP_RESOLVER_SERVICE } from '@objectstack/spec/contracts';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

// ── metadata: the card's shape, transcribed ────────────────────────────────

/** The bare object: no master, so a bare insert performs NO read. */
const JOB_SCHEMA = {
  name: 'qa_job',
  sharingModel: 'public_read_write',
  fields: {
    id: { name: 'id' },
    title: { name: 'title' },
    employer_org: { name: 'employer_org' },
    created_by: { name: 'created_by' },
  },
};

/** The master of the controlled_by_parent child below. */
const EMPLOYER_SCHEMA = {
  name: 'qa_employer',
  sharingModel: 'public_read_write',
  fields: {
    id: { name: 'id' },
    name: { name: 'name' },
    created_by: { name: 'created_by' },
  },
};

/** The card's row 4: a `controlled_by_parent` child whose insert READS its master first. */
const MEMBER_SCHEMA = {
  name: 'qa_employer_member',
  sharingModel: 'controlled_by_parent',
  fields: {
    id: { name: 'id' },
    employer: { name: 'employer', type: 'master_detail', required: true, reference: 'qa_employer' },
    role: { name: 'role' },
    created_by: { name: 'created_by' },
  },
};

const SCHEMAS: Record<string, any> = {
  qa_job: JOB_SCHEMA,
  qa_employer: EMPLOYER_SCHEMA,
  qa_employer_member: MEMBER_SCHEMA,
};

/** The real platform baseline, as the app runs under it. */
const MEMBER_DEFAULT = defaultPermissionSets.find((p) => p.name === 'member_default')!;

/**
 * The card's policy, verbatim in shape: `operation: 'all'`, `using` and
 * `check` twins, both reading the resolver-owned key. The same key guards the
 * master and the child so the accidental paths are exercised on the SAME
 * variable the bare insert fails on.
 */
const QA_EMPLOYER_ADMIN: PermissionSet = PermissionSetSchema.parse({
  name: 'qa_employer_admin',
  objects: {
    qa_job: { allowRead: true, allowCreate: true, allowEdit: true },
    qa_employer: { allowRead: true, allowEdit: true },
    qa_employer_member: { allowRead: true, allowCreate: true, allowEdit: true },
  },
  rowLevelSecurity: [
    {
      name: 'employer_admin_jobs',
      object: 'qa_job',
      operation: 'all',
      using: 'record.employer_org in current_user.employer_org_ids',
      check: 'record.employer_org in current_user.employer_org_ids',
    },
    {
      name: 'employer_admin_employers',
      object: 'qa_employer',
      operation: 'all',
      using: 'record.id in current_user.employer_org_ids',
    },
    {
      name: 'employer_admin_members',
      object: 'qa_employer_member',
      operation: 'all',
      using: 'record.employer in current_user.employer_org_ids',
      check: 'record.employer in current_user.employer_org_ids',
    },
  ],
});

const PERMISSION_SETS: PermissionSet[] = [MEMBER_DEFAULT, QA_EMPLOYER_ADMIN];

// ── rows ───────────────────────────────────────────────────────────────────

const ADMIN = { userId: 'usr_quillstone_admin', email: 'admin@quillstone.example' };
const OWN_ORG = 'org_quillstone';
const OTHER_ORG = 'org_other';

const EMPLOYER_OWN = { id: OWN_ORG, name: 'Quillstone', created_by: 'usr_seed' };
const EMPLOYER_OTHER = { id: OTHER_ORG, name: 'Other', created_by: 'usr_seed' };
const JOB_OWN = { id: 'job_own', title: 'Existing job', employer_org: OWN_ORG, created_by: ADMIN.userId };

/** A fresh caller context per test: nothing has read with it, nothing is memoized on it. */
const freshCtx = (): any => ({
  userId: ADMIN.userId,
  email: ADMIN.email,
  tenantId: 'org1',
  positions: ['employer_admin'],
  permissions: ['qa_employer_admin'],
});

// ── in-memory engine, counting its reads ───────────────────────────────────

function makeEngine() {
  const tables: Record<string, any[]> = {
    qa_job: [{ ...JOB_OWN }],
    qa_employer: [{ ...EMPLOYER_OWN }, { ...EMPLOYER_OTHER }],
    qa_employer_member: [],
    sys_record_share: [],
  };
  const matches = (row: any, filter: any): boolean => {
    if (!filter || typeof filter !== 'object') return true;
    if (Array.isArray(filter.$or) && !filter.$or.some((f: any) => matches(row, f))) return false;
    if (Array.isArray(filter.$and) && !filter.$and.every((f: any) => matches(row, f))) return false;
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
  /** Every store READ, by object — the harness's evidence that a path read or did not. */
  const reads: string[] = [];
  return {
    _tables: tables,
    _middlewares: middlewares,
    _reads: reads,
    registerMiddleware: (mw: any) => middlewares.push(mw),
    getSchema: (name: string) => SCHEMAS[name],
    async find(object: string, options: any = {}) {
      reads.push(object);
      const rows = (tables[object] ??= []);
      return rows.filter((r) => matches(r, options.filter ?? options.where)).slice(0, options.limit ?? 1000);
    },
    async findOne(object: string, options: any = {}) {
      assertEngineFindOnePredicate(object, options);
      const rows = await this.find(object, { ...options, limit: 1 });
      return rows[0] ?? null;
    },
    async insert(object: string, data: any) {
      (tables[object] ??= []).push({ ...data });
      return data;
    },
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

interface WriteOutcome {
  ok: boolean;
  /** ADR-0112 envelope of the refusal — asserted, never a bare `toThrow()`. */
  code?: string;
  status?: number;
  message: string;
  developerMessage?: string;
}

interface Resolver {
  keys: string[];
  resolve: ReturnType<typeof vi.fn>;
}

interface Stack {
  plugin: SecurityPlugin;
  security: any;
  engine: ReturnType<typeof makeEngine>;
  logger: { info: any; warn: any; error: any; debug: any };
  write: (
    operation: 'insert' | 'update',
    object: string,
    payload: { recordId?: string; data?: Record<string, unknown> },
    context: any,
  ) => Promise<WriteOutcome>;
  rows: (object: string) => any[];
}

/** The card's resolver: publishes the caller's employer organizations. */
function makeResolver(sets: Record<string, string[]> = { employer_org_ids: [OWN_ORG] }): Resolver {
  return { keys: Object.keys(sets), resolve: vi.fn(async () => sets) };
}

async function makeStack(resolver: Resolver | null): Promise<Stack> {
  const engine = makeEngine();
  const metadata = {
    get: async (_type: string, name: string) => SCHEMAS[name] ?? null,
    list: async () => PERMISSION_SETS,
  };
  let security: any;
  let sharing: SharingService;
  const services: Record<string, any> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    metadata,
    get sharing() { return sharing; },
  };
  if (resolver) services[RLS_MEMBERSHIP_RESOLVER_SERVICE] = resolver;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: any = {
    logger,
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

  sharing = new SharingService({ engine: engine as any, securityService: () => security });
  const sharingMw = buildSharingMiddleware(sharing, ctx.logger);
  const securityMw = engine._middlewares[0];

  const run = async (opCtx: any): Promise<WriteOutcome> => {
    let reached = false;
    try {
      await securityMw(opCtx, async () => {
        await sharingMw(opCtx, async () => {
          // [#16608] The engine's own half of the write gate, which this
          // executor stands in for: the insert-side RLS `check` is INSTALLED on
          // the operation context by the middleware and run by `ObjectQL.insert`
          // once the `beforeInsert` chain has produced the row that will be
          // stored. A double that skips it models an engine carrying a write
          // past a gate that never ran, and the middleware refuses exactly that
          // (fail closed) rather than vouching for it. Flag first — it answers
          // "did the seam run", never "did the write pass". This harness runs
          // no hooks, so the row that would be stored IS `opCtx.data`.
          const seam = opCtx.postHookWriteImageCheck;
          if (seam) {
            seam.honoured = true;
            await seam.evaluate([opCtx.data]);
          }
          if (opCtx.operation === 'insert') await engine.insert(opCtx.object, opCtx.data);
          else await engine.update(opCtx.object, opCtx.data, opCtx.options);
          reached = true;
        });
      });
    } catch (e: any) {
      return {
        ok: false,
        code: e?.code,
        status: e?.statusCode,
        message: String(e?.message ?? e),
        developerMessage: e?.developerMessage,
      };
    }
    return reached
      ? { ok: true, message: 'written' }
      : { ok: false, message: 'middleware swallowed the write' };
  };

  return {
    plugin,
    security,
    engine,
    logger,
    rows: (object: string) => (engine._tables[object] ??= []),
    async write(operation, object, payload, context) {
      // The by-id dispatch shape — no `ast` — exactly what a REST POST / PATCH
      // by id arrives as.
      const opCtx: any = { object, operation, context };
      if (operation === 'insert') opCtx.data = { ...payload.data };
      else opCtx.data = { id: payload.recordId, ...payload.data };
      return run(opCtx);
    },
  };
}

/** The 3.6 post-image gate — the CHECK envelope, distinct from the row gate's. */
function expectCheckDenial(outcome: WriteOutcome, operation: 'insert' | 'update', object: string) {
  expect(outcome.ok, `expected a refusal, got a completed ${operation}`).toBe(false);
  expect(outcome.code, 'ADR-0112 error code').toBe('PERMISSION_DENIED');
  expect(outcome.status, 'ADR-0112 HTTP status').toBe(403);
  expect(outcome.message, 'the user half is the localized catalog sentence')
    .toBe(BUILTIN_OPERATION_MESSAGES.en.record_change_not_allowed);
  expect(outcome.developerMessage, 'the CHECK gate must be what refused').toContain(
    `[Security] Access denied: the ${operation} would violate a row-level CHECK on '${object}'`,
  );
}

/** The compiled shape both twins resolve to once the key is staged. */
const JOB_FILTER = { employer_org: { $in: [OWN_ORG] } };

/**
 * Store reads of objects the caller's policies GOVERN. The plugin's own grant
 * resolution reads `sys_permission_set` / `sys_user_permission_set` /
 * `sys_user` / `sys_position` under its system context; those never compute
 * the caller's read filter and so can never stage the caller's context — they
 * are excluded so the assertion measures the accident under test (a
 * pre-image or master read under the CALLER's context) and nothing else.
 */
const governedReads = (stack: Stack): string[] => stack.engine._reads.filter((o) => !o.startsWith('sys_'));

// ── the control: the read side, which always worked ────────────────────────

describe('[#16607] control — the `using` twin resolves the resolver key on the read path', () => {
  it('getReadFilter compiles `record.employer_org in current_user.employer_org_ids` to the resolved set', async () => {
    const resolver = makeResolver();
    const stack = await makeStack(resolver);
    const filter = await stack.security.getReadFilter('qa_job', freshCtx());
    expect(filter).toEqual(JOB_FILTER);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });
});

// ── the repro ──────────────────────────────────────────────────────────────

describe('[#16607] the repro — a BARE insert, on a context nothing has read with', () => {
  let resolver: Resolver;
  let stack: Stack;
  beforeEach(async () => {
    resolver = makeResolver();
    stack = await makeStack(resolver);
  });

  it('lands when the payload value is in the resolved set (the card\'s row 2: was 403 PERMISSION_DENIED)', async () => {
    const context = freshCtx();
    const out = await stack.write(
      'insert',
      'qa_job',
      { data: { id: 'job_new', title: 'Senior Engineer', employer_org: OWN_ORG } },
      context,
    );
    expect(out, 'the check must resolve the same variable its `using` twin resolves').toEqual({ ok: true, message: 'written' });
    expect(stack.rows('qa_job').find((r) => r.id === 'job_new')).toMatchObject({ employer_org: OWN_ORG });
  });

  it('is decided WITHOUT any read having staged the key: the write path consulted the resolver itself', async () => {
    const context = freshCtx();
    await stack.write('insert', 'qa_job', { data: { id: 'job_new', title: 'x', employer_org: OWN_ORG } }, context);
    // No governed object was read before the verdict — an insert on an object
    // with no master has no pre-image and no master to read. The accident that
    // made the update / controlled_by_parent shapes pass is therefore absent
    // here by measurement, not by assumption.
    expect(governedReads(stack), 'a bare insert reads no governed object').toEqual([]);
    expect(resolver.resolve, 'the write path staged the key itself').toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith(
      expect.objectContaining({ userId: ADMIN.userId, tenantId: 'org1', positions: ['employer_admin'] }),
    );
    expect(context.__rlsMembershipStaged).toBe(true);
    expect(context.rlsMembership).toEqual({ employer_org_ids: [OWN_ORG] });
  });
});

// ── the fail-closed direction, on every leg the fix could have relaxed ─────

describe('[#16607] fail-closed stays fail-closed — the fix OBTAINS the context, it never degrades to permissive', () => {
  it('a value OUTSIDE the resolved set is refused by the CHECK gate, and the row does not land', async () => {
    const resolver = makeResolver();
    const stack = await makeStack(resolver);
    const out = await stack.write(
      'insert',
      'qa_job',
      { data: { id: 'job_forged', title: 'forged', employer_org: OTHER_ORG } },
      freshCtx(),
    );
    expectCheckDenial(out, 'insert', 'qa_job');
    expect(stack.rows('qa_job').find((r) => r.id === 'job_forged')).toBeUndefined();
    // The refusal is the POLICY's verdict on a resolved key, not an unresolved one.
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('with NO resolver registered the key never resolves — refused by the CHECK gate (the pre-D11 state)', async () => {
    const stack = await makeStack(null);
    const out = await stack.write(
      'insert',
      'qa_job',
      { data: { id: 'job_new', title: 'x', employer_org: OWN_ORG } },
      freshCtx(),
    );
    expectCheckDenial(out, 'insert', 'qa_job');
    expect(stack.rows('qa_job').find((r) => r.id === 'job_new')).toBeUndefined();
  });

  it('a resolver that THROWS leaves the key unresolved — refused by the CHECK gate, and the throw is logged', async () => {
    const resolver: Resolver = {
      keys: ['employer_org_ids'],
      resolve: vi.fn(async () => {
        throw new Error('membership service down');
      }),
    };
    const stack = await makeStack(resolver);
    const out = await stack.write(
      'insert',
      'qa_job',
      { data: { id: 'job_new', title: 'x', employer_org: OWN_ORG } },
      freshCtx(),
    );
    expectCheckDenial(out, 'insert', 'qa_job');
    expect(stack.rows('qa_job').find((r) => r.id === 'job_new')).toBeUndefined();
    expect(stack.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('rls-membership-resolver threw'),
      expect.anything(),
    );
  });

  it('a resolver that omits the key resolves nothing for it — refused by the CHECK gate', async () => {
    const resolver = makeResolver({ some_other_key: ['x'] });
    const stack = await makeStack(resolver);
    const out = await stack.write(
      'insert',
      'qa_job',
      { data: { id: 'job_new', title: 'x', employer_org: OWN_ORG } },
      freshCtx(),
    );
    expectCheckDenial(out, 'insert', 'qa_job');
    expect(stack.rows('qa_job').find((r) => r.id === 'job_new')).toBeUndefined();
  });
});

// ── the accidental paths, re-pinned WITHOUT the accident ───────────────────

describe('[#16607] the two shapes that passed by ACCIDENT pass by design', () => {
  let resolver: Resolver;
  let stack: Stack;
  beforeEach(async () => {
    resolver = makeResolver();
    stack = await makeStack(resolver);
  });

  it('the check filter compiles on a context that NOTHING has read with, and equals the `using` twin', async () => {
    // The card's acceptance boundary: test `check` directly on a context with
    // no preceding read, so this green cannot be the pre-image or master read
    // having staged the key first.
    const sets = await (stack.plugin as any).resolvePermissionSetsForContext(freshCtx());
    const checkCtx = freshCtx();
    const checkFilter = await (stack.plugin as any).computeWriteCheckFilter(sets, 'qa_job', 'insert', checkCtx);
    expect(governedReads(stack), 'no governed-object read staged this context').toEqual([]);
    expect(checkFilter).not.toEqual(RLS_DENY_FILTER);
    expect(checkFilter).toEqual(JOB_FILTER);
    expect(checkCtx.__rlsMembershipStaged).toBe(true);
    // …and the `using` twin, on ITS own fresh context, compiles to the same thing.
    const usingFilter = await stack.security.getReadFilter('qa_job', freshCtx());
    expect(checkFilter).toEqual(usingFilter);
  });

  it('the delegator leg is the same method on a distinct context: staged for THAT principal, once', async () => {
    // Step 3.6 computes the delegator's check with `computeWriteCheckFilter(
    // delegatorSets, …, delegatorContext)` — a second context object that no
    // read has staged either. Same method, so the same staging applies.
    const delegatorCtx = { ...freshCtx(), userId: 'usr_delegator', email: 'delegator@quillstone.example' };
    const sets = await (stack.plugin as any).resolvePermissionSetsForContext(delegatorCtx);
    const checkFilter = await (stack.plugin as any).computeWriteCheckFilter(sets, 'qa_job', 'insert', delegatorCtx);
    expect(checkFilter).toEqual(JOB_FILTER);
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({ userId: 'usr_delegator' }));
  });

  it('a by-id UPDATE of an own job still lands (the card\'s row 3), with the resolver consulted ONCE', async () => {
    const context = freshCtx();
    const out = await stack.write(
      'update',
      'qa_job',
      { recordId: JOB_OWN.id, data: { title: 'Renamed' } },
      context,
    );
    expect(out).toEqual({ ok: true, message: 'written' });
    expect(stack.rows('qa_job').find((r) => r.id === JOB_OWN.id)).toMatchObject({ title: 'Renamed', employer_org: OWN_ORG });
    // The pre-image read staged the key AND the check reused it — memoized per
    // context, so adding the write-side staging did not double-resolve.
    expect(governedReads(stack)).toContain('qa_job');
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('a by-id UPDATE that re-points the job to a foreign employer is refused by the CHECK gate', async () => {
    const out = await stack.write(
      'update',
      'qa_job',
      { recordId: JOB_OWN.id, data: { employer_org: OTHER_ORG } },
      freshCtx(),
    );
    expectCheckDenial(out, 'update', 'qa_job');
    expect(stack.rows('qa_job').find((r) => r.id === JOB_OWN.id)).toMatchObject({ employer_org: OWN_ORG });
  });

  it('a controlled_by_parent INSERT under an own employer still lands (the card\'s row 4), resolver consulted ONCE', async () => {
    const context = freshCtx();
    const out = await stack.write(
      'insert',
      'qa_employer_member',
      { data: { id: 'mem_new', employer: OWN_ORG, role: 'recruiter' } },
      context,
    );
    expect(out).toEqual({ ok: true, message: 'written' });
    expect(stack.rows('qa_employer_member').find((r) => r.id === 'mem_new')).toMatchObject({ employer: OWN_ORG });
    // The master read staged the key; the child's check reused it.
    expect(governedReads(stack)).toContain('qa_employer');
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it('a controlled_by_parent INSERT under a foreign employer is refused, and the row does not land', async () => {
    const out = await stack.write(
      'insert',
      'qa_employer_member',
      { data: { id: 'mem_forged', employer: OTHER_ORG, role: 'recruiter' } },
      freshCtx(),
    );
    expect(out.ok).toBe(false);
    expect(out.code).toBe('PERMISSION_DENIED');
    expect(out.status).toBe(403);
    expect(stack.rows('qa_employer_member').find((r) => r.id === 'mem_forged')).toBeUndefined();
  });
});
