// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approval-node approver authoring lint (ADR-0090 D3 fallout).
 *
 * `org_membership_level` (and `role`, its deprecated spelling) resolves against
 * better-auth's org-membership tier (`sys_member.role`: owner / admin / member)
 * — it is NOT a position. After ADR-0090 D3 renamed `sys_role` → `sys_position`,
 * downstream apps that authored `{ type: 'role', value: 'sales_manager' }`
 * silently route the approval to nobody: the expansion finds no member row,
 * falls back to the `role:sales_manager` literal, a slot no one can act on,
 * and a slate that names no one else lands on the node's `onEmptyApprovers`
 * instead of the people the author meant. These rules move that failure from
 * runtime to a located fix-it at author time.
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
 * | approval-approvers-may-resolve-empty       | info     | unset-manager dead-end (#16748) |
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
import { walkFlowNodes } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

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
 * (`user`/`field`/`manager`) and the guaranteed-staffed `org_membership_level`
 * tiers are deliberately excluded: any of them present signals the author has
 * a non-group route, so the node isn't purely group-gated.
 *
 * `queue` is IN (ADR-0142 D6): a queue's members are runtime data — its
 * positions' holders, or an organization's `sys_queue_member` rows — and an
 * empty queue adds no slot, so a queue-only node reaches the same empty slate a
 * position-only one does.
 *
 * ⛔ `manager` stays OUT of this set and is judged by its own arm below
 * ({@link MANAGER_ONLY_FIX}), for two reasons that are not interchangeable:
 * the group message ("routes to a group (position/team/department/queue)") would be
 * false about it, and the REMEDY differs — an unstaffed position is staffed
 * in-product, an unset `sys_user.manager_id` is not (#16748). Folding `manager`
 * in here would also change a `position` verdict this package pins: a
 * `[position, manager]` node is silent today, and that pin is the existing
 * arm's contract, not an oversight to sweep up.
 */
const GROUP_ROUTED_TYPES = new Set(['position', 'team', 'department', 'queue']);

/**
 * [#22161] The closing clause both empty-slate verdicts share under the
 * default `lockRecord: true` — one wording, so the two arms cannot drift. What
 * recovers such a record is the `approval-approvers-may-resolve-empty`
 * explanation's text (`os explain`), not the verdict's.
 */
const STAYS_LOCKED = ', and (lockRecord) the record stays locked';

/**
 * How an operator actually populates `sys_user.manager_id` (#16748 / #16678).
 *
 * [#22161] The graded routes below are printed by
 * `os explain approval-approvers-may-resolve-empty`: their text is the
 * `MANAGER_ONLY_REMEDY` and `MANAGER_ONLY_ROUTES` paragraphs of that id's entry
 * in `rule-explanations.ts`, the one copy, and this block stays the
 * measurement behind each grade. The `manager` arm's `fix:` line
 * ({@link MANAGER_ONLY_FIX}) names the first route and the escape in one line.
 *
 * ⚠️ STILL NOT "edit the user in the Console". The column is `readonly: true`
 * and stays out of ADR-0092's Tier 1, so `getManagedUpdateWhitelist('sys_user')`
 * is still exactly `{name, image, locale}` and the standard edit form still
 * renders no editable field for it. What changed in #16678 is that the column
 * gained a DEDICATED admin operation of its own, which is a different thing
 * from becoming an editable profile column — and the distinction is the design,
 * not a nicety: ADR-0092 D5's amendment made Tier-1 membership imply
 * SELF-editability, so a `manager_id` that reached the form would hand every
 * member their own first-rung approver.
 *
 * ⛔ AND a remedy naming a route that does not exist is worse than no remedy —
 * an exact diagnosis whose prescription cannot be carried out (#17037). So the
 * routes are GRADED here rather than listed, and each grade is a measurement
 * against this tree with a discriminating control beside it. Re-taken on the
 * change that landed the write surface:
 *
 *   - The admin endpoint — AVAILABLE HERE, and now the route to name first.
 *     `POST /api/v1/auth/admin/set-user-manager`, body `{ userId, managerId }`
 *     with `managerId: null` as the clear, platform-admin gated (ADR-0068) and
 *     ledgered as an ObjectStack mount in plugin-auth's `auth-route-ledger.ts`.
 *     It reaches the column under a SYSTEM context — by context, ⛔ not by a
 *     whitelist entry — which is why the whitelist reading above is unchanged.
 *     It refuses self-assignment, a link that closes a cycle, a chain past its
 *     depth cap, a manager provably outside the user's organizations, and any
 *     identity whose `sys_user.source` is `idp_provisioned`.
 *   - Seed, or any other system-context write — AVAILABLE HERE, unchanged.
 *     Both write guards gate on `isUserContextWrite`, spelled identically in
 *     each: `Boolean(userId) && isSystem !== true` (plugin-security
 *     `system-write-guard.ts`, plugin-auth `identity-write-guard.ts`). A
 *     system-context write therefore bypasses the managed-update whitelist by
 *     construction.
 *   - SCIM — NOT here, re-measured and unchanged. The Enterprise `manager`
 *     attribute IS declared (`scim.zod.ts`), but no non-test file under
 *     `packages/plugins` or `packages/runtime` projects it onto the column:
 *     measured 0, against a control (`SysScimGroup`) the same scan does find,
 *     so the scan discriminates.
 *   - Admin bulk import — AVAILABLE HERE, and the grade this block used to
 *     give it ("NOT here") went stale when the import tier admitted the column.
 *     `POST /api/v1/auth/admin/import-users` (`admin-import-users.ts`) reads a
 *     `manager_id` column (`MANAGER_COLUMN`) whose cell holds the MANAGER'S
 *     identity key — an email, or a phone number where the phone plugin is
 *     wired — strips it from the row before the identity write, and links it in
 *     a SECOND pass once every row of the batch exists, through
 *     `applyUserManagerLink`, the derivation `set-user-manager` itself runs.
 *     So it carries the endpoint's refusals (self-assignment, cycle, depth cap,
 *     cross-organization, directory-owned identity); a link it cannot make is
 *     reported on that row's `manager` result and never fails the user it
 *     imported. `SYS_USER_IMPORT_UPDATE_FIELDS` is unchanged — the column rides
 *     the second pass, ⛔ not the upsert patch. Measured by
 *     `admin-import-users-manager-pass.test.ts`: a link to a manager created by
 *     a LATER row lands, with a control where the manager does not exist yet.
 *     It is the route to name for a whole file; a remedy that said otherwise
 *     sent the author away from a supported path.
 *
 * ⇒ SCIM and directory sync stay NAMED, because a deployment running a real
 * one may well populate the column through it — but named as something the
 * operator's own provisioning supplies, ⛔ never as something this repo gives
 * them. They also now have PRECEDENCE over the endpoint rather than merely
 * sitting beside it: on an `idp_provisioned` identity the endpoint refuses, so
 * the directory is the one authoring surface for those rows.
 *
 * ⛔ WHAT DID NOT CHANGE — and why this rule is not deleted. The dead end the
 * finding reports SURVIVES the write surface: a static check still cannot read
 * the column, so a slate that is entirely `manager` rungs can still resolve to
 * nobody. Only its CAUSE became recoverable — "nobody can populate it" became
 * "an operator can". So the finding stays, `stackWiresManagerChain` stays the
 * silencer, and the remedy is what was rewritten (#16678).
 *
 * ⛔ THE SAME READING APPLIES to the node-level `onEmptyApprovers: 'fallback'`
 * policy this remedy now names. A fallback does not make `manager` resolve; it
 * makes the failure SURVIVABLE, and the two are independent. So it is added to
 * the remedy as one more route the author can take — ⛔ never as a second
 * silencer beside `stackWiresManagerChain`. Silencing on it would be a
 * different claim from the one this rule is allowed to make: the rule reads
 * SHAPE, and a declared `fallbackApprovers` list can itself resolve to nobody
 * at runtime, which a static check cannot see either.
 *
 * ⛔ DEPENDENCY — the other two carriers of this assertion are now correct and
 * must stay that way: `ApproverType`'s `.describe()` in
 * `packages/spec/src/automation/approval.zod.ts` (rendered verbatim into the
 * generated `content/docs/references/automation/approval.mdx`, once per shape
 * that reuses the approver entry — so a stale copy there multiplies) and the
 * `manager` callout in `content/docs/automation/approvals.mdx`. Neither
 * RESTATES the remedy — both point back at this rule, which is why there is
 * still exactly one copy to edit: since #22161 that copy is the explanation's
 * two paragraphs, which the finding reaches through its `rule:` line's
 * `os explain` pointer rather than on its `fix:` line.
 */
// ⛔ The tracker ids stay in the comments above and never in the strings below
// or in the explanation: `check:doc-authoring` Rule 3 — a runtime string reaches
// authors, operators and generated surfaces, none of whom can resolve `#NNNN`.
// The reader who can resolve it is reading this source.
/**
 * [#22161] The `manager` arm's `fix:` line: the first route the docblock above
 * grades (the admin operation, or its bulk import) and the escape that needs
 * no write to the column, in one line. Every route, graded, is the
 * explanation's (see above).
 */
const MANAGER_ONLY_FIX =
  "Set every submitter's sys_user.manager_id (Setup → Users → Set Manager, or the admin user import), or add " +
  "an approver that cannot resolve empty, e.g. { type: 'org_membership_level', value: 'owner' }";

/**
 * [#22161] The group arm's `fix:` line: its three routes in one line, the
 * third in #22824's words — `fallback` NAMES who decides, rather than leave a
 * slate that names no one to the organization's administrators (the verdict's
 * own outcome). What happens when even that names no one is the explanation's.
 */
const GROUP_ONLY_FIX =
  "Staff at least one target, add an approver that cannot resolve empty (e.g. { type: 'org_membership_level', " +
  "value: 'owner' }), or name who decides in fallbackApprovers with onEmptyApprovers: 'fallback'";

/**
 * [#27101] The clause both single-slot verdicts end on — one wording, so the
 * two arms cannot drift. It states the SLOT, never the request's fate, the
 * runtime's own rule for its expansion warnings (`resolveApproverSpec` in
 * plugin-approvals): one approver cannot see the rest of the slate, and what an
 * empty slate does is the node's `onEmptyApprovers`, whose default can move.
 * ⛔ Never name an outcome or the default here: "the request stalls" was such
 * a restated outcome, and it went false when the default became `admin_rescue`.
 */
const EMPTY_SLATE_DECIDES = 'onEmptyApprovers decides an empty slate';

/**
 * [#27101] The routes the unsupported-type hint offers: the group-routed types
 * whose binding the runtime implements, derived so the hint can never offer a
 * type that is itself `unsupported` (it offered `queue` while `queue` was the
 * one unsupported type, ADR-0142 D6).
 */
const EXPANDABLE_GROUP_TYPES = [...GROUP_ROUTED_TYPES].filter(
  (t) => (APPROVER_VALUE_BINDINGS as Record<string, { source: string }>)[t]?.source !== 'unsupported',
);

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

/**
 * Does this stack itself show that it wires `sys_user.manager_id`?
 *
 * The ONLY manager-chain evidence a stack can carry is its own seed rows
 * (`stack.data` — `SeedSchema[]`, `{ object, records, … }`), so this is the
 * whole of what a static check may read on the question. It reads it and says
 * no more than it read: a stack that seeds a `sys_user` row carrying a
 * non-empty `manager_id` demonstrably knows about the column and populates it,
 * so the advisory below would be noise there. A stack that seeds none has given
 * the linter nothing, which is not the same as the column being unset at
 * runtime — hence the advisory's wording, which flags the SHAPE and is
 * conditional ("where … is unset"): it does not assert the slate is empty, and
 * its `os explain` entry says why.
 *
 * ⛔ This is deliberately NOT "every seeded user has a manager": the top of any
 * real reporting chain legitimately has none, so an all-rows test would fire on
 * a correctly-seeded stack forever. Nor does a seeded chain prove anything
 * about users who arrive later by sign-up or SCIM — which is exactly why the
 * finding it suppresses is `info`, not an error.
 *
 * ⚠️ SURFACE ASYMMETRY, so nobody reads a correct suppressor as broken: this
 * silences the advisory on the CLI only. The runtime publish gate hands rules a
 * `RuntimeStackContext`, whose collections are fixed by
 * `CONTEXT_STACK_KEY_ORDER` in `runtime-gate.ts` — `objects`, `permissions`,
 * `books`, `datasets`, `pages`, and NO `data`. So a Studio publish of a
 * manager-only flow carries no seeds to read, `stack.data` is absent, and the
 * advisory is drawn no matter how the tenant's users are wired. That is
 * acceptable rather than a bug: an `info` finding never blocks a publish, it
 * rides the 2xx `advisories`. ⛔ Do not "fix" it by weakening the arm — the
 * repair, if one is ever wanted, is a context collection the gate does not
 * carry today, which is a runtime-gate decision and not this rule's.
 */
function stackWiresManagerChain(stack: AnyRec): boolean {
  const seeds = Array.isArray(stack.data) ? (stack.data as AnyRec[]) : [];
  for (const seed of seeds) {
    if (!seed || typeof seed !== 'object') continue;
    if (seed.object !== 'sys_user') continue;
    const rows = Array.isArray(seed.records) ? (seed.records as unknown[]) : [];
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      const managerId = (row as AnyRec).manager_id;
      if (typeof managerId === 'string' && managerId.trim() !== '') return true;
      if (typeof managerId === 'number') return true;
    }
  }
  return false;
}

/**
 * Validate the approvers of every Approval node in the stack's flows.
 * Returns findings (empty = clean).
 */
export function validateApprovalApprovers(stack: AnyRec): ApprovalApproverFinding[] {
  const findings: ApprovalApproverFinding[] = [];
  if (!stack || typeof stack !== 'object') return findings;

  const flows = recordsOf(stack.flows);
  const validTypes = new Set<string>(ApproverType.options);
  // Stack-level, so it is read once and every node is judged on the same
  // evidence — a per-node re-read would let two identical nodes disagree.
  const managerChainWired = stackWiresManagerChain(stack);

  for (let fi = 0; fi < flows.length; fi++) {
    const flow = flows[fi];
    if (!flow || typeof flow !== 'object') continue;
    const flowName = typeof flow.name === 'string' ? flow.name : `(flow ${fi})`;
    // Every node, INCLUDING those nested in try_catch / loop / parallel regions
    // — an approval inside a loop body is still an approval (#4380).
    const walked = walkFlowNodes(flow, `flows[${fi}]`);

    for (let ni = 0; ni < walked.length; ni++) {
      const { node, path: nodePath } = walked[ni];
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
        const path = `${nodePath}.config.approvers[${ai}]`;

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
              // [#22161] One remedy line; what each root holds is
              // `os explain approval-expression-invalid`.
              hint: `Write a CEL expression over current.*, trigger.* or vars.*, e.g. current.approvers_dynamic`,
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
                  // [#22161] One remedy line per arm; why `record` and
                  // `previous` are unbound at an approval node is
                  // `os explain approval-expression-invalid`.
                  hint: wantsRecord
                    ? `Write current.<field> for the live value at node entry or trigger.<field> for the ` +
                      `submit-time snapshot; vars.previous carries the pre-update row`
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
            // [#22161] One verdict; what the type resolves against and why a
            // business role is a position is `os explain` text.
            message:
              `approver { type: '${type}', value: '${value}' } names no membership tier ` +
              `(${MEMBERSHIP_TIER_LIST}), so it matches nobody; ${EMPTY_SLATE_DECIDES}`,
            // [#22161] One remedy line: the verdict already lists the tiers,
            // and why a business role is always a position (the closed
            // ADR-0108 vocabulary, `sys_user_position`) is the explanation's.
            hint:
              `If it is an org position, author { type: 'position', value: '${value}' }; keep ` +
              `'org_membership_level' for the tiers the verdict lists`,
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
          // this type — the slot degrades to an inert `type:value` literal that
          // names no one, and a slate left naming no one takes the node's
          // `onEmptyApprovers` route. Say it at authoring time instead of
          // letting the slot fail silently (Prime Directive #10). No binding is
          // `unsupported` today (ADR-0142 D6 implemented the last, `queue`);
          // the arm stays as the guard for the next one.
          findings.push({
            severity: 'warning',
            rule: APPROVAL_APPROVER_TYPE_UNSUPPORTED,
            where,
            path: `${path}.type`,
            message:
              `approver type '${type}' is declared but not implemented by the runtime: it was deprecated ` +
              `rather than built, and is no longer offered for authoring — the slot resolves to nobody, and ` +
              `${EMPTY_SLATE_DECIDES}.`,
            hint:
              `Route to people the engine can expand: ` +
              `{ type: ${EXPANDABLE_GROUP_TYPES.map((t) => `'${t}'`).join(' | ')}, ... }.`,
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
              `'position', 'org_membership_level', 'department', 'queue' and 'expression' approvers.`,
          });
        }
      }

      // Empty-slate dead-end (#3424): when EVERY approver on the node routes to
      // a group whose membership can be empty (an unstaffed position, an empty
      // team/department), no person the node names can act at runtime, and
      // under the default `admin_rescue` the request opens on the
      // organization's administrators instead (#22824), the record locked
      // under `lockRecord` until one of them decides.
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
          path: `${nodePath}.config.approvers`,
          // [#22161] One verdict sentence; why staffing is unreadable here and
          // who decides an empty slate is `os explain` text.
          message:
            `every approver on this node routes to a group (position/team/department/queue), so if ` +
            `none is staffed the request opens on the organization's administrators` +
            (locks ? STAYS_LOCKED : ''),
          hint: GROUP_ONLY_FIX,
        });
      }

      // Unset-manager dead-end (#16748) — the empty-slate rule's other half.
      //
      // `{ type: 'manager' }` resolves through `lookupManager`: it reads
      // `sys_user.manager_id` of `record[value] ?? record.owner_id` and returns
      // NULL when the column is unset, so the approver contributes nobody. When
      // the whole slate is manager rungs that is the same empty-slate dead-end
      // the #3424 arm above flags for positions — with a strictly WORSE cause.
      // An unstaffed position is an operator's to fix in-product; an unset
      // `manager_id` is not (see {@link MANAGER_ONLY_FIX}). So the rule that
      // exists for the recoverable rung was, until this arm, silent on the
      // unrecoverable one — and `manager` is the canonical first rung of a
      // tiered ladder, so the silent case was also the common one.
      //
      // ⛔ Scoped to slates that are ENTIRELY manager rungs, which keeps it
      // disjoint from the arm above by construction (`manager` is not in
      // GROUP_ROUTED_TYPES, so that arm's `every` is false whenever this one's
      // is true — no node can draw both findings) and leaves every `position`
      // verdict, mixed slates included, exactly as it was.
      //
      // Advisory (`info`), the same tier as its sibling: this reads the SHAPE.
      // It does not read row data, so the message is conditional rather than
      // asserting a slate is empty — a lint rule must not claim a runtime fact
      // it did not read (the explanation states that limit in full). `stackWiresManagerChain` is the one manager-chain fact
      // a stack CAN put in front of it, and it silences the advisory.
      if (
        !managerChainWired &&
        routable.length > 0 &&
        routable.every((a) => canonicalApproverType(String((a as AnyRec).type)) === 'manager')
      ) {
        const locks = (cfg as AnyRec).lockRecord !== false; // default true
        findings.push({
          severity: 'info',
          rule: APPROVAL_APPROVERS_MAY_RESOLVE_EMPTY,
          where,
          path: `${nodePath}.config.approvers`,
          // [#22161] Conditional on purpose — the rule cannot read the column,
          // so the verdict says what happens WHERE it is unset and asserts no
          // runtime fact; that reasoning is `os explain` text.
          message:
            `every approver on this node is { type: 'manager' }, so where sys_user.manager_id ` +
            `is unset the request opens on the organization's administrators` +
            (locks ? STAYS_LOCKED : ''),
          hint: MANAGER_ONLY_FIX,
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
          path: `${nodePath}.config`,
          message:
            `this node resolves approvers from an expression but declares no onEmptyApprovers — ` +
            `an empty result falls back to the default ('admin_rescue': request opens, only a ` +
            `privileged admin can act).`,
          // [#22161] One remedy line naming the closed vocabulary (held to the
          // spec's enum by the rule's test); what each policy does is
          // `os explain approval-expression-no-empty-policy`.
          hint:
            `Declare onEmptyApprovers on the node: 'admin_rescue', 'fail', 'auto_approve', or 'fallback' ` +
            `with a fallbackApprovers list`,
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
          path: `${nodePath}.config.decisionOutputs`,
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
            path: `${nodePath}.config.escalation.escalateTo`,
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
