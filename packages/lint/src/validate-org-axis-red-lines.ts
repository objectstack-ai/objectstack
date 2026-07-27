// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0105 D6] The two organization-axis red lines, enforced at authoring time.
 *
 * ADR-0105 gives organizations a reporting/grouping dimension
 * (`sys_organization.parent_organization_id`, sibling ordering). That dimension
 * is load-bearing for consolidated reporting — and dangerous, because it LOOKS
 * like a permission hierarchy. Two lines keep it from becoming one:
 *
 * | Rule                                    | Red line                          |
 * |-----------------------------------------|-----------------------------------|
 * | org-axis-permission-inheritance (error) | D6 ①: no inheritance along the org tree |
 * | org-axis-cross-org-bu-grant     (error) | D6 ②: business-unit trees stay org-internal |
 *
 * **① No permission inheritance along the org axis.** Cross-organization
 * visibility comes from membership union (`accessible_org_ids`, ADR-0105 D2) —
 * the engine's own Layer 0 wall — never from walking a parent reference. An RLS
 * policy or sharing rule that reads `parent_organization_id` builds a SECOND
 * permission hierarchy beside the business-unit tree: exactly the dual-hierarchy
 * mistake ADR-0057 D5 retired and ADR-0090 D3 finalized for positions. It also
 * silently outranks the wall it sits behind, since a Layer-1 policy cannot widen
 * Layer 0 (W1) — so the author gets a rule that appears to grant access and
 * does not. Fail at authoring, not in a support ticket.
 *
 * **② Business-unit trees remain org-internal.** `sys_business_unit` is
 * org-scoped and every BU mechanism (`unit_and_subordinates` sharing,
 * `adminScope` delegation, depth scopes) resolves within ONE organization. A
 * business-unit sharing rule on a PLATFORM-GLOBAL object (`tenancy.enabled:
 * false`) has no organization column to scope against, so the grant spans every
 * organization in the database — a cross-org BU grant by construction, and the
 * "cross-org BU mega-tree" the ADR rejected, arrived at by accident.
 *
 * Both are `error`, per ADR-0049 discipline: each mirrors a real enforcement
 * property (the Layer 0 wall's independence; the org-predicated BU resolver),
 * so the lint moves the failure from silent-wrong-answer to author-time fix-it.
 *
 * Pure `(stack) => Finding[]`; accepts the NORMALIZED stack input.
 */

export const ORG_AXIS_PERMISSION_INHERITANCE = 'org-axis-permission-inheritance';
export const ORG_AXIS_CROSS_ORG_BU_GRANT = 'org-axis-cross-org-bu-grant';

export type OrgAxisSeverity = 'error' | 'warning';

export interface OrgAxisFinding {
  severity: OrgAxisSeverity;
  /** Diagnostic rule id (`org-axis-*`). */
  rule: string;
  /** Human-readable location, e.g. `permission set "plant_reader"`. */
  where: string;
  /** Config path, e.g. `permissions[2].rowLevelSecurity[0].using`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/** The org-axis grouping reference. Reporting only — never an authorization input. */
const ORG_PARENT_FIELD = 'parent_organization_id';

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** True iff the object opted out of tenancy — platform-global, no org column. */
function isTenancyDisabled(object: AnyRec): boolean {
  const tenancy = object.tenancy as AnyRec | undefined;
  if (tenancy && typeof tenancy === 'object' && tenancy.enabled === false) return true;
  const systemFields = object.systemFields as AnyRec | undefined;
  if (systemFields && typeof systemFields === 'object' && systemFields.tenant === false) return true;
  return false;
}

const INHERITANCE_HINT =
  `Remove the ${ORG_PARENT_FIELD} reference. Cross-organization visibility comes from MEMBERSHIP: ` +
  `under the \`group\` tenancy posture the engine's Layer 0 wall is ` +
  `\`organization_id IN accessible_org_ids\`, so a user who should see several organizations is made ` +
  `a member of them (ADR-0105 D2). A Layer-1 policy cannot widen Layer 0 anyway, so this rule would ` +
  `not grant the access it appears to. For a hierarchy INSIDE one organization, use the business-unit ` +
  `tree (\`unit_and_subordinates\` sharing, or a depth scope anchored on \`sys_user_position\`).`;

/**
 * Lint an ObjectStack config for the ADR-0105 D6 organization-axis red lines.
 */
export function validateOrgAxisRedLines(stack: unknown): OrgAxisFinding[] {
  const findings: OrgAxisFinding[] = [];
  const cfg = (stack ?? {}) as AnyRec;

  // ── ① No permission inheritance along the org axis ────────────────────────
  //
  // RLS policies may live on a permission set (`rowLevelSecurity`) or be
  // authored per object; both reach the same compiler, so both are checked.
  const permissionSets = asArray(cfg.permissions ?? cfg.permissionSets);
  permissionSets.forEach((ps, psIndex) => {
    asArray(ps.rowLevelSecurity).forEach((policy, pIndex) => {
      for (const clause of ['using', 'check'] as const) {
        if (!str(policy[clause]).includes(ORG_PARENT_FIELD)) continue;
        findings.push({
          severity: 'error',
          rule: ORG_AXIS_PERMISSION_INHERITANCE,
          where: `permission set "${str(ps.name) || psIndex}" policy "${str(policy.name) || pIndex}"`,
          path: `permissions[${psIndex}].rowLevelSecurity[${pIndex}].${clause}`,
          message:
            `RLS ${clause} reads \`${ORG_PARENT_FIELD}\`, which builds a permission hierarchy along the ` +
            `organization axis. ADR-0105 D6 forbids it: the org tree is a REPORTING dimension only.`,
          hint: INHERITANCE_HINT,
        });
      }
    });
  });

  const objects = asArray(cfg.objects);
  objects.forEach((object, oIndex) => {
    const objectName = str(object.name) || String(oIndex);

    asArray(object.rowLevelSecurity ?? object.rls).forEach((policy, pIndex) => {
      for (const clause of ['using', 'check'] as const) {
        if (!str(policy[clause]).includes(ORG_PARENT_FIELD)) continue;
        findings.push({
          severity: 'error',
          rule: ORG_AXIS_PERMISSION_INHERITANCE,
          where: `object "${objectName}" policy "${str(policy.name) || pIndex}"`,
          path: `objects[${oIndex}].rowLevelSecurity[${pIndex}].${clause}`,
          message:
            `RLS ${clause} reads \`${ORG_PARENT_FIELD}\`, which builds a permission hierarchy along the ` +
            `organization axis. ADR-0105 D6 forbids it: the org tree is a REPORTING dimension only.`,
          hint: INHERITANCE_HINT,
        });
      }
    });
  });

  // Sharing rules — criteria and recipient may both reach for the org parent.
  asArray(cfg.sharingRules ?? cfg.sharing).forEach((rule, rIndex) => {
    const criteria = JSON.stringify(rule.criteria ?? rule.filter ?? '');
    const sharedTo = JSON.stringify(rule.sharedTo ?? rule.recipient ?? '');
    if (criteria.includes(ORG_PARENT_FIELD) || sharedTo.includes(ORG_PARENT_FIELD)) {
      findings.push({
        severity: 'error',
        rule: ORG_AXIS_PERMISSION_INHERITANCE,
        where: `sharing rule "${str(rule.name) || rIndex}"`,
        path: `sharingRules[${rIndex}]`,
        message:
          `Sharing rule reads \`${ORG_PARENT_FIELD}\`, granting access by walking the organization ` +
          `tree. ADR-0105 D6 forbids permission inheritance along the org axis.`,
        hint: INHERITANCE_HINT,
      });
    }
  });

  // ── ② Business-unit trees remain org-internal ─────────────────────────────
  //
  // A `business_unit` recipient on a platform-global object has no organization
  // column to scope against, so the grant reaches every organization's rows.
  const tenancyDisabledObjects = new Set(
    objects.filter((o) => isTenancyDisabled(o)).map((o) => str(o.name)).filter(Boolean),
  );
  asArray(cfg.sharingRules ?? cfg.sharing).forEach((rule, rIndex) => {
    const target = str(rule.object ?? rule.objectName);
    if (!target || !tenancyDisabledObjects.has(target)) return;
    const sharedTo = (rule.sharedTo ?? rule.recipient) as AnyRec | undefined;
    const recipientType = str(sharedTo?.type);
    if (recipientType !== 'business_unit') return;
    findings.push({
      severity: 'error',
      rule: ORG_AXIS_CROSS_ORG_BU_GRANT,
      where: `sharing rule "${str(rule.name) || rIndex}" on object "${target}"`,
      path: `sharingRules[${rIndex}].sharedTo`,
      message:
        `A business-unit sharing rule targets "${target}", which opted out of tenancy ` +
        `(\`tenancy.enabled: false\`). Platform-global objects carry no organization column, so this ` +
        `grant spans EVERY organization — a cross-organization business-unit grant, which ADR-0105 D6 ` +
        `forbids (BU trees are org-internal).`,
      hint:
        `Either scope the object to organizations (drop \`tenancy.enabled: false\` so Layer 0 walls it), ` +
        `or share it to a position / permission-set audience instead of a business unit. A ` +
        `platform-global catalog that everyone should read wants an OWD of \`public_read\`, not a BU grant.`,
    });
  });

  return findings;
}
