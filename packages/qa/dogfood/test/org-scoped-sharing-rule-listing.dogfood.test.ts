// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7676 / #7762] The HTTP-layer regression test for #7676 — restored.
//
// ## Why this file has a history before it has a first commit
//
// #7676: `sys_sharing_rule` rows seeded by the package/app seeder carry
// `organization_id = null` (`bootstrapDeclaredSharingRules` defines under
// `SYSTEM_CTX`, before any org id exists). The admin read path scoped with a
// strict `organization_id = <request org>` equality, so on a stock boot
// `GET /api/v1/sharing/rules` answered `{data: []}` over four active seeded
// rules, by-name GET and evaluate 404'd, and only the org-unfiltered by-id
// branch still worked. Rules that grant access but cannot be listed, inspected
// or deactivated.
//
// PR #7760 fixed it and its dev wrote exactly this test — then measured it
// GREEN against the UNFIXED code and correctly DELETED it rather than ship
// phantom coverage. The reason is #7762: `bootStack` could not mint an admin
// whose resolved execution context carried an organization, so `orgId` was
// `null` on every request, `adminOrgScope` returned the `where` untouched, and
// the strict-equality bug was unreachable from the harness. The assertion
// passed because the filter never engaged — the #4700 constant-false shape.
//
// `bootStack({ orgContext: true })` (#7762) is what makes the test mean
// something: the admin is bound to a real organization, their session carries
// `activeOrganizationId`, and the org-scoped branch of `listRules` / `getRule`
// is the one that actually runs. THAT is why this file boots with the flag and
// asserts the flag took effect FIRST — an org-less admin here would silently
// restore the vacuum this file exists to escape.
//
// ⛔ Nothing here is a tenant-isolation proof. `orgContext` stands up no
// organization wall (SecurityPlugin strips the wildcard `organization_id` RLS
// policies with no `org-scoping` service present) — see the option's doc block
// in `packages/verify/src/harness.ts`. This file proves that an org-scoped READ
// FILTER engages and admits the platform-global rows it must; it proves nothing
// about tenant B's rows, and must never be extended to claim that.
//
// @proof: org-scoped-sharing-rule-listing

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const RULES = '/sharing/rules';
const SYS = { isSystem: true } as const;

/**
 * The rules `examples/app-showcase` declares, all seeded org-less.
 *
 * [#9237] Two of the former four were retired rather than re-homed: they sat
 * on `showcase_project` / `showcase_task`, whose `public_read_write` OWD
 * leaves sharing nothing to widen, so their boot backfill was refused
 * (`SHARING_NOT_ENABLED`) on every boot. What this file measures — an org-bound
 * admin's READ over org-less rows — is unchanged by their number.
 */
const SEEDED_RULE_NAMES = [
  'share_new_inquiries_with_field_ops',
  'share_key_account_qualified_contacts_with_managers',
];

interface RuleRow {
  id: string;
  name: string;
  organization_id: string | null;
}

describe('#7676 — package-seeded (org-less) sharing rules stay visible to an ORG-BOUND admin', () => {
  let stack: VerifyStack;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ql: any;
  let admin: string;

  beforeAll(async () => {
    stack = await bootStack(showcaseStack, { orgContext: true });
    admin = await stack.signIn();
    ql = await stack.kernel.getServiceAsync('objectql');
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('PRECONDITION: the admin actually carries an organization (else everything below is vacuous)', async () => {
    // The measurement from #7762, inverted. The card recorded `POST
    // /api/v1/sharing/rules` answering 201 with `organization_id: null`, and
    // named that a direct proof the caller's context had no organization —
    // `defineRule` stamps the row from the resolved context. So a NON-NULL
    // stamp here is the same measurement reporting the opposite, taken through
    // the same route.
    const res = await stack.apiAs(admin, 'POST', RULES, {
      name: 'org_bound_probe_7762',
      label: 'Org-bound probe',
      object: 'showcase_project',
      recipientType: 'position',
      recipientId: 'exec',
      criteria: { health: 'red' },
      accessLevel: 'read',
    });
    expect(res.status).toBe(201);
    const row = (await res.json()) as RuleRow;
    expect(
      row.organization_id,
      'a row created by the org-bound admin is stamped with their organization',
    ).toBeTruthy();

    // And the org id is a real `sys_organization`, not a stray string.
    const org = await ql.findOne('sys_organization', {
      where: { id: row.organization_id },
      context: SYS,
    });
    expect(org?.id).toBe(row.organization_id);
  });

  it('THE REPORTED CASE: GET /sharing/rules lists the seeded org-less rules', async () => {
    // Pre-#7676 this answered `{data: []}`. It is also the assertion that was
    // green on the unfixed code before `orgContext` existed — see the header.
    const res = await stack.apiAs(admin, 'GET', RULES);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: RuleRow[] };
    const names = body.data.map((r) => r.name);

    for (const name of SEEDED_RULE_NAMES) {
      expect(names, `seeded rule ${name} must be listed`).toContain(name);
    }
    // They really are the platform-global rows, not org-stamped copies — which
    // is what makes them invisible to a strict `organization_id = orgId`.
    for (const name of SEEDED_RULE_NAMES) {
      const row = body.data.find((r) => r.name === name);
      expect(row?.organization_id, `${name} is seeded org-less`).toBeNull();
    }
  });

  it('by-NAME GET resolves a seeded org-less rule (404 RULE_NOT_FOUND before the fix)', async () => {
    const res = await stack.apiAs(admin, 'GET', `${RULES}/${SEEDED_RULE_NAMES[0]}`);
    expect(res.status).toBe(200);
    const row = (await res.json()) as RuleRow;
    expect(row.name).toBe(SEEDED_RULE_NAMES[0]);
    expect(row.organization_id).toBeNull();
  });

  it('a seeded org-less rule can be EVALUATED — the half that granted access all along', async () => {
    // Enforcement always read these rows (under SYSTEM_CTX); only the admin
    // surface could not. "Rules that grant access but cannot be inspected or
    // deactivated are the worst half of both properties."
    const rule = await ql.findOne('sys_sharing_rule', {
      where: { name: SEEDED_RULE_NAMES[0] },
      context: SYS,
    });
    expect(rule?.id, 'the seeded rule exists in storage').toBeTruthy();
    const res = await stack.apiAs(admin, 'POST', `${RULES}/${rule.id}/evaluate`, {});
    expect(res.status).toBeLessThan(300);
  });

  it('the scope still SCOPES — another organization\'s rule is not listed', async () => {
    // The counterweight, and the reason this is a scope rather than a hole:
    // widening the read to `this org ∪ platform-global` must not also admit a
    // THIRD org's row. Written at the storage seam because the harness mints
    // exactly one organization — this is a read-filter assertion, NOT a
    // tenant-isolation proof (see the header).
    const foreignId = 'srule_7762_foreign';
    await ql.insert(
      'sys_sharing_rule',
      {
        id: foreignId,
        organization_id: 'org_someone_else_7762',
        name: 'foreign_org_rule_7762',
        label: 'Foreign org rule',
        object_name: 'showcase_project',
        criteria_json: JSON.stringify({ health: 'red' }),
        recipient_type: 'position',
        recipient_id: 'exec',
        access_level: 'read',
        active: true,
      },
      { context: SYS },
    );

    const res = await stack.apiAs(admin, 'GET', RULES);
    const body = (await res.json()) as { data: RuleRow[] };
    expect(body.data.map((r) => r.name)).not.toContain('foreign_org_rule_7762');

    // [#7761] The by-id branch carries the same scope — an opaque id is not a
    // tenant boundary.
    const byId = await stack.apiAs(admin, 'GET', `${RULES}/${foreignId}`);
    expect(byId.status).toBe(404);
  });
});
