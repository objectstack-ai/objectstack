// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0090 D7] Security-posture linter — one failing fixture per rule (the
 * ADR's own acceptance bar: "each lint rule has a fixture that fails without
 * it"), plus the clean-stack fixture that must stay silent.
 */

import { describe, it, expect } from 'vitest';
import {
  validateSecurityPosture,
  SECURITY_OWD_UNSET,
  SECURITY_OWD_ALIAS,
  SECURITY_EXTERNAL_WIDER,
  SECURITY_WILDCARD_VAMA,
  SECURITY_ANCHOR_HIGH_PRIVILEGE,
  SECURITY_ROLE_WORD,
  SECURITY_PRIVATE_NO_READSCOPE,
  SECURITY_MASTER_DETAIL_UNGRANTED,
} from './validate-security-posture.js';

const rulesOf = (stack: Record<string, unknown>) =>
  validateSecurityPosture(stack).map((f) => f.rule);

describe('validateSecurityPosture (ADR-0090 D7)', () => {
  it('clean stack produces no findings', () => {
    const findings = validateSecurityPosture({
      objects: [
        { name: 'leave_request', label: 'Leave Request', sharingModel: 'private', fields: { title: { name: 'title', label: 'Title' } } },
        { name: 'leave_item', label: 'Leave Item', sharingModel: 'controlled_by_parent' },
        { name: 'sys_internal', label: 'Internal' }, // system prefix — exempt from OWD rules
      ],
      permissions: [
        {
          name: 'hr_user',
          label: 'HR User',
          objects: { leave_request: { allowRead: true, allowCreate: true, readScope: 'unit' } },
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

  it('honors sharingModel nested under security.*', () => {
    expect(
      rulesOf({ objects: [{ name: 'ok_obj', security: { sharingModel: 'private' } }] }),
    ).toEqual([]);
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
  it('errors on "role" in identifiers and labels across kinds', () => {
    const findings = validateSecurityPosture({
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
      rulesOf({
        objects: [
          { name: 'payroll_run', label: 'Payroll — Controlled Rollout', sharingModel: 'private' },
        ],
      }),
    ).toEqual([]);
  });

  it('skips system objects (better-auth sys_member.role is the documented exception)', () => {
    expect(
      rulesOf({ objects: [{ name: 'sys_member', fields: { role: { name: 'role', label: 'Role' } } }] }),
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
