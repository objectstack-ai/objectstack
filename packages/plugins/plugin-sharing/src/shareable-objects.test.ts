// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30209 row 5 B] The objects a sharing rule can take effect on, and the door
 * that serves them, `GET /api/v1/sharing/shareable-objects`.
 *
 * Real `ObjectQL` + `SqlDriver` (better-sqlite3 `:memory:`) holding the object
 * shapes the save-time refusal distinguishes, with the real `SharingService`
 * and `SharingRuleService`, and the save doors' guard bound — so "listed" is
 * compared with what a save actually does, not with a restatement of it.
 *
 *  - the list holds exactly the objects the save doors admit a rule on;
 *    every object it leaves out is one `defineRule` refuses with
 *    `SHARING_NOT_ENABLED` (the one-verdict pin);
 *  - business objects come before platform objects, each group by label;
 *  - the platform's credential and session objects (as their packages declare
 *    them) are not listed, and a rule on any of them is refused at save;
 *  - the sharing-rule surface's admission decides who may ask;
 *  - the door: anonymous, a held sign-in and a query parameter are refused by
 *    envelope before the list is read; a member without the admin surface is
 *    refused `PERMISSION_DENIED` through the real resolver and the real
 *    service; an administrator resolved the same way is served the list.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { bindSecurityCatalogReader, type SecurityCatalogReader } from '@objectstack/core';
import { SysSecret } from '@objectstack/platform-objects';
import {
  SysAccount, SysApiKey, SysJwks, SysOauthAccessToken, SysOauthApplication, SysOauthConsent, SysSession,
  SysTwoFactor, SysVerification,
} from '@objectstack/platform-objects/identity';
import { ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';

import { SharingService } from './sharing-service.js';
import { SharingRuleService } from './sharing-rule-service.js';
import { bindRuleObjectEnforcementGuard } from './rule-hooks.js';
import { listShareableObjects, ShareableObjectsUnavailableError, SharingRulesNotRunningError } from './shareable-objects.js';
import { SHAREABLE_OBJECTS_ROUTE, registerShareableObjectsRoutes } from './shareable-objects-routes.js';

const ORG = 'org_30209';

const ADMIN = {
  userId: 'usr_admin', organizationId: ORG, tenantId: ORG,
  positions: [], permissions: [], systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;
const LEGACY_ADMIN = { ...ADMIN, systemPermissions: ['manage_platform_settings'] } as unknown as ExecutionContext;
const MEMBER = { ...ADMIN, userId: 'usr_member', systemPermissions: [] } as unknown as ExecutionContext;
/** Holds the org-scoped capability but resolved no organization (ADR-0111 D6 / #8158). */
const ORGLESS_ADMIN = {
  userId: 'usr_orgless', positions: [], permissions: [], systemPermissions: ['manage_sharing'],
} as unknown as ExecutionContext;

const text = (name: string) => ({ type: 'text', name, label: name });
const silent: any = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return silent; } };

/** Every object the boot registers, by the verdict the save doors give a rule on it. */
const ADMITTED = {
  /** private model + owner: the ordinary enforced business object. */
  deal: 'os30209_deal',
  /** a second business object, to pin the label order (label "Account" < "Deal"). */
  account: 'os30209_account',
  /** public model WITH an owner column: admitted (its external members are still granted). */
  notice: 'os30209_notice',
  /** a platform object under enforcement: listed, after the business objects. */
  sysCase: 'sys_os30209_case',
} as const;
const REFUSED = {
  /** the `sys_session` shape: no owner, no model. */
  session: 'os30209_session',
  /** a platform object that bypasses record sharing (plugin default bypass list). */
  sysUser: 'sys_user',
  /** a detail under its master. */
  line: 'os30209_line',
  /** the sharing-rule store itself: `isSystem` with no model (public) and no owner. */
  rule: 'sys_sharing_rule',
} as const;

const RULE_FIELDS = Object.fromEntries(
  ['organization_id', 'name', 'label', 'description', 'object_name', 'criteria_json', 'recipient_type',
    'recipient_id', 'access_level', 'managed_by', 'created_at', 'updated_at'].map((f) => [f, text(f)]),
);

const open: SqlDriver[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.disconnect().catch(() => undefined);
  vi.restoreAllMocks();
});

async function boot() {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  open.push(driver);
  const ql = new ObjectQL({ logger: silent });
  ql.registerDriver(driver as never, true);
  await ql.init();
  ql.setTenancyPostureProvider(() => 'single');
  const recordFields = { id: { ...text('id'), primary: true }, stage: text('stage'), organization_id: text('organization_id') };
  const owned = { ...recordFields, owner_id: text('owner_id') };
  ql.registerObject({ name: ADMITTED.deal, label: 'Deal', sharingModel: 'private', fields: owned } as never);
  ql.registerObject({ name: ADMITTED.account, label: 'Account', sharingModel: 'read', fields: owned } as never);
  ql.registerObject({ name: ADMITTED.notice, label: 'Notice', sharingModel: 'public_read_write', fields: owned } as never);
  ql.registerObject({ name: ADMITTED.sysCase, label: 'Case', isSystem: true, sharingModel: 'private', fields: owned } as never);
  ql.registerObject({ name: REFUSED.session, label: 'Session', ownership: 'none', fields: recordFields } as never);
  ql.registerObject({ name: REFUSED.sysUser, label: 'User', isSystem: true, sharingModel: 'private', fields: owned } as never);
  ql.registerObject({
    name: REFUSED.line, label: 'Line', sharingModel: 'controlled_by_parent', fields: owned,
  } as never);
  ql.registerObject({
    name: REFUSED.rule, label: 'Sharing Rule', isSystem: true,
    fields: { id: { ...text('id'), primary: true }, ...RULE_FIELDS, active: { type: 'boolean', name: 'active', label: 'Active' } },
  } as never);
  await driver.initObjects([REFUSED.rule].map((name) => ({ name, fields: (ql as any).getSchema(name).fields }) as never));
  const sharing = new SharingService({ engine: ql as never });
  const rules = new SharingRuleService({ engine: ql as never, sharing });
  bindRuleObjectEnforcementGuard(ql as never, sharing);
  return { ql, rules, sharing };
}

const names = (list: Array<{ name: string }>) => list.map((o) => o.name);

describe('[#30209] the objects a sharing rule can take effect on — the list', () => {
  it('lists the admitted objects, business first and each group by label, and none of the refused ones', async () => {
    const { rules } = await boot();
    const listed = rules.listShareableObjects(ADMIN);
    expect(listed).toEqual([
      { name: ADMITTED.account, label: 'Account', system: false },
      { name: ADMITTED.deal, label: 'Deal', system: false },
      { name: ADMITTED.notice, label: 'Notice', system: false },
      { name: ADMITTED.sysCase, label: 'Case', system: true },
    ]);
    for (const refused of Object.values(REFUSED)) expect(names(listed)).not.toContain(refused);
  });

  it('one verdict: every object left out is one defineRule refuses with SHARING_NOT_ENABLED, every listed one it does not', async () => {
    const { ql, rules } = await boot();
    const listed = new Set(names(rules.listShareableObjects(ADMIN)));
    const registered = Object.keys((ql as any).getConfigs());
    expect(registered.length).toBeGreaterThanOrEqual(8);
    for (const object of registered) {
      const err = await rules.defineRule({
        name: `r_${object}`, label: object, object, recipientType: 'position', recipientId: 'sales_rep',
        criteria: { stage: 'won' },
      } as never, ADMIN).then(() => undefined, (x: unknown) => x as Error & { code?: string; status?: number });
      const refusedForObject = err?.code === 'SHARING_NOT_ENABLED' && err?.status === 422;
      expect(refusedForObject, `${object}: listed=${listed.has(object)} defineRule=${err?.message ?? 'saved'}`)
        .toBe(!listed.has(object));
    }
  });

  it('a platform object is one the registry marks isSystem or one named sys_', () => {
    const configs = {
      zeta: { name: 'zeta', label: 'Zeta' },
      sys_alpha: { name: 'sys_alpha', label: 'Alpha' },
      flagged: { name: 'flagged', label: 'Beta', isSystem: true },
      bare: { name: 'bare' },
    };
    expect(listShareableObjects({ getConfigs: () => configs }, () => null)).toEqual([
      { name: 'bare', label: 'bare', system: false },
      { name: 'zeta', label: 'Zeta', system: false },
      { name: 'sys_alpha', label: 'Alpha', system: true },
      { name: 'flagged', label: 'Beta', system: true },
    ]);
  });

  it('an engine that cannot enumerate its objects is told so, never answered with an empty list', () => {
    expect(() => listShareableObjects({}, () => null)).toThrow(ShareableObjectsUnavailableError);
  });
});

describe('[#30209] objects holding credentials and sessions are not listed, and a rule on them is refused', () => {
  /** The platform's credential and session objects, as their packages declare them. */
  const CREDENTIAL_OBJECTS = [
    SysSession, SysAccount, SysVerification, SysApiKey, SysTwoFactor,
    SysOauthApplication, SysOauthAccessToken, SysOauthConsent, SysJwks, SysSecret,
  ];

  it('none of them is listed, and defineRule refuses each with SHARING_NOT_ENABLED 422', async () => {
    const { ql, rules } = await boot();
    for (const def of CREDENTIAL_OBJECTS) ql.registerObject(def as never);
    const credentialNames = CREDENTIAL_OBJECTS.map((d) => (d as { name: string }).name);
    expect(credentialNames).toEqual(expect.arrayContaining(['sys_session', 'sys_account', 'sys_api_key', 'sys_secret']));
    for (const name of credentialNames) expect((ql as any).getSchema(name), `${name} registered`).toBeTruthy();

    const listed = names(rules.listShareableObjects(ADMIN));
    expect(listed.filter((n) => credentialNames.includes(n))).toEqual([]);
    // CONTROL: the same list still serves the enforced objects beside them.
    expect(listed).toContain(ADMITTED.deal);

    for (const object of credentialNames) {
      const err = await rules.defineRule({
        name: `r_${object}`, label: object, object, recipientType: 'position', recipientId: 'sales_rep',
        criteria: { id: 'x' },
      } as never, ADMIN).then(() => undefined, (x: unknown) => x as Error & { code?: string; status?: number });
      expect([err?.code, err?.status], `${object}: ${err?.message ?? 'saved'}`).toEqual(['SHARING_NOT_ENABLED', 422]);
    }
  });
});

describe('[#30209] the list is admitted as the sharing-rule surface admits', () => {
  it('a member without manage_sharing is refused PERMISSION_DENIED', async () => {
    const { rules } = await boot();
    expect(() => rules.listShareableObjects(MEMBER)).toThrow(/^PERMISSION_DENIED: .*manage_sharing/);
  });

  it('a manage_sharing holder with no organization resolved is refused PERMISSION_DENIED', async () => {
    const { rules } = await boot();
    expect(() => rules.listShareableObjects(ORGLESS_ADMIN)).toThrow(/^PERMISSION_DENIED: .*active organization/);
  });

  it('CONTROL: the legacy manage_platform_settings gate is admitted, as on every verb of the surface', async () => {
    const { rules } = await boot();
    expect(names(rules.listShareableObjects(LEGACY_ADMIN))).toContain(ADMITTED.deal);
  });
});

// ── the door ────────────────────────────────────────────────────────────────

/** The sessions the fake auth service knows, by bearer token. */
const SESSIONS: Record<string, { userId: string; authGate?: { code: string; message: string } }> = {
  admin: { userId: 'usr_admin' },
  member: { userId: 'usr_member' },
  held: { userId: 'usr_admin', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
};

/** The one permission set this rig's catalog serves: it confers the sharing-rule admin capability. */
const SHARING_ADMIN_SET = 'os30209_sharing_admin';

function catalogServing(): SecurityCatalogReader {
  const entry = { type: 'permission', name: SHARING_ADMIN_SET, definition: { name: SHARING_ADMIN_SET, systemPermissions: ['manage_sharing'] }, source: 'registry' };
  return {
    async resolve(type: string, name: string) {
      return type === 'permission' && name === SHARING_ADMIN_SET ? entry : undefined;
    },
    async list(type: string) {
      return type === 'permission' ? [entry] : [];
    },
  } as unknown as SecurityCatalogReader;
}

/**
 * The grant store the platform resolver reads the caller's grants from: the
 * administrator holds {@link SHARING_ADMIN_SET} in {@link ORG}, the member
 * holds nothing; both are members of {@link ORG}.
 */
function grantStore() {
  const rows: Record<string, Array<Record<string, unknown>>> = {
    sys_user_permission_set: [{ id: 'ups_admin', user_id: 'usr_admin', permission_set: SHARING_ADMIN_SET, organization_id: ORG }],
    sys_member: [
      { id: 'm_admin', user_id: 'usr_admin', organization_id: ORG, role: 'member' },
      { id: 'm_member', user_id: 'usr_member', organization_id: ORG, role: 'member' },
    ],
  };
  const matches = (row: Record<string, unknown>, where: unknown): boolean => {
    if (!where || typeof where !== 'object') return true;
    return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
      if (k === '$and' && Array.isArray(v)) return v.every((w) => matches(row, w));
      if (k === '$or' && Array.isArray(v)) return v.some((w) => matches(row, w));
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const op = v as Record<string, unknown>;
        if ('$in' in op && Array.isArray(op.$in)) return op.$in.includes(row[k]);
        if ('$eq' in op) return row[k] === op.$eq;
        return true;
      }
      return row[k] === v;
    });
  };
  const store = {
    find: async (object: string, opts?: { where?: unknown; filter?: unknown; limit?: number }) => {
      const matched = (rows[object] ?? []).filter((r) => matches(r, opts?.where ?? opts?.filter));
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
    findOne: async (object: string, opts?: { where?: unknown; filter?: unknown }) =>
      (rows[object] ?? []).find((r) => matches(r, opts?.where ?? opts?.filter)) ?? null,
  };
  bindSecurityCatalogReader(store, catalogServing());
  return store;
}

function door(list: (context: ExecutionContext) => ReturnType<SharingRuleService['listShareableObjects']>) {
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const http = {
    get: vi.fn((path: string, handler: (req: unknown, res: unknown) => Promise<void>) => handlers.set(`GET ${path}`, handler)),
    post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn(),
  };
  const auth = {
    api: {
      getSession: vi.fn(async (input: { headers: Headers }) => {
        const bearer = input.headers.get('authorization')?.replace(/^Bearer /, '');
        const s = bearer ? SESSIONS[bearer] : undefined;
        if (!s) return null;
        return {
          user: { id: s.userId, email: `${s.userId}@example.test`, ...(s.authGate ? { authGate: s.authGate } : {}) },
          session: { id: `ses_${bearer}`, userId: s.userId, activeOrganizationId: ORG },
        };
      }),
    },
  };
  const listSpy = vi.fn(list);
  const store = grantStore();
  registerShareableObjectsRoutes(http as never, {
    getEngine: () => store,
    getAuth: () => auth as never,
    tenancy: undefined,
    listShareableObjects: listSpy,
  });

  async function call(opts: { bearer?: string; query?: Record<string, string> } = {}) {
    const handler = handlers.get(`GET ${SHAREABLE_OBJECTS_ROUTE}`);
    if (!handler) throw new Error('the door mounted no GET handler at its route');
    const answer: { status: number; body: any } = { status: 0, body: undefined };
    const res = {
      status: (code: number) => { answer.status = code; return res; },
      json: (body: unknown) => { answer.body = body; },
      header: () => res,
      send: () => undefined,
    };
    await handler(
      {
        params: {},
        query: opts.query ?? {},
        headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
        method: 'GET',
        path: SHAREABLE_OBJECTS_ROUTE,
      },
      res,
    );
    expect(envelopeViolations(answer.body), JSON.stringify(answer.body)).toEqual([]);
    return answer;
  }

  return { call, listSpy };
}

/** The refusal envelope's `code` and `status`, after checking the error parses as the declared `ApiError`. */
function envelope(answer: { status: number; body: any }): [unknown, number] {
  expect(answer.body?.success).toBe(false);
  expect(ApiErrorSchema.safeParse(answer.body.error).success, JSON.stringify(answer.body.error)).toBe(true);
  return [answer.body.error.code, answer.status];
}

describe('[#30209] the shareable-objects door — mounted', () => {
  it('registers exactly one route: GET /api/v1/sharing/shareable-objects', () => {
    const http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn() };
    registerShareableObjectsRoutes(http as never, {} as never);
    expect(http.get.mock.calls.map((c) => c[0])).toEqual(['/api/v1/sharing/shareable-objects']);
    for (const verb of ['post', 'put', 'patch', 'delete', 'use'] as const) expect(http[verb]).not.toHaveBeenCalled();
  });
});

describe('[#30209] the shareable-objects door — answers', () => {
  it('serves an administrator the list, through the platform resolver and the real service', async () => {
    const { rules } = await boot();
    const d = door((context) => rules.listShareableObjects(context));
    const answer = await d.call({ bearer: 'admin' });
    expect(answer.status, JSON.stringify(answer.body)).toBe(200);
    expect(answer.body.success).toBe(true);
    expect(names(answer.body.data.objects)).toEqual([ADMITTED.account, ADMITTED.deal, ADMITTED.notice, ADMITTED.sysCase]);
    // The context the service received is the resolved administrator, organization included.
    const [context] = d.listSpy.mock.calls[0]!;
    expect(context.userId).toBe('usr_admin');
    expect(context.tenantId).toBe(ORG);
    expect(context.systemPermissions).toContain('manage_sharing');
  });

  it('refuses a member without the sharing-rule admin surface 403 PERMISSION_DENIED, and lists nothing', async () => {
    const { rules } = await boot();
    const d = door((context) => rules.listShareableObjects(context));
    const answer = await d.call({ bearer: 'member' });
    expect(envelope(answer)).toEqual(['PERMISSION_DENIED', 403]);
    expect(answer.body.error.message).toMatch(/manage_sharing/);
    expect(answer.body.data).toBeUndefined();
  });

  it('refuses an anonymous caller 401 UNAUTHENTICATED before the list is read', async () => {
    const d = door(() => { throw new Error('must not be read'); });
    expect(envelope(await d.call())).toEqual(['UNAUTHENTICATED', 401]);
    expect(d.listSpy).not.toHaveBeenCalled();
  });

  it('refuses a held sign-in 403 with the policy code before the list is read', async () => {
    const d = door(() => { throw new Error('must not be read'); });
    expect(envelope(await d.call({ bearer: 'held' }))).toEqual(['PASSWORD_EXPIRED', 403]);
    expect(d.listSpy).not.toHaveBeenCalled();
  });

  it('refuses a query parameter 400 VALIDATION_ERROR naming it, never ignoring it', async () => {
    const d = door(() => { throw new Error('must not be read'); });
    const answer = await d.call({ bearer: 'admin', query: { object: 'os30209_deal' } });
    expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
    expect(answer.body.error.message).toContain("'object'");
    expect(d.listSpy).not.toHaveBeenCalled();
  });

  it('answers 501 NOT_IMPLEMENTED when no sharing-rule service runs, never an empty list', async () => {
    const d = door(() => { throw new SharingRulesNotRunningError(); });
    const answer = await d.call({ bearer: 'admin' });
    expect(envelope(answer)).toEqual(['NOT_IMPLEMENTED', 501]);
    expect(answer.body.data).toBeUndefined();
  });

  it('answers a list that cannot be read 500 INTERNAL_ERROR, never an empty list', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const d = door(() => { throw new ShareableObjectsUnavailableError(); });
    const answer = await d.call({ bearer: 'admin' });
    expect(envelope(answer)).toEqual(['INTERNAL_ERROR', 500]);
    expect(answer.body.data).toBeUndefined();
  });
});
