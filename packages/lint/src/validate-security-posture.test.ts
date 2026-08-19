// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D7] Security-posture linter — one failing fixture per rule (the
 * ADR's own acceptance bar: "each lint rule has a fixture that fails without
 * it"), plus the clean-stack fixture that must stay silent.
 */

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';
import { ObjectStackSchema } from '@objectstack/spec';
import { FieldSchema, ObjectSchema } from '@objectstack/spec/data';
import { ObjectPermissionSchema, PermissionSetSchema } from '@objectstack/spec/security';
import {
  SECURITY_FLS_UNQUALIFIED_KEY,
  validateSecurityPosture,
  validateSecurityRoleWord,
  SECURITY_OWD_UNSET,
  SECURITY_OWD_ALIAS,
  SECURITY_EXTERNAL_WIDER,
  SECURITY_WILDCARD_VAMA,
  SECURITY_ANCHOR_HIGH_PRIVILEGE,
  SECURITY_ROLE_WORD,
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_GRANT_EXPIRED_AT_AUTHORING,
  SECURITY_DELEGATION_MISSING_REASON,
  SECURITY_CBP_NO_RELATION,
} from './validate-security-posture.js';

const rulesOf = (stack: Record<string, unknown>) =>
  validateSecurityPosture(stack).map((f) => f.rule);

describe('validateSecurityPosture (ADR-0090 D7)', () => {
  it('clean stack produces no findings', () => {
    const findings = validateSecurityPosture({
      objects: [
        { name: 'leave_request', label: 'Leave Request', sharingModel: 'private', fields: { title: { name: 'title', label: 'Title' } } },
        // [#7503] This fixture used to declare `controlled_by_parent` with NO
        // fields at all — i.e. the clean-stack fixture of the security linter
        // was itself an instance of the defect `security-controlled-by-parent-
        // no-relation` now reports (runtime: 422 on write, deny on read). It is
        // a detail object, so it is given the master_detail it always implied.
        {
          name: 'leave_item', label: 'Leave Item', sharingModel: 'controlled_by_parent',
          fields: { request: { name: 'request', type: 'master_detail', reference: 'leave_request', required: true } },
        },
        { name: 'sys_internal', label: 'Internal' }, // system prefix — exempt from OWD rules
      ],
      permissions: [
        {
          name: 'hr_user',
          label: 'HR User',
          objects: {
            leave_request: { allowRead: true, allowCreate: true, readScope: 'unit' },
            // The detail now carries a master_detail (above), so it needs its
            // own object-level CRUD grant or `security-master-detail-ungranted`
            // fires — gate ① is never derived from the master (ADR-0055).
            leave_item: { allowRead: true, allowCreate: true },
          },
        },
      ],
      positions: [{ name: 'hr_specialist', label: 'HR Specialist' }],
    });
    expect(findings).toEqual([]);
  });

  // ── Rule: security-owd-unset (origin: objectui#2348 incident) ────────
  it('errors on a custom object with no sharingModel — the leave_request shape', () => {
    const findings = validateSecurityPosture({
      objects: [{ name: 'leave_request', label: 'Leave Request' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SECURITY_OWD_UNSET,
      where: 'object "leave_request"',
    });
    expect(findings[0].hint).toContain("'private'");
  });

  it('does not flag system objects for unset OWD', () => {
    expect(rulesOf({ objects: [{ name: 'sys_thing' }, { name: 'custom', isSystem: true }] })).toEqual([]);
  });

  // Was: "honors sharingModel nested under security.*". There is no such
  // envelope and there never was — `ObjectSchema` declares the OWD dials flat
  // and is strict, so `objects[].security` is REFUSED by name, not stripped.
  // The fallback that test pinned could not run for any stack an author can
  // ship; all it did was advertise an authorization surface that does not
  // exist (#5017). Schema evidence: the "undeclared keys are the schema's job"
  // block at the end of this file.
  it('does not read an OWD nested under a `security` envelope — no such key', () => {
    expect(
      rulesOf({ objects: [{ name: 'ok_obj', security: { sharingModel: 'private' } }] }),
    ).toEqual([SECURITY_OWD_UNSET]);
  });

  // ── Rule: security-owd-alias (ADR-0090 D4) ───────────────────────────
  it('errors with a fix-it on retired alias values', () => {
    const findings = validateSecurityPosture({
      objects: [{ name: 'a', sharingModel: 'read' }, { name: 'b', sharingModel: 'read_write' }],
    });
    expect(findings.map((f) => f.rule)).toEqual([SECURITY_OWD_ALIAS, SECURITY_OWD_ALIAS]);
    expect(findings[0].hint).toContain("'public_read'");
    expect(findings[1].hint).toContain("'public_read_write'");
  });

  it('errors on unknown OWD values (runtime fails closed to private)', () => {
    const findings = validateSecurityPosture({ objects: [{ name: 'a', sharingModel: 'everyone' }] });
    expect(findings[0].rule).toBe(SECURITY_OWD_ALIAS);
    expect(findings[0].message).toContain("fails CLOSED to 'private'");
  });

  // ── Rule: security-external-wider-than-internal (ADR-0090 D11) ──────
  it('errors when the external dial is wider than the internal one', () => {
    const findings = validateSecurityPosture({
      objects: [{ name: 'portal_case', sharingModel: 'private', externalSharingModel: 'public_read' }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SECURITY_EXTERNAL_WIDER);
  });

  it('accepts external ≤ internal', () => {
    expect(
      rulesOf({
        objects: [
          { name: 'a', sharingModel: 'public_read_write', externalSharingModel: 'public_read' },
          { name: 'b', sharingModel: 'public_read', externalSharingModel: 'public_read' },
        ],
      }),
    ).toEqual([]);
  });

  // ── Rule: security-wildcard-vama (ADR-0066) ─────────────────────────
  it("errors on a '*' wildcard carrying viewAll/modifyAll in an authored set", () => {
    const findings = validateSecurityPosture({
      permissions: [
        { name: 'sneaky_admin', objects: { '*': { allowRead: true, viewAllRecords: true } } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SECURITY_WILDCARD_VAMA);
  });

  it("tolerates a plain '*' read wildcard without VAMA", () => {
    expect(
      rulesOf({ permissions: [{ name: 'reader', objects: { '*': { allowRead: true } } }] }),
    ).toEqual([]);
  });

  // ── Rule: security-fls-unqualified-key (permission-zoo audit) ───────
  it('errors on a bare FLS key — the runtime evaluator silently ignores it', () => {
    const findings = validateSecurityPosture({
      permissions: [
        {
          name: 'contrib',
          objects: { crm_opportunity: { allowRead: true, allowEdit: true } },
          fields: { cost_internal: { readable: true, editable: false } },
        },
      ],
    }).filter((f) => f.rule === SECURITY_FLS_UNQUALIFIED_KEY);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toMatch(/silently IGNORED/);
    expect(findings[0].hint).toMatch(/crm_opportunity\.cost_internal/);
  });

  it('accepts object-qualified FLS keys', () => {
    expect(
      rulesOf({
        permissions: [
          {
            name: 'contrib',
            objects: { crm_opportunity: { allowRead: true } },
            fields: { 'crm_opportunity.cost_internal': { readable: false, editable: false } },
          },
        ],
      }),
    ).toEqual([]);
  });

  // ── Rule: security-anchor-high-privilege (ADR-0090 D5/D9) ───────────
  it('errors when an isDefault (everyone-suggested) set carries high-privilege bits', () => {
    const findings = validateSecurityPosture({
      permissions: [
        {
          name: 'app_default',
          isDefault: true,
          objects: { invoice: { allowRead: true, allowDelete: true } },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(SECURITY_ANCHOR_HIGH_PRIVILEGE);
    expect(findings[0].message).toContain('everyone');
  });

  it('accepts a low-privilege isDefault set', () => {
    expect(
      rulesOf({
        permissions: [
          { name: 'app_default', isDefault: true, objects: { invoice: { allowRead: true, allowCreate: true, allowEdit: true } } },
        ],
      }),
    ).toEqual([]);
  });

  // ── Rule: security-role-word (ADR-0090 D3) ──────────────────────────
  // [#8310] Its own function (and registry entry) since the rest of the block
  // crossed the runtime publish surface — same file, same rule id, same
  // findings; see `validateSecurityRoleWord`'s docblock for the #7220 reason.
  it('errors on "role" in identifiers and labels across kinds', () => {
    const findings = validateSecurityRoleWord({
      objects: [
        {
          name: 'user_role', // identifier token
          sharingModel: 'private',
          fields: { role_name: { name: 'role_name', label: 'Role Name' } },
        },
      ],
      permissions: [{ name: 'role_manager', label: 'Role Manager' }],
      positions: [{ name: 'sales_rep', label: 'Sales Role' }], // label word
    });
    const roleFindings = findings.filter((f) => f.rule === SECURITY_ROLE_WORD);
    // object name, field name, permission set name, position label
    expect(roleFindings).toHaveLength(4);
    expect(roleFindings.every((f) => f.severity === 'error')).toBe(true);
  });

  it('does not flag words merely containing the letters (payroll, controlled)', () => {
    expect(
      validateSecurityRoleWord({
        objects: [
          { name: 'payroll_run', label: 'Payroll — Controlled Rollout', sharingModel: 'private' },
        ],
      }),
    ).toEqual([]);
  });

  it('skips system objects (better-auth sys_member.role is the documented exception)', () => {
    expect(
      validateSecurityRoleWord({ objects: [{ name: 'sys_member', fields: { role: { name: 'role', label: 'Role' } } }] }),
    ).toEqual([]);
  });

  // ── Rule: security-private-no-readscope (info) ──────────────────────
  it('emits info when a set grants plain read on a private object without depth', () => {
    const findings = validateSecurityPosture({
      objects: [{ name: 'expense', sharingModel: 'private' }],
      permissions: [{ name: 'finance_user', objects: { expense: { allowRead: true } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: 'info', rule: SECURITY_PRIVATE_NO_READSCOPE });
  });

  it('stays silent when depth or VAMA is declared, or the object is public', () => {
    expect(
      rulesOf({
        objects: [
          { name: 'expense', sharingModel: 'private' },
          { name: 'notice', sharingModel: 'public_read' },
        ],
        permissions: [
          { name: 'a', objects: { expense: { allowRead: true, readScope: 'unit' } } },
          { name: 'b', objects: { expense: { allowRead: true, viewAllRecords: true } } },
          { name: 'c', objects: { notice: { allowRead: true } } },
        ],
      }).filter((r) => r === SECURITY_PRIVATE_NO_READSCOPE),
    ).toEqual([]);
  });
});

// ── Rule: security-master-detail-ungranted (framework#2700) ───────────
describe('validateSecurityPosture · master-detail detail ungranted (framework#2700)', () => {
  const mdOnly = (stack: Record<string, unknown>) =>
    validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_MASTER_DETAIL_UNGRANTED);

  /**
   * A work_order (master, granted) + work_order_item (detail). `childGrant`
   * grants the child in the same set; `extraPermission` appends another set
   * (e.g. an admin wildcard). Omit both → the incident shape: parent granted,
   * child forgotten. The master grant carries readScope so it never trips the
   * separate private-no-readscope info rule.
   */
  const detailStack = (
    childGrant?: Record<string, unknown>,
    opts?: { extraPermission?: Record<string, unknown> },
  ): Record<string, unknown> => ({
    objects: [
      { name: 'work_order', label: 'Work Order', sharingModel: 'private', fields: { name: { name: 'name', label: 'Name' } } },
      {
        name: 'work_order_item',
        label: 'Work Order Item',
        sharingModel: 'controlled_by_parent',
        fields: { order: { name: 'order', type: 'master_detail', reference: 'work_order', required: true } },
      },
    ],
    permissions: [
      {
        name: 'field_tech',
        label: 'Field Tech',
        objects: {
          work_order: { allowRead: true, allowCreate: true, allowEdit: true, readScope: 'unit' },
          ...(childGrant ? { work_order_item: childGrant } : {}),
        },
      },
      ...(opts?.extraPermission ? [opts.extraPermission] : []),
    ],
  });

  it('warns when the child is granted by no permission set — the incident shape', () => {
    const md = mdOnly(detailStack());
    expect(md).toHaveLength(1);
    expect(md[0]).toMatchObject({ severity: 'warning', where: 'object "work_order_item"' });
    expect(md[0].path).toBe('objects[1].fields.order');
    expect(md[0].message).toContain('controlled_by_parent');
    expect(md[0].message).toContain('403');
    expect(md[0].message).toContain('work_order'); // names the master
    expect(md[0].hint).toContain('permissions[i].objects.work_order_item');
  });

  it.each([
    ['allowRead', { allowRead: true }],
    ['allowCreate', { allowCreate: true }],
    ['allowEdit', { allowEdit: true }],
    ['allowDelete', { allowDelete: true }],
    ['viewAllRecords (VAMA)', { viewAllRecords: true }],
    ['modifyAllRecords (VAMA)', { modifyAllRecords: true }],
  ])('stays silent when the child is granted %s in a set', (_label, grant) => {
    expect(mdOnly(detailStack(grant))).toEqual([]);
  });

  it("stays silent when a package-declared '*' wildcard grant covers every object", () => {
    expect(
      mdOnly(detailStack(undefined, { extraPermission: { name: 'app_admin', objects: { '*': { allowRead: true } } } })),
    ).toEqual([]);
  });

  it('does not fire when the package authors no permission sets (nothing to compare)', () => {
    const { permissions: _drop, ...noPerms } = detailStack();
    expect(mdOnly(noPerms)).toEqual([]);
  });

  it('ignores a non-detail object that is merely ungranted (lookup, not master_detail)', () => {
    expect(
      mdOnly({
        objects: [
          { name: 'work_order', label: 'Work Order', sharingModel: 'private', fields: { name: { name: 'name', label: 'Name' } } },
          { name: 'lonely', label: 'Lonely', sharingModel: 'private', fields: { ref: { name: 'ref', type: 'lookup', reference: 'work_order' } } },
        ],
        permissions: [{ name: 'u', objects: { work_order: { allowRead: true, readScope: 'unit' } } }],
      }),
    ).toEqual([]);
  });

  it('exempts system detail objects (sys_ prefix or isSystem:true)', () => {
    expect(
      mdOnly({
        objects: [
          { name: 'thing', label: 'Thing', sharingModel: 'private', fields: { name: { name: 'name', label: 'Name' } } },
          { name: 'sys_thing_audit', sharingModel: 'controlled_by_parent', fields: { thing: { name: 'thing', type: 'master_detail', reference: 'thing' } } },
          { name: 'thing_internal', isSystem: true, sharingModel: 'controlled_by_parent', fields: { thing: { name: 'thing', type: 'master_detail', reference: 'thing' } } },
        ],
        permissions: [{ name: 'u', objects: { thing: { allowRead: true, readScope: 'unit' } } }],
      }),
    ).toEqual([]);
  });

  it('detects detail objects declared with the array field form', () => {
    const md = mdOnly({
      objects: [
        { name: 'work_order', label: 'Work Order', sharingModel: 'private', fields: [{ name: 'name', label: 'Name' }] },
        { name: 'work_order_item', sharingModel: 'controlled_by_parent', fields: [{ name: 'order', type: 'master_detail', reference: 'work_order', required: true }] },
      ],
      permissions: [{ name: 'u', objects: { work_order: { allowRead: true, readScope: 'unit' } } }],
    });
    expect(md).toHaveLength(1);
    expect(md[0].where).toBe('object "work_order_item"');
  });
});

// ── Rule: security-controlled-by-parent-no-relation (#7503 / #7474) ───
//
// The accept bar is the rule's own probe, and it is FOUR fixtures, not one: the
// defect shape must be reported, and each of the THREE shapes the runtime
// `resolveCbpRelation` actually resolves must be silent — one negative control
// per fallback step, because a rule that only mirrors step 1 would report two
// perfectly working objects. The three steps (security-plugin.ts):
//   1. a required `master_detail`   2. ANY `master_detail`   3. a required `lookup`
// each additionally requiring a `reference` target — mirrored by the fourth
// fixture pair below (a relation naming nothing resolves nothing).
describe('validateSecurityPosture · controlled_by_parent with no relation (#7503)', () => {
  const cbpOnly = (stack: Record<string, unknown>) =>
    validateSecurityPosture(stack).filter((f) => f.rule === SECURITY_CBP_NO_RELATION);

  /** A cbp object carrying exactly the fields under test, plus its master. */
  const cbpStack = (fields: unknown): Record<string, unknown> => ({
    objects: [
      { name: 'work_order', label: 'Work Order', sharingModel: 'private', fields: { name: { name: 'name', label: 'Name' } } },
      { name: 'work_order_item', label: 'Work Order Item', sharingModel: 'controlled_by_parent', fields },
    ],
  });

  // ── POSITIVE CONTROL — the rule must be able to SEE before any silence
  // below is worth believing (a rule wired to nothing is silent on everything).
  it('errors on a controlled_by_parent object with no relation at all', () => {
    const findings = cbpOnly(cbpStack({ note: { name: 'note', type: 'text', label: 'Note' } }));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      severity: 'error',
      rule: SECURITY_CBP_NO_RELATION,
      where: 'object "work_order_item"',
      path: 'objects[1].sharingModel',
    });
    expect(findings[0].message).toContain('controlled_by_parent');
    expect(findings[0].message).toContain('422');
    expect(findings[0].hint).toContain('master_detail');
  });

  it('errors when the object declares no fields key whatsoever', () => {
    expect(cbpOnly(cbpStack(undefined))).toHaveLength(1);
  });

  // ── NEGATIVE CONTROLS — one per fallback step of `resolveCbpRelation` ──
  it('stays silent on step 1: a REQUIRED master_detail', () => {
    expect(
      cbpOnly(cbpStack({ order: { name: 'order', type: 'master_detail', reference: 'work_order', required: true } })),
    ).toEqual([]);
  });

  it('stays silent on step 2: ANY master_detail (not marked required)', () => {
    expect(
      cbpOnly(cbpStack({ order: { name: 'order', type: 'master_detail', reference: 'work_order' } })),
    ).toEqual([]);
  });

  it('stays silent on step 3: a REQUIRED lookup', () => {
    expect(
      cbpOnly(cbpStack({ order: { name: 'order', type: 'lookup', reference: 'work_order', required: true } })),
    ).toEqual([]);
  });

  // The step-3 predicate is `lookup AND required` — an optional lookup is NOT a
  // fourth resolution step at runtime, so it must still be reported. This is the
  // "plausible thing for an agent to write" shape #7503 names: cbp next to a
  // lookup someone forgot to mark required.
  it('errors on an OPTIONAL lookup — the runtime does not resolve one', () => {
    expect(cbpOnly(cbpStack({ order: { name: 'order', type: 'lookup', reference: 'work_order' } }))).toHaveLength(1);
  });

  // `pick` requires `pred(f) && ref(f)`: a relation naming no target resolves
  // nothing, on every one of the three steps.
  it.each([
    ['required master_detail', { name: 'order', type: 'master_detail', required: true }],
    ['bare master_detail', { name: 'order', type: 'master_detail' }],
    ['required lookup', { name: 'order', type: 'lookup', required: true }],
  ])('errors when the %s names no reference target', (_label, field) => {
    expect(cbpOnly(cbpStack({ order: field }))).toHaveLength(1);
  });

  it('picks up a later relation when an earlier one names no target', () => {
    expect(
      cbpOnly(
        cbpStack({
          broken: { name: 'broken', type: 'master_detail', required: true },
          order: { name: 'order', type: 'master_detail', reference: 'work_order', required: true },
        }),
      ),
    ).toEqual([]);
  });

  it('detects the defect in the array field form too', () => {
    expect(cbpOnly(cbpStack([{ name: 'note', type: 'text', label: 'Note' }]))).toHaveLength(1);
    expect(
      cbpOnly(cbpStack([{ name: 'order', type: 'master_detail', reference: 'work_order', required: true }])),
    ).toEqual([]);
  });

  // Not scoped to `controlled_by_parent`'s absence of a relation in general:
  // an object with any OTHER sharing model owes no derivation and is silent
  // however few relations it has.
  it.each(['private', 'public_read', 'public_read_write'])(
    'stays silent for a relation-less object whose sharingModel is %s',
    (model) => {
      expect(
        cbpOnly({ objects: [{ name: 'standalone', label: 'S', sharingModel: model, fields: { a: { name: 'a', type: 'text' } } }] }),
      ).toEqual([]);
    },
  );

  // Unlike the D1 unset-OWD rule, system objects are NOT exempt: the runtime
  // refusal (`assertControlledByParentWrite` / `computeControlledByParentFilter`)
  // does not exempt them, and the defect is intrinsic to the declaration.
  it('reports system objects too — the runtime refusal does not exempt them', () => {
    expect(
      cbpOnly({
        objects: [
          { name: 'sys_thing_audit', sharingModel: 'controlled_by_parent', fields: { a: { name: 'a', type: 'text' } } },
          { name: 'thing_internal', isSystem: true, sharingModel: 'controlled_by_parent', fields: { a: { name: 'a', type: 'text' } } },
        ],
      }),
    ).toHaveLength(2);
  });
});

describe('validateSecurityPosture · book audience (ADR-0046 §6.7 / ADR-0090)', () => {
  it('flags the reserved word in book names and labels', () => {
    const findings = validateSecurityRoleWord({
      books: [
        { name: 'crm_role_guide', label: 'CRM Guide', groups: [] },
        { name: 'crm_admin_guide', label: 'Admin Roles Handbook', groups: [] },
      ],
    });
    const bookRole = findings.filter((f) => f.rule === SECURITY_ROLE_WORD);
    expect(bookRole).toHaveLength(2);
    expect(bookRole.map((f) => f.where)).toEqual(['book "crm_role_guide"', 'book "crm_admin_guide"']);
  });

  it('warns when a { permissionSet } audience references a set the stack does not declare', () => {
    const findings = validateSecurityPosture({
      permissions: [{ name: 'crm_admin' }],
      books: [
        { name: 'crm_admin_guide', audience: { permissionSet: 'crm_admn' }, groups: [] }, // typo
      ],
    });
    const dangling = findings.filter((f) => f.rule === SECURITY_BOOK_AUDIENCE_UNKNOWN_SET);
    expect(dangling).toHaveLength(1);
    expect(dangling[0].severity).toBe('warning');
    expect(dangling[0].path).toBe('books[0].audience.permissionSet');
    expect(dangling[0].message).toContain('crm_admn');
  });

  it('accepts a gated book whose set the stack declares — and scalar audiences', () => {
    expect(
      rulesOf({
        permissions: [{ name: 'crm_admin' }],
        books: [
          { name: 'crm_admin_guide', audience: { permissionSet: 'crm_admin' }, groups: [] },
          { name: 'crm_guide', audience: 'public', groups: [] },
          { name: 'crm_internal', audience: 'org', groups: [] },
          { name: 'crm_default', groups: [] },
        ],
      }),
    ).toEqual([]);
  });

  // ── ADR-0091: authored grant rows (seed data) — lifecycle sanity ──────
  const NOW = Date.parse('2026-07-10T12:00:00Z');

  it('errors on a seed grant whose valid_until is already in the past (dead on arrival)', () => {
    const findings = validateSecurityPosture(
      {
        data: [
          {
            object: 'sys_user_position',
            records: [
              { user_id: 'u1', position: 'approver', valid_until: '2026-07-01T00:00:00Z' },
              { user_id: 'u2', position: 'approver', valid_until: '2026-08-01T00:00:00Z' }, // future — fine
            ],
          },
        ],
      },
      { nowMs: NOW },
    );
    const expired = findings.filter((f) => f.rule === SECURITY_GRANT_EXPIRED_AT_AUTHORING);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      severity: 'error',
      where: 'seed "sys_user_position" record #0',
      path: 'data[0].records[0].valid_until',
    });
  });

  it('errors on an unparseable valid_until (the resolver fails closed — grant never active)', () => {
    const findings = validateSecurityPosture(
      { data: [{ object: 'sys_user_permission_set', records: [{ user_id: 'u1', permission_set_id: 'ps1', valid_until: 'not-a-date' }] }] },
      { nowMs: NOW },
    );
    const expired = findings.filter((f) => f.rule === SECURITY_GRANT_EXPIRED_AT_AUTHORING);
    expect(expired).toHaveLength(1);
    expect(expired[0].message).toContain('not a parseable timestamp');
  });

  it('errors on a delegation row (delegated_from) without a reason — D3 dual audit', () => {
    const findings = validateSecurityPosture(
      {
        data: [
          {
            object: 'sys_user_position',
            records: [
              { user_id: 'u2', position: 'approver', delegated_from: 'u1', valid_until: '2999-01-01T00:00:00Z' },
              { user_id: 'u3', position: 'approver', delegated_from: 'u1', valid_until: '2999-01-01T00:00:00Z', reason: 'vacation stand-in' },
            ],
          },
        ],
      },
      { nowMs: NOW },
    );
    const missing = findings.filter((f) => f.rule === SECURITY_DELEGATION_MISSING_REASON);
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({
      severity: 'error',
      path: 'data[0].records[0].reason',
    });
  });

  it('the D3 reason rule is scoped to sys_user_position — `delegated_from` is retired from sys_user_permission_set (#9730)', () => {
    // Maintainer ruling 2026-08-18 (ADR-0049 enforce-or-remove, REMOVE): the
    // runtime delegation gate never read `delegated_from` on
    // `sys_user_permission_set`, so this rule was that column's ONLY
    // enforcement — authoring-advisory security. The column no longer exists
    // on that object; a seed row still carrying the key is refused by the
    // engine's schema preflight (400 INVALID_FIELD), not re-linted here as if
    // the column were still declared. D2 (valid_until) still covers this
    // object — asserted by the unparseable-valid_until case above.
    const findings = validateSecurityPosture(
      { data: [{ object: 'sys_user_permission_set', records: [{ user_id: 'u1', permission_set_id: 'ps1', delegated_from: 'u2' }] }] },
      { nowMs: NOW },
    );
    expect(findings.filter((f) => f.rule === SECURITY_DELEGATION_MISSING_REASON)).toEqual([]);
  });

  it('stays silent on unbounded grants and non-grant seed objects', () => {
    expect(
      validateSecurityPosture(
        {
          data: [
            { object: 'sys_user_position', records: [{ user_id: 'u1', position: 'approver' }] },
            { object: 'crm_lead', records: [{ name: 'stale', valid_until: '2020-01-01T00:00:00Z' }] },
          ],
        },
        { nowMs: NOW },
      ),
    ).toEqual([]);
  });
});

/**
 * ── The structural meta-guard (#4992 pattern, #5009/#5018 shape) — #5017 ─────
 *
 * #4984 removed the `??` alias reads from a sharing rule's fields; #5009
 * removed four more one file over. #5017 found two of the same shape HERE, and
 * one of them was the worst of the family: `obj.security?.sharingModel`, a
 * fallback onto an object-level `security` envelope that **does not exist** —
 * in the security linter, where the next reader is most likely to believe it.
 *
 * These guards pin the PROPERTY that made those reads removable, so the next
 * one fails before review rather than after:
 *
 * 1. **Declared-key guard** — every key this rule reads off a stack, object,
 *    field, permission set, permission entry, app, position, book or seed must
 *    appear in that surface's own Zod `.shape`. Scanning the SOURCE rather than
 *    the behaviour is deliberate: an unreachable branch has no behaviour to
 *    assert on, which is exactly the problem.
 *
 * 2. **Reachability guard** — every `findings.push` site must be reached by a
 *    fixture the schema raises no `unrecognized_keys` issue on.
 *
 *    Note the criterion, which is NOT #5018's flat `safeParse` success, and the
 *    difference is this rule's whole point. It is registered `input: 'parsed'`
 *    but documented to run pre-parse too, so that `os lint` can answer a value
 *    the zod gate would reject — with a better message (`sharingModel: 'read'`
 *    is `invalid_value`, and rule `security-owd-alias` exists to name the
 *    canonical replacement). Demanding a fully-parsing fixture would delete
 *    four legitimate rules. A rejected KEY is a different animal from a
 *    rejected VALUE: a key the schema does not declare cannot reach this rule
 *    on the parsed path at all, and its presence in the source asserts that an
 *    authoring surface exists. So the corpus below is allowed to carry values
 *    the schema refuses, and never a key it refuses.
 *
 * Scope: BOTH guards cover the whole rule (all fifteen `findings.push` sites,
 * every receiver except the two named in `NOT_SCHEMA_RECEIVERS` below).
 */
const RULE_SOURCE = readFileSync(new URL('./validate-security-posture.ts', import.meta.url), 'utf8');

/** The rule's CODE — comments stripped, since the guards scan reads, not prose. */
const RULE_CODE = RULE_SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Distinct property names read off `receiver` in the rule's code. */
function keysReadOff(receiver: string): string[] {
  const re = new RegExp(`\\b${receiver}\\??\\.([A-Za-z_$][\\w$]*)`, 'g');
  return [...new Set([...RULE_CODE.matchAll(re)].map((m) => m[1]))].sort();
}

/**
 * The declared keys of a schema, unwrapping the optional / array / record /
 * lazy / union layers between a collection and its element.
 *
 * A union answers the UNION of its members' keys, which is the right reading:
 * a validation rule or a field is exactly one variant, and a key any variant
 * declares is a key some author can legitimately write.
 *
 * `lazySchema` wraps schemas in a Proxy whose target is a FUNCTION, so the
 * `typeof` guard has to admit both — miss that and every lazily-built schema
 * silently answers "declares nothing", which would make this guard vacuous.
 */
function shapeKeysOf(schema: unknown, depth = 0): string[] {
  const s = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown>; unwrap?: () => unknown };
  if (!s || (typeof s !== 'object' && typeof s !== 'function') || depth > 12) return [];
  if (s.shape) return Object.keys(s.shape);
  const d = (s._def ?? {}) as Record<string, unknown>;
  if (d.type === 'union' && Array.isArray(d.options)) {
    return [...new Set((d.options as unknown[]).flatMap((o) => shapeKeysOf(o, depth + 1)))];
  }
  const getter = d.getter as (() => unknown) | undefined;
  for (const next of [d.innerType, d.element, d.valueType, getter?.(), d.in, d.out]) {
    const r = shapeKeysOf(next, depth + 1);
    if (r.length) return r;
  }
  if (typeof s.unwrap === 'function') return shapeKeysOf(s.unwrap(), depth + 1);
  return [];
}

/**
 * Receivers whose keys are NOT a spec `.shape`, and why. Kept as an explicit,
 * reasoned list rather than "whatever the table forgot": a receiver that drops
 * out of the table silently is how an undeclared read gets back in.
 */
const NOT_SCHEMA_RECEIVERS: Record<string, string> = {
  rec: 'a seed RECORD — its keys are COLUMNS of `sys_user_position` / `sys_user_permission_set` (ADR-0091), not keys of a metadata schema.',
  md: "this file's own `firstMasterDetailField` return type, not an authored surface.",
};

const READ_SURFACES: Array<{ receiver: string; expected: string[]; declaredBy: string; keys: () => string[] }> = [
  {
    receiver: 'stack',
    expected: ['apps', 'books', 'data', 'objects', 'permissions', 'positions'],
    declaredBy: 'ObjectStackSchema',
    keys: () => Object.keys(ObjectStackSchema.shape),
  },
  {
    receiver: 'obj',
    // `security` is absent, and that is the #5017 fix: `ObjectSchema` declares
    // the OWD dials FLAT and has no `security` envelope to nest them under.
    expected: ['actions', 'externalSharingModel', 'fields', 'isSystem', 'label', 'name', 'sharingModel'],
    declaredBy: 'ObjectSchema',
    keys: () => Object.keys(ObjectSchema.shape),
  },
  { receiver: 'o', expected: ['name'], declaredBy: 'ObjectSchema', keys: () => Object.keys(ObjectSchema.shape) },
  {
    receiver: 'ps',
    expected: ['fields', 'isDefault', 'label', 'name', 'objects'],
    declaredBy: 'PermissionSetSchema',
    keys: () => Object.keys(PermissionSetSchema.shape),
  },
  // `reference_to` is absent — the other half of the #5017 fix.
  { receiver: 'def', expected: ['reference'], declaredBy: 'FieldSchema', keys: () => Object.keys(FieldSchema.shape) },
  // `required` joined this list with #7503: `resolveCbpRelation` mirrors the
  // runtime's three-step fallback, whose steps 1 and 3 are predicated on it.
  { receiver: 'f', expected: ['label', 'name', 'required', 'type'], declaredBy: 'FieldSchema', keys: () => Object.keys(FieldSchema.shape) },
  // [#7503] The field `resolveCbpRelation` settled on — a FieldSchema record.
  { receiver: 'found', expected: ['name', 'type'], declaredBy: 'FieldSchema', keys: () => Object.keys(FieldSchema.shape) },
  {
    receiver: 'p',
    expected: ['allowCreate', 'allowDelete', 'allowEdit', 'allowRead', 'modifyAllRecords', 'readScope', 'viewAllRecords'],
    declaredBy: 'ObjectPermissionSchema',
    keys: () => shapeKeysOf(ObjectPermissionSchema),
  },
  {
    receiver: 'wildcard',
    expected: ['modifyAllRecords', 'viewAllRecords'],
    declaredBy: 'ObjectPermissionSchema',
    keys: () => shapeKeysOf(ObjectPermissionSchema),
  },
  {
    receiver: 'action',
    expected: ['label', 'name'],
    declaredBy: 'ObjectSchema.actions[]',
    keys: () => shapeKeysOf(ObjectSchema.shape.actions),
  },
  {
    receiver: 'app',
    expected: ['label', 'name'],
    declaredBy: 'ObjectStackSchema.apps[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.apps),
  },
  {
    receiver: 'pos',
    expected: ['label', 'name'],
    declaredBy: 'ObjectStackSchema.positions[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.positions),
  },
  {
    receiver: 'book',
    expected: ['label', 'name'],
    declaredBy: 'ObjectStackSchema.books[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.books),
  },
  {
    receiver: 'audience',
    expected: ['permissionSet'],
    declaredBy: 'books[].audience',
    keys: () => shapeKeysOf((shapeOf(ObjectStackSchema.shape.books) as Record<string, unknown>).audience),
  },
  {
    receiver: 'seed',
    expected: ['object', 'records'],
    declaredBy: 'ObjectStackSchema.data[]',
    keys: () => shapeKeysOf(ObjectStackSchema.shape.data),
  },
];

/** The `.shape` object itself (not just its keys) of a wrapped collection. */
function shapeOf(schema: unknown, depth = 0): Record<string, unknown> {
  const s = schema as { shape?: Record<string, unknown>; _def?: Record<string, unknown>; unwrap?: () => unknown };
  if (!s || (typeof s !== 'object' && typeof s !== 'function') || depth > 12) return {};
  if (s.shape) return s.shape;
  const d = (s._def ?? {}) as Record<string, unknown>;
  const getter = d.getter as (() => unknown) | undefined;
  for (const next of [d.innerType, d.element, d.valueType, getter?.(), d.in, d.out]) {
    const r = shapeOf(next, depth + 1);
    if (Object.keys(r).length) return r;
  }
  if (typeof s.unwrap === 'function') return shapeOf(s.unwrap(), depth + 1);
  return {};
}

describe('validateSecurityPosture — reads only keys the spec declares (meta-test, #5017)', () => {
  it.each(READ_SURFACES)('every key read off `$receiver` is declared by $declaredBy', (surface) => {
    const read = keysReadOff(surface.receiver);
    // Exact match, so ADDING a read (or renaming a loop variable, which would
    // silently disarm the scan) forces a deliberate visit to this table.
    expect(read).toEqual(surface.expected);
    const declared = surface.keys();
    expect(declared.length, `${surface.declaredBy} resolved to no keys — the guard would be vacuous`).toBeGreaterThan(0);
    expect(read.filter((k) => !declared.includes(k))).toEqual([]);
  });

  it('covers every receiver in the source that is not explicitly excused', () => {
    // Without this, a NEW receiver (a new loop variable over a new collection)
    // would carry undeclared reads with nothing to notice — the table only
    // guards what the table lists.
    const receivers = [...new Set([...RULE_CODE.matchAll(/\b([a-z][\w$]*)\??\.[A-Za-z_$]/g)].map((m) => m[1]))];
    const tabled = new Set([...READ_SURFACES.map((s) => s.receiver), ...Object.keys(NOT_SCHEMA_RECEIVERS)]);
    // Locals whose "keys" are JS methods / this file's own plumbing, not metadata.
    const PLUMBING = new Set([
      'findings', 'objects', 'permissionSets', 'privateObjects', 'grantedObjects', 'stackSetNames',
      'records', 'reason', 'until', 'setName', 'flsKey', 'opts', 'path', 'i', 'e', 'fields', 'crm_opportunity',
      'entries', // #7503: the rule's own field list — `.find`, a JS method.
    ]);
    expect(receivers.filter((r) => !tabled.has(r) && !PLUMBING.has(r))).toEqual([]);
  });
});

/**
 * ── The two surfaces this rule deliberately does NOT read (#5017) ───────────
 *
 * Each is pinned against the schema fact that makes it unreachable, so "put
 * the fallback back, just in case" fails a test with the evidence attached
 * rather than passing quietly.
 */
const MANIFEST = { id: 'security_probe', name: 'security_probe', version: '1.0.0', type: 'app' } as const;

/** Does the schema refuse any KEY in this stack (as opposed to any VALUE)? */
function unrecognizedKeysIn(stack: unknown): string[] {
  const result = ObjectStackSchema.safeParse(stack);
  if (result.success) return [];
  return result.error.issues
    .filter((i) => i.code === 'unrecognized_keys')
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

describe('validateSecurityPosture — undeclared keys are the schema’s job, not this rule’s (#5017)', () => {
  it('there is no `objects[].security` envelope: the OWD dials are declared FLAT', () => {
    const objectKeys = Object.keys(ObjectSchema.shape);
    expect(objectKeys).not.toContain('security');
    expect(objectKeys).toEqual(expect.arrayContaining(['sharingModel', 'externalSharingModel', 'publicSharing']));

    // And `ObjectSchema` is strict, so this is not a silent strip: a stack
    // nesting the OWD under `security` is REFUSED, by name.
    expect(
      unrecognizedKeysIn({
        manifest: MANIFEST,
        objects: [{ name: 'ok_obj', label: 'OK', fields: { a: { type: 'text', label: 'A' } }, security: { sharingModel: 'private' } }],
      }).join(' '),
    ).toMatch(/Unrecognized key\(s\) on this object: `security`/);

    // So the lint reads `sharingModel` and nothing else. An author who nested
    // it gets `security-owd-unset` from here (the OWD really is unset on the
    // only key that carries one) and a named refusal from the schema — instead
    // of a silent all-clear from a fallback onto a surface that is not there.
    expect(rulesOf({ objects: [{ name: 'ok_obj', security: { sharingModel: 'private' } }] })).toEqual([
      SECURITY_OWD_UNSET,
    ]);
    expect(rulesOf({ objects: [{ name: 'ok_obj', sharingModel: 'private' }] })).toEqual([]);
  });

  it('`fields[].reference_to` is a rejected alias of `reference`', () => {
    const fieldKeys = Object.keys(FieldSchema.shape);
    expect(fieldKeys).toContain('reference');
    expect(fieldKeys).not.toContain('reference_to');
    expect(
      unrecognizedKeysIn({
        manifest: MANIFEST,
        objects: [
          {
            name: 'child', label: 'Child', sharingModel: 'controlled_by_parent',
            fields: { parent_ref: { type: 'master_detail', label: 'Parent', reference_to: 'parent_obj' } },
          },
        ],
      }).join(' '),
    ).toMatch(/Unrecognized key\(s\) on this field: `reference_to`/);

    // The finding still fires either way — `reference_to` only ever fed the
    // master's NAME into the message. On the canonical spelling that name is
    // there; on the rejected one the rule now says "master_detail" without a
    // target, and the schema says which key to fix.
    const withAlias = validateSecurityPosture({
      objects: [{ name: 'child', sharingModel: 'private', fields: [{ name: 'p', type: 'master_detail', reference_to: 'parent_obj' }] }],
      permissions: [{ name: 'ps', objects: { other: { allowRead: true } } }],
    }).filter((f) => f.rule === SECURITY_MASTER_DETAIL_UNGRANTED);
    expect(withAlias).toHaveLength(1);
    expect(withAlias[0].message).not.toContain('parent_obj');

    const withCanonical = validateSecurityPosture({
      objects: [{ name: 'child', sharingModel: 'private', fields: [{ name: 'p', type: 'master_detail', reference: 'parent_obj' }] }],
      permissions: [{ name: 'ps', objects: { other: { allowRead: true } } }],
    }).filter((f) => f.rule === SECURITY_MASTER_DETAIL_UNGRANTED);
    expect(withCanonical).toHaveLength(1);
    expect(withCanonical[0].message).toContain('"parent_obj"');
  });
});

/**
 * ── Reachability: every branch is reachable without an undeclared key ────────
 */
function pushedRuleIds(): string[] {
  const sites = RULE_CODE.split('findings.push({').slice(1);
  return sites.map((block, i) => {
    const ruleConst = /rule:\s*([A-Z_][A-Z0-9_]*)/.exec(block)?.[1];
    if (!ruleConst) throw new Error(`findings.push site #${i} has no literal \`rule:\` — the guard cannot map it`);
    const id = RULE_IDS[ruleConst];
    if (!id) throw new Error(`findings.push site #${i} emits unknown rule id \`${ruleConst}\``);
    return id;
  });
}

const RULE_IDS: Record<string, string> = {
  SECURITY_OWD_UNSET,
  SECURITY_OWD_ALIAS,
  SECURITY_EXTERNAL_WIDER,
  SECURITY_WILDCARD_VAMA,
  SECURITY_ANCHOR_HIGH_PRIVILEGE,
  SECURITY_ROLE_WORD,
  SECURITY_BOOK_AUDIENCE_UNKNOWN_SET,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_MASTER_DETAIL_UNGRANTED,
  SECURITY_FLS_UNQUALIFIED_KEY,
  SECURITY_GRANT_EXPIRED_AT_AUTHORING,
  SECURITY_DELEGATION_MISSING_REASON,
  SECURITY_CBP_NO_RELATION,
};

const TEXT_FIELD = { a: { type: 'text', label: 'A' } } as const;
const objectFixture = (extra: Record<string, unknown>) => ({ label: 'X', fields: TEXT_FIELD, ...extra });

/**
 * One fixture per rule. Every one is a full stack put through
 * `unrecognizedKeysIn` below — values the schema refuses are allowed (that is
 * what half these rules are FOR), keys it refuses are not.
 */
const REACHABILITY_CORPUS: Array<{ label: string; stack: Record<string, unknown> }> = [
  { label: 'owd-unset', stack: { objects: [objectFixture({ name: 'leave_request' })] } },
  { label: 'owd-alias (retired value)', stack: { objects: [objectFixture({ name: 'leave_request', sharingModel: 'read' })] } },
  { label: 'owd-alias (non-canonical value)', stack: { objects: [objectFixture({ name: 'leave_request', sharingModel: 'nonsense' })] } },
  { label: 'owd-alias (external retired value)', stack: { objects: [objectFixture({ name: 'o', sharingModel: 'private', externalSharingModel: 'full' })] } },
  {
    label: 'external-wider',
    stack: { objects: [objectFixture({ name: 'o', sharingModel: 'private', externalSharingModel: 'public_read_write' })] },
  },
  { label: 'fls-unqualified-key', stack: { permissions: [{ name: 'ps', label: 'PS', objects: {}, fields: { budget: { readable: true } } }] } },
  { label: 'wildcard-vama', stack: { permissions: [{ name: 'ps', label: 'PS', objects: { '*': { viewAllRecords: true } } }] } },
  {
    label: 'anchor-high-privilege',
    stack: { permissions: [{ name: 'ps', label: 'PS', isDefault: true, objects: { '*': { modifyAllRecords: true } } }] },
  },
  { label: 'role-word (identifier)', stack: { objects: [objectFixture({ name: 'user_role', sharingModel: 'private' })] } },
  { label: 'role-word (label)', stack: { objects: [objectFixture({ name: 'user_duty', label: 'User Role', sharingModel: 'private' })] } },
  {
    label: 'book-audience-unknown-set',
    stack: { books: [{ name: 'guide', label: 'Guide', slug: 'guide', groups: [], audience: { permissionSet: 'nobody_declares_this' } }] },
  },
  {
    label: 'private-no-readscope',
    stack: {
      objects: [objectFixture({ name: 'todo', sharingModel: 'private' })],
      permissions: [{ name: 'ps', label: 'PS', objects: { todo: { allowRead: true } } }],
    },
  },
  {
    label: 'master-detail-ungranted',
    stack: {
      objects: [
        objectFixture({
          name: 'line_item', sharingModel: 'controlled_by_parent',
          fields: { parent_ref: { type: 'master_detail', label: 'Parent', reference: 'invoice' } },
        }),
      ],
      permissions: [{ name: 'ps', label: 'PS', objects: { invoice: { allowRead: true } } }],
    },
  },
  {
    label: 'cbp-no-relation',
    stack: {
      objects: [objectFixture({ name: 'line_item', sharingModel: 'controlled_by_parent' })],
    },
  },
  {
    label: 'grant-expired-at-authoring',
    stack: { data: [{ object: 'sys_user_position', records: [{ user_id: 'u1', position: 'p', valid_until: '2020-01-01T00:00:00Z' }] }] },
  },
  {
    label: 'delegation-missing-reason',
    // sys_user_position, NOT sys_user_permission_set: `delegated_from` was
    // retired from the permission-set table (#9730), and the D3 branch is
    // scoped to the position table with it — a permission-set fixture can no
    // longer reach this push site at all.
    stack: { data: [{ object: 'sys_user_position', records: [{ user_id: 'u1', position: 'approver', delegated_from: 'u2' }] }] },
  },
];

describe('validateSecurityPosture — every branch is reachable without an undeclared key (meta-test, #5017)', () => {
  it.each(REACHABILITY_CORPUS)('$label: the fixture uses only keys the spec declares', ({ stack }) => {
    expect(unrecognizedKeysIn({ manifest: MANIFEST, ...stack })).toEqual([]);
  });

  it('maps every `findings.push` site in the source', () => {
    expect(pushedRuleIds()).toHaveLength(16);
  });

  it('reaches every `findings.push` site from that corpus', () => {
    // [#8310] Both exported rules of this module: `pushedRuleIds()` scans the
    // whole source file, so the corpus must drive the whole file too.
    const emitted = new Set(
      REACHABILITY_CORPUS.flatMap(({ stack }) => [
        ...validateSecurityPosture(stack, { nowMs: Date.parse('2026-07-10T12:00:00Z') }),
        ...validateSecurityRoleWord(stack),
      ].map((f) => f.rule)),
    );
    expect(
      [...new Set(pushedRuleIds())].filter((id) => !emitted.has(id)),
      'a branch no key-legal stack can reach must be deleted, not kept "just in case" (#5017)',
    ).toEqual([]);
  });
});
