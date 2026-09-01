// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12974] The verified platform OWNER crosses the Layer 0 org wall — pins.
 *
 * Maintainer ruling 2026-08-29 (on the tracking card), verbatim and
 * untranslated: 「能不能简单点，对于超级管理员，配置了环境变量邮箱的，在执行墙的
 * 时候不要强制加上 org_id 的过滤」— when plugin-security arms the Layer 0
 * organization wall, the `org_id` filter is NOT appended for a session whose
 * account is the VERIFIED declared platform owner (`OS_PLATFORM_OWNER_EMAIL`
 * under the #11343 verified-email predicate). Everyone else's wall is
 * byte-identical to before.
 *
 * The pins hold BOTH fail-closed directions the ruling records (there is no
 * shape in which a misconfiguration widens access):
 *
 *  - env unset ⇒ nobody bypasses — the wall arms exactly as today, and the
 *    probe performs no row I/O at all;
 *  - email mismatch ⇒ walled (fast negative, no row I/O);
 *  - email matches but the account is NOT verified ⇒ walled;
 *  - verified match ⇒ no `org_id` filter on READS — including the org-less
 *    session that previously hit the fail-closed deny sentinel (the
 *    cloud#1676 "operator console reads EMPTY" shape), and the `group`
 *    union wall;
 *  - the door is READ-ONLY (director's correction on the card): the
 *    WRITE-side Layer 0 twin is KEPT for the owner — an org-less
 *    tenant-scoped write still resolves the deny sentinel that drives the
 *    ADR-0123 D2 403 refusal, and an org-carrying owner write keeps the
 *    equality wall;
 *  - the bypass lifts ONLY Layer 0: authored business RLS (Layer 1) still
 *    binds the owner;
 *  - every wall-bypassing READ computation carries the stable audit event
 *    name (`platform_owner_wall_bypass` — structured warn-level log, the
 *    ruled floor while plugin-audit is not wired into plugin-security).
 *
 * Harness modeled on `federated-tenant-layer0.test.ts`: a real SecurityPlugin
 * over a fake ObjectQL, asserted at `getReadFilter` — the composed
 * FilterCondition before any driver sees it.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PermissionSet } from '@objectstack/spec/security';
import { parsePlatformAdminEmails } from '@objectstack/core';
import { SecurityPlugin } from './security-plugin.js';
import { RLS_DENY_FILTER } from './rls-compiler.js';
import {
  PLATFORM_OWNER_WALL_BYPASS_EVENT,
  isVerifiedPlatformOwnerRow,
  matchesDeclaredOwnerEmail,
} from './platform-owner-wall-bypass.js';

const OWNER_EMAIL = 'operator@corp.example';
/**
 * [#13147] The SECOND declared administrator, and the comma-separated value
 * that declares both. `OS_PLATFORM_OWNER_EMAIL` takes a list (#11663 Choice
 * 2B); every reader of it must answer for EVERY member, and before this card
 * this one answered for none of them — it compared the whole raw list to one
 * candidate address, so nobody crossed the wall.
 */
const SECOND_OWNER = 'ops@corp.example';
const OWNER_LIST = `${OWNER_EMAIL}, ${SECOND_OWNER}`;
/** The parsed config the predicates now take — never a raw operator string. */
const cfg = (raw: string) => parsePlatformAdminEmails(raw);
const SOLO = cfg(OWNER_EMAIL);
const LIST = cfg(OWNER_LIST);

/** A member with plain CRUD and NO row-level policies, so the only thing
 *  `getReadFilter` can return is Layer 0 — the layer under test. */
const PLAIN_MEMBER: PermissionSet = {
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
} as unknown as PermissionSet;

/** A LOCAL tenant object with a real `organization_id` — the wall arms here. */
const TENANT_SCHEMA = {
  name: 'task',
  fields: {
    organization_id: { type: 'text', label: 'Organization' },
    name: { type: 'text', label: 'Name' },
  },
};

/**
 * Boot a SecurityPlugin over a fake ObjectQL. `users` maps sys_user id → row,
 * served through `findOne` (the same by-id system read the plugin performs);
 * the sentinel `org-scoping` service selects the `isolated` posture, `tenancy`
 * overrides it where a case needs `group`.
 */
async function boot(opts: {
  users?: Record<string, any>;
  tenancy?: { posture: string };
  permissionSets?: PermissionSet[];
} = {}) {
  const users = opts.users ?? {};
  const findOne = vi.fn(async (object: string, o: any) =>
    object === 'sys_user' ? (users[o?.where?.id] ?? null) : null,
  );
  const warn = vi.fn();
  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: { registerMiddleware: vi.fn(), getSchema: () => TENANT_SCHEMA, findOne },
    metadata: { get: async () => TENANT_SCHEMA, list: async () => opts.permissionSets ?? [PLAIN_MEMBER] },
    'org-scoping': { name: 'com.objectstack.org-scoping' },
  };
  if (opts.tenancy) services['tenancy'] = opts.tenancy;
  const ctx: Record<string, unknown> = {
    logger: { info: vi.fn(), warn, error: vi.fn() },
    registerService: vi.fn(),
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const plugin = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.init(ctx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await plugin.start(ctx as any);
  return { plugin, findOne, warn };
}

/** Fresh per-test context — the plugin memoizes the owner verdict on it. */
const sessionCtx = (over: Record<string, unknown> = {}) => ({
  userId: 'u_owner',
  email: OWNER_EMAIL,
  tenantId: 'org-1',
  positions: [],
  permissions: [],
  ...over,
});

const readFilter = (plugin: unknown, ctx: unknown) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (plugin as any).getReadFilter('task', ctx);

const OLD_OWNER = process.env.OS_PLATFORM_OWNER_EMAIL;
beforeEach(() => {
  delete process.env.OS_PLATFORM_OWNER_EMAIL;
});
afterEach(() => {
  if (OLD_OWNER === undefined) delete process.env.OS_PLATFORM_OWNER_EMAIL;
  else process.env.OS_PLATFORM_OWNER_EMAIL = OLD_OWNER;
});

describe('[#12974] verified-platform-owner Layer 0 wall bypass — fail-closed directions', () => {
  it('env UNSET ⇒ nobody bypasses: walled exactly as today, and no sys_user row is read', async () => {
    const { plugin, findOne } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx());
    expect(filter).toEqual({ organization_id: 'org-1' });
    // The probe answered on the undeclared env before any I/O.
    expect(findOne).not.toHaveBeenCalled();
  });

  it('email MISMATCH ⇒ walled (fast negative on the server-resolved session email, no row I/O)', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin, findOne } = await boot({
      users: { u_member: { id: 'u_member', email: 'member@corp.example', email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx({ userId: 'u_member', email: 'member@corp.example' }));
    expect(filter).toEqual({ organization_id: 'org-1' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('email matches but the account is NOT verified ⇒ still walled', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin } = await boot({
      // No `email_verified` at all — the #11343 allow-list reads absent as
      // unverified (the imported/legacy-row shape).
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL } },
    });
    const filter = await readFilter(plugin, sessionCtx());
    expect(filter).toEqual({ organization_id: 'org-1' });
  });

  it('session email matches but the sys_user row is GONE ⇒ walled (fail closed)', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin } = await boot({ users: {} });
    const filter = await readFilter(plugin, sessionCtx());
    expect(filter).toEqual({ organization_id: 'org-1' });
  });
});

describe('[#12974] verified-platform-owner Layer 0 wall bypass — the door', () => {
  it('VERIFIED match ⇒ the org_id filter is NOT appended', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx());
    // No Layer 1 policies and Layer 0 lifted → nothing to AND at all.
    expect(filter).toBeUndefined();
  });

  it('org-LESS verified owner under `isolated` ⇒ no fail-closed READ deny sentinel (the cloud#1676 empty-screen shape; the WRITE sentinel stays — see the read-only pins)', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx({ tenantId: undefined }));
    expect(filter).toBeUndefined();
    // The control: the same org-less session WITHOUT the door still fails closed.
    delete process.env.OS_PLATFORM_OWNER_EMAIL;
    const walled = await readFilter(plugin, sessionCtx({ tenantId: undefined }));
    expect(walled).toEqual({ ...RLS_DENY_FILTER });
  });

  it('`group` posture: the verified owner crosses the union wall too', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
      tenancy: { posture: 'group' },
    });
    const filter = await readFilter(plugin, sessionCtx({ accessible_org_ids: ['org-1', 'org-2'] }));
    expect(filter).toBeUndefined();
    // The control: a non-owner member keeps the membership union.
    const member = await readFilter(
      plugin,
      sessionCtx({ userId: 'u_m', email: 'member@corp.example', accessible_org_ids: ['org-1', 'org-2'] }),
    );
    expect(member).toEqual({ organization_id: { $in: ['org-1', 'org-2'] } });
  });

  it('absent session email: the sys_user row is the authoritative answer', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin, findOne } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx({ email: undefined }));
    expect(filter).toBeUndefined();
    expect(findOne).toHaveBeenCalledWith('sys_user', expect.objectContaining({ where: { id: 'u_owner' } }));
  });
});

describe('[#12974] the bypass lifts ONLY Layer 0', () => {
  it('an authored Layer 1 (business RLS) policy still binds the verified owner', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const authored: PermissionSet = {
      name: 'member_default',
      label: 'Member',
      objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
      rowLevelSecurity: [
        { name: 'app_name_scope', object: '*', operation: 'all', using: 'name == current_user.id' },
      ],
    } as unknown as PermissionSet;
    const { plugin } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
      permissionSets: [authored],
    });
    const filter = await readFilter(plugin, sessionCtx());
    // Layer 0 gone, Layer 1's authored predicate intact — no `$and`, no org column.
    expect(filter).toEqual({ name: 'u_owner' });
  });

  it('the WRITE-side Layer 0 twin is KEPT for the owner: the org wall and the org-less deny sentinel both stand', async () => {
    // Director's correction on the card (after the dogfood gate red): the door
    // is READ-only. The write twin feeds the ADR-0123 D2 refusal — an org-less
    // tenant-scoped write must refuse 403 naming the missing active
    // organization, for the owner exactly as for everyone else; lifting it
    // would mint the NULL-organization rows the platform is eliminating (and
    // measurably turned that refusal into a 500 on the dogfood rig).
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    // Org-carrying owner write: the equality wall stands.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const owner = await (plugin as any).computeWriteTenantCheckFilter([PLAIN_MEMBER], 'task', 'update', sessionCtx());
    expect(owner).toEqual({ organization_id: 'org-1' });
    // Org-LESS owner write: the deny sentinel stands — this is the exact
    // verdict the ADR-0123 D2 refusal derives its 403 from.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ownerOrgless = await (plugin as any).computeWriteTenantCheckFilter(
      [PLAIN_MEMBER],
      'task',
      'insert',
      sessionCtx({ tenantId: undefined }),
    );
    expect(ownerOrgless).toEqual({ ...RLS_DENY_FILTER });
    // Everyone else: unchanged, same wall.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const member = await (plugin as any).computeWriteTenantCheckFilter(
      [PLAIN_MEMBER],
      'task',
      'update',
      sessionCtx({ userId: 'u_m', email: 'member@corp.example' }),
    );
    expect(member).toEqual({ organization_id: 'org-1' });
  });
});

describe('[#12974] audit — the ruled floor', () => {
  it('a wall-bypassing READ emits the stable event name; a walled read and an owner WRITE do not', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_EMAIL;
    const { plugin, warn } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    const bypassEvents = () =>
      warn.mock.calls.filter(([, meta]) => meta?.event === PLATFORM_OWNER_WALL_BYPASS_EVENT);
    await readFilter(plugin, sessionCtx({ userId: 'u_m', email: 'member@corp.example' }));
    expect(bypassEvents()).toHaveLength(0);
    // Owner WRITE: no bypass happens, so no event may claim one did.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (plugin as any).computeWriteTenantCheckFilter([PLAIN_MEMBER], 'task', 'update', sessionCtx());
    expect(bypassEvents()).toHaveLength(0);
    await readFilter(plugin, sessionCtx());
    const fired = bypassEvents();
    expect(fired.length).toBeGreaterThan(0);
    expect(fired[0][1]).toMatchObject({
      event: PLATFORM_OWNER_WALL_BYPASS_EVENT,
      object: 'task',
      userId: 'u_owner',
      suppressedFilter: { organization_id: 'org-1' },
    });
  });
});

describe('[#12974] the shared row predicate (the per-request derivation’s twin)', () => {
  it('matchesDeclaredOwnerEmail — canonical comparison: trimmed, case-insensitive', () => {
    expect(matchesDeclaredOwnerEmail({ email: 'Operator@Corp.Example' }, SOLO)).toBe(true);
    expect(matchesDeclaredOwnerEmail({ email: '  operator@corp.example  ' }, SOLO)).toBe(true);
    expect(matchesDeclaredOwnerEmail({ email: OWNER_EMAIL }, cfg('Operator@CORP.example'))).toBe(true);
    expect(matchesDeclaredOwnerEmail({ email: 'other@corp.example' }, SOLO)).toBe(false);
    expect(matchesDeclaredOwnerEmail({ email: '' }, SOLO)).toBe(false);
    expect(matchesDeclaredOwnerEmail({ email: 42 }, SOLO)).toBe(false);
    expect(matchesDeclaredOwnerEmail({}, SOLO)).toBe(false);
    expect(matchesDeclaredOwnerEmail(null, SOLO)).toBe(false);
  });

  it('isVerifiedPlatformOwnerRow — match AND verified, fail-closed on every other shape', () => {
    expect(isVerifiedPlatformOwnerRow({ email: OWNER_EMAIL, email_verified: true }, SOLO)).toBe(true);
    expect(isVerifiedPlatformOwnerRow({ email: OWNER_EMAIL, email_verified: 1 }, SOLO)).toBe(true);
    expect(isVerifiedPlatformOwnerRow({ email: OWNER_EMAIL }, SOLO)).toBe(false);
    expect(isVerifiedPlatformOwnerRow({ email: OWNER_EMAIL, email_verified: false }, SOLO)).toBe(false);
    expect(isVerifiedPlatformOwnerRow({ email: 'other@corp.example', email_verified: true }, SOLO)).toBe(false);
    expect(isVerifiedPlatformOwnerRow(null, SOLO)).toBe(false);
  });

  // ─────────────────────────────────────────────────────────────────────────
  it('[#13147] a comma-separated LIST matches EVERY member — the defect, at the predicate', () => {
    // Red before the fix in the loudest possible way: the comparator held the
    // whole raw value as one address, so BOTH of these answered false and the
    // Layer 0 wall stayed armed against both declared administrators.
    expect(matchesDeclaredOwnerEmail({ email: OWNER_EMAIL }, LIST)).toBe(true);
    expect(matchesDeclaredOwnerEmail({ email: SECOND_OWNER }, LIST)).toBe(true);
    expect(isVerifiedPlatformOwnerRow({ email: SECOND_OWNER, email_verified: true }, LIST)).toBe(true);
    // Still every fail-closed direction: a stranger, and the raw list itself
    // (which is not an address and must never be treated as one).
    expect(matchesDeclaredOwnerEmail({ email: 'stranger@corp.example' }, LIST)).toBe(false);
    expect(matchesDeclaredOwnerEmail({ email: OWNER_LIST }, LIST)).toBe(false);
    // A REFUSED list confers nothing on anybody (Choice 2B: the WHOLE variable
    // fails closed, never the one bad entry).
    expect(matchesDeclaredOwnerEmail({ email: OWNER_EMAIL }, cfg(`${OWNER_EMAIL},nonsense`))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('[#13147] the Layer 0 wall bypass under a comma-separated OS_PLATFORM_OWNER_EMAIL', () => {
  it('the SECOND declared administrator crosses the wall (before: a list let nobody across)', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_LIST;
    const { plugin } = await boot({
      users: { u_two: { id: 'u_two', email: SECOND_OWNER, email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx({ userId: 'u_two', email: SECOND_OWNER }));
    // No Layer 1 policies and Layer 0 lifted → nothing to AND at all.
    expect(filter).toBeUndefined();
  });

  it('the FIRST declared administrator still crosses it', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_LIST;
    const { plugin } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    expect(await readFilter(plugin, sessionCtx())).toBeUndefined();
  });

  it('⛔ nobody else does: a stranger is still walled, and the fast negative still spends no row read', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_LIST;
    const { plugin, findOne } = await boot({
      users: { u_member: { id: 'u_member', email: 'member@corp.example', email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx({ userId: 'u_member', email: 'member@corp.example' }));
    expect(filter).toEqual({ organization_id: 'org-1' });
    expect(findOne).not.toHaveBeenCalled();
  });

  it('⛔ a list member whose account is NOT verified is still walled', async () => {
    process.env.OS_PLATFORM_OWNER_EMAIL = OWNER_LIST;
    const { plugin } = await boot({ users: { u_two: { id: 'u_two', email: SECOND_OWNER } } });
    const filter = await readFilter(plugin, sessionCtx({ userId: 'u_two', email: SECOND_OWNER }));
    expect(filter).toEqual({ organization_id: 'org-1' });
  });

  it('⛔ a REFUSED list declares nobody: an unparseable entry walls every member', async () => {
    // Choice 2B's whole-variable refusal reaching the wall — the operator gets
    // the parser's one loud line, and NOT a silently narrower admin set.
    process.env.OS_PLATFORM_OWNER_EMAIL = `${OWNER_EMAIL},not-an-email`;
    const { plugin, findOne } = await boot({
      users: { u_owner: { id: 'u_owner', email: OWNER_EMAIL, email_verified: true } },
    });
    const filter = await readFilter(plugin, sessionCtx());
    expect(filter).toEqual({ organization_id: 'org-1' });
    expect(findOne).not.toHaveBeenCalled();
  });
});
