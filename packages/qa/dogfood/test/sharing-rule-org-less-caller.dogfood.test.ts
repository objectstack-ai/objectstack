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
// (`sys_user_permission_set`) is independent of organization MEMBERSHIP, and
// `resolveUserAuthzGrants` keeps an org-scoped grant when the caller has no
// active org to compare it against (`!(org && tenantId && org !== tenantId)`).
// A multi-org deployment (whose membership reconciler binds nobody — ADR-0093
// D1 `no-target-org`), an `invite-only` deployment, a user removed from their
// organization, or an SSO JIT user pending placement all produce it.
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

const RULES = '/sharing/rules';
const SYS = { isSystem: true } as const;

const ORG_A = 'org_8158_a';
const ORG_B = 'org_8158_b';
const RULE_A = 'rule_8158_tenant_a';
const RULE_B = 'rule_8158_tenant_b';
const PASSWORD = 'Member-Pass-123';
const ORG_LESS_EMAIL = 'orgless-8158@verify.test';
const ORG_BOUND_EMAIL = 'orgbound-8158@verify.test';

interface RuleRow {
  id: string;
  name: string;
  organization_id: string | null;
}

describe('#8158 — a manage_sharing holder with NO active organization cannot read every tenant', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  /** The harness admin: platform authority, and (by harness design) org-less. */
  let platform: string;
  /** The exposed persona: org-scoped `manage_sharing`, no membership, no active org. */
  let orgLess: string;
  /** The control persona: the SAME grant, plus a membership in tenant A. */
  let orgBound: string;
  let orgLessUserId = '';
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
    platform = await stack.signIn();
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
    const uid = async (email: string): Promise<string> =>
      (await ql.findOne('sys_user', { where: { email }, context: SYS }))?.id;
    orgLessUserId = await uid(ORG_LESS_EMAIL);
    orgBoundUserId = await uid(ORG_BOUND_EMAIL);

    // The identical grant for both, scoped to tenant A.
    for (const userId of [orgLessUserId, orgBoundUserId]) {
      await ql.insert('sys_user_permission_set', {
        user_id: userId, permission_set_id: psId, organization_id: ORG_A,
      }, { context: SYS });
    }
    // …and a membership for ONE of them. That single row is the whole
    // difference between the two personas: `session.create.before` resolves it
    // and stamps `activeOrganizationId`.
    await ql.insert('sys_member', {
      id: 'mem_8158_bound', organization_id: ORG_A, user_id: orgBoundUserId, role: 'member',
    }, { context: SYS });

    // Sign in AFTER the grants, so both sessions are minted by the same path
    // with the membership state above already in place.
    orgLess = await stack.signIn(ORG_LESS_EMAIL, PASSWORD);
    orgBound = await stack.signIn(ORG_BOUND_EMAIL, PASSWORD);
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
    const rows: any[] = Array.isArray(sessions) ? sessions : sessions?.records ?? [];
    expect(rows.length, 'the sign-in really did mint a session row').toBeGreaterThan(0);
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
