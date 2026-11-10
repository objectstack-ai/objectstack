// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

/**
 * #32168 — every author-time advisory this app still raises is one it MEANS,
 * and each says why.
 *
 * `os dev`, `os build` and `os validate` print the author-time rule findings
 * (`warning` and `info`) on every boot. The 2026-11-10 full run (QA run #32135)
 * counted 76 on this app, and a reference app whose boot prints 76 advisories
 * teaches its readers to skim them: the same reason `no-startup-warnings.test.ts`
 * exists (#3420). #32168 fixed the metadata where the advisory was right — 46
 * fields placed in `fieldGroups` sections or list columns — and lists the rest
 * below, each with the reason it stays. There is no per-rule suppression in the
 * CLI, so these still print; this list is where a reader finds out why.
 *
 * Two directions, both enforced off the CLI's own `validate --json`, never a
 * re-derivation of the rule table:
 *   - a finding NOT on the list fails: fix the metadata it names, or add it here
 *     with its reason, in the same change;
 *   - an entry that no longer fires fails: delete it, so the list never claims a
 *     reason for something the app stopped doing.
 *
 * A finding is matched by its `rule` and `where` (the CLI's own wording), and by
 * its `path` with array indices dropped where two findings share a `where`.
 */

interface Finding {
  severity: string;
  rule: string;
  where: string;
  path?: string;
}

interface Allowed {
  rule: string;
  where: string;
  /** The finding's `path` with `[n]` indices dropped; only where `where` is shared. */
  path?: string;
  reason: string;
}

// ── Reasons shared by several entries ──────────────────────────────────────

const POSITION_SLATE =
  'Routes only to the showcase positions (showcase_manager, showcase_finance, showcase_legal, showcase_exec, '
  + "showcase_auditor). Where an organization staffs none of them the request opens on that organization's "
  + 'administrators, and that fallback is the behaviour the approvals checklist items drive (approvals.json: the '
  + "budget approval in a second organization is 'Routed to this organization's administrators'). An explicit "
  + 'fallbackApprovers would change what they observe.';

const UNARMED_BINDINGS =
  "showcase_approver_bindings ships status 'obsolete' with empty values on purpose (PR #24008): it is loaded and "
  + "never armed, and exists to exercise the flow designer's Value pickers, so no request is ever opened on it.";

const MEMBER_EXPENSE_TOTALS =
  'The everyone baseline (showcase_member_default) reads expense reports because they sit in the shared '
  + 'navigation (ADR-0090 D6), and leaves line detail to the filing persona (showcase_contributor). The '
  + "report's roll-ups are figures of the report itself. Hiding them, or granting every member the lines, is "
  + 'an access change this card does not make.';

const LIAISON_PROGRESS =
  'showcase_client_liaison reads projects to brief clients and is not granted tasks. How much work a project '
  + 'holds is the progress a client brief reports; the budget figures it must not see are withheld field by '
  + 'field in the same set.';

const CONTRIBUTOR_TOTALS =
  'A contributor sees only its own tasks (task_own_rows), and the project roll-ups count every task: the size '
  + "of the project, not other people's task rows.";

const NESTED_FAN_OUT =
  'showcase_nested_fan_out_reminders is the loop { parallel } fixture automation.flow-run-step-nesting scores, '
  + 'pinned by test/nested-fan-out-region-indices.test.ts. Wrapping the notify step in a try_catch puts a region '
  + 'between the parallel branch and the step whose (iteration, branch) tags the clause reads.';

export const ALLOWED_ADVISORIES: readonly Allowed[] = [
  // ── Approval slates (info) ───────────────────────────────────────────────
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_expense_signoff" · node "dual_signoff"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_committee_quorum" · node "committee"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_budget_approval" · node "manager_review"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_budget_approval" · node "exec_review"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_invoice_signoff" · node "dual_signoff"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_one_task_signoff" · node "review"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_closure_signoff" · node "ask_signoff"', reason: POSITION_SLATE },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_approver_bindings" · node "by_team"', reason: UNARMED_BINDINGS },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_approver_bindings" · node "by_department"', reason: UNARMED_BINDINGS },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_approver_bindings" · node "by_position"', reason: UNARMED_BINDINGS },
  { rule: 'approval-approvers-may-resolve-empty', where: 'flow "showcase_approver_bindings" · node "by_manager"', reason: UNARMED_BINDINGS },

  // ── Roll-ups a set reads without the child rows (warning / info) ─────────
  {
    rule: 'security-rollup-source-unreadable',
    where: 'permission set "showcase_ops" · summary field "showcase_invoice.total"',
    reason: 'Operations reads invoice totals and is not granted the lines: the order total shown to staff who may '
      + 'not see line costs, the shape the rule itself names as legal and often meant.',
  },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_member_default" · summary field "showcase_expense_report.total_amount"', reason: MEMBER_EXPENSE_TOTALS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_member_default" · summary field "showcase_expense_report.approved_amount"', reason: MEMBER_EXPENSE_TOTALS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_member_default" · summary field "showcase_expense_report.reimbursable_amount"', reason: MEMBER_EXPENSE_TOTALS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_member_default" · summary field "showcase_expense_report.line_count"', reason: MEMBER_EXPENSE_TOTALS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_member_default" · summary field "showcase_expense_report.rejected_count"', reason: MEMBER_EXPENSE_TOTALS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_member_default" · summary field "showcase_expense_report.over_limit_count"', reason: MEMBER_EXPENSE_TOTALS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_client_liaison" · summary field "showcase_project.task_count"', reason: LIAISON_PROGRESS },
  { rule: 'security-rollup-source-unreadable', where: 'permission set "showcase_client_liaison" · summary field "showcase_project.total_estimate"', reason: LIAISON_PROGRESS },
  { rule: 'security-rollup-source-row-scoped', where: 'permission set "showcase_contributor" · summary field "showcase_project.task_count"', reason: CONTRIBUTOR_TOTALS },
  { rule: 'security-rollup-source-row-scoped', where: 'permission set "showcase_contributor" · summary field "showcase_project.total_estimate"', reason: CONTRIBUTOR_TOTALS },

  // ── Owner-only reads on private objects (info) ───────────────────────────
  {
    rule: 'security-private-no-readscope',
    where: 'permission set "showcase_member_default"',
    path: 'permissions[].objects.showcase_private_note.readScope',
    reason: "Personal notes: the private OWD keeping them owner-only is the intent, as the grant's own comment in "
      + 'src/security/permission-sets.ts says.',
  },
  {
    rule: 'security-private-no-readscope',
    where: 'permission set "showcase_member_default"',
    path: 'permissions[].objects.showcase_inquiry.readScope',
    reason: 'Members file inquiries and read back their own; reading every inquiry is the triage personas\' '
      + "org-scoped grant (showcase_ops and the other sets that carry readScope: 'org').",
  },

  // ── Fixtures ─────────────────────────────────────────────────────────────
  { rule: 'flow-loop-body-uncontained', where: "flow 'showcase_nested_fan_out_reminders' · loop 'each_task' body → parallel 'fan_out_audiences' branch 0 · node 'notify_owner' (notify)", reason: NESTED_FAN_OUT },
  { rule: 'flow-loop-body-uncontained', where: "flow 'showcase_nested_fan_out_reminders' · loop 'each_task' body → parallel 'fan_out_audiences' branch 1 · node 'notify_watcher' (notify)", reason: NESTED_FAN_OUT },
  {
    rule: 'field-no-consumers',
    where: 'object "showcase_semantic_zoo" · field "notes"',
    reason: "Ungrouped on purpose: it is the ADR-0085 fixture's trailing untitled bucket, which "
      + 'packages/qa/dogfood/test/semantic-roles.dogfood.test.ts asserts.',
  },
  {
    rule: 'title-unresolvable',
    where: 'object "showcase_project_membership"',
    reason: 'A junction row: every surface that lists it names it by its two masters (team and project), and it '
      + 'has no text field for nameField to point at. Records fall back to the stable Record #ID floor.',
  },

  // ── Lint false positives (reported on #32168 for domain:spec) ────────────
  {
    rule: 'field-no-consumers',
    where: 'object "showcase_invoice" · field "owner"',
    reason: 'Read on every select by the invoice_own_rows row-level policy (owner == current_user.email, '
      + 'src/security/permission-sets.ts). The rule counts the whole permissions root as a carrier, so the '
      + 'predicate goes uncredited.',
  },
  {
    rule: 'field-no-consumers',
    where: 'object "showcase_invoice_line" · field "position"',
    reason: "The invoice's line grid stamps it on drag-reorder: the renderer derives the line-position field from "
      + 'the child object (INLINE_GRID_SORT_FIELDS, packages/spec/src/data/inline-grid-sort-fields.ts), and the '
      + 'rule does not credit that derivation.',
  },
];

/** `objects[3].fields.owner` → `objects[].fields.owner`. */
function indexFree(path: string | undefined): string | undefined {
  return path?.replace(/\[\d+\]/g, '[]');
}

function matches(entry: Allowed, finding: Finding): boolean {
  return entry.rule === finding.rule
    && entry.where === finding.where
    && (entry.path === undefined || entry.path === indexFree(finding.path));
}

function label(f: { rule: string; where: string; path?: string }): string {
  return `${f.rule} · ${f.where}${f.path ? ` · ${f.path}` : ''}`;
}

/** The CLI this app's own scripts run (`objectstack validate`), resolved from the package root. */
const CLI = `${process.cwd()}/node_modules/@objectstack/cli/bin/run.js`;

describe('the showcase author-time advisories are the allow-listed ones (#32168)', () => {
  it('every allow-list entry carries a reason', () => {
    const bare = ALLOWED_ADVISORIES.filter((e) => e.reason.trim().length < 40).map(label);
    expect(bare, 'allow-list entries without a real reason').toEqual([]);
  });

  it('validate --json reports exactly the allow-listed advisories', () => {
    expect(existsSync(CLI), `no CLI at ${CLI}: build @objectstack/cli first`).toBe(true);
    const run = spawnSync('node', [CLI, 'validate', '--json'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 120_000,
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    expect(run.status, run.stderr.slice(-2000)).toBe(0);
    const report = JSON.parse(run.stdout) as { valid: boolean; warnings?: Finding[] };
    expect(report.valid).toBe(true);
    const findings = (report.warnings ?? []).filter((w) => typeof w.rule === 'string');

    const unlisted = findings.filter((f) => !ALLOWED_ADVISORIES.some((e) => matches(e, f)));
    expect(
      unlisted.map((f) => label({ ...f, path: indexFree(f.path) })),
      'new author-time advisories: fix the metadata each names, or allow-list it with its reason',
    ).toEqual([]);

    const stale = ALLOWED_ADVISORIES.filter((e) => !findings.some((f) => matches(e, f)));
    expect(stale.map(label), 'allow-list entries that no longer fire: delete them').toEqual([]);

    const ambiguous = ALLOWED_ADVISORIES.filter((e) => findings.filter((f) => matches(e, f)).length > 1);
    expect(ambiguous.map(label), 'entries matching more than one finding: add the index-free path').toEqual([]);
  }, 150_000);
});
