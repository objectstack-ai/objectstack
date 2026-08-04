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
 * "cross-org BU mega-tree" the ADR rejected, arrived at by accident. It covers
 * BOTH business-unit recipients, `business_unit` and `unit_and_subordinates`
 * — see {@link BU_TREE_RECIPIENT_TYPES} for the word list and its deliberate
 * complement.
 *
 * Both are `error`, per ADR-0049 discipline: each mirrors a real enforcement
 * property (the Layer 0 wall's independence; the org-predicated BU resolver),
 * so the lint moves the failure from silent-wrong-answer to author-time fix-it.
 *
 * Pure `(stack) => Finding[]`; accepts the NORMALIZED stack input.
 *
 * ## Scope — the keys this rule reads, and the ones it deliberately does not
 *
 * Every key below is one `@objectstack/spec` DECLARES. That is a contract, not
 * a style preference: the rule is registered `input: 'parsed'`, so what it sees
 * is what `ObjectStackSchema` returned. An undeclared key never survives to be
 * read — the stack root strips it, and the `.strict()` sub-schemas reject the
 * whole stack outright — so a branch keyed on one is inert for every stack an
 * author can actually ship (#4984, #5009).
 *
 * | Read                                  | Declared by                        |
 * |---------------------------------------|------------------------------------|
 * | `permissions[]`                       | `ObjectStackSchema`                |
 * | `permissions[].rowLevelSecurity[]`    | `PermissionSetSchema`              |
 * | `…[].using` / `…[].check`             | `RowLevelSecurityPolicySchema`     |
 * | `sharingRules[]`                      | `ObjectStackSchema`                |
 * | `sharingRules[].condition` / `.sharedWith` / `.object` | `SharingRuleSchema` |
 * | `objects[].tenancy` / `.systemFields` | `ObjectSchema`                     |
 *
 * NOT read, and each for a reason that is a schema fact:
 *
 * - `permissionSets` / `sharing` — not declared on the stack root. The root
 *   STRIPS them, so after parse they are `undefined` no matter what the author
 *   wrote. The declared spellings are `permissions` and `sharingRules`.
 * - `sharingRules[].objectName` — `SharingRuleSchema` is `.strict()` and knows
 *   it only as a rejected name; `object` is required, so the canonical read can
 *   never be missing on a rule that parsed.
 * - `objects[].rowLevelSecurity` / `objects[].rls` — **object-level RLS is not
 *   an authoring surface at all.** `ObjectSchema` declares neither key (nor
 *   does `authorable-surface.json` list one: the sole entry is
 *   `security/PermissionSet:rowLevelSecurity`), and `ObjectSchema` is
 *   `.strict()`, so a stack carrying one does not parse — it is refused with
 *   "Unrecognized key(s) on this object". Until #5009 this file walked that
 *   non-existent surface for ~20 lines, complete with an `objects[N].
 *   rowLevelSecurity[M].using` diagnostic path. Nothing could reach it, and the
 *   cost was never the missed finding: the next author to read this rule (human
 *   or AI) came away believing object-level RLS was a real authorization
 *   surface and wrote more code against it (#5008 nearly did). RLS policies
 *   live on a permission set; that is the branch above.
 *
 * Alias tolerance belongs at the schema's refusal, not in a consumer (Prime
 * Directive #12) — where it also converts a loud, named rejection into a
 * silently-inert gate. `validate-org-axis-red-lines.test.ts` pins all of this
 * structurally: every key read here is checked against the declaring schema's
 * own `.shape`, and every `findings.push` site must be reachable by a fixture
 * that passed `safeParse`.
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

/**
 * The sharing-rule recipients rule ② intercepts: the ones whose runtime
 * expansion IS the business-unit tree.
 *
 * Cross-checked word-for-word against the authoring enum `ShareRecipientType`
 * (`@objectstack/spec/security`, `sharing.zod.ts`) — the only vocabulary an
 * author can write, since `sharedWith` is `.strict()` and rejects everything
 * else by name. That enum has FIVE members; this list intercepts two, and the
 * difference is deliberate, not an oversight (it is exactly the oversight
 * #4991 was filed for — ② shipped naming only `business_unit` while ADR-0105
 * D6 ②'s own text names `unit_and_subordinates`):
 *
 * | `ShareRecipientType`    | ② | Why                                        |
 * |-------------------------|---|--------------------------------------------|
 * | `business_unit`         | ✅ | Members of exactly one BU — `BusinessUnitGraphService`, org-predicated. |
 * | `unit_and_subordinates` | ✅ | That BU **plus every descendant unit** (ADR-0057 D5 subtree widening) — same resolver, strictly WIDER grant. |
 * | `user`                  | — | A literal user id, no expansion at all. No tree to resolve, so no org to resolve it in. |
 * | `team`                  | — | `sys_team` is a FLAT collaboration grouping (ADR-0090 D3 renamed `group` → `team`); `TeamGraphService`, not the BU graph. |
 * | `position`              | — | Flat holder expansion (ADR-0090 D3 finalized the retirement of the position hierarchy); `PositionGraphService`, not the BU graph. The BU *depth scopes* D6 ② also names are a SCOPE mechanism, not a sharing-rule recipient. |
 *
 * The three allowed recipients are the sanctioned way to share a
 * platform-global object (ADR-0066): naming a user, a flat team, or a flat
 * position audience grants those people the catalog, which is the entire point
 * of `tenancy.enabled: false`. What ② forbids is not "sharing a global object"
 * but "resolving a BU SUBTREE with no organization to resolve it within".
 *
 * The runtime contract `SharingRuleRecipientType`
 * (`spec/contracts/sharing-service.ts`) additionally carries `queue`; it is
 * deliberately NOT authorable ("no `sys_queue` yet") and `expandRecipient`
 * returns `[]` for it, so no author can reach it and it grants nothing. If it
 * ever becomes authorable it is a work-distribution list, not a BU node — but
 * this table is the place to re-decide that, in `ShareRecipientType` order.
 */
const BU_TREE_RECIPIENT_TYPES = new Set(['business_unit', 'unit_and_subordinates']);

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

/**
 * The text behind an `ExpressionInput` slot — the CEL source, whichever shape
 * it arrives in.
 *
 * `SharingRule.condition` is an `ExpressionInputSchema`: a bare string at
 * authoring time, the `{ dialect, source }` envelope after parse, and
 * `{ dialect, ast }` once `objectstack compile` lowers it. This rule sees all
 * three (`input: 'parsed'`, falling back to the normalized stack under `os
 * lint`), so each has to yield something to scan. The `ast` branch stringifies
 * the node — a field reference survives as its identifier — while no branch
 * ever reads `meta.rationale`, whose prose may legitimately name the very field
 * it is explaining that the rule does NOT use.
 */
function expressionText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') {
    const rec = v as AnyRec;
    if (typeof rec.source === 'string') return rec.source;
    if (rec.ast !== undefined) return JSON.stringify(rec.ast) ?? '';
  }
  return '';
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
  // RLS policies live on a PERMISSION SET (`permissions[].rowLevelSecurity`) —
  // the one place `ObjectSchema` does not offer and `PermissionSetSchema` does.
  // See the `## Scope` table above for the object-level surface that looked
  // like a second home for them and never was (#5009).
  const permissionSets = asArray(cfg.permissions);
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

  // Sharing rules — the predicate and the recipient may both reach for the org
  // parent, so both slots are scanned.
  //
  // The keys read here are the ones `SharingRuleSchema` DECLARES: `condition`
  // (the CEL predicate) and `sharedWith` (the recipient). `criteria` / `filter`
  // / `sharedTo` / `recipient` are NOT alternative spellings — the schema is
  // `.strict()` and rejects them by name, with `sharingRuleUnknownKeyError`
  // prescribing the canonical key. Reading them here as `??` fallbacks is what
  // made this red line inert for every spec-valid stack (#4984): after parse
  // they are always `undefined`, so the gate never fired. Alias tolerance
  // belongs at the schema's refusal, not in a consumer (Prime Directive #12).
  // The collection itself is `sharingRules`; `sharing` was the same mistake one
  // level up, and is gone with the rest of them (#5009).
  asArray(cfg.sharingRules).forEach((rule, rIndex) => {
    const slots: Array<{ key: string; text: string }> = [
      { key: 'condition', text: expressionText(rule.condition) },
      { key: 'sharedWith', text: JSON.stringify(rule.sharedWith ?? '') ?? '' },
    ];
    for (const slot of slots) {
      if (!slot.text.includes(ORG_PARENT_FIELD)) continue;
      findings.push({
        severity: 'error',
        rule: ORG_AXIS_PERMISSION_INHERITANCE,
        where: `sharing rule "${str(rule.name) || rIndex}"`,
        path: `sharingRules[${rIndex}].${slot.key}`,
        message:
          `Sharing rule ${slot.key} reads \`${ORG_PARENT_FIELD}\`, granting access by walking the ` +
          `organization tree. ADR-0105 D6 forbids permission inheritance along the org axis.`,
        hint: INHERITANCE_HINT,
      });
    }
  });

  // ── ② Business-unit trees remain org-internal ─────────────────────────────
  //
  // A business-unit recipient on a platform-global object has no organization
  // column to scope against, so the grant reaches every organization's rows.
  // Both BU recipients count — see `BU_TREE_RECIPIENT_TYPES` for why that word
  // list is two long and which three of `ShareRecipientType` it lets past.
  const tenancyDisabledObjects = new Set(
    asArray(cfg.objects).filter((o) => isTenancyDisabled(o)).map((o) => str(o.name)).filter(Boolean),
  );
  asArray(cfg.sharingRules).forEach((rule, rIndex) => {
    // `object` is REQUIRED by `SharingRuleSchema`, so a rule that parsed always
    // has it; `objectName` is not a spelling the schema accepts (#5009).
    const target = str(rule.object);
    if (!target || !tenancyDisabledObjects.has(target)) return;
    // `sharedWith` is the declared recipient key; `sharedTo` / `recipient` are
    // spelt out only in the schema's rejection message (#4984).
    const sharedWith = rule.sharedWith as AnyRec | undefined;
    const recipientType = str(sharedWith?.type);
    if (!BU_TREE_RECIPIENT_TYPES.has(recipientType)) return;
    // `unit_and_subordinates` is the strictly wider of the two — it is the BU
    // named plus every descendant unit — so say which one was written rather
    // than a generic "business-unit rule" the author has to go look up.
    const reach =
      recipientType === 'unit_and_subordinates'
        ? 'a business unit AND every descendant unit'
        : 'a business unit';
    findings.push({
      severity: 'error',
      rule: ORG_AXIS_CROSS_ORG_BU_GRANT,
      where: `sharing rule "${str(rule.name) || rIndex}" on object "${target}"`,
      path: `sharingRules[${rIndex}].sharedWith`,
      message:
        `Sharing rule recipient \`${recipientType}\` (${reach}) targets "${target}", which opted out of ` +
        `tenancy (\`tenancy.enabled: false\`). Platform-global objects carry no organization column, so ` +
        `this grant spans EVERY organization — a cross-organization business-unit grant, which ADR-0105 ` +
        `D6 forbids (BU trees are org-internal).`,
      hint:
        `Either scope the object to organizations (drop \`tenancy.enabled: false\` so Layer 0 walls it), ` +
        `or share it to a \`user\` / \`team\` / \`position\` audience instead — those expand flat, with no ` +
        `business-unit tree to resolve. A platform-global catalog that everyone should read wants an OWD ` +
        `of \`public_read\`, not a BU grant.`,
    });
  });

  return findings;
}
