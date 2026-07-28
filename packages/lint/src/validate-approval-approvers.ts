// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approval-node approver authoring lint (ADR-0090 D3 fallout).
 *
 * `org_membership_level` (and `role`, its deprecated spelling) resolves against
 * better-auth's org-membership tier (`sys_member.role`: owner / admin / member)
 * — it is NOT a position. After ADR-0090 D3 renamed `sys_role` → `sys_position`,
 * downstream apps that authored `{ type: 'role', value: 'sales_manager' }`
 * silently route the approval to nobody: the expansion finds no member row,
 * falls back to the `role:sales_manager` literal, and the request waits on an
 * approver that can never act. These rules move that failure from a stuck
 * request at runtime to a located fix-it at author time.
 *
 * Rules:
 *
 * | Rule                                       | Severity | Origin                     |
 * |--------------------------------------------|----------|----------------------------|
 * | approval-approver-not-membership-tier      | warning  | ADR-0090 D3 (hotcrm class) |
 * | approval-approver-type-deprecated          | warning  | ADR-0090 D3 (#3133)        |
 * | approval-approver-type-unknown             | warning  | contract-first (PD #12)    |
 * | approval-escalation-reassign-no-target     | warning  | silent notify degradation  |
 * | approval-approvers-may-resolve-empty       | info     | empty-position dead-end (#3424) |
 * | approval-expression-invalid                | error/info | #3447 P2 closed-root expressions |
 * | approval-expression-no-empty-policy        | info     | #3447 P2 empty-slate policy |
 * | approval-decision-outputs-reserved         | error    | #3447 P2 resume envelope   |
 * | approval-approver-cross-org-unsupported    | error    | ADR-0105 D9 targeting      |
 *
 * The first two are mutually exclusive by construction — a bad *value* wins,
 * because its fix (`position`) differs from the deprecation's fix
 * (`org_membership_level`), and prescribing the latter for a position name
 * would be wrong advice.
 *
 * Warnings (not errors): a custom better-auth membership tier is legal, and
 * the runtime keeps its literal fallback — but both shapes are near-certainly
 * authoring mistakes, so say it out loud.
 *
 * Pure `(stack) => Finding[]`; accepts the NORMALIZED stack input.
 */

import {
  ApproverType,
  APPROVAL_NODE_TYPE,
  DEPRECATED_APPROVER_TYPES,
  APPROVER_VALUE_BINDINGS,
  approverTypeIsOrgScoped,
  canonicalApproverType,
  normalizeDecisionOutputs,
} from '@objectstack/spec/automation';
import { BUILTIN_MEMBERSHIP_ROLES } from '@objectstack/spec';
import { collectCelRootIdentifiers } from '@objectstack/formula';

export const APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER = 'approval-approver-not-membership-tier';
export const APPROVAL_APPROVER_TYPE_DEPRECATED = 'approval-approver-type-deprecated';
export const APPROVAL_APPROVER_TYPE_UNKNOWN = 'approval-approver-type-unknown';
export const APPROVAL_APPROVER_TYPE_UNSUPPORTED = 'approval-approver-type-unsupported';
export const APPROVAL_ESCALATION_REASSIGN_NO_TARGET = 'approval-escalation-reassign-no-target';
export const APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY = 'approval-approvers-may-resolve-empty';
export const APPROVAL_EXPRESSION_INVALID = 'approval-expression-invalid';
export const APPROVAL_EXPRESSION_NO_EMPTY_POLICY = 'approval-expression-no-empty-policy';
export const APPROVAL_DECISION_OUTPUTS_RESERVED = 'approval-decision-outputs-reserved';
export const APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED = 'approval-approver-cross-org-unsupported';

/**
 * The CLOSED root set an `expression` approver may reference (#3447 P2) —
 * `current` (live record at node entry), `trigger` (submit-time snapshot),
 * `vars` (flow variables). Mirrors APPROVER_EXPRESSION_ROOTS in
 * plugin-approvals; both sides extract roots via the same
 * {@link collectCelRootIdentifiers}, so what lints clean is what runs.
 */
const EXPRESSION_ROOTS = new Set(['current', 'trigger', 'vars']);

/** Resume-envelope keys a decision output may never use (#3447 P2). */
const RESERVED_OUTPUT_KEYS = new Set(['decision', 'requestId']);

/**
 * Approver types that route to a GROUP whose membership is runtime data and can
 * be empty (an unstaffed position, an empty team/department). When EVERY
 * approver on a node is one of these, the node can resolve to an empty slate at
 * runtime — the framework#3424 dead-end. Individually-routed types
 * (`user`/`field`/`manager`), the guaranteed-staffed `org_membership_level`
 * tiers, and the opaque `queue` are deliberately excluded: any of them present
 * signals the author has a non-group route, so the node isn't purely
 * group-gated.
 */
const GROUP_ROUTED_TYPES = new Set(['position', 'team', 'department']);

export type ApprovalApproverSeverity = 'error' | 'warning' | 'info';

export interface ApprovalApproverFinding {
  severity: ApprovalApproverSeverity;
  /** Diagnostic rule id (`approval-*`). */
  rule: string;
  /** Human-readable location, e.g. `flow "expense_approval" · node "step1"`. */
  where: string;
  /** Config path, e.g. `flows[0].nodes[2].config.approvers[0]`. */
  path: string;
  /** What is wrong. */
  message: string;
  /** How to fix it. */
  hint: string;
}

type AnyRec = Record<string, unknown>;

/**
 * The org-membership tiers `sys_member.role` actually stores — DERIVED, not
 * transcribed (ADR-0108 / #3723).
 *
 * The vocabulary is closed and framework-owned, so the one source in
 * `@objectstack/spec` is also the only correct list here. A hand-kept copy is
 * how this list came to carry `guest`, which the `sys_member.role` select has
 * never offered: an approver naming it resolved to nobody, and the lint that
 * exists to catch exactly that stayed silent.
 *
 * Anything outside this set authored as `{ type: 'org_membership_level' }` (or
 * its deprecated `role` spelling) is almost certainly a position name.
 */
const MEMBERSHIP_TIERS: ReadonlySet<string> = new Set<string>(BUILTIN_MEMBERSHIP_ROLES);

/** The same list, rendered for diagnostics — so no message can contradict it. */
const MEMBERSHIP_TIER_LIST = BUILTIN_MEMBERSHIP_ROLES.join('/');

/** Off-spec dialect spellings we can name a canonical fix for. */
const TYPE_FIX: Record<string, string> = {
  business_unit: 'department',
  bu: 'department',
};

/** Coerce a collection (array or name-keyed map) to an array of records. */
function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  }
  return [];
}

/**
 * Validate the approvers of every Approval node in the stack's flows.
 * Returns findings (empty = clean).
 */
export function validateApprovalApprovers(stack: AnyRec): ApprovalApproverFinding[] {
  const findings: ApprovalApproverFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const flows = asArray(stack.flows);
  const validTypes = new Set<string>(ApproverType.options);

  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi];
    if (!flow || typeof flow !== 'object') continue;
    const flowName = typeof flow.name === 'string' ? flow.name : `(flow ${fi})`;
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];

    for (let ni = 0; ni < nodes.length; ni++) {
      const node = nodes[ni];
      if (!node || node.type !== APPROVAL_NODE_TYPE) continue;
      const nodeId = typeof node.id === 'string' ? node.id : `(node ${ni})`;
      const cfg = (node.config ?? {}) as AnyRec;
      const approvers = Array.isArray(cfg.approvers) ? (cfg.approvers as AnyRec[]) : [];
      const where = `flow "${flowName}" · node "${nodeId}"`;

      for (let ai = 0; ai < approvers.length; ai++) {
        const a = approvers[ai];
        if (!a || typeof a !== 'object') continue;
        const type = typeof a.type === 'string' ? a.type : '';
        const value = typeof a.value === 'string' ? a.value : '';
        const path = `flows[${fi}].nodes[${ni}].config.approvers[${ai}]`;

        if (type && !validTypes.has(type)) {
          const fix = TYPE_FIX[type];
          findings.push({
            severity: 'warning',
            rule: APPROVAL_APPROVER_TYPE_UNKNOWN,
            where,
            path: `${path}.type`,
            message:
              `approver type '${type}' is not an ApproverType (${ApproverType.options.join(' | ')}).`,
            hint: fix
              ? `Use the spec value: { type: '${fix}', value: '${value}' }.`
              : `Pick one of the spec values; unmapped types degrade to an inert '${type}:${value}' literal at runtime.`,
          });
          continue;
        }

        const canonical = canonicalApproverType(type);

        // Expression approvers (#3447 P2): the runtime REJECTS an expression
        // that doesn't parse or references a root outside `current`/`trigger`/
        // `vars` (the CEL env would resolve an unknown root as dyn → null → a
        // silently-empty slate, so the pre-check fails the node loudly). Catch
        // both at author time — `error`, because the node cannot run.
        if (canonical === 'expression') {
          const source = value.trim();
          if (!source) {
            findings.push({
              severity: 'error',
              rule: APPROVAL_EXPRESSION_INVALID,
              where,
              path: `${path}.value`,
              message: `expression approver has an empty expression — the node fails at entry.`,
              hint:
                `Write a CEL expression over current.* (the record's live state at node entry), ` +
                `trigger.* (the submit-time snapshot) or vars.* (flow variables), ` +
                `e.g. current.approvers_dynamic or vars.approval_lead.picked_departments.`,
            });
          } else {
            const parsed = collectCelRootIdentifiers(source);
            if (!parsed.ok) {
              findings.push({
                severity: 'error',
                rule: APPROVAL_EXPRESSION_INVALID,
                where,
                path: `${path}.value`,
                message: `expression approver does not parse as CEL: ${parsed.error}.`,
                hint:
                  `Approver expressions are bare CEL (no {…} template braces), e.g. ` +
                  `current.approvers_dynamic or vars.get_reviewers.record.owner_id.`,
              });
            } else {
              const illegal = parsed.roots.filter((r) => !EXPRESSION_ROOTS.has(r));
              if (illegal.length) {
                const wantsRecord = illegal.includes('record') || illegal.includes('previous');
                findings.push({
                  severity: 'error',
                  rule: APPROVAL_EXPRESSION_INVALID,
                  where,
                  path: `${path}.value`,
                  message:
                    `expression approver references \`${illegal.join('`, `')}\` — only current.*, ` +
                    `trigger.* and vars.* are available, and the node fails at entry on any other root.`,
                  hint: wantsRecord
                    ? `\`record\`/\`previous\` are not bound here (on this platform \`record\` always means ` +
                      `"the record at event time", which is ambiguous at an approval node). Write ` +
                      `current.<field> for the live value at node entry, trigger.<field> for the ` +
                      `submit-time snapshot (vars.previous carries the pre-update row).`
                    : `Did you mean current.<field> (live record), trigger.<field> (submit snapshot), ` +
                      `or vars.<name> (flow variable)?`,
                });
              }
            }
          }
        } else if (a.resolveAs != null) {
          // resolveAs only means something on an expression approver; on any
          // other type it silently does nothing — surface the dead config.
          findings.push({
            severity: 'info',
            rule: APPROVAL_EXPRESSION_INVALID,
            where,
            path: `${path}.resolveAs`,
            message: `resolveAs has no effect on a '${type}' approver — it only applies to type 'expression'.`,
            hint: `Remove it, or switch this approver to { type: 'expression', value: '<CEL>', resolveAs: '${String(a.resolveAs)}' }.`,
          });
        }

        // Exactly one of the two below fires. Order matters: a bad VALUE is
        // the more serious (and differently-fixed) defect, so it wins. Telling
        // an author to rewrite { type: 'role', value: 'sales_manager' } as
        // `org_membership_level` would be actively wrong advice — the fix is
        // `position`, and the deprecation is beside the point.
        if (canonical === 'org_membership_level' && value && !MEMBERSHIP_TIERS.has(value.toLowerCase())) {
          findings.push({
            severity: 'warning',
            rule: APPROVAL_APPROVER_NOT_MEMBERSHIP_TIER,
            where,
            path: `${path}.value`,
            message:
              `approver { type: '${type}', value: '${value}' } resolves against the better-auth ` +
              `org-membership tier (sys_member.role: ${MEMBERSHIP_TIER_LIST}) — '${value}' is not ` +
              `a membership tier, so this approver matches nobody and the request stalls.`,
            hint:
              `If '${value}' is an org position, author { type: 'position', value: '${value}' } ` +
              `(resolved via sys_user_position, ADR-0090 D3). Keep type 'org_membership_level' ` +
              `only for membership tiers (${MEMBERSHIP_TIER_LIST}) — the vocabulary is closed ` +
              `(ADR-0108), so a business role is always a position.`,
          });
        } else if (type in DEPRECATED_APPROVER_TYPES) {
          const fix = canonicalApproverType(type);
          findings.push({
            severity: 'warning',
            rule: APPROVAL_APPROVER_TYPE_DEPRECATED,
            where,
            path: `${path}.type`,
            message:
              `approver type '${type}' is the deprecated spelling of '${fix}' (ADR-0090 D3) and ` +
              `is removed in the next major.`,
            hint: `Author { type: '${fix}', value: '${value}' }. It resolves identically today.`,
          });
        } else if (
          (APPROVER_VALUE_BINDINGS as Record<string, { source: string }>)[canonical]?.source === 'unsupported'
        ) {
          // Declared-but-unenforced (#3508): the runtime has no resolution for
          // this type — the slot degrades to an inert `type:value` literal and
          // the request routes to nobody. Say it at authoring time instead of
          // letting the request stall silently (Prime Directive #10).
          findings.push({
            severity: 'warning',
            rule: APPROVAL_APPROVER_TYPE_UNSUPPORTED,
            where,
            path: `${path}.type`,
            message:
              `approver type '${type}' is declared but not implemented by the runtime (#3508) — ` +
              `the slot resolves to nobody and the request stalls.`,
            hint:
              `Route to people the engine can expand: { type: 'team' | 'department' | 'position', ... }. ` +
              `Queue approvers need a real ownership-queue implementation before they take effect.`,
          });
        }

        // [ADR-0105 D9] Cross-organization targeting on a type that has no
        // organization-scoped directory. `user` / `field` / `manager` name a
        // person outright and `team` membership carries no organization, so the
        // declaration cannot narrow anything — it is a misunderstanding of what
        // the field does, and the runtime refuses it. Error, not warning: this
        // is a certain authoring mistake with a certain fix, and letting it
        // reach the runtime turns author time into an incident.
        const declaredOrg = (a as AnyRec).organization;
        if (typeof declaredOrg === 'string' && declaredOrg.trim() !== ''
          && ApproverType.options.includes(canonical as never)
          && !approverTypeIsOrgScoped(canonical)) {
          findings.push({
            severity: 'error',
            rule: APPROVAL_APPROVER_CROSS_ORG_UNSUPPORTED,
            where,
            path: `${path}.organization`,
            message:
              `approver type '${type}' does not resolve through an organization directory, so ` +
              `'organization: ${declaredOrg}' has no effect (ADR-0105 D9) — the runtime refuses it.`,
            hint:
              `Drop 'organization' here. Cross-organization targeting applies to ` +
              `'position', 'org_membership_level', 'department' and 'expression' approvers.`,
          });
        }
      }

      // Empty-slate dead-end (#3424): when EVERY approver on the node routes to
      // a group whose membership can be empty (an unstaffed position, an empty
      // team/department), the request can resolve to an empty `pending_approvers`
      // at runtime — no concrete user can act, and with `lockRecord` the record
      // stays locked with no recovery except a platform/tenant admin override.
      // Advisory (`info`): staffing is runtime data a linter can't see, so this
      // flags the risky SHAPE and prescribes a guaranteed-staffed fallback.
      const routable = approvers.filter(
        (a) => a && typeof a === 'object' && typeof (a as AnyRec).type === 'string',
      );
      if (
        routable.length > 0 &&
        routable.every((a) => GROUP_ROUTED_TYPES.has(canonicalApproverType(String((a as AnyRec).type))))
      ) {
        const locks = (cfg as AnyRec).lockRecord !== false; // default true
        findings.push({
          severity: 'info',
          rule: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
          where,
          path: `flows[${fi}].nodes[${ni}].config.approvers`,
          message:
            `every approver on this node routes to a group (position/team/department) whose ` +
            `members are runtime data — if none is staffed, the request resolves to an empty ` +
            `slate and waits forever` +
            (locks ? `, and (lockRecord) the record stays locked with no in-product recovery.` : `.`),
          hint:
            `Make sure at least one target is always staffed, or add a guaranteed-staffed ` +
            `fallback approver, e.g. { type: 'org_membership_level', value: 'owner' }. A request ` +
            `that still lands empty is recoverable only by a platform/tenant admin override (#3424).`,
        });
      }

      // #3447 P2: a node with an `expression` approver resolves people from
      // runtime data — an empty result is far likelier than for static types
      // (a mid-flow field nobody wrote yet, an upstream output that came back
      // empty). Nudge the author to SAY what an empty slate should do rather
      // than inherit the default silently.
      const hasExpression = approvers.some(
        (a) => a && typeof a === 'object' && canonicalApproverType(String((a as AnyRec).type ?? '')) === 'expression',
      );
      if (hasExpression && (cfg as AnyRec).onEmptyApprovers == null) {
        findings.push({
          severity: 'info',
          rule: APPROVAL_EXPRESSION_NO_EMPTY_POLICY,
          where,
          path: `flows[${fi}].nodes[${ni}].config`,
          message:
            `this node resolves approvers from an expression but declares no onEmptyApprovers — ` +
            `an empty result falls back to the default ('admin_rescue': request opens, only a ` +
            `privileged admin can act).`,
          hint:
            `Declare the empty-slate policy explicitly: onEmptyApprovers: 'admin_rescue' (hold for ` +
            `admin takeover), 'fail' (fail the node — config bug), or 'auto_approve' (wave through, ` +
            `output.autoApproved = true).`,
        });
      }

      // #3447 P2: `decision`/`requestId` ride the resume envelope; a declared
      // decision output with either name is rejected at runtime on every
      // decide — the node can never accept the output it declares.
      // Bare keys and typed { key, … } declarations whitelist identically —
      // the spec normalizer is the one reader of the union shape.
      const declaredOutputs = normalizeDecisionOutputs((cfg as AnyRec).decisionOutputs).map((d) => d.key);
      const reserved = declaredOutputs.filter((k) => RESERVED_OUTPUT_KEYS.has(k));
      if (reserved.length) {
        findings.push({
          severity: 'error',
          rule: APPROVAL_DECISION_OUTPUTS_RESERVED,
          where,
          path: `flows[${fi}].nodes[${ni}].config.decisionOutputs`,
          message:
            `decisionOutputs declares reserved key(s) \`${reserved.join('`, `')}\` — the resume ` +
            `envelope owns them, so every decide carrying them is rejected.`,
          hint: `Rename the output key(s); any name other than 'decision'/'requestId' works.`,
        });
      }

      // escalation.action 'reassign' with no escalateTo silently degrades to a
      // plain SLA-breach notification at runtime — the hand-off the author
      // asked for never happens.
      const escalation = (cfg.escalation ?? null) as AnyRec | null;
      if (escalation && typeof escalation === 'object' && escalation.action === 'reassign') {
        const target = typeof escalation.escalateTo === 'string' ? escalation.escalateTo.trim() : '';
        if (!target) {
          findings.push({
            severity: 'warning',
            rule: APPROVAL_ESCALATION_REASSIGN_NO_TARGET,
            where,
            path: `flows[${fi}].nodes[${ni}].config.escalation.escalateTo`,
            message:
              `escalation.action is 'reassign' but escalateTo is empty — at runtime the ` +
              `escalation degrades to a notify and the request stays with the original approvers.`,
            hint:
              `Set escalateTo to a position machine name (expanded via sys_user_position, ` +
              `ADR-0090 D3) or a specific user id, or change action to 'notify'.`,
          });
        }
      }
    }
  }

  return findings;
}
