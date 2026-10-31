// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A `runAs:'user'` run carries the posture rung its user's own request
 * carries, derived once, by the resolver the request path derives it with:
 * `resolveUserAuthzGrants` in `@objectstack/core`, which `resolveAuthzContext`
 * copies onto a request's `ExecutionContext.posture`. The run takes the rung
 * off that same resolution, through the grants bridge the automation plugin
 * wires; nothing here derives one.
 *
 * The defect this pins: run setup seeded positions, permission sets, peers and
 * email, and no rung. A reader keyed on the rung then answered the run as for
 * a principal below it. The ledger's deployment-level rows (`tenant_id` NULL,
 * served to `PLATFORM_ADMIN` alone since #26750) are the measured case: a flow
 * run as the platform administrator was served none of them, while the same
 * administrator's own request is served them. Fail closed, never a leak.
 *
 * Two layers, each pinning what the other cannot see:
 *
 *  1. THE ENVELOPE (a bare engine, a recording node, a grants-resolver stub):
 *     the data context a node hands the data engine carries the rung the
 *     resolver answered, beside the grants it answered; a context that brought
 *     its own grants (a door's resolved envelope, an agent's narrowed ceiling)
 *     gains no rung from a re-resolution; a `runAs:'system'` run carries none;
 *     and after an approval decision the rung is the decider's, never the
 *     submitter's.
 *  2. THE REAL STACK (ObjectKernel, ObjectQLPlugin, driver-sql on
 *     better-sqlite3 `:memory:`, the identity objects, the real SecurityPlugin,
 *     AuditPlugin's ledger read gate, the grants resolver the automation
 *     plugin bridges): a record-change-shaped run as the platform
 *     administrator reads the deployment-level ledger rows its user's request
 *     reads, and a member's run is served what the member's request is
 *     served, with or without the rung.
 *
 * [#28099] The door half: a run started through the REST or action door
 * carries the caller's resolved grants, so run setup does not re-resolve them,
 * and its rung is the one the door forwarded (`AutomationContext.posture`).
 * Both layers pin it: the forwarded rung is carried as forwarded, never
 * re-derived or raised; no forwarded rung is no rung; a rung forwarded without
 * grants gives way to the rung of the grants run setup resolves. The doors'
 * producer half is `flow-run-posture.test.ts` in `@objectstack/runtime`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel, resolveUserAuthzGrants, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, securityDefaultPermissionSets } from '@objectstack/plugin-security';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { RESUME_AUTHORITY_SERVICE, type ResumeSignal } from '@objectstack/spec/contracts';
import { AutomationEngine } from './engine.js';
import { AutomationServicePlugin } from './plugin.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { resolveRunDataContext } from './runtime-identity.js';

const silentLogger = (): any => {
  const l: any = { info() {}, warn() {}, error() {}, debug() {} };
  l.child = () => l;
  return l;
};

/** The approval node's stand-in: a pause only its owning service may continue. */
const GATED = defineActionDescriptor({
  type: 'decision_gate', version: '1.0.0', name: 'Decision Gate',
  supportsPause: true, resumeAuthority: 'service',
});

/** What `ApprovalService.decide` hands the engine for a human decision. */
const decided = (resumedBy: string): ResumeSignal => ({
  branchLabel: 'approve',
  output: { decision: 'approve' },
  resumedBy,
  [RESUME_AUTHORITY_SERVICE]: true,
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. The envelope
// ─────────────────────────────────────────────────────────────────────────────

/** Each user's grants as the resolver answers them, the rung among them. */
const GRANTS: Record<string, { positions: string[]; permissions: string[]; org_user_ids: string[]; posture: 'PLATFORM_ADMIN' | 'MEMBER' }> = {
  usr_admin: { positions: ['platform_admin', 'everyone'], permissions: ['admin_full_access'], org_user_ids: ['usr_admin', 'usr_member'], posture: 'PLATFORM_ADMIN' },
  usr_member: { positions: ['org_member', 'everyone'], permissions: ['member_default'], org_user_ids: ['usr_member', 'usr_admin'], posture: 'MEMBER' },
};

/** start → first (record) → gate → second (record) → end. */
function recordingFlow(name: string, runAs?: 'user' | 'system') {
  return {
    name, label: name, type: 'autolaunched',
    ...(runAs ? { runAs } : {}),
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'first', type: 'record_identity', label: 'first' },
      { id: 'gate', type: 'decision_gate', label: 'Review' },
      { id: 'second', type: 'record_identity', label: 'second' },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'first' },
      { id: 'e2', source: 'first', target: 'gate' },
      { id: 'e3', source: 'gate', target: 'second', label: 'approve' },
      { id: 'e4', source: 'second', target: 'end' },
    ],
  };
}

function envelopeHarness() {
  const seen = new Map<string, any>();
  const engine = new AutomationEngine(silentLogger(), new InMemorySuspendedRunStore());
  engine.registerNodeExecutor({ type: 'decision_gate', descriptor: GATED, async execute() { return { success: true, suspend: true }; } });
  // What a CRUD node hands ObjectQL as `options.context`, recorded per node.
  engine.registerNodeExecutor({
    type: 'record_identity',
    async execute(node, _variables, context) {
      seen.set(node.id, resolveRunDataContext(context));
      return { success: true };
    },
  });
  engine.setUserGrantsResolver(async (userId, tenantId) => {
    const g = GRANTS[userId];
    return g ? { ...g, tenantId } : undefined;
  });
  return { engine, ctxOf: (nodeId: string) => seen.get(nodeId) };
}

describe("[#28070] a runAs:'user' run's data context carries the rung its resolver derived, with the grants it derived it from", () => {
  it("a user-only trigger (the record-change shape): the platform administrator's run carries PLATFORM_ADMIN", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    await h.engine.execute('rung', { userId: 'usr_admin', tenantId: 'org_a' } as never);
    expect(h.ctxOf('first')).toMatchObject({
      isSystem: false, userId: 'usr_admin', permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN',
    });
  });

  it("a member's run carries the member's own rung, nothing wider", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    await h.engine.execute('rung', { userId: 'usr_member', tenantId: 'org_a' } as never);
    expect(h.ctxOf('first')).toMatchObject({ userId: 'usr_member', permissions: ['member_default'], posture: 'MEMBER' });
  });

  it('a context that brought its own grants gains no rung: carried grants are never paired with a rung they were not derived from', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    // An agent's narrowed ceiling acting for the administrator, or a door's
    // pre-resolved envelope: positions and permission sets, no rung.
    await h.engine.execute('rung', { userId: 'usr_admin', tenantId: 'org_a', positions: ['everyone'], permissions: ['agent_ceiling'] } as never);
    const ctx = h.ctxOf('first');
    expect(ctx).toMatchObject({ userId: 'usr_admin', permissions: ['agent_ceiling'] });
    expect(ctx).not.toHaveProperty('posture');
    // Its peers still come from the re-resolution, as before.
    expect(ctx.org_user_ids).toEqual(GRANTS.usr_admin.org_user_ids);
  });

  it('a value that names no rung is not carried', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    await h.engine.execute('rung', { userId: 'usr_admin', tenantId: 'org_a', positions: [], permissions: [], posture: 'ROOT' } as never);
    expect(h.ctxOf('first')).not.toHaveProperty('posture');
  });

  it("a runAs:'system' run is unchanged: elevated, and no rung is resolved or carried", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung_sys', recordingFlow('rung_sys', 'system') as never);
    await h.engine.execute('rung_sys', { userId: 'usr_admin', tenantId: 'org_a' } as never);
    expect(h.ctxOf('first')).toEqual({ isSystem: true, actor: 'svc:flow:rung_sys', userId: 'usr_admin', tenantId: 'org_a', flowRunId: expect.any(String) });
  });

  it("after an approval decision the rung is the decider's: a platform administrator's submission does not lend a member decider its rung", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    const paused = await h.engine.execute('rung', { userId: 'usr_admin', tenantId: 'org_a' } as never);
    expect(paused.status).toBe('paused');
    expect(h.ctxOf('first')).toMatchObject({ userId: 'usr_admin', posture: 'PLATFORM_ADMIN' });

    const res = await h.engine.resume(paused.runId!, decided('usr_member'));
    expect(res.success, JSON.stringify(res)).toBe(true);
    expect(h.ctxOf('second')).toMatchObject({ userId: 'usr_member', permissions: ['member_default'], posture: 'MEMBER' });
  });

  it("a decider the resolver answers nothing for carries no rung, never the submitter's", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    const paused = await h.engine.execute('rung', { userId: 'usr_admin', tenantId: 'org_a' } as never);
    const res = await h.engine.resume(paused.runId!, decided('usr_unresolved'));
    expect(res.success, JSON.stringify(res)).toBe(true);
    const ctx = h.ctxOf('second');
    expect(ctx).toMatchObject({ userId: 'usr_unresolved', permissions: [] });
    expect(ctx).not.toHaveProperty('posture');
  });
});

describe("[#28099] a door-started run carries the rung its door forwarded, beside the grants it forwarded", () => {
  /**
   * What the REST trigger door (`buildAutomationContext`) and the action door
   * (`dispatchFlowAction`) in `@objectstack/runtime` hand `execute`: the
   * request's own resolved grants, and since #28099 its rung.
   */
  const doorEnvelope = (userId: string, posture?: string) => ({
    userId, tenantId: 'org_a', event: 'manual', params: {},
    positions: GRANTS[userId].positions, permissions: GRANTS[userId].permissions,
    ...(posture !== undefined ? { posture } : {}),
  });

  it("the platform administrator's door-started run carries the forwarded PLATFORM_ADMIN with the forwarded grants", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    await h.engine.execute('rung', doorEnvelope('usr_admin', 'PLATFORM_ADMIN') as never);
    expect(h.ctxOf('first')).toMatchObject({
      isSystem: false, userId: 'usr_admin', permissions: ['admin_full_access'], posture: 'PLATFORM_ADMIN',
    });
  });

  it("the forwarded rung is the run's: run setup does not re-derive it, so it is never raised to the one the resolver would answer", async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    await h.engine.execute('rung', doorEnvelope('usr_admin', 'MEMBER') as never);
    expect(h.ctxOf('first')).toMatchObject({ userId: 'usr_admin', permissions: ['admin_full_access'], posture: 'MEMBER' });
  });

  it('a door that forwarded no rung gives a run without one: absent, never a default', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    await h.engine.execute('rung', doorEnvelope('usr_admin') as never);
    const ctx = h.ctxOf('first');
    expect(ctx).toMatchObject({ userId: 'usr_admin', permissions: ['admin_full_access'] });
    expect(ctx).not.toHaveProperty('posture');
  });

  it('a forwarded rung without forwarded grants is replaced by the rung of the grants run setup resolves', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    // A door forwards positions and permission sets only when non-empty: the
    // rung can arrive alone, and the grants are then re-resolved.
    await h.engine.execute('rung', { userId: 'usr_member', tenantId: 'org_a', posture: 'PLATFORM_ADMIN' } as never);
    expect(h.ctxOf('first')).toMatchObject({ userId: 'usr_member', permissions: ['member_default'], posture: 'MEMBER' });
  });

  it('a forwarded rung without forwarded grants is dropped when the resolution answers none', async () => {
    const h = envelopeHarness();
    h.engine.registerFlow('rung', recordingFlow('rung') as never);
    h.engine.setUserGrantsResolver(async () => ({ positions: ['everyone'], permissions: ['member_default'] }));
    await h.engine.execute('rung', { userId: 'usr_member', tenantId: 'org_a', posture: 'PLATFORM_ADMIN' } as never);
    const ctx = h.ctxOf('first');
    expect(ctx).toMatchObject({ userId: 'usr_member', permissions: ['member_default'] });
    expect(ctx).not.toHaveProperty('posture');
  });

  it('a forwarded rung without forwarded grants is dropped when the resolution fails: the resolver rejects, answers nothing, or is not wired', async () => {
    const alone = { userId: 'usr_member', tenantId: 'org_a', posture: 'PLATFORM_ADMIN' };
    for (const resolver of [
      async () => { throw new Error('grants store unavailable'); },
      async () => undefined,
      null,
    ]) {
      const h = envelopeHarness();
      h.engine.registerFlow('rung', recordingFlow('rung') as never);
      h.engine.setUserGrantsResolver(resolver as never);
      await h.engine.execute('rung', { ...alone } as never);
      const ctx = h.ctxOf('first');
      expect(ctx).toMatchObject({ isSystem: false, userId: 'usr_member' });
      expect(ctx).not.toHaveProperty('posture');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. The real stack
// ─────────────────────────────────────────────────────────────────────────────

const SYS = { isSystem: true } as const;
const LEDGER = 'sys_audit_log';
const ADMIN = 'usr_platform_admin';
const MEMBER = 'usr_ledger_member';
/** The deployment-level row the flow asks for, as its writer writes it: as the system, about no organization. */
const STANDING_CHANGE = 'platform_admin_standing_change';

/** A ledger reader below the platform rung: an organization holder of the ledger audit capability. */
const ledgerReaderSet = PermissionSetSchema.parse({
  name: 'qa_ledger_reader',
  label: 'Ledger reader',
  objects: { [LEDGER]: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } },
  systemPermissions: ['view_all_audit_log'],
});

/** start → read the ledger's standing-change rows → end. */
const ledgerFlow = (name: string, runAs: 'user' | 'system' = 'user') => ({
  name, label: name, type: 'autolaunched', runAs,
  variables: [{ name: 'rows', type: 'object', isOutput: true }],
  nodes: [
    { id: 'start', type: 'start', label: 'Start' },
    { id: 'read', type: 'get_record', label: 'Read', config: { objectName: LEDGER, filter: { action: STANDING_CHANGE }, limit: 50, outputVariable: 'rows' } },
    { id: 'end', type: 'end', label: 'End' },
  ],
  edges: [
    { id: 'e1', source: 'start', target: 'read' },
    { id: 'e2', source: 'read', target: 'end' },
  ],
});

describe("[#28070] a runAs:'user' flow is served the ledger rows its user's request is served", () => {
  let kernel: ObjectKernel;
  let ql: ObjectQL;
  let automation: AutomationEngine;
  let orgA = '';
  /** The deployment-level rows the flow asks for. */
  let standingIds: string[] = [];
  /** The one row of the same action about the organization: served to every reader of the ledger. */
  let orgIds: string[] = [];

  beforeAll(async () => {
    kernel = new ObjectKernel({ logger: { level: 'fatal' } });
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await kernel.use({
      name: 'test.driver.sqlite', type: 'standard', version: '1.0.0',
      async init(ctx: PluginContext) { ctx.registerService('driver.default', driver); },
    });
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AutomationServicePlugin({ suspendedRunStore: 'memory' }));
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SecurityPlugin({ defaultPermissionSets: [...securityDefaultPermissionSets, ledgerReaderSet] }));
    await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    ql = kernel.getService<ObjectQL>('objectql');
    automation = kernel.getService<AutomationEngine>('automation');

    const orgs = await ql.find('sys_organization', { context: SYS });
    expect(orgs.map((o: any) => o.slug)).toEqual(['default']);
    orgA = String(orgs[0].id);
    for (const [id, role, set] of [[ADMIN, 'admin', 'admin_full_access'], [MEMBER, 'member', ledgerReaderSet.name]] as const) {
      await ql.insert('sys_user', { id, name: id, email: `${id}@example.test` }, { context: SYS });
      await ql.insert('sys_member', { id: `mem_${id}`, user_id: id, organization_id: orgA, role }, { context: SYS });
      await ql.insert('sys_user_permission_set', { id: `ups_${id}`, user_id: id, permission_set: set, organization_id: orgA }, { context: SYS });
    }
    for (let i = 0; i < 2; i += 1) {
      await ql.insert(LEDGER, { action: STANDING_CHANGE, object_name: 'sys_user', record_id: null, user_id: null, actor: 'svc:fixture', tenant_id: null }, { context: SYS });
    }
    await ql.insert(LEDGER, { action: STANDING_CHANGE, object_name: 'sys_user', record_id: null, user_id: null, actor: 'svc:fixture', tenant_id: orgA }, { context: SYS });
    // The fixture's rows, and any the security plugin's standing roster wrote for the grant above.
    const standing = (await ql.find(LEDGER, { where: { action: STANDING_CHANGE }, context: SYS })) as any[];
    standingIds = standing.filter((r) => r.tenant_id == null).map((r) => String(r.id)).sort();
    orgIds = standing.filter((r) => r.tenant_id === orgA).map((r) => String(r.id));

    automation.registerFlow('qa_ledger_read', ledgerFlow('qa_ledger_read') as never);
    automation.registerFlow('qa_ledger_read_system', ledgerFlow('qa_ledger_read_system', 'system') as never);
  }, 60_000);

  afterAll(async () => {
    try { await kernel?.shutdown(); } catch { /* noop */ }
  });

  /** The context the request path hands ObjectQL for `userId` in the organization: `resolveAuthzContext`'s copy of these grants. */
  async function requestContext(userId: string, opts: { posture?: boolean } = {}) {
    const g = await resolveUserAuthzGrants(ql, userId, { tenantId: orgA, bypassGrantsCache: true });
    return {
      userId,
      tenantId: orgA,
      isSystem: false,
      positions: g.positions,
      permissions: g.permissions,
      systemPermissions: g.systemPermissions,
      org_user_ids: g.org_user_ids,
      accessible_org_ids: g.accessible_org_ids,
      ...(opts.posture === false || !g.posture ? {} : { posture: g.posture }),
    };
  }

  const ids = (rows: unknown) => (Array.isArray(rows) ? rows : []).map((r: any) => String(r.id)).sort();
  const requestReads = async (ctx: Record<string, unknown>) => ids(await ql.find(LEDGER, { where: { action: STANDING_CHANGE }, context: ctx as any }));

  /** What the record-change trigger hands `automation.execute`: a user and an organization, no grants. */
  const userOnlyEnvelope = (userId: string) => ({ userId, tenantId: orgA, params: {} });

  it('CONTROL: the fixture holds the deployment-level rows, and the administrator resolves PLATFORM_ADMIN, the member below it', async () => {
    expect(standingIds.length).toBeGreaterThanOrEqual(2);
    expect(orgIds).toHaveLength(1);
    expect((await requestContext(ADMIN)).posture).toBe('PLATFORM_ADMIN');
    expect((await requestContext(MEMBER)).posture).not.toBe('PLATFORM_ADMIN');
  });

  it("CONTROL: the administrator's request is served the rows, and the same request without the rung (a run's shape before the fix) is served none", async () => {
    expect(await requestReads(await requestContext(ADMIN))).toEqual([...standingIds, ...orgIds].sort());
    expect(await requestReads(await requestContext(ADMIN, { posture: false }))).toEqual(orgIds);
  });

  it("the card's reproduction: the platform administrator's runAs:'user' run is served every deployment-level row", async () => {
    const res: any = await automation.execute('qa_ledger_read', userOnlyEnvelope(ADMIN) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(ids(res.output?.rows)).toEqual([...standingIds, ...orgIds].sort());
  });

  it("a member's run is unchanged: an organization holder of the audit capability is served what their request is served, with or without the rung, and no deployment-level row", async () => {
    const res: any = await automation.execute('qa_ledger_read', userOnlyEnvelope(MEMBER) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    const ran = ids(res.output?.rows);
    expect(ran, 'the organization row is served; no deployment-level row is').toEqual(orgIds);
    expect(await requestReads(await requestContext(MEMBER))).toEqual(ran);
    expect(await requestReads(await requestContext(MEMBER, { posture: false }))).toEqual(ran);
  });

  /**
   * [#28099] What the REST and action doors hand `automation.execute` for the
   * user's request: its own resolved grants, and its rung unless `posture` is
   * false (the doors' shape before #28099).
   */
  async function doorEnvelope(userId: string, opts: { posture?: boolean } = {}) {
    const r = await requestContext(userId, opts);
    return {
      userId, tenantId: orgA, event: 'manual', params: {},
      positions: r.positions, permissions: r.permissions,
      ...('posture' in r ? { posture: r.posture } : {}),
    };
  }

  it("[#28099] CONTROL: a door-started run without the forwarded rung (the doors' shape before the fix) is served the organization row only", async () => {
    const res: any = await automation.execute('qa_ledger_read', (await doorEnvelope(ADMIN, { posture: false })) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(ids(res.output?.rows)).toEqual(orgIds);
  });

  it("[#28099] the platform administrator's door-started run, carrying the rung the door forwarded, is served every deployment-level row, as their request is", async () => {
    const res: any = await automation.execute('qa_ledger_read', (await doorEnvelope(ADMIN)) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(ids(res.output?.rows)).toEqual([...standingIds, ...orgIds].sort());
    expect(ids(res.output?.rows)).toEqual(await requestReads(await requestContext(ADMIN)));
  });

  it("[#28099] a member's door-started run is served what the member's request is served, and no deployment-level row", async () => {
    const res: any = await automation.execute('qa_ledger_read', (await doorEnvelope(MEMBER)) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(ids(res.output?.rows)).toEqual(orgIds);
    expect(await requestReads(await requestContext(MEMBER))).toEqual(orgIds);
  });

  it("a runAs:'system' run is unchanged: elevated, it is served every row as before", async () => {
    const res: any = await automation.execute('qa_ledger_read_system', userOnlyEnvelope(MEMBER) as never);
    expect(res.success, `run failed: ${JSON.stringify(res)}`).toBe(true);
    expect(ids(res.output?.rows)).toEqual([...standingIds, ...orgIds].sort());
  });
});
