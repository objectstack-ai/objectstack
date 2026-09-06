// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15813] The security middleware RECORDS its Layer 0 verdict on the
 * operation context — `opCtx.tenantLayer0Verdict` — at the moment it composes
 * the wall onto the operation's predicate, so a producer downstream
 * (`publishBulkDataEvent`, `@objectstack/objectql`) reads what the wall
 * decided instead of re-deriving it (the #15706 ruling: seam (i)).
 *
 * What these pins hold:
 *
 *  1. The recorded verdict IS the wall that was composed — every case reads
 *     the verdict AND the injected `ast.where` off ONE middleware pass, so a
 *     verdict that disagreed with the predicate would fail here first.
 *  2. The populations the engine could never answer are answered HERE, from
 *     inputs only this plugin sees: the deployment's #12699 carve-out (`none`
 *     under an armed wall — the #15706 population), a `PLATFORM_ADMIN` rung
 *     on a PUBLIC tenant object (`organization` — the wall stands), a
 *     `PLATFORM_ADMIN` on a posture-permitting object (`none` — the wall was
 *     crossed), and a hand-built context carrying no rung whose exemption
 *     the capability probe decides.
 *  3. Nothing is recorded where no wall was composed: a system context (the
 *     middleware's first exit) and a by-id write (no predicate to compose
 *     onto). Absence is a distinct state from `none`.
 *  4. [#15887] The four shapes that were CORRECT BY CONSTRUCTION but pinned
 *     only one layer away — `systemFields.tenant: false` beside an
 *     author-declared column, the #7835 phantom anchor, a custom
 *     `tenancy.tenantField`, and the ADR-0090 D10 on-behalf-of INTERSECTION,
 *     whose middleware line carried no pin at all. Each rested on the
 *     projection's own pins (`security-plugin.test.ts`,
 *     `federated-tenant-layer0.test.ts`, `tenant-layer.test.ts`), i.e. on the
 *     identity「the recorded verdict IS what the predicate was projected from」
 *     — the very identity that would break first. The pins below read the
 *     RECORDED object, so a divergence is caught on the recording side.
 *
 * Harness: `deployment-platform-global-exemption.test.ts` — a SecurityPlugin
 * over a fake ObjectQL. The registered middleware is captured and driven with
 * a hand-built predicate-write `opCtx`; `next` is a no-op, so the assertion is
 * about what the middleware left on the context, not about a driver.
 */

import { describe, it, expect, vi } from 'vitest';
import { TENANT_SCOPE_FIELD_DEF } from '@objectstack/metadata-core';
import type { PermissionSet } from '@objectstack/spec/security';
import { ADMIN_FULL_ACCESS } from '@objectstack/spec/identity';
import { SecurityPlugin } from './security-plugin.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';

const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

const ADMIN_SET = defaultPermissionSets.find((s) => s.name === ADMIN_FULL_ACCESS);
if (!ADMIN_SET) throw new Error(`fixture: '${ADMIN_FULL_ACCESS}' is not among the default permission sets`);

/**
 * An explicit per-object grant on the PRIVATE object: a wildcard `'*'` grant
 * does not reach a private object (ADR-0066), so a plain member holding only
 * `member_default` is refused at the CRUD gate before any wall is composed.
 * This set lets the rungless-member half of the probe pin REACH the wall,
 * carrying no superuser bit and no platform capability.
 */
const SECRET_EDITOR: PermissionSet = {
  name: 'secret_editor',
  label: 'Secret editor',
  objects: { crm_secret: { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/** An ordinary member of `org-1`, rung carried as the authz resolver would. */
const MEMBER_CTX = { userId: 'u1', tenantId: 'org-1', positions: [], permissions: [], posture: 'MEMBER' };

const localSchema = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    title: { type: 'text', label: 'Title' },
    status: { type: 'text', label: 'Status' },
  },
  ...extra,
});

/** `localSchema` plus extra columns — the custom-tenant-column shapes need one. */
const withFields = (
  schema: Record<string, unknown>,
  fields: Record<string, unknown>,
): Record<string, unknown> => ({
  ...schema,
  fields: { ...(schema.fields as Record<string, unknown>), ...fields },
});

const SCHEMAS: Record<string, Record<string, unknown>> = {
  crm_task: localSchema('crm_task'),
  sys_widget_registry: localSchema('sys_widget_registry'),
  sys_catalog: localSchema('sys_catalog', { tenancy: { enabled: false } }),
  crm_secret: localSchema('crm_secret', { access: { default: 'private' } }),

  // ── [#15887] the three object shapes ──────────────────────────────────────
  //
  // P1. The object opted OUT of the tenant system field while the author's own
  // `organization_id` stays declared and perfectly readable.
  // `getObjectSecurityMeta` folds `systemFields.tenant === false` into
  // `tenancyDisabled` beside `tenancy.enabled === false`, so the wall composes
  // NOTHING here. The readable column is the trap: a reader answering from the
  // column instead of from the wall stamps this batch with the caller's
  // organization — a MISLABEL, on rows the wall never constrained.
  shared_catalog: localSchema('shared_catalog', { systemFields: { tenant: false } }),

  // [#7835] Federated, carrying the anchor `applySystemFields` injects —
  // spread from the shipped constant exactly as the registry does
  // (`additions.organization_id = { ...TENANT_SCOPE_FIELD_DEF }`), so
  // `hasPhantomTenantAnchor` reads the PLATFORM's provenance and Layer 0 treats
  // the object as carrying no tenant column. The platform issues no DDL for an
  // `external` object, so that column exists in the registry and nowhere else.
  ext_customer: {
    name: 'ext_customer',
    external: { remoteName: 'customers' },
    fields: {
      organization_id: { ...TENANT_SCOPE_FIELD_DEF },
      title: { type: 'text', label: 'Title' },
      status: { type: 'text', label: 'Status' },
    },
  },
  // The provenance control, federated too: this `organization_id` is the
  // AUTHOR's — a real remote column — so the wall is doing real work and stays.
  // The phantom exit is about PROVENANCE, never about `external != null`.
  ext_ledger: {
    name: 'ext_ledger',
    external: { remoteName: 'ledgers' },
    fields: {
      organization_id: { type: 'text', label: 'Org (a real remote column)' },
      title: { type: 'text', label: 'Title' },
      status: { type: 'text', label: 'Status' },
    },
  },

  // A custom tenant column declared BESIDE the kernel one — the wall keys on
  // the literal `organization_id` and never reads `tenancy.tenantField`.
  workspace_doc: withFields(localSchema('workspace_doc', { tenancy: { tenantField: 'workspace_id' } }), {
    workspace_id: { type: 'text', label: 'Workspace' },
  }),
  // The same declaration on an object that carries NO `organization_id`: the
  // custom column is never read as a stand-in, so there is no wall to record.
  workspace_note: {
    name: 'workspace_note',
    tenancy: { tenantField: 'workspace_id' },
    fields: {
      workspace_id: { type: 'text', label: 'Workspace' },
      title: { type: 'text', label: 'Title' },
      status: { type: 'text', label: 'Status' },
    },
  },
};

/**
 * [#15887 / ADR-0090 D10] Seed for the on-behalf-of leg: the `sys_*` rows the
 * delegator resolution reads (`resolveDelegatorContext` -> `buildContextForUser`
 * -> core's `resolveUserAuthzGrants`). `memberOf` becomes `sys_member` rows,
 * which is where the delegator's OWN `accessible_org_ids` come from — and that
 * set is the one Layer 0 input a delegated context does NOT inherit from the
 * live principal, so it is the only way the two walls can differ at all.
 * An empty `memberOf` still seeds the `sys_user` row: a MISSING delegator is a
 * different contract (a fail-closed refusal before any wall is composed).
 */
type DelegatorSeed = { userId: string; memberOf: string[] };

async function boot(opts: {
  entitlement?: Record<string, unknown>;
  tenancy?: { posture: string };
  sets?: PermissionSet[];
  delegator?: DelegatorSeed;
} = {}) {
  const middlewares: Array<(opCtx: any, next: () => Promise<void>) => Promise<void>> = [];
  // [#15887] Only the delegated leg needs a readable store; without a seed the
  // tables are empty and `findOne` answers `null` for every object exactly as
  // before, so the cases above are byte-identical. `find` is added ONLY under a
  // seed — the non-delegated path never issues one, and a `ql` without `find`
  // is what the earlier cases were measured against.
  const del = opts.delegator;
  const tables: Record<string, Record<string, unknown>[]> = del
    ? {
        sys_user: [{ id: del.userId, email: `${del.userId}@example.test` }],
        sys_member: del.memberOf.map((organization_id) => ({ user_id: del.userId, organization_id })),
      }
    : {};
  // Plain equality is all the delegator resolution ever asks for (`{ id }`,
  // `{ user_id }`). A combinator read as a FIELD NAME would match nothing and
  // say nothing, so this double REFUSES what it does not implement rather than
  // answering quietly — `check:where-matcher` refuses exactly the quiet shape.
  const matches = (row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean =>
    Object.entries(where ?? {}).every(([k, v]) => {
      if (k.startsWith('$')) throw new Error(`fake engine: unsupported combinator ${k}`);
      if (v && typeof v === 'object') throw new Error(`fake engine: unsupported operator on '${k}'`);
      return row[k] === v;
    });
  const rowsOf = (object: string, where: Record<string, unknown> | undefined) =>
    (tables[object] ?? []).filter((r) => matches(r, where));
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: {
      registerMiddleware: (mw: any) => middlewares.push(mw),
      getSchema: (name: string) => SCHEMAS[name],
      findOne: vi.fn(async (object: string, o: any) => rowsOf(object, o?.where)[0] ?? null),
      ...(del
        ? {
            // The caller's bound is applied AFTER the filter and BY PRESENCE:
            // core's grants resolution hands every one of these reads a `limit`,
            // and a double that silently ignores it cannot report what the real
            // engine would (`check:objectql-double-limit`).
            find: async (object: string, o: any) => {
              const rows = rowsOf(object, o?.where);
              return typeof o?.limit === 'number' ? rows.slice(0, o.limit) : rows;
            },
          }
        : {}),
    },
    metadata: {
      get: async (_type: string, name: string) => SCHEMAS[name],
      list: async () => opts.sets ?? [PLAIN_MEMBER],
    },
    'org-scoping': { name: 'com.objectstack.org-scoping', ...(opts.entitlement ?? {}) },
  };
  if (opts.tenancy) services['tenancy'] = opts.tenancy;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const ctx: Record<string, unknown> = {
    logger,
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await plugin.init(ctx as any);
  await plugin.start(ctx as any);
  if (middlewares.length === 0) throw new Error('SecurityPlugin registered no middleware');
  return { plugin, logger, middleware: middlewares[0] };
}

/** A predicate write — the `multi: true` shape, which carries an `ast`. */
function sweep(object: string, operation: 'update' | 'delete', context: Record<string, unknown>) {
  const where = { status: 'open' };
  const opCtx: any = {
    object,
    operation,
    context: { ...context },
    options: { where, multi: true },
    ast: { where },
  };
  if (operation === 'update') opCtx.data = { title: 'swept' };
  return opCtx;
}

/**
 * [#15887] A READ — the other half of the `opCtx.ast` branch the verdict is
 * recorded in. Needed for the fail-closed delegated leg: a predicate WRITE by a
 * principal whose delegator holds no organization scope is refused by the
 * ADR-0123 D2 write check BEFORE the wall is composed, so the write shape could
 * not observe the recorded verdict there at all.
 */
function readSweep(object: string, context: Record<string, unknown>) {
  const where = { status: 'open' };
  return { object, operation: 'find', context: { ...context }, options: { where }, ast: { where } } as any;
}

const hasVerdict = (opCtx: any) => Object.prototype.hasOwnProperty.call(opCtx, 'tenantLayer0Verdict');
const injectedOrgWall = (opCtx: any): unknown => {
  // The wall is AND-ed under the caller's predicate; find the organization_id clause.
  const walk = (node: any): unknown => {
    if (!node || typeof node !== 'object') return undefined;
    if ('organization_id' in node) return node.organization_id;
    for (const part of node.$and ?? []) {
      const hit = walk(part);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  return walk(opCtx.ast?.where);
};
/**
 * [#15887] EVERY `organization_id` clause in the composed tree, in composition
 * order. The on-behalf-of leg injects TWO walls (the caller's, then the
 * delegator's — `extra` is pushed in that order and spread into one `$and`),
 * and the single-hit walker above would report only the first.
 */
const injectedOrgWalls = (opCtx: any): unknown[] => {
  const out: unknown[] = [];
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if ('organization_id' in node) out.push(node.organization_id);
    for (const part of node.$and ?? []) walk(part);
  };
  walk(opCtx.ast?.where);
  return out;
};

describe('[#15813] the middleware records the Layer 0 verdict it composed — one pass, verdict and predicate agree', () => {
  it('`isolated`, a member with an active organization: `organization`, and the injected wall is that equality', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('the predicate DELETE path records it too', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'delete', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('`group`: `organizations` is the membership SET, and the injected wall is the same set', async () => {
    const { middleware } = await boot({ tenancy: { posture: 'group' } });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-2'] });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organizations', organizationIds: ['org-1', 'org-2'] });
    expect(injectedOrgWall(opCtx)).toEqual({ $in: ['org-1', 'org-2'] });
  });

  it('`group` with a repeated membership records the organization ONCE — a set, so a reader may test length === 1', async () => {
    const { middleware } = await boot({ tenancy: { posture: 'group' } });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, accessible_org_ids: ['org-1', 'org-1'] });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organizations', organizationIds: ['org-1'] });
    expect(injectedOrgWall(opCtx)).toEqual({ $in: ['org-1'] });
  });

  it('`single`: `none` — the wall ran and contributed nothing; nothing is injected', async () => {
    const { middleware } = await boot({ tenancy: { posture: 'single' } });
    const opCtx = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();
  });

  it('an org-less caller under `isolated` records `deny` on a predicate DELETE — the fail-closed sentinel, not an organization', async () => {
    // `delete` is deliberately outside the ADR-0123 D2 write refusal (it
    // places no row), so the operation reaches the wall and the wall denies.
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'delete', { userId: 'u1', positions: [], permissions: [], posture: 'MEMBER' });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'deny' });
  });
});

describe('[#15813] the populations the engine could never answer are answered where the wall is computed', () => {
  it('the deployment\'s #12699 carve-out: an exempted object under an armed wall records `none` — the #15706 population', async () => {
    const { middleware } = await boot({ entitlement: { platformGlobalObjects: ['sys_widget_registry'] } });
    const exempted = sweep('sys_widget_registry', 'update', MEMBER_CTX);
    await middleware(exempted, async () => {});
    expect(exempted.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(exempted)).toBeUndefined();
    // Firing control on the same deployment: the sibling is walled and says so.
    const sibling = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(sibling, async () => {});
    expect(sibling.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
  });

  it('an object that opted out of tenancy (`tenancy.enabled: false`) records `none`', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('sys_catalog', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
  });

  it('a `PLATFORM_ADMIN` rung on a PUBLIC tenant object records `organization` — the wall STANDS there (the engine answered this absent)', async () => {
    const { middleware } = await boot({ sets: [PLAIN_MEMBER, ADMIN_SET as PermissionSet] });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('a `PLATFORM_ADMIN` on a posture-permitting (private) object records `none` — the wall was crossed, so no organization is asserted', async () => {
    const { middleware } = await boot({ sets: [PLAIN_MEMBER, ADMIN_SET as PermissionSet] });
    const opCtx = sweep('crm_secret', 'update', { ...MEMBER_CTX, permissions: [ADMIN_FULL_ACCESS], posture: 'PLATFORM_ADMIN' });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();
  });

  it('a hand-built context carrying NO rung is decided by the capability probe: platform caps cross a private object, a plain member does not', async () => {
    const { middleware } = await boot({ sets: [PLAIN_MEMBER, ADMIN_SET as PermissionSet, SECRET_EDITOR] });
    const { posture: _drop, ...rungless } = MEMBER_CTX;
    const admin = sweep('crm_secret', 'update', { ...rungless, permissions: [ADMIN_FULL_ACCESS] });
    await middleware(admin, async () => {});
    expect(admin.tenantLayer0Verdict).toEqual({ kind: 'none' });
    // Same private object, same absent rung, an explicit grant instead of the
    // platform set: the probe finds no platform capability and the wall stands.
    const member = sweep('crm_secret', 'update', { ...rungless, permissions: ['secret_editor'] });
    await middleware(member, async () => {});
    expect(member.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
  });
});

describe('[#15813] nothing is recorded where no wall was composed — absence is a distinct state', () => {
  it('a system context takes the middleware\'s first exit: no verdict member at all', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('crm_task', 'update', { isSystem: true, userId: 'usr_system', tenantId: 'org-1' });
    await middleware(opCtx, async () => {});
    expect(hasVerdict(opCtx)).toBe(false);
  });

  it('a by-id write carries no predicate to compose onto: no verdict member', async () => {
    const { middleware } = await boot();
    const opCtx: any = { object: 'crm_task', operation: 'update', data: { id: 'r1', title: 'x' }, context: { ...MEMBER_CTX } };
    // The pre-image gate re-reads the row through the (fake) engine and refuses
    // a row it cannot see — irrelevant here: the assertion is about what the
    // middleware left on the context, and step 3 is never reached without an ast.
    await middleware(opCtx, async () => {}).catch(() => undefined);
    expect(hasVerdict(opCtx)).toBe(false);
  });

  it('the public `getReadFilter` (no operation context) is byte-identical: the filter is the verdict\'s projection', async () => {
    const { plugin } = await boot();
    expect(await (plugin as any).getReadFilter('crm_task', MEMBER_CTX)).toEqual({ organization_id: 'org-1' });
    expect(await (plugin as any).getReadFilter('sys_catalog', MEMBER_CTX)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [#15887] The four shapes that were correct BY CONSTRUCTION and pinned only
// one layer away. Nothing below claims any of them is broken — every one of
// them holds on `main` today. What was missing is a reading on the RECORDING
// side: each rested on the projection's own pins, i.e. on the identity 「the
// verdict recorded is the object the predicate was projected from」. That
// identity is exactly what a future change to this seam would break first, and
// when it breaks, the projection-side pins stay green.
//
// So each case reads `opCtx.tenantLayer0Verdict` — the recorded object itself,
// never the downstream filter and never `getReadFilter`'s projection — off ONE
// middleware pass, and reads the injected predicate beside it as the control.
// ---------------------------------------------------------------------------
describe('[#15887] the three object shapes record their verdict HERE, not one layer away', () => {
  it('`systemFields.tenant: false` beside an AUTHOR-DECLARED `organization_id` records `none` (P1) — a readable column is not a wall', async () => {
    const { middleware } = await boot();
    // The fixture's premise, asserted rather than recalled: the column really
    // is there to be misread. (That the REGISTRY leaves an authored column
    // standing under this opt-out is the registry's own fact, pinned where the
    // registry lives; here it is the input.)
    expect((SCHEMAS.shared_catalog.fields as Record<string, unknown>).organization_id).toBeDefined();

    const opCtx = sweep('shared_catalog', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();

    // Firing control on the same boot: the sibling with no opt-out IS walled,
    // so `none` above is this object's verdict and not a dead middleware.
    const sibling = sweep('crm_task', 'update', MEMBER_CTX);
    await middleware(sibling, async () => {});
    expect(sibling.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
  });

  it('[#7835] a FEDERATED object carrying the PLATFORM\'s injected anchor records `none` — the phantom column is not a wall', async () => {
    const { middleware } = await boot();
    const opCtx = sweep('ext_customer', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();
  });

  it('[#7835] a FEDERATED object whose AUTHOR declared a real remote `organization_id` records `organization` — the exit is PROVENANCE, not `external`', async () => {
    // The half that keeps the phantom exit from becoming "suppress Layer 0 for
    // every federated object", which would delete a wall that is doing its job.
    const { middleware } = await boot();
    const opCtx = sweep('ext_ledger', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
  });

  it('a custom `tenancy.tenantField` is NOT an exit by itself: still `organization`, and the wall names `organization_id`', async () => {
    // Layer 0 keys on the literal `organization_id` and never reads
    // `tenancy.tenantField`. An object declaring a custom tenant column while
    // still carrying the kernel one is walled on the kernel one — so the
    // recorded verdict names the organization, and the injected predicate names
    // `organization_id`, never `workspace_id`.
    const { middleware } = await boot();
    const opCtx = sweep('workspace_doc', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organization', organizationId: 'org-1' });
    expect(injectedOrgWall(opCtx)).toBe('org-1');
    expect(JSON.stringify(opCtx.ast.where)).not.toContain('workspace_id');
  });

  it('a custom `tenancy.tenantField` on an object carrying NO `organization_id` records `none` — the custom column is never a substitute', async () => {
    // The other direction of the same fact: the declaration does not make
    // `workspace_id` a tenant column the wall can key on, so with the kernel
    // column absent there is no wall — and `none` is the honest verdict, not a
    // wall silently relocated onto the author's column.
    const { middleware } = await boot();
    expect((SCHEMAS.workspace_note.fields as Record<string, unknown>).organization_id).toBeUndefined();
    const opCtx = sweep('workspace_note', 'update', MEMBER_CTX);
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'none' });
    expect(injectedOrgWall(opCtx)).toBeUndefined();
  });
});

describe('[#15887 / ADR-0090 D10] the on-behalf-of INTERSECTION is recorded at the middleware line', () => {
  // `intersectTenantLayer0Verdicts` is unit-pinned in `tenant-layer.test.ts`.
  // What had no pin is the LINE that calls it: that after a delegated pass the
  // recorded verdict is the intersection of the two walls the middleware
  // AND-composed — not the caller's half, which is what the site would record
  // if that call were ever dropped. These cases therefore assert something
  // NEITHER wall states on its own, which a re-run of the unit assertion in
  // this file could not do.
  const DELEGATOR = 'u2';
  // `group` is the only posture in which the two walls can differ: the
  // delegator's `accessible_org_ids` are resolved from ITS OWN memberships and
  // are deliberately not inherited, while `tenantId` is (so under `isolated`
  // both halves resolve to the same organization by construction).
  const GROUP = { posture: 'group' };
  const CALLER_ORGS = ['org-1', 'org-2', 'org-3'];

  it('the recorded verdict is the INTERSECTION — an organization set neither wall names alone', async () => {
    const { middleware } = await boot({
      tenancy: GROUP,
      delegator: { userId: DELEGATOR, memberOf: ['org-2', 'org-3', 'org-9'] },
    });
    const opCtx = sweep('crm_task', 'update', {
      ...MEMBER_CTX,
      accessible_org_ids: CALLER_ORGS,
      onBehalfOf: { userId: DELEGATOR },
    });
    await middleware(opCtx, async () => {});

    // Both walls really were composed onto this one operation, in order.
    expect(injectedOrgWalls(opCtx)).toEqual([
      { $in: ['org-1', 'org-2', 'org-3'] },
      { $in: ['org-2', 'org-3', 'org-9'] },
    ]);
    // And the recorded verdict is what a row must satisfy to clear BOTH — a
    // set that is neither injected clause. Dropping the intersection at the
    // call site records the caller's three organizations while the composed
    // predicate admits two: the recorded verdict would then over-state the
    // batch's reach, on a wall the middleware itself narrowed.
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organizations', organizationIds: ['org-2', 'org-3'] });
  });

  it('the SAME fixture without the delegation link records the caller\'s half — the link is what moves the answer', async () => {
    // Identical boot and identical caller, minus `onBehalfOf`: the case above
    // is a reading about the intersection, not about the `group` posture.
    const { middleware } = await boot({
      tenancy: GROUP,
      delegator: { userId: DELEGATOR, memberOf: ['org-2', 'org-3', 'org-9'] },
    });
    const opCtx = sweep('crm_task', 'update', { ...MEMBER_CTX, accessible_org_ids: CALLER_ORGS });
    await middleware(opCtx, async () => {});
    expect(injectedOrgWalls(opCtx)).toEqual([{ $in: ['org-1', 'org-2', 'org-3'] }]);
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'organizations', organizationIds: CALLER_ORGS });
  });

  it('a delegator with NO membership makes the recorded verdict `deny` — the composed wall fails closed, the caller\'s half does not', async () => {
    // A READ (see `readSweep`): the write twin is refused by the ADR-0123 D2
    // check before the wall is composed, so the write shape cannot observe this
    // at all. The caller's own half names three organizations; the delegator's
    // empty access set denies; the AND of the two admits no row, and the
    // recorded verdict says so rather than naming an organization.
    const { middleware } = await boot({
      tenancy: GROUP,
      delegator: { userId: DELEGATOR, memberOf: [] },
    });
    const opCtx = readSweep('crm_task', {
      ...MEMBER_CTX,
      accessible_org_ids: CALLER_ORGS,
      onBehalfOf: { userId: DELEGATOR },
    });
    await middleware(opCtx, async () => {});
    expect(opCtx.tenantLayer0Verdict).toEqual({ kind: 'deny' });
  });
});
