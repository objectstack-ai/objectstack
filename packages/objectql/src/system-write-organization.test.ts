// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ── A system-context write resolves the install's organization, or is refused (#8844) ──
//
// The runtime twin of #8686. That card fixed the SEED producer of untenanted
// rows and shipped a backfill for what it had already written; this one is the
// producer that is still running — a hook, a cron job, a custom endpoint or a
// `runAs: system` flow creating an ordinary record. A backfill cannot reach it:
// it mints a fresh duplicate on every tick, which is what makes #8686's repair
// self-undoing on any install with server-side automation.
//
// ## The seam under test is `DriverOptions.tenantId`, not SQL
//
// `@objectstack/objectql` cannot import `@objectstack/driver-sql` (the
// dependency runs the other way), so this file pins the exact input both driver
// mechanisms key off — the same seam `engine-external-tenant-scope.test.ts`
// pins for the read wall. `injectTenantOnInsert` stamps the tenant column only
// when `options.tenantId` is present, and `fillAutoNumberFields` resolves its
// counter scope as `row[tenantField] ?? options.tenantId ?? null` with `null`
// collapsing to `__global__`. So "`tenantId` in DriverOptions" is precisely
// "the row is stamped and its counter is the organization's", and resolving it
// at the ENGINE is what makes the fix cover every driver at once — which
// matters twice over here, because `fillAutoNumberFields` is duplicated in
// `driver-sql` and `driver-turso`. The end-to-end consequence — one counter
// instead of two, on a real SQL database — is pinned in
// `packages/runtime/src/system-write-tenancy-autonumber-split.integration.test.ts`.
//
// ## Both directions, in the same cases, deliberately
//
// A silent default is the defect; a refusal that is too broad is a different
// defect that breaks every system write on a walled install — including hooks
// and cron that run unattended, where a loud failure surfaces as a stalled
// automation rather than a 4xx someone reads. A file that pinned only the
// refusal would stay green if the engine refused EVERYTHING, and one that
// pinned only the stamp would stay green if it stamped a guess on a walled
// install. So each case below carries its discriminating control.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { ObjectQL } from './engine.js';
import { resolveSystemWriteOrganization } from './tenancy/system-write-organization.js';

const ORG_ID = 'org_msokm9oaz0cal87q';
const SECOND_ORG_ID = 'org_second';

/** The card's shape: a hook / cron write, elevated, carrying no organization. */
const SYSTEM_CTX: ExecutionContext = { isSystem: true } as ExecutionContext;
/** A signed-in planner in the Console — the write path that already works. */
const SESSION_CTX: ExecutionContext = { userId: 'u_planner', tenantId: ORG_ID };

interface ObservedCall {
  object: string;
  method: string;
  data: any;
  options: Record<string, unknown> | undefined;
}

function makeDriver(observed: ObservedCall[], organizations: string[]) {
  const record = (object: string, method: string, data: any, options: any) => {
    observed.push({ object, method, data, options });
  };
  return {
    name: 'memory',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async find(object: string, _ast: any, options: any) {
      record(object, 'find', undefined, options);
      return object === 'sys_organization' ? organizations.map((id) => ({ id })) : [];
    },
    async findOne() { return null; },
    async count() { return 0; },
    async create(object: string, data: any, options: any) {
      record(object, 'create', data, options);
      return { id: 'r_1', ...data };
    },
    async update(object: string, id: string, data: any, options: any) {
      record(object, 'update', data, options); return { id, ...data };
    },
    async delete() { return true; },
    async bulkCreate(object: string, rows: any[], options: any) {
      record(object, 'bulkCreate', rows, options);
      return rows.map((r, i) => ({ id: `r_${i + 1}`, ...r }));
    },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async syncSchema() {},
  } as any;
}

const PACKAGE_ID = '#8844';

/**
 * The card's own shape: an application object with an autonumber declared
 * `unique` at organization scope. `unique: 'organization'` is what makes a real
 * driver materialize the NULL-safe partitioned index whose two partitions is
 * where the duplicates hide.
 */
const DISPATCH_ORDER = {
  name: 'dispatch_order',
  fields: {
    subject: { type: 'text' },
    document_no: { type: 'autonumber', format: 'WI-{00000}', unique: 'organization' },
  },
} as any;

/** A platform-namespace object: its rows are deliberately org-less (#8672). */
const SYS_LEDGER = {
  name: 'sys_audit_entry',
  fields: { subject: { type: 'text' } },
} as any;

/** ADR-0066: the DECLARED way to say "rows of this object belong to no org". */
const PLATFORM_GLOBAL = {
  name: 'billing_license',
  tenancy: { enabled: false },
  fields: { subject: { type: 'text' } },
} as any;

const ORG_OBJECT = { name: 'sys_organization', fields: { name: { type: 'text' } } } as any;

async function makeEngine(opts: { posture?: string; organizations?: string[] } = {}) {
  const observed: ObservedCall[] = [];
  const engine = new ObjectQL();
  engine.registerDriver(makeDriver(observed, opts.organizations ?? [ORG_ID]), true);
  await engine.init();
  for (const o of [DISPATCH_ORDER, SYS_LEDGER, PLATFORM_GLOBAL, ORG_OBJECT]) {
    engine.registry.registerObject(o, PACKAGE_ID);
  }
  if (opts.posture) engine.setTenancyPostureProvider(() => opts.posture);
  return { engine, observed };
}

/** What the driver was handed for the LAST write of `object`. */
const lastWrite = (observed: ObservedCall[], object: string) =>
  [...observed].reverse().find((c) => c.object === object && c.method !== 'find');

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('#8844 the decision — the ruling as one pure function', () => {
  const probe = (ids: string[]) => () => Promise.resolve(ids);

  it('[binding point 1] single-tenant with exactly one organization derives it', async () => {
    expect(await resolveSystemWriteOrganization({ posture: 'single', probeOrganizations: probe([ORG_ID]) }))
      .toEqual({ kind: 'derived', organizationId: ORG_ID });
  });

  it.each(['group', 'isolated'] as const)(
    '[binding point 2] the walled posture %s refuses, without asking the database anything',
    async (posture) => {
      const probeOrganizations = vi.fn(async () => [ORG_ID]);
      expect(await resolveSystemWriteOrganization({ posture, probeOrganizations }))
        .toEqual({ kind: 'refuse', reason: 'walled-posture' });
      // The count could not change the verdict on a walled install, so it is
      // not read — a refusal must not cost a query per write.
      expect(probeOrganizations).not.toHaveBeenCalled();
    },
  );

  it('[binding point 2] a `single` posture whose DATA holds several organizations refuses too', async () => {
    // The posture is what the deployment asked for; the count is what the data
    // is. Where they disagree there is no unambiguous answer, so the topology
    // falls under the refusal rather than getting a guessed default — the same
    // line #8686's backfill draws as `skipped-ambiguous-organization`.
    expect(await resolveSystemWriteOrganization({
      posture: 'single',
      probeOrganizations: probe([ORG_ID, SECOND_ORG_ID]),
    })).toEqual({ kind: 'refuse', reason: 'ambiguous-organization', organizationCount: 2 });
  });

  it('[first boot] no organization yet is NOT a refusal — there is nothing to fork away from', async () => {
    // Seeds land during `start()`; the admin, and with them the first
    // organization, arrive by a later sign-up POST. Refusing here would refuse
    // first boot itself, and there is no second partition to fork from anyway —
    // #8686's `sys_organization`-insert handoff adopts exactly these rows.
    expect(await resolveSystemWriteOrganization({ posture: 'single', probeOrganizations: probe([]) }))
      .toEqual({ kind: 'no-organization-yet' });
  });
});

describe('#8844 single-tenant — the system write is stamped like a session write', () => {
  it('derives the install organization for a system-context insert, and a session write is unchanged', async () => {
    const { engine, observed } = await makeEngine();

    // POSITIVE CONTROL — the card's producer: a hook / cron create with no
    // organization anywhere. It now reaches the driver carrying one.
    await engine.insert('dispatch_order', { subject: 'rework order' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(ORG_ID);

    // DISCRIMINATING CONTROL — the write path that already worked. If the fix
    // had changed what a session write resolves, this is where it would show.
    await engine.insert('dispatch_order', { subject: 'production order' }, { context: SESSION_CTX } as any);
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(ORG_ID);

    // Both producers now resolve the SAME organization, which is the whole
    // point: one counter scope, so the two cannot mint the same number.
    const tenants = observed
      .filter((c) => c.object === 'dispatch_order' && c.method === 'create')
      .map((c) => c.options?.tenantId);
    expect(tenants).toEqual([ORG_ID, ORG_ID]);
  });

  it('resolves once per batch and stamps a batch insert', async () => {
    const { engine, observed } = await makeEngine();
    await engine.insert(
      'dispatch_order',
      [{ subject: 'a' }, { subject: 'b' }, { subject: 'c' }],
      { context: SYSTEM_CTX } as any,
    );
    expect(lastWrite(observed, 'dispatch_order')?.method).toBe('bulkCreate');
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(ORG_ID);
  });

  it('probes `sys_organization` once across many system writes, and re-probes after one is created', async () => {
    const { engine, observed } = await makeEngine();
    for (let i = 0; i < 5; i++) {
      await engine.insert('dispatch_order', { subject: `n${i}` }, { context: SYSTEM_CTX } as any);
    }
    const probes = () => observed.filter((c) => c.object === 'sys_organization' && c.method === 'find').length;
    expect(probes()).toBe(1);

    // The one event that can change the answer drops the memo — the sign-up
    // that brings an organization into existence is exactly this insert.
    await engine.insert('sys_organization', { id: SECOND_ORG_ID, name: 'Second' }, { context: SYSTEM_CTX } as any);
    await engine.insert('dispatch_order', { subject: 'after' }, { context: SYSTEM_CTX } as any);
    expect(probes()).toBe(2);
  });

  it('[first boot] leaves the write untenanted when the install has no organization yet', async () => {
    const { engine, observed } = await makeEngine({ organizations: [] });
    await engine.insert('dispatch_order', { subject: 'seeded' }, { context: SYSTEM_CTX } as any);
    // Nothing to stamp and nothing refused: the row lands org-less exactly as
    // before, for #8686's handoff to adopt when the organization appears.
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBeUndefined();
  });
});

describe('#8844 multi-organization — the write is REFUSED, never defaulted', () => {
  it.each(['isolated', 'group'] as const)(
    'refuses a system-context insert on the %s posture with the ADR-0112 envelope',
    async (posture) => {
      const { engine, observed } = await makeEngine({ posture });

      const refusal = await engine
        .insert('dispatch_order', { subject: 'rework order' }, { context: SYSTEM_CTX } as any)
        .catch((e) => e);

      // The envelope, not just the throw: a bare `toThrow()` would stay green
      // for any error the engine happens to raise on this path.
      expect(refusal.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
      expect(refusal.status).toBe(500);
      // Loud: the condition, what would have been written, and the remedy.
      expect(refusal.message).toContain('dispatch_order');
      expect(refusal.message).toContain('__global__');
      expect(refusal.message).toContain('tenantId');
      expect(refusal.message).toContain('tenancy: { enabled: false }');

      // ⛔ NOT defaulted and ⛔ not silently skipped — nothing reached the driver.
      expect(observed.filter((c) => c.object === 'dispatch_order')).toEqual([]);
    },
  );

  it('refuses when the posture says single but the data holds several organizations', async () => {
    const { engine } = await makeEngine({ organizations: [ORG_ID, SECOND_ORG_ID] });
    const refusal = await engine
      .insert('dispatch_order', { subject: 'ambiguous' }, { context: SYSTEM_CTX } as any)
      .catch((e) => e);
    expect(refusal.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
    expect(refusal.reason).toBe('ambiguous-organization');
    expect(refusal.message).toContain('2 organizations');
  });

  it('reads the posture from the ENV when no provider is injected', async () => {
    // A lean embedding mounts no SecurityPlugin, so nothing injects the live
    // `tenancy` service's answer. The operator's declared posture is then the
    // best fact available — and it must still be read, or a walled deployment
    // without plugin-security silently falls back to the stamping branch.
    vi.stubEnv('OS_TENANCY_POSTURE', 'isolated');
    const { engine } = await makeEngine();
    const refusal = await engine
      .insert('dispatch_order', { subject: 'env-walled' }, { context: SYSTEM_CTX } as any)
      .catch((e) => e);
    expect(refusal.code).toBe('ERR_SYSTEM_WRITE_ORGANIZATION_REQUIRED');
    expect(refusal.reason).toBe('walled-posture');
  });

  it('a write that CARRIES an organization is never refused on a walled install', async () => {
    // The other half of binding point 2 — "carry an explicit organization OR be
    // refused". Without this case the refusal could be unconditional and the
    // suite would not notice.
    const { engine, observed } = await makeEngine({ posture: 'isolated' });

    // (a) carried on the execution context
    await engine.insert(
      'dispatch_order',
      { subject: 'explicit ctx' },
      { context: { isSystem: true, tenantId: SECOND_ORG_ID } as ExecutionContext } as any,
    );
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(SECOND_ORG_ID);

    // (b) carried on the record itself
    await engine.insert(
      'dispatch_order',
      { subject: 'explicit row', organization_id: ORG_ID },
      { context: SYSTEM_CTX } as any,
    );
    expect(lastWrite(observed, 'dispatch_order')?.data?.organization_id).toBe(ORG_ID);

    // (c) a signed-in caller — the ordinary path, untouched on every posture
    await engine.insert('dispatch_order', { subject: 'session' }, { context: SESSION_CTX } as any);
    expect(lastWrite(observed, 'dispatch_order')?.options?.tenantId).toBe(ORG_ID);
  });

  it('a beforeInsert hook that stamps the organization has carried it', async () => {
    // The resolution runs AFTER the hooks on purpose: a hook that supplies the
    // organization itself must not then be refused for the value it just wrote.
    const { engine, observed } = await makeEngine({ posture: 'isolated' });
    engine.on('beforeInsert', 'dispatch_order', async (ctx: any) => {
      ctx.input.data.organization_id = SECOND_ORG_ID;
    });
    await engine.insert('dispatch_order', { subject: 'hook-stamped' }, { context: SYSTEM_CTX } as any);
    expect(lastWrite(observed, 'dispatch_order')?.data?.organization_id).toBe(SECOND_ORG_ID);
  });
});

describe('#8844 the exclusions — populations the refusal must not touch', () => {
  it.each(['isolated', 'single'] as const)(
    'a platform-namespace object stays org-less on the %s posture',
    async (posture) => {
      // #8672 measured this primitive on `sys_permission_set` and filed it as an
      // observation because an org-less row is defensible there. The #8844
      // ruling confirms that reasoning holds for platform objects and does NOT
      // generalize to application objects — which is exactly the boundary here.
      const { engine, observed } = await makeEngine({ posture });
      await engine.insert('sys_audit_entry', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
      expect(lastWrite(observed, 'sys_audit_entry')?.options?.tenantId).toBeUndefined();
    },
  );

  it.each(['isolated', 'single'] as const)(
    'an object declaring `tenancy.enabled: false` stays org-less on the %s posture',
    async (posture) => {
      // ADR-0066 is the DECLARED way to hold deliberately org-less rows — stated
      // once on the object and checkable, rather than a per-write bypass flag,
      // which is the lenient-consumer accommodation PD #12 forbids.
      const { engine, observed } = await makeEngine({ posture });
      await engine.insert('billing_license', { subject: 'lic' }, { context: SYSTEM_CTX } as any);
      expect(lastWrite(observed, 'billing_license')?.options?.tenantId).toBeUndefined();
    },
  );

  it('never probes `sys_organization` for a write it does not judge', async () => {
    // The cost half of the exclusions: an ordinary write must pay two property
    // reads and a regexp, not a query.
    const { engine, observed } = await makeEngine({ organizations: [ORG_ID] });
    await engine.insert('sys_audit_entry', { subject: 'e1' }, { context: SYSTEM_CTX } as any);
    await engine.insert('billing_license', { subject: 'lic' }, { context: SYSTEM_CTX } as any);
    await engine.insert('dispatch_order', { subject: 'session' }, { context: SESSION_CTX } as any);
    expect(observed.filter((c) => c.object === 'sys_organization')).toEqual([]);
  });
});
