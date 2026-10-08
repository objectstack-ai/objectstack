// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#8158] The HTTP-layer proof that a `manage_sharing` holder whose session
// carries no ACTIVE organization does not read every tenant's sharing rules.
//
// ## What was open
//
// `SharingRuleService` decided its admin read scope on the ABSENCE OF AN ORG
// ID (`if (!orgId) return where` in `adminOrgScope`, and the same shape in
// `getRule` / `findRuleRowByName`). That unfiltered branch exists for
// `SYSTEM_CTX` — boot seeding, hooks, backfills — but it was reached on
// capability, not on system-ness, and the ADR-0111 D6 gate admits any caller
// holding the org-scoped `manage_sharing` capability. An authenticated,
// non-system caller arriving with neither `organizationId` nor `tenantId`
// therefore got the system read scope: every organization's rules, resolvable
// by id and by name, and evaluable — which reconciles `sys_record_share`, so a
// cross-tenant WRITE.
//
// ## Why this file exists at all — the card filed its own gap
//
// > Whether a real deployment can hand an authenticated `manage_sharing`
// > holder a session with no `activeOrganizationId` is **not** measured here —
// > only that the resolver and the service both permit it.
//
// This file is that measurement, taken through the real login path rather than
// inferred from reading the resolver. Every step below is the product's own:
// better-auth `sign-up` / `sign-in` mint the session, `session.create.before`
// (ADR-0093 D9) is the hook that would have stamped an active organization and
// declines to because the user holds no `sys_member` row, `resolveAuthzContext`
// turns that session into the execution context, and the REST route is the one
// the Setup sharing pages call. Nothing here is simulated, and the
// PRECONDITION tests below assert each link rather than assuming it.
//
// The user shape is ordinary, not contrived: a permission-set grant
// (`sys_user_permission_set`) is independent of organization MEMBERSHIP. A
// multi-org deployment (whose membership reconciler binds nobody — ADR-0093
// D1 `no-target-org`), an `invite-only` deployment, a user removed from their
// organization, or an SSO JIT user pending placement all produce a caller with
// no active organization.
//
// [#20515] What such a caller HOLDS changed underneath this file. When #8158
// was filed, `resolveUserAuthzGrants` kept an ORGANIZATION-scoped grant for a
// caller with no active organization (`!(org && tenantId && org !== tenantId)`
// read "no tenant" as "every organization"), so an org-scoped `manage_sharing`
// reached `adminOrgScope`. It no longer does: with no active organization only
// GLOBAL grants apply. So the two faces are pinned separately below —
//   - the EXPOSED persona holds `manage_sharing` through a GLOBAL grant, the one
//     way an org-less caller still holds it, and keeps pinning `adminOrgScope`
//     (#8158's defence in depth: capability held, no organization to use it in);
//   - the ORG-SCOPED persona holds the very grant #8158 was filed with, scoped
//     to tenant A, and is now refused at the ADR-0111 D6 capability gate.
//
// ## Anti-vacuity
//
// TWO organizations, one rule each. A single-tenant fixture would pass on the
// BROKEN build, because there would be nothing to leak. The refusal assertions
// are therefore paired with a control proving the other tenant's row is
// present and readable BY SOMEONE (the platform operator), and with an
// org-bound caller who sees its own row and not the other's.
//
// @proof: sharing-rule-org-less-caller

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { leaveOrganization } from './armed.js';

const RULES = '/sharing/rules';
const SYS = { isSystem: true } as const;

const ORG_A = 'org_8158_a';
const ORG_B = 'org_8158_b';
const RULE_A = 'rule_8158_tenant_a';
const RULE_B = 'rule_8158_tenant_b';
const PASSWORD = 'Member-Pass-123';
const ORG_LESS_EMAIL = 'orgless-8158@verify.test';
const ORG_BOUND_EMAIL = 'orgbound-8158@verify.test';
const ORG_SCOPED_ORG_LESS_EMAIL = 'orgscoped-orgless-8158@verify.test';
const OPERATOR_EMAIL = 'operator-8158@verify.test';

interface RuleRow {
  id: string;
  name: string;
  organization_id: string | null;
}

describe('#8158 — a manage_sharing holder with NO active organization cannot read every tenant', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  /**
   * A platform operator with no active organization: `admin_full_access` held
   * globally, and no membership. [ADR-0131 D3] The harness admin can no longer
   * play this part — every `single` boot makes them the Default Organization's
   * owner, so their session carries it.
   */
  let platform: string;
  /** The exposed persona: GLOBAL `manage_sharing`, no membership, no active org. */
  let orgLess: string;
  /** [#20515] The #8158 grant as filed — scoped to tenant A — with no membership and no active org. */
  let orgScopedOrgLess: string;
  /** The control persona: the same set scoped to tenant A, plus a membership in tenant A. */
  let orgBound: string;
  let orgLessUserId = '';
  let orgScopedOrgLessUserId = '';
  let orgBoundUserId = '';

  const ruleRow = (organizationId: string, name: string) => ({
    id: `srule_${name}`,
    organization_id: organizationId,
    name,
    label: `Rule of ${organizationId}`,
    object_name: 'showcase_project',
    // A real predicate: a criteria-less row is inert by ADR-0049 and the
    // write guard refuses it, so this is also what makes the row a live one.
    criteria_json: JSON.stringify({ health: 'red' }),
    recipient_type: 'user',
    recipient_id: 'someone',
    access_level: 'read',
    active: true,
    managed_by: 'admin',
    customized: false,
  });

  beforeAll(async () => {
    stack = await bootStack(showcaseStack);
    await stack.signIn(); // the first user: the bootstrap account
    ql = await stack.kernel.getServiceAsync('objectql');

    // Two tenants — the anti-vacuity premise.
    for (const [id, label] of [[ORG_A, 'Tenant A'], [ORG_B, 'Tenant B']] as const) {
      await ql.insert('sys_organization', { id, name: label, slug: id }, { context: SYS });
    }
    await ql.insert('sys_sharing_rule', ruleRow(ORG_A, RULE_A), { context: SYS });
    await ql.insert('sys_sharing_rule', ruleRow(ORG_B, RULE_B), { context: SYS });

    // An ORG-SCOPED sharing-admin permission set: `manage_sharing` and
    // deliberately NOT `manage_platform_settings` — the card's exposed class is
    // precisely the caller who holds the org capability and no platform one.
    const psId = 'ps_8158_sharing_admin';
    await ql.insert('sys_permission_set', {
      id: psId,
      name: 'sharing_admin_8158',
      label: 'Sharing Administrator (org-scoped)',
      system_permissions: JSON.stringify(['manage_sharing']),
    }, { context: SYS });

    // Real sign-ups: better-auth's own path, through every database hook.
    await stack.signUp(ORG_LESS_EMAIL, PASSWORD);
    await stack.signUp(ORG_BOUND_EMAIL, PASSWORD);
    await stack.signUp(ORG_SCOPED_ORG_LESS_EMAIL, PASSWORD);
    const uid = async (email: string): Promise<string> =>
      (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    orgLessUserId = await uid(ORG_LESS_EMAIL);
    orgBoundUserId = await uid(ORG_BOUND_EMAIL);
    orgScopedOrgLessUserId = await uid(ORG_SCOPED_ORG_LESS_EMAIL);

    // [#20515] The exposed persona holds the set GLOBALLY (no organization):
    // with no active organization only global grants apply, so this is the one
    // spelling under which it still carries `manage_sharing` and still reaches
    // `adminOrgScope`.
    await ql.insert('sys_user_permission_set', {
      user_id: orgLessUserId, permission_set_id: psId, organization_id: null,
    }, { context: SYS });
    // The #8158 grant as filed — scoped to tenant A — for the control (which
    // has tenant A active) and for the org-scoped persona (which has none).
    for (const userId of [orgBoundUserId, orgScopedOrgLessUserId]) {
      await ql.insert('sys_user_permission_set', {
        user_id: userId, permission_set_id: psId, organization_id: ORG_A,
      }, { context: SYS });
    }
    // [ADR-0131 D3] The membership reconciler bound every sign-up above to the
    // Default Organization. The control persona keeps exactly ONE membership,
    // in tenant A, so its own is removed first…
    const ownMembers = await ql.find('sys_member', { where: { user_id: orgBoundUserId }, context: SYS });
    for (const m of Array.isArray(ownMembers) ? ownMembers : ownMembers?.records ?? []) {
      await ql.delete('sys_member', { where: { id: m.id }, context: SYS });
    }
    // …and given a membership in tenant A. That single row is the whole
    // difference between the personas: `session.create.before` resolves it and
    // stamps `activeOrganizationId`.
    await ql.insert('sys_member', {
      id: 'mem_8158_bound', organization_id: ORG_A, user_id: orgBoundUserId, role: 'member',
    }, { context: SYS });

    // A platform operator outside the organization: `admin_full_access` held
    // globally, the grant a platform administrator holds under `single`.
    await stack.signUp(OPERATOR_EMAIL, PASSWORD);
    const adminSet = await ql.findOne('sys_permission_set', { where: { name: 'admin_full_access' }, context: SYS });
    expect(adminSet?.id, 'admin_full_access is seeded').toBeTruthy();
    await ql.insert('sys_user_permission_set', {
      user_id: await uid(OPERATOR_EMAIL), permission_set_id: adminSet.id, organization_id: null,
    }, { context: SYS });

    // Sign in AFTER the grants, so every session is minted by the same path
    // with the membership state above already in place. The org-less personas
    // and the operator are removed from the Default Organization first — a user
    // removed from their organization, one of the ordinary shapes the header
    // names — so their sessions carry no active organization.
    orgLess = await leaveOrganization(stack, ORG_LESS_EMAIL, PASSWORD);
    orgBound = await stack.signIn(ORG_BOUND_EMAIL, PASSWORD);
    orgScopedOrgLess = await leaveOrganization(stack, ORG_SCOPED_ORG_LESS_EMAIL, PASSWORD);
    platform = await leaveOrganization(stack, OPERATOR_EMAIL, PASSWORD);
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
  });

  // ── preconditions: every link of the reachability chain, measured ────

  it('PRECONDITION: two tenants really do have a rule each', async () => {
    const rows = await ql.find('sys_sharing_rule', {
      where: { name: { $in: [RULE_A, RULE_B] } }, context: SYS,
    });
    const list: RuleRow[] = Array.isArray(rows) ? rows : rows?.records ?? [];
    expect(list.find((r) => r.name === RULE_A)?.organization_id).toBe(ORG_A);
    expect(list.find((r) => r.name === RULE_B)?.organization_id).toBe(ORG_B);
  });

  it('PRECONDITION: the exposed persona holds no membership, and its SESSION carries no active organization', async () => {
    // This is the card's unmeasured half. `session.create.before` (ADR-0093
    // D9) stamps `activeOrganizationId` from the caller's `sys_member` row;
    // with no such row it declines, and nothing downstream re-derives one.
    const members = await ql.find('sys_member', { where: { user_id: orgLessUserId }, context: SYS });
    expect(Array.isArray(members) ? members : members?.records ?? []).toHaveLength(0);

    const sessions = await ql.find('sys_session', { where: { user_id: orgLessUserId }, context: SYS });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = Array.isArray(sessions) ? sessions : sessions?.records ?? [];
    // [ADR-0131 D3] The sign-up session was minted while the reconciler's
    // membership held, and leaving the organization revoked it (#15784); the
    // LIVE session is the one the persona signed in with afterwards.
    const rows = all.filter((s) => !(s.revoked_at ?? s.revokedAt));
    expect(rows.length, 'the sign-in really did mint a live session row').toBeGreaterThan(0);
    for (const s of rows) {
      expect(
        s.active_organization_id ?? s.activeOrganizationId ?? null,
        'an authenticated session with NO active organization — the state the card asks about',
      ).toBeFalsy();
    }
  });

  it('PRECONDITION: the CONTROL persona’s session DOES carry one (so the difference is the membership, not the harness)', async () => {
    const sessions = await ql.find('sys_session', { where: { user_id: orgBoundUserId }, context: SYS });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = Array.isArray(sessions) ? sessions : sessions?.records ?? [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((s) => (s.active_organization_id ?? s.activeOrganizationId) === ORG_A)).toBe(true);
  });

  it('PRECONDITION: both tenants’ rules are visible OVER HTTP to a platform operator', async () => {
    // The refusal below would be vacuous if the route answered nothing to
    // anybody. It also pins the second permitted class: a platform operator
    // with no active organization keeps the unfiltered read it has always had.
    const res = await stack.apiAs(platform, 'GET', RULES);
    expect(res.status).toBe(200);
    const names = ((await res.json()) as { data: RuleRow[] }).data.map((r) => r.name);
    expect(names).toContain(RULE_A);
    expect(names).toContain(RULE_B);
  });

  // ── the measurement ──────────────────────────────────────────────────

  it('THE REPORTED CASE: listing is refused 403, not answered with every tenant’s rules', async () => {
    // The exposed persona holds `manage_sharing` GLOBALLY (#20515 — see the
    // header), so this is `adminOrgScope` refusing, as the next case proves.
    const res = await stack.apiAs(orgLess, 'GET', RULES);
    const payload = res.status === 200
      ? ((await res.json()) as { data: RuleRow[] }).data.map((r) => `${r.name}@${r.organization_id}`)
      : await res.text();
    // The failure MESSAGE carries the leak itself — vitest truncates a diff's
    // arrays, so an ablation run must be told which tenants' rules came back
    // rather than left with `payload: [ …(6) ]`.
    expect(
      res.status,
      'an org-scoped manage_sharing holder with no active organization must not read the rule ' +
        `surface — it answered: ${JSON.stringify(payload)}`,
    ).toBe(403);
  });

  it('the refusal names the ORGANIZATION, which is also how we know the capability gate was cleared', async () => {
    // Both refusals on this surface are `PERMISSION_DENIED`; only the message
    // separates "you lack manage_sharing" from "you have it and no org to use
    // it in". Reading the second proves the persona really did carry the
    // capability — i.e. that this fixture measures the fall-open and not the
    // older ADR-0111 D6 gate.
    const res = await stack.apiAs(orgLess, 'GET', RULES);
    const body = (await res.json()) as { code?: string; error?: string };
    expect(body.code).toBe('PERMISSION_DENIED');
    expect(body.error ?? '').toMatch(/active organization/);
    expect(body.error ?? '').not.toMatch(/requires the manage_sharing capability/);
  });

  it('by-NAME GET of the OTHER tenant’s rule is refused', async () => {
    const res = await stack.apiAs(orgLess, 'GET', `${RULES}/${RULE_B}`);
    expect(res.status, await res.text()).toBe(403);
  });

  it('by-ID GET of the OTHER tenant’s rule is refused', async () => {
    const res = await stack.apiAs(orgLess, 'GET', `${RULES}/srule_${RULE_B}`);
    expect(res.status, await res.text()).toBe(403);
  });

  it('EVALUATE — the cross-tenant WRITE — is refused, and reconciles nothing', async () => {
    const before = await ql.find('sys_record_share', { where: { source: 'rule' }, context: SYS });
    const res = await stack.apiAs(orgLess, 'POST', `${RULES}/${RULE_B}/evaluate`, {});
    expect(res.status, await res.text()).toBe(403);
    const after = await ql.find('sys_record_share', { where: { source: 'rule' }, context: SYS });
    const count = (r: unknown): number => (Array.isArray(r) ? r.length : (r as any)?.records?.length ?? 0);
    expect(count(after)).toBe(count(before));
  });

  it('DELETE of the other tenant’s rule is refused, and the row survives', async () => {
    const res = await stack.apiAs(orgLess, 'DELETE', `${RULES}/${RULE_B}`);
    expect(res.status, await res.text()).toBe(403);
    expect((await ql.findOne('sys_sharing_rule', { where: { name: RULE_B }, context: SYS }))?.id).toBeTruthy();
  });

  it('CREATE is refused — no org-less caller mints a platform-global rule', async () => {
    const res = await stack.apiAs(orgLess, 'POST', RULES, {
      name: 'rule_8158_minted_by_orgless',
      label: 'Minted with no organization',
      object: 'showcase_project',
      recipientType: 'user',
      recipientId: 'someone',
      criteria: { health: 'red' },
      accessLevel: 'read',
    });
    expect(res.status, await res.text()).toBe(403);
    expect(await ql.findOne('sys_sharing_rule', {
      where: { name: 'rule_8158_minted_by_orgless' }, context: SYS,
    })).toBeFalsy();
  });

  // ── [#20515] the #8158 grant as filed: ORG-scoped, no active organization ───

  it('PRECONDITION: the org-scoped persona holds no membership, and its SESSION carries no active organization', async () => {
    const members = await ql.find('sys_member', { where: { user_id: orgScopedOrgLessUserId }, context: SYS });
    expect(Array.isArray(members) ? members : members?.records ?? []).toHaveLength(0);
    const sessions = await ql.find('sys_session', { where: { user_id: orgScopedOrgLessUserId }, context: SYS });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const all: any[] = Array.isArray(sessions) ? sessions : sessions?.records ?? [];
    // The live session only — the sign-up one was revoked on leaving (see above).
    const rows = all.filter((s) => !(s.revoked_at ?? s.revokedAt));
    expect(rows.length, 'the sign-in really did mint a live session row').toBeGreaterThan(0);
    for (const s of rows) {
      expect(s.active_organization_id ?? s.activeOrganizationId ?? null).toBeFalsy();
    }
  });

  it('an ORG-scoped manage_sharing grant with no active organization is refused 403 at the CAPABILITY gate', async () => {
    // With no active organization only global grants apply, so the tenant-A
    // grant confers nothing here: the ADR-0111 D6 gate refuses before
    // `adminOrgScope` is ever asked — and no tenant's rule is read.
    const res = await stack.apiAs(orgScopedOrgLess, 'GET', RULES);
    const body = (await res.json()) as { code?: string; error?: string; data?: RuleRow[] };
    expect(res.status, JSON.stringify(body)).toBe(403);
    expect(body.code).toBe('PERMISSION_DENIED');
    expect(body.error ?? '').toMatch(/requires the manage_sharing capability/);
    expect(body.data).toBeUndefined();
  });

  it('the org-scoped persona is refused the other tenant’s rule by name as well', async () => {
    const res = await stack.apiAs(orgScopedOrgLess, 'GET', `${RULES}/${RULE_B}`);
    expect(res.status, await res.text()).toBe(403);
  });

  // ── the control: the SAME grant, with an organization, still works ───

  it('the org-BOUND holder of the same grant reads its own tenant and NOT the other', async () => {
    // The anti-vacuity pair, over HTTP: same permission set, same object, one
    // extra `sys_member` row — and a scoped answer instead of a refusal.
    const res = await stack.apiAs(orgBound, 'GET', RULES);
    // One read of the body: `text()` then `json()` on the same Response throws
    // "Body is unusable", which reports as a failure of the assertion that
    // never ran.
    const body = (await res.json()) as { data?: RuleRow[]; error?: string };
    expect(res.status, JSON.stringify(body)).toBe(200);
    const names = (body.data ?? []).map((r) => r.name);
    expect(names).toContain(RULE_A);
    expect(names).not.toContain(RULE_B);
  });

  it('the org-BOUND holder cannot reach the other tenant by name or id either (404, never 200)', async () => {
    // Not a #8158 assertion — #7676/#7761's — but it is what makes "scoped"
    // mean scoped here rather than "listing happens to be filtered".
    expect((await stack.apiAs(orgBound, 'GET', `${RULES}/${RULE_B}`)).status).toBe(404);
    expect((await stack.apiAs(orgBound, 'GET', `${RULES}/srule_${RULE_B}`)).status).toBe(404);
  });
});
