// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0123 D2 / #8247, #8208] An authenticated session with NO active
 * organization: reads resolve to nothing, tenant-scoped writes are REFUSED.
 *
 * ## What was open
 *
 * The Layer 0 write-side twin (`security-plugin.ts` step 3.7) validated
 * **supplied** `organization_id` values only — its own comment says so. That is
 * the right guard for a payload naming ANOTHER tenant (#2937 / ADR-0105 D5) and
 * it leaves the opposite case wide open: a payload naming NO tenant, written by
 * a caller who HAS no tenant. Nothing downstream fills it either (auto-stamping
 * lives in the enterprise organizations runtime and has nothing to stamp), so
 * the row landed with `organization_id` NULL and the read wall then hid it from
 * every reader — including the author who had just created it (#8208).
 *
 * ## Anti-vacuity — the two traps this file is built around
 *
 * **1. "Reads resolve to nothing" and "the bug" look identical from outside.**
 * A test asserting an empty result set passes under BOTH the correct
 * fail-closed rule and the silent-NULL defect. So the read-side cases here never
 * assert "empty". They take ONE concrete row, and assert that the SAME row is
 * *admitted* under a system context and *excluded* under the org-less caller's
 * own composed filter — and that the excluding filter is the DENY SENTINEL
 * specifically, not an absent policy. Empty-by-rule and empty-by-accident are
 * different verdicts here, and a row that was never written would be admitted by
 * neither, so the system-context leg is what makes the discrimination real.
 *
 * **2. A 4xx assertion on the status alone cannot tell a conforming refusal
 * from any other 4xx.** ADR-0123 D2/D4 require the refusal to NAME the missing
 * active organization, so every write-side case pins three things — `code`,
 * `statusCode`, and the message content — never a bare `rejects.toThrow()`. The
 * ordering case is the sharpest of them: a caller with no organization scope who
 * ALSO supplies a foreign `organization_id` satisfies the sibling forge guard
 * too, and both answer 403 `PERMISSION_DENIED`. Only the message tells them
 * apart, which is exactly why D4 is a decision and not a nicety.
 *
 * Every control below is paired with the case it controls: for each exemption
 * (system context, platform operator, non-tenant object, `single` posture, a
 * non-empty `group` membership set) there is a sibling case differing in that
 * one fact where the refusal DOES fire. A file of controls alone would pass on
 * the pre-fix build.
 */

import { describe, it, expect, vi } from 'vitest';
import { matchesFilterCondition } from '@objectstack/formula';
import type { PermissionSet } from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';

/** Plain CRUD, NO row-level policies — so Layer 0 is the only enforcer under test. */
const MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/**
 * A platform operator: the superuser bit AND a platform-EXCLUSIVE capability.
 * Both halves are required by ADR-0095 D3 — an `organization_admin` holds the
 * superuser bit through its wildcard grant and must NOT cross the wall.
 */
const PLATFORM_ADMIN: PermissionSet = {
  name: 'admin_full_access',
  label: 'Platform Administrator',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true } },
  systemPermissions: ['manage_platform_settings', 'manage_metadata'],
} as unknown as PermissionSet;

const TENANT_SCHEMA = {
  name: 'task',
  fields: { id: { name: 'id' }, organization_id: { name: 'organization_id' }, owner_id: { name: 'owner_id' }, name: { name: 'name' } },
};

interface BootOpts {
  schema?: Record<string, unknown>;
  sets?: PermissionSet[];
  /**
   * Which set a caller carrying no positions resolves to. The harness has no
   * position→set binding, so this is how a case chooses its persona: the
   * default `member_default` is the ordinary member, `admin_full_access`
   * selects {@link PLATFORM_ADMIN}.
   */
  fallback?: string;
  /** Override the posture; omitted → the `org-scoping` sentinel, i.e. `isolated`. */
  posture?: string;
  /** Leave the wall OFF entirely (`single`) — no `org-scoping` service at all. */
  noWall?: boolean;
  findOneImpl?: (query: unknown) => unknown;
}

async function boot(opts: BootOpts = {}) {
  const schema = opts.schema ?? TENANT_SCHEMA;
  const sets = opts.sets ?? [MEMBER];
  let middleware: ((opCtx: unknown, next: () => Promise<void>) => Promise<void>) | undefined;
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: never) => { if (!middleware) middleware = mw; },
      getSchema: () => schema,
      findOne: vi.fn(async (_o: string, q: unknown) => (opts.findOneImpl ? opts.findOneImpl(q) : null)),
    },
    metadata: { get: async () => schema, list: async () => sets },
  };
  if (!opts.noWall) services['org-scoping'] = { name: 'com.objectstack.org-scoping' };
  if (opts.posture) services['tenancy'] = { posture: opts.posture };
  const warn = vi.fn();
  const ctx = {
    logger: { info: vi.fn(), warn, error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: opts.fallback ?? 'member_default' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.init(ctx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.start(ctx as any);
  return {
    plugin,
    warn,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    readFilter: (object: string, context: any) => (plugin as any).getReadFilter(object, context),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    run: async (opCtx: any) => { await middleware!(opCtx, async () => {}); return opCtx; },
  };
}

/** Authenticated, ordinary member, and NO active organization — the whole subject. */
const ORG_LESS = { userId: 'u1', positions: [], permissions: [] };
/** The same person one `sys_member` row later. The single-fact control. */
const ORG_BOUND = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [] };

/**
 * Assert a refusal CONFORMS to ADR-0123 D2/D4 rather than merely being some 4xx.
 * Three facts, because any two of them are satisfied by refusals this rule is
 * not: the sibling forge guard is also `PERMISSION_DENIED`/403, and any 403 at
 * all satisfies the first two.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function expectConformingRefusal(err: any, opts: { principal?: 'session' | 'delegator' } = {}) {
  expect(err, 'the write was not refused at all').toBeDefined();
  expect(err.code).toBe('PERMISSION_DENIED');
  expect(err.statusCode).toBe(403);
  // D4: the refusal NAMES what is missing. Without this the message is
  // indistinguishable from a permission denial, and sends the reader to audit
  // permission sets that are perfectly fine.
  expect(err.message).toMatch(/no active organization/i);
  expect(err.message).toMatch(/organization to place the record in/i);
  // NOT the sibling forge guard's sentence — that one is about a value the
  // caller supplied, which is not why this write cannot land.
  expect(err.message).not.toMatch(/another tenant/i);
  if (opts.principal === 'delegator') expect(err.message).toMatch(/delegating principal/i);
  // The operator half names the decision so the next reader can find it.
  expect(err.developerMessage).toMatch(/ADR-0123 D2/);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refusalFrom(run: (opCtx: any) => Promise<unknown>, opCtx: unknown): Promise<any> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await run(opCtx as any);
    return undefined;
  } catch (e) {
    return e;
  }
}

describe('[ADR-0123 D2] tenant-scoped WRITES with no active organization are refused loudly', () => {
  it('insert is refused, and the refusal names the missing active organization', async () => {
    const h = await boot();
    const err = await refusalFrom(h.run, {
      object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS },
    });
    expectConformingRefusal(err);
  });

  it('update is refused the same way', async () => {
    // Pre-image visible so step 2.7 passes and 3.7 is genuinely reached.
    const h = await boot({ findOneImpl: () => ({ id: 't1', organization_id: 'org-1' }) });
    const err = await refusalFrom(h.run, {
      object: 'task', operation: 'update', data: { id: 't1', name: 'renamed' }, context: { ...ORG_LESS },
    });
    expectConformingRefusal(err);
  });

  it('a BULK insert is refused as a whole — no partial landing', async () => {
    const h = await boot();
    const err = await refusalFrom(h.run, {
      object: 'task', operation: 'insert', data: [{ name: 'A' }, { name: 'B' }], context: { ...ORG_LESS },
    });
    expectConformingRefusal(err);
  });

  it('CONTROL: the same write by the same user WITH an active organization lands, and is still not stamped', async () => {
    // The single-fact control, and the one that makes every case above mean
    // something: only `tenantId` differs. It also pins that the refusal is NOT
    // a new stamping behaviour — SecurityPlugin still never fills
    // `organization_id` (ADR-0105 D5/D12); it refuses when it cannot be filled.
    const h = await boot();
    const opCtx = { object: 'task', operation: 'insert', data: { name: 'A' } as Record<string, unknown>, context: { ...ORG_BOUND } };
    await h.run(opCtx);
    expect(opCtx.data.organization_id).toBeUndefined();
  });

  it('CONTROL: a system context is untouched (boot seeding, reconcilers, backfills, imports)', async () => {
    const h = await boot();
    await h.run({ object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS, isSystem: true } });
  });

  it('CONTROL: the `single` posture has no wall, so an org-less write is ordinary', async () => {
    const h = await boot({ noWall: true });
    await h.run({ object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS } });
  });

  it('CONTROL: a true PLATFORM operator crosses the wall on a posture-permitting object (ADR-0095 D3)', async () => {
    // `access.default: 'private'` is one of the postures that PERMITS the
    // crossing; the object still carries `organization_id`, so it is a tenant
    // object and the wall is live for everyone else — which the sibling case
    // below measures on the very same fixture.
    const h = await boot({
      schema: { ...TENANT_SCHEMA, access: { default: 'private' } },
      sets: [PLATFORM_ADMIN],
      fallback: 'admin_full_access',
    });
    await h.run({ object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS } });
  });

  it('…but the SAME platform operator IS refused on an ordinary BUSINESS tenant object', async () => {
    // The control's control, and the half that matters: ADR-0095 D3's exemption
    // is POSTURE-scoped, never a property of the person. Drop the posture and
    // the identical caller — same superuser bits, same platform capabilities —
    // meets the wall like everyone else. Without this pin, the case above would
    // pass just as well if the exemption had been widened to "any platform
    // admin, any object", which is the W2 hole ADR-0095 exists to keep shut.
    const h = await boot({ sets: [PLATFORM_ADMIN], fallback: 'admin_full_access' });
    const err = await refusalFrom(h.run, {
      object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS },
    });
    expectConformingRefusal(err);
  });

  it('CONTROL: an object that opted OUT of tenancy is not tenant-scoped, so nothing is refused', async () => {
    const h = await boot({ schema: { ...TENANT_SCHEMA, tenancy: { enabled: false } } });
    await h.run({ object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS } });
  });

  it('CONTROL: an object with no `organization_id` column is not tenant-scoped either', async () => {
    const h = await boot({ schema: { name: 'task', fields: { id: { name: 'id' }, name: { name: 'name' } } } });
    await h.run({ object: 'task', operation: 'insert', data: { name: 'A' }, context: { ...ORG_LESS } });
  });

  it('`delete` is deliberately NOT refused here — it places no row (ADR-0123 D2 boundary)', async () => {
    // Stated as a pin so the boundary is a decision on the record rather than an
    // omission the next author "fixes". A delete decides no tenant; its target
    // is selected through the Layer 0 ROW wall, which already resolves to
    // nothing under this state — the read rule, applied to the targeting step.
    const h = await boot({ findOneImpl: () => ({ id: 't1', organization_id: 'org-1' }) });
    const err = await refusalFrom(h.run, {
      object: 'task', operation: 'delete', options: { where: { id: 't1' } }, context: { ...ORG_LESS },
    });
    expect(err?.message ?? '').not.toMatch(/no active organization/i);
  });

  describe('the `group` posture reads MEMBERSHIP, not the active organization (ADR-0105 D2)', () => {
    it('an EMPTY membership set is refused', async () => {
      const h = await boot({ posture: 'group' });
      const err = await refusalFrom(h.run, {
        object: 'task', operation: 'insert', data: { name: 'A' },
        context: { ...ORG_LESS, accessible_org_ids: [] },
      });
      expectConformingRefusal(err);
    });

    it('CONTROL: a NON-EMPTY membership set lands, even with no active organization', async () => {
      // The half a `tenantId`-only test would get wrong: under `group` the
      // membership set IS the scope, so this caller is fully scoped despite
      // carrying no active organization.
      const h = await boot({ posture: 'group' });
      await h.run({
        object: 'task', operation: 'insert', data: { name: 'A' },
        context: { ...ORG_LESS, accessible_org_ids: ['org-1', 'org-2'] },
      });
    });
  });

  describe('ordering against the sibling forge guard (both are 403 PERMISSION_DENIED)', () => {
    it('no organization scope AND a foreign organization_id → the no-active-organization sentence wins', async () => {
      // Both guards would fire. Only one of the two messages is actionable: the
      // supplied value is not why this write cannot land — the caller has no
      // organization scope at all, so NO value could have satisfied the wall.
      const h = await boot();
      const err = await refusalFrom(h.run, {
        object: 'task', operation: 'insert', data: { name: 'A', organization_id: 'org-2' }, context: { ...ORG_LESS },
      });
      expectConformingRefusal(err);
    });

    it('CONTROL: WITH an organization scope, a foreign organization_id still gets the forge sentence', async () => {
      // The other half of the ordering: the new gate must not swallow the guard
      // it was placed in front of.
      const h = await boot();
      const err = await refusalFrom(h.run, {
        object: 'task', operation: 'insert', data: { name: 'A', organization_id: 'org-2' }, context: { ...ORG_BOUND },
      });
      expect(err?.code).toBe('PERMISSION_DENIED');
      expect(err?.message).toMatch(/would place .* in another tenant/);
      expect(err?.message).not.toMatch(/no active organization/i);
    });
  });
});

describe('[ADR-0123 D2] tenant-scoped READS with no active organization resolve to nothing — BY RULE', () => {
  /**
   * One concrete row, in a real tenant. It exists throughout; nothing below
   * deletes it or writes a different one. That is what makes "the read returns
   * nothing" attributable to the RULE rather than to an empty store.
   */
  const ROW = { id: 't1', organization_id: 'org-1', owner_id: 'u1', name: 'A' };

  it('the org-less caller\'s composed read filter is the DENY SENTINEL, and it excludes the row', async () => {
    const h = await boot();
    const filter = await h.readFilter('task', { ...ORG_LESS });
    // Not merely "some filter": the sentinel specifically. A missing policy
    // would be `undefined` (unrestricted) and an ordinary wall would be
    // `organization_id = …`; both are different verdicts from this one.
    expect(filter).toEqual(RLS_DENY_FILTER);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(matchesFilterCondition(ROW as any, filter as any)).toBe(false);
  });

  it('the SAME row is admitted under a system context — so the empty read is by RULE, not by accident', async () => {
    // The discriminator the card asks for. If the row simply did not exist, this
    // leg would be just as empty as the one above and the pair would prove
    // nothing. It is admitted here and excluded there, on the same object, in
    // the same boot.
    const h = await boot();
    const filter = await h.readFilter('task', { isSystem: true, userId: 'sys', positions: [], permissions: [] });
    expect(filter).toBeUndefined(); // no scoping imposed at all
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(matchesFilterCondition(ROW as any, (filter ?? {}) as any)).toBe(true);
  });

  it('CONTROL: the same caller WITH an active organization gets a real wall that ADMITS the row', async () => {
    // The third leg. It rules out "plugin-security denies this object to
    // everyone but system": one `sys_member` row turns the sentinel into
    // `organization_id = org-1`, which the row satisfies.
    const h = await boot();
    const filter = await h.readFilter('task', { ...ORG_BOUND });
    expect(filter).toEqual({ organization_id: 'org-1' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(matchesFilterCondition(ROW as any, filter as any)).toBe(true);
  });

  it('a read is NOT refused — reads resolve to nothing, only writes are refused (the D2 asymmetry)', async () => {
    // The asymmetry is the decision, so it gets its own pin: making reads throw
    // would break every list screen for a user between organizations.
    const h = await boot();
    const opCtx = { object: 'task', operation: 'find', options: { where: {} }, context: { ...ORG_LESS } };
    await h.run(opCtx); // must not throw
  });
});
