// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18783] `ISecurityService.getEffectiveObjectPermissions` — the effective
 * object-permission map, and the one producer behind both `/auth/me/permissions`
 * and the map `current_user.can()` reads on the write path.
 *
 * Every case resolves the service the way a cross-package consumer does — off
 * the `ctx.registerService('security', …)` call, as a `Partial` (the contract's
 * availability rule) — never off the plugin instance, so what is pinned is the
 * member a consumer can actually REACH.
 *
 * What the contract member's docblock requires, clause by clause:
 *
 *  - byte-for-byte the `objects` slot of `/auth/me/permissions` — pinned as
 *    equality with `buildEffectiveObjectPermissions` (`@objectstack/core`) over
 *    the same resolution and the same engine, the function the endpoint builds
 *    that slot with (the endpoint's own half is pinned in plugin-hono-server's
 *    `current-user-endpoints-effective-objects.test.ts`);
 *  - the WHOLE map — seeded, covered (a plain `'*'`, #20083), folded, clamped
 *    and annotated, not a slice — and, per cell, the map `current_user.can()`
 *    answers what `PermissionEvaluator.checkObjectPermission` answers (the
 *    parity table at the foot of this file);
 *  - it THROWS on resolution failure and ⛔ never answers `{}`;
 *  - request-scoped: resolved per ask, never cached across requests.
 *
 * And the wiring half: the SAME method is what the plugin registers on the
 * engine, and an engine without the seam is reported, not silently skipped.
 */

import { describe, it, expect, vi } from 'vitest';
import { buildEffectiveObjectPermissions } from '@objectstack/core';
import { ExpressionEngine, toEvalPermissions } from '@objectstack/formula';
import { SysAttachment, SysMember, SysSecret, SysUser, SysUserPreference } from '@objectstack/platform-objects';
import type { ISecurityService } from '@objectstack/spec/contracts';
import { canServeApiOperation } from '@objectstack/spec/data';
import {
  OBJECT_PERMISSION_VERB_NAMES,
  PermissionSetSchema,
  resolveObjectPermissionVerb,
  type PermissionSet,
} from '@objectstack/spec/security';
import { SecurityPlugin } from './security-plugin.js';
import { PermissionEvaluator } from './permission-evaluator.js';
import { defaultPermissionSets } from './objects/default-permission-sets.js';
import { SysPermissionSet, SysPosition } from './objects/index.js';

/** The metadata-declared baseline every member resolves additively. */
const MEMBER_DEFAULT: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { deal: { allowRead: true }, sys_member: { allowRead: true } },
  fields: {},
  systemPermissions: [],
  tabPermissions: {},
} as any;

/**
 * A DB-authored super-user set: a `'*'` wildcard carrying both bypass bits
 * (and, per #8681, no `allowExport`), plus an explicit write-deny on a
 * better-auth object — the shape that makes all four folds fire.
 */
const OPS_ADMIN_ROW = {
  name: 'ops_admin',
  label: 'Ops Admin',
  object_permissions: JSON.stringify({
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
    sys_member: { allowRead: true, allowEdit: false },
  }),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
};

/** A DB-authored plain grant — no wildcard, no bypass. */
const SALES_ROW = {
  name: 'sales',
  label: 'Sales',
  object_permissions: JSON.stringify({ deal: { allowRead: true, allowEdit: true } }),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
};

/**
 * [#20083] A DB-authored PLAIN wildcard — no bypass bit — the shape of the
 * wall-less org admin (`organization_admin_no_bypass`). It names no object, so
 * every entry it contributes is the plain-wildcard coverage pass's.
 */
const OPS_PLAIN_ROW = {
  name: 'ops_plain',
  label: 'Ops (no bypass)',
  object_permissions: JSON.stringify({ '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } }),
  field_permissions: JSON.stringify({}),
  system_permissions: JSON.stringify([]),
  tab_permissions: JSON.stringify({}),
};

/** Registered schemas: one plain, one better-auth-managed, one whose `apiMethods` tighten exposure. */
const SCHEMAS: Record<string, any> = {
  deal: { name: 'deal', label: 'Deal', fields: { id: { name: 'id' } } },
  sys_member: { name: 'sys_member', label: 'Member', managedBy: 'better-auth', fields: { id: { name: 'id' } } },
  report: { name: 'report', label: 'Report', enable: { apiMethods: ['get', 'list'] }, fields: { id: { name: 'id' } } },
};

/** `where` matcher: scalar equality plus the `$in` form the resolver sends; any other operator REFUSES. */
function matches(row: Record<string, unknown>, where: Record<string, unknown> | undefined): boolean {
  return Object.entries(where ?? {}).every(([key, cond]) => {
    if (key.startsWith('$')) throw new Error(`fake engine: unsupported operator ${key}`);
    const value = row[key] ?? null;
    if (cond && typeof cond === 'object' && Array.isArray((cond as { $in?: unknown }).$in)) {
      return ((cond as { $in: unknown[] }).$in).includes(value);
    }
    if (cond && typeof cond === 'object') throw new Error(`fake engine: unsupported condition on ${key}`);
    return value === (cond ?? null);
  });
}

function bootPlugin(
  opts: { dbRows?: Array<Record<string, unknown>>; engineSeam?: boolean; schemas?: Record<string, any> } = {},
) {
  const dbRows = opts.dbRows ?? [];
  const schemas = opts.schemas ?? SCHEMAS;
  const permissionSetReads: string[][] = [];
  const registered: Array<(context: unknown) => Promise<unknown>> = [];
  const ql: any = {
    registerMiddleware: () => {},
    registry: { getAllObjects: () => Object.values(schemas) },
    getSchema: (name: string) => schemas[name] ?? null,
    find: async (object: string, query: any) => {
      const tables: Record<string, Array<Record<string, unknown>>> = { sys_permission_set: dbRows };
      if (object === 'sys_permission_set') permissionSetReads.push(query?.where?.name?.$in ?? []);
      const rows = (tables[object] ?? []).filter((r) => matches(r, query?.where));
      // Hold the caller's bound (`check:objectql-double-limit`).
      return typeof query?.limit === 'number' ? rows.slice(0, query.limit) : rows;
    },
  };
  if (opts.engineSeam !== false) {
    ql.registerEffectiveObjectPermissionsResolver = (fn: (context: unknown) => Promise<unknown>) => registered.push(fn);
  }
  const metadata: any = {
    get: async (_type: string, name: string) => schemas[name] ?? null,
    list: async () => [MEMBER_DEFAULT],
  };
  const services: Record<string, any> = { manifest: { register: vi.fn() }, objectql: ql, metadata };
  const ctx: any = {
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' } as any);
  return { plugin, ctx, ql, permissionSetReads, registered };
}

async function locate(opts?: Parameters<typeof bootPlugin>[0]) {
  const booted = bootPlugin(opts);
  await booted.plugin.init(booted.ctx);
  await booted.plugin.start(booted.ctx);
  const svc = booted.ctx.registerService.mock.calls.find((c: any[]) => c[0] === 'security')?.[1] as Partial<ISecurityService>;
  return { ...booted, svc };
}

/** The endpoint's computation, stated the way `/auth/me/permissions` states it: its sets, its engine. */
function endpointObjects(sets: unknown, ql: any) {
  return buildEffectiveObjectPermissions(sets as any, {
    allSchemas: () => ql.registry.getAllObjects(),
    schemaOf: (name) => ql.getSchema(name),
  });
}

const ADMIN = { userId: 'u_admin', permissions: ['ops_admin'] } as any;
const REP = { userId: 'u_rep', permissions: ['sales'] } as any;
const PLAIN = { userId: 'u_plain', permissions: ['ops_plain'] } as any;

describe('[#18783] getEffectiveObjectPermissions — reachable, and the endpoint\'s answer', () => {
  it('is exposed on the REGISTERED literal, where a cross-package consumer feature-detects it', async () => {
    const { svc } = await locate();
    expect(typeof svc.getEffectiveObjectPermissions).toBe('function');
  });

  it('is BYTE-EQUAL to the /auth/me/permissions computation over the same resolution', async () => {
    const { svc, ql } = await locate({ dbRows: [OPS_ADMIN_ROW, SALES_ROW, OPS_PLAIN_ROW] });
    for (const context of [ADMIN, REP, PLAIN, { userId: 'u_member' }]) {
      const sets = await svc.resolvePermissionSetsForContext!(context);
      const member = await svc.getEffectiveObjectPermissions!(context);
      expect(JSON.stringify(member), context.userId).toBe(JSON.stringify(endpointObjects(sets, ql)));
    }
    // [#20083] …with the plain-wildcard coverage pass firing for the no-bypass subject, so the
    // equality covers it too: `report` is named by no set, and reaches the map through `'*'`.
    const plain: any = await svc.getEffectiveObjectPermissions!(PLAIN);
    expect(plain.report).toMatchObject({ allowRead: true, allowEdit: true });
  });

  it('is the WHOLE map — merged, seeded, folded, clamped and annotated, not a slice', async () => {
    const { svc } = await locate({ dbRows: [OPS_ADMIN_ROW] });
    const map: any = await svc.getEffectiveObjectPermissions!(ADMIN);
    // Fold: the wildcard super-user reaches an object another set named explicitly.
    expect(map.deal).toMatchObject({ allowRead: true, allowEdit: true, allowDelete: true });
    // Seed: a restricting object no set names still gets an entry for a super-user…
    expect(map.report).toMatchObject({ allowRead: true, allowEdit: true });
    // …annotated with its effective operation set.
    expect(Array.isArray(map.report.apiOperations)).toBe(true);
    // Clamp: the better-auth guard wins over the fold on a write the object never opted in.
    expect(map.sys_member).toMatchObject({ allowRead: true, allowEdit: false, allowCreate: false, allowDelete: false });
    // The wildcard itself is carried, as the endpoint serves it.
    expect(map['*']).toMatchObject({ modifyAllRecords: true });
  });

  it('is frozen at the top level and aliases no permission set', async () => {
    const { svc } = await locate({ dbRows: [SALES_ROW] });
    const sets: any[] = await svc.resolvePermissionSetsForContext!(REP);
    const map: any = await svc.getEffectiveObjectPermissions!(REP);
    expect(Object.isFrozen(map)).toBe(true);
    for (const set of sets) {
      for (const entry of Object.values(set.objects ?? {})) {
        expect(Object.values(map)).not.toContain(entry);
      }
    }
  });

  it('an EMPTY map is a real answer: a caller that resolves no set gets `{}`', async () => {
    const { svc } = await locate();
    // No principal ⇒ no additive baseline ⇒ nothing resolves (the middleware's own answer).
    await expect(svc.getEffectiveObjectPermissions!({ positions: [], permissions: [] } as any)).resolves.toEqual({});
  });
});

describe('[#18783] failure stance and scope', () => {
  it('a resolution failure THROWS, untouched — it never degrades to `{}`', async () => {
    const { svc, plugin } = await locate();
    const boom = Object.assign(new Error('permission-set resolution failed'), { status: 503 });
    vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockRejectedValueOnce(boom);
    await expect(svc.getEffectiveObjectPermissions!(REP)).rejects.toBe(boom);
  });

  it('is request-scoped: one resolution per request context, a fresh one for the next request', async () => {
    const { svc, permissionSetReads } = await locate({ dbRows: [SALES_ROW] });
    // The loads that resolve THIS subject's grant (boot-time reads name nothing).
    const salesLoads = () => permissionSetReads.filter((names) => names.includes('sales')).length;
    const before = salesLoads();
    const request1 = { ...REP };
    await svc.getEffectiveObjectPermissions!(request1);
    await svc.getEffectiveObjectPermissions!(request1);
    // Within one request the plugin's per-context memo answers the second ask.
    expect(salesLoads() - before).toBe(1);
    // A new request is a new context object — resolved again, never served from the last one.
    await svc.getEffectiveObjectPermissions!({ ...REP });
    expect(salesLoads() - before).toBe(2);
  });

  it('a grant revoked between two requests is gone from the second map', async () => {
    const rows: Array<Record<string, unknown>> = [SALES_ROW];
    const { svc } = await locate({ dbRows: rows });
    const before: any = await svc.getEffectiveObjectPermissions!({ ...REP });
    expect(before.deal.allowEdit).toBe(true);
    rows.length = 0; // the `sales` set is taken away
    const after: any = await svc.getEffectiveObjectPermissions!({ ...REP });
    expect(after.deal?.allowEdit).not.toBe(true);
  });
});

describe('[#18783] the engine is handed the same producer', () => {
  it('registers ONE resolver on the engine, and it answers exactly what the service answers', async () => {
    const { svc, registered } = await locate({ dbRows: [OPS_ADMIN_ROW, SALES_ROW] });
    expect(registered).toHaveLength(1);
    for (const context of [ADMIN, REP]) {
      const viaEngine = await registered[0](context);
      const viaService = await svc.getEffectiveObjectPermissions!(context);
      expect(JSON.stringify(viaEngine)).toBe(JSON.stringify(viaService));
    }
  });

  it('an engine without the seam is REPORTED at start — absence is loud, not silent', async () => {
    const { ctx, registered } = await locate({ engineSeam: false });
    expect(registered).toHaveLength(0);
    const lines = ctx.logger.warn.mock.calls.map((c: any[]) => String(c[0]));
    expect(lines.some((l: string) => l.includes('registerEffectiveObjectPermissionsResolver'))).toBe(true);
  });
});

/**
 * [#20083] PARITY — the map the member answers, read the way `current_user.can()`
 * reads it, against the server's own verdict, `PermissionEvaluator.checkObjectPermission`,
 * cell by cell: subjects x registered objects x every verb `can()` accepts.
 *
 * The map used to omit every object a subject reached only through a PLAIN `'*'`
 * (one with no super-user bit), so the wall-less org admin's `can('crm_account',
 * 'edit')` answered `false` where the server writes; and it kept a narrower entry
 * wherever one set named the object and another covered it by its wildcard. Both
 * directions are held here, over the shipped sets and the wildcard shapes an
 * author can write:
 *
 *  - EXACT, cell for cell — except that
 *  - on a guarded managed object (`better-auth` / `engine-owned` / `append-only`)
 *    the create / edit / delete verbs may read NARROWER than the evaluator: that
 *    is the managed-write clamp, the engine write guard the permission sets do not
 *    model. There the pin holds the refuse direction only — the map never grants
 *    what the evaluator refuses.
 *
 * [#20134] Subjects whose sets carry a SUPER-USER wildcard are held by the same
 * table, one row per shape: the shipped platform admin and walled org admin, a
 * bare `modifyAllRecords` wildcard, a super-read wildcard carrying plain bits, a
 * super-user wildcard carrying `allowExport` (which the seed used to skip), and
 * a super-user wildcard beside a set naming an object narrower. Their entries
 * used to lack `transfer` (the write bypass grants it) and a super-read
 * wildcard's own plain bits, and the `allowExport` shape had no entry at all for
 * an unrestricted object; each row is now 0 under-granted.
 *
 * The super-user fold is also BROADER than the evaluator in two known places.
 * Both belong to this family's over-grant card (#20136), and both are
 * pre-registered below cell for cell in `KNOWN_OVER_GRANT` — never absorbed
 * into the table's rule: the merged bypass folded into an entry the super-user
 * set itself names narrower, and `allowCreate` pulled on `modifyAllRecords`
 * alone, which the spec's `objectPermissionGrants` gives no create cell.
 */
describe('[#20083] parity: can() over the member\'s map answers what checkObjectPermission answers', () => {
  const REGISTERED: Record<string, any> = {
    // App objects: public, restricted exposure, private posture, API switched off.
    crm_account: { name: 'crm_account', label: 'Account', fields: { name: { type: 'text' } } },
    crm_lead: { name: 'crm_lead', label: 'Lead', fields: { name: { type: 'text' } }, enable: { apiMethods: ['get', 'list'] } },
    crm_secret: { name: 'crm_secret', label: 'Secret', fields: { name: { type: 'text' } }, access: { default: 'private' } },
    crm_hidden: { name: 'crm_hidden', label: 'Hidden', fields: { name: { type: 'text' } }, enable: { apiEnabled: false } },
    // Real platform objects, one per posture the shipped sets treat differently.
    [SysAttachment.name]: SysAttachment,         // public, named by no shipped set
    [SysUserPreference.name]: SysUserPreference, // named by member_default, not by the org admin
    [SysUser.name]: SysUser,                     // better-auth, opts `edit` in
    [SysMember.name]: SysMember,                 // better-auth, write-denied blanket
    [SysSecret.name]: SysSecret,                 // private, engine-owned, named by no shipped set
    [SysPosition.name]: SysPosition,             // the org admin's read-only RBAC rows
    [SysPermissionSet.name]: SysPermissionSet,
  };
  const shipped = (name: string): PermissionSet => {
    const set = defaultPermissionSets.find((ps) => ps.name === name);
    if (!set) throw new Error(`no shipped permission set '${name}'`);
    return set;
  };
  const authored = (name: string, objects: Record<string, unknown>): PermissionSet =>
    PermissionSetSchema.parse({ name, label: name, objects });

  const SUBJECTS: Record<string, PermissionSet[]> = {
    'wall-less org admin': [shipped('organization_admin_no_bypass'), shipped('member_default')],
    'member': [shipped('member_default')],
    'viewer': [shipped('viewer_readonly'), shipped('member_default')],
    'an explicit entry beside another set\'s plain wildcard': [
      authored('reader', { crm_account: { allowRead: true } }),
      authored('wild', { '*': { allowRead: true, allowEdit: true, allowExport: true } }),
    ],
    'one set: a plain wildcard AND a narrower explicit entry': [
      authored('same', { '*': { allowRead: true, allowEdit: true, allowDelete: true }, crm_account: { allowRead: true } }),
    ],
    'an export-only wildcard beside a reader': [
      authored('reader', { crm_account: { allowRead: true } }),
      authored('exporter', { '*': { allowExport: true } }),
    ],
    'a wildcard that grants nothing': [authored('none', { '*': {} })],
    // [#20134] Super-user wildcards.
    'platform admin': [shipped('admin_full_access'), shipped('member_default')],
    'platform admin who is also a wall-less org admin': [
      shipped('admin_full_access'), shipped('organization_admin_no_bypass'), shipped('member_default'),
    ],
    'walled org admin': [shipped('organization_admin'), shipped('member_default')],
    'a bare modify-all wildcard': [authored('modify_all', { '*': { modifyAllRecords: true } })],
    'a super-read wildcard carrying plain bits': [
      authored('view_all_editor', { '*': { viewAllRecords: true, allowEdit: true, allowTransfer: true } }),
    ],
    'a super-user wildcard carrying the export grant': [
      authored('exporting_admin', {
        '*': {
          allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true,
          viewAllRecords: true, modifyAllRecords: true, allowExport: true,
        },
      }),
    ],
    'a super-read wildcard carrying the export grant': [
      authored('exporting_viewer', { '*': { viewAllRecords: true, allowExport: true } }),
    ],
    'an explicit entry beside another set\'s super-user wildcard': [
      authored('reader', { crm_account: { allowRead: true } }),
      authored('super', { '*': { viewAllRecords: true, allowTransfer: true, allowExport: true } }),
    ],
    'one set: a super-user wildcard AND a narrower explicit entry': [
      authored('same_super', {
        '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
        crm_account: { allowRead: true },
      }),
    ],
    // [#20135] The export slot's own shapes.
    'platform admin beside a plain export-only wildcard': [shipped('admin_full_access'), authored('exporter', { '*': { allowExport: true } })],
    'one set: an exporting wildcard AND an explicit entry without the grant': [
      authored('same_export', { '*': { allowRead: true, allowExport: true }, crm_lead: { allowRead: true } }),
    ],
  };

  /**
   * [#20134] KNOWN DIVERGENCE, pre-registered — the super-user fold's two
   * over-grants, both owned by #20136 and both left exactly as they were:
   *
   *  - the merged bypass folded into an entry the super-user set ITSELF names
   *    narrower (`resolveObjectPermission` answers that set with its explicit
   *    entry): the walled org admin's read-only RBAC rows, and the one-set row;
   *  - `allowCreate` pulled on `modifyAllRecords` alone.
   *
   * The assertion below is EXACT, both ways: a cell missing here fails the row,
   * and a cell listed here that no longer diverges fails it too. ⛔ FLIP TRIGGER:
   * when #20136 lands, these rows go red; delete each entry it empties — never
   * widen one to absorb a new cell.
   */
  const WRITE_VERBS = ['create', 'delete', 'edit', 'import', 'remove', 'update', 'write'] as const;
  const CREATE_VERBS = ['create', 'import'] as const;
  const cellsOf = (objects: readonly string[], verbs: readonly string[]) =>
    objects.flatMap((object) => verbs.map((verb) => `${object}.${verb}`));
  const KNOWN_OVER_GRANT: Record<string, readonly string[]> = {
    // `organization_admin` names its RBAC rows read-only; its own `'*'` is folded over them.
    'walled org admin': cellsOf([SysPosition.name, SysPermissionSet.name], WRITE_VERBS),
    // The same shape, authored: the set's `crm_account` entry is its whole answer there.
    'one set: a super-user wildcard AND a narrower explicit entry': cellsOf(['crm_account'], WRITE_VERBS),
    // `modifyAllRecords` has no create cell; the fold pulls `allowCreate` on every unguarded entry
    // (the clamp takes it back on a guarded one).
    'a bare modify-all wildcard': cellsOf(
      ['crm_account', 'crm_lead', 'crm_secret', 'crm_hidden', SysAttachment.name, SysUserPreference.name, SysPosition.name, SysPermissionSet.name],
      CREATE_VERBS,
    ),
  };

  const OPERATION: Record<string, string> = {
    allowRead: 'find', allowCreate: 'insert', allowEdit: 'update', allowDelete: 'delete',
    allowTransfer: 'transfer', allowExport: 'export',
  };
  const GUARDED = new Set(['better-auth', 'engine-owned', 'append-only']);
  const CLAMPED = new Set(['allowCreate', 'allowEdit', 'allowDelete']);
  const USER = { id: 'u_parity', positions: [] as string[] };
  const evaluator = new PermissionEvaluator();

  /** The real `can()`: formula's CEL binding over the published map shape. */
  function can(permissions: ReturnType<typeof toEvalPermissions>, object: string, verb: string): boolean {
    const res = ExpressionEngine.evaluate<boolean>(
      { dialect: 'cel', source: `current_user.can('${object}', '${verb}')` },
      { user: USER, permissions },
    );
    if (!res.ok) throw new Error(`can('${object}', '${verb}') did not evaluate: ${JSON.stringify(res.error)}`);
    return res.value === true;
  }

  it('covers every verb the vocabulary accepts', () => {
    expect([...OBJECT_PERMISSION_VERB_NAMES].sort()).toEqual(
      ['create', 'delete', 'edit', 'export', 'import', 'read', 'remove', 'transfer', 'update', 'write'],
    );
  });

  for (const [label, sets] of Object.entries(SUBJECTS)) {
    it(`${label}: no cell where the map and the evaluator disagree`, async () => {
      const { svc, plugin } = await locate({ schemas: REGISTERED });
      vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(sets);
      const permissions = toEvalPermissions(await svc.getEffectiveObjectPermissions!({ userId: USER.id }));

      const wrong: string[] = [];
      const overGranted: string[] = [];
      let cells = 0;
      for (const schema of Object.values(REGISTERED)) {
        const isPrivate = schema.access?.default === 'private';
        const clamped = GUARDED.has(schema.managedBy);
        for (const verb of OBJECT_PERMISSION_VERB_NAMES) {
          const target = resolveObjectPermissionVerb(verb)!;
          const map = can(permissions, schema.name, verb);
          const server = evaluator.checkObjectPermission(OPERATION[target], schema.name, sets, { isPrivate });
          cells += 1;
          if (map === server) continue;
          // The managed-write clamp may only NARROW, and only on its own verbs.
          if (clamped && CLAMPED.has(target) && server && !map) continue;
          // [#20134] A pre-registered over-grant is collected, then held EXACTLY below.
          if (map && (KNOWN_OVER_GRANT[label] ?? []).includes(`${schema.name}.${verb}`)) {
            overGranted.push(`${schema.name}.${verb}`);
            continue;
          }
          wrong.push(`${schema.name}.${verb}: can()=${map} checkObjectPermission=${server}`);
        }
      }
      expect(cells).toBe(Object.keys(REGISTERED).length * OBJECT_PERMISSION_VERB_NAMES.length);
      expect(wrong).toEqual([]);
      // The flip trigger: the known divergence is exactly what it was registered as.
      expect([...overGranted].sort()).toEqual([...(KNOWN_OVER_GRANT[label] ?? [])].sort());
    });
  }

  it('[#20134] every pre-registered over-grant names a row of the table', () => {
    for (const label of Object.keys(KNOWN_OVER_GRANT)) expect(SUBJECTS, label).toHaveProperty([label]);
  });

  it('[#20134] the reported case, spelled out: the platform admin may transfer, and can() says so', async () => {
    const sets = SUBJECTS['platform admin'];
    const { svc, plugin } = await locate({ schemas: REGISTERED });
    vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(sets);
    const permissions = toEvalPermissions(await svc.getEffectiveObjectPermissions!({ userId: USER.id }));
    // `modifyAllRecords` is the write bypass, and `transfer` is in its class.
    expect(evaluator.checkObjectPermission('transfer', 'crm_account', sets)).toBe(true);
    expect(can(permissions, 'crm_account', 'transfer')).toBe(true);
    // …on a private object too: a super-user wildcard covers it.
    expect(evaluator.checkObjectPermission('transfer', 'crm_secret', sets, { isPrivate: true })).toBe(true);
    expect(can(permissions, 'crm_secret', 'transfer')).toBe(true);
  });

  it('[#20134] a super-user wildcard carrying the export grant: an unrestricted object has an entry, and it answers', async () => {
    const sets = SUBJECTS['a super-user wildcard carrying the export grant'];
    const { svc, plugin } = await locate({ schemas: REGISTERED });
    vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(sets);
    const map: any = await svc.getEffectiveObjectPermissions!({ userId: USER.id });
    const permissions = toEvalPermissions(map);
    for (const [verb, operation] of [['read', 'find'], ['edit', 'update'], ['export', 'export']] as const) {
      expect(evaluator.checkObjectPermission(operation, 'crm_account', sets)).toBe(true);
      expect(can(permissions, 'crm_account', verb), verb).toBe(true);
    }
    // The operation channel still says nothing about an object that keeps its whole closure…
    expect(map.crm_account).not.toHaveProperty('apiOperations');
    // …and still speaks for one whose `apiMethods` narrow it, `export` included.
    expect(map.crm_lead.apiOperations).toEqual(expect.arrayContaining(['get', 'list', 'export']));
  });

  /**
   * [#20135] The `apiOperations` COLUMN — the map's operation set, read the way
   * a client reads it (absent = default-allow), against what the REST door
   * serves, for every subject above × every registered object its map carries
   * an entry for × every operation the door gates by name. The door is asked
   * its own two questions:
   *
   *  - the object half, `canServeApiOperation` — the boolean face of the spec's
   *    `apiExposureDenialReason`, which `@objectstack/rest`'s `enforceApiAccess`
   *    turns into `404 OBJECT_API_DISABLED` / `405 OBJECT_API_METHOD_NOT_ALLOWED`
   *    (this package takes no dependency on the transport, so the door's decision
   *    function is asked, not its envelope);
   *  - the user half on `export`, the security member's own `canExport` — what
   *    `enforceExportPermission` asks before its `403 EXPORT_NOT_PERMITTED`.
   *
   * `offeredRefused` is the security direction — an operation the client offers
   * and the door refuses — and `servedHidden` its converse. Both must be empty.
   * An object with no entry is left out: whether the map carries an entry at all
   * is the seed's question, not this column's.
   *
   * It used to fail two ways: an `enable.apiEnabled: false` object was annotated
   * with its whole closure, or not at all, while the door answers 404 for every
   * verb; and the export slot fell back to the MERGED `'*'` export bit, which
   * offered `export` on a private object only a plain wildcard reached, and on
   * an object the exporting set itself names without the grant.
   */
  const DOOR_OPERATIONS = ['get', 'list', 'create', 'update', 'delete', 'bulk', 'import', 'export'] as const;

  for (const [label, sets] of Object.entries(SUBJECTS)) {
    it(`[#20135] ${label}: apiOperations offers exactly what the REST door serves`, async () => {
      const { svc, plugin } = await locate({ schemas: REGISTERED });
      vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(sets);
      const context = { userId: USER.id };
      const map: any = await svc.getEffectiveObjectPermissions!(context);

      const offeredRefused: string[] = [];
      const servedHidden: string[] = [];
      let cells = 0;
      for (const schema of Object.values(REGISTERED)) {
        const entry = map[schema.name];
        if (!entry) continue;
        for (const operation of DOOR_OPERATIONS) {
          const served = canServeApiOperation(schema.enable, operation)
            && (operation !== 'export' || (await svc.canExport!(schema.name, context)));
          const offered = entry.apiOperations === undefined || entry.apiOperations.includes(operation);
          cells += 1;
          if (offered && !served) offeredRefused.push(`${schema.name}.${operation}`);
          if (served && !offered) servedHidden.push(`${schema.name}.${operation}`);
        }
      }
      // Every registered entry the map carries was scored (a subject granted nothing carries none).
      expect(cells).toBe(Object.keys(map).filter((name) => name in REGISTERED).length * DOOR_OPERATIONS.length);
      expect({ offeredRefused, servedHidden }).toEqual({ offeredRefused: [], servedHidden: [] });
    });
  }

  it('[#20135] the reported cases, spelled out', async () => {
    const context = { userId: USER.id };
    // An API-disabled object: the platform admin's entry stays, and offers nothing.
    const admin = SUBJECTS['platform admin'];
    const a = await locate({ schemas: REGISTERED });
    vi.spyOn(a.plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(admin);
    const adminMap: any = await a.svc.getEffectiveObjectPermissions!(context);
    for (const operation of DOOR_OPERATIONS) expect(canServeApiOperation(REGISTERED.crm_hidden.enable, operation), operation).toBe(false);
    expect(adminMap.crm_hidden.apiOperations).toEqual([]);
    expect(adminMap.crm_hidden).toMatchObject({ allowRead: true, allowEdit: true });

    // The private export: `admin_full_access` beside a plain `'*': { allowExport: true }`.
    const sets = SUBJECTS['platform admin beside a plain export-only wildcard'];
    const b = await locate({ schemas: REGISTERED });
    vi.spyOn(b.plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(sets);
    const map: any = await b.svc.getEffectiveObjectPermissions!(context);
    expect(evaluator.checkObjectPermission('export', SysSecret.name, sets, { isPrivate: true })).toBe(false);
    expect(await b.svc.canExport!(SysSecret.name, context)).toBe(false);
    expect(map[SysSecret.name].apiOperations).not.toContain('export');
    expect(map.crm_secret.apiOperations).not.toContain('export');
    // …and a public object the plain wildcard covers keeps it, on both sides.
    expect(await b.svc.canExport!('crm_lead', context)).toBe(true);
    expect(map.crm_lead.apiOperations).toContain('export');
  });

  it('the wall-less org admin\'s reported case, spelled out: edit on an app object reached only through `*`', async () => {
    const sets = SUBJECTS['wall-less org admin'];
    const { svc, plugin } = await locate({ schemas: REGISTERED });
    vi.spyOn(plugin as any, 'resolvePermissionSetsForContext').mockResolvedValue(sets);
    const permissions = toEvalPermissions(await svc.getEffectiveObjectPermissions!({ userId: USER.id }));
    expect(evaluator.checkObjectPermission('update', 'crm_account', sets)).toBe(true);
    expect(can(permissions, 'crm_account', 'edit')).toBe(true);
    // …and the private object stays out of a plain wildcard's reach on both sides.
    expect(evaluator.checkObjectPermission('find', 'crm_secret', sets, { isPrivate: true })).toBe(false);
    expect(can(permissions, 'crm_secret', 'read')).toBe(false);
  });
});
