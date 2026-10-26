/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * approvalOverride — the ONE place the console answers "is this decision an
 * ADMIN OVERRIDE?" (objectui#5178).
 *
 * ## The gap this closes
 *
 * framework#3424 gives a platform/tenant admin a privileged decision path: they
 * may approve / reject / reassign a request they hold no slot in, so a request
 * routed to an unstaffed position is rescuable instead of locking its record
 * forever. That branch is *authoritative* — it finalises the node even under
 * `per_group` / `unanimous` / `quorum`, bypassing every co-sign group that has
 * not voted.
 *
 * The console rendered it as an ordinary decision: the same filled **Approve**
 * a designated approver sees, one click, no warning. The measured consequence
 * (the report behind objectui#5178) was a PM who clicked Approve *"to see if it
 * was real"* and finalised a stage for an approver who never acted.
 *
 * ## Why the predicate is read, not a name list
 *
 * `sys_approval_request` declares its decision actions as METADATA, and the
 * record page's whole design is that "a ninth decision action ships as metadata
 * alone" (see `DeclaredActionsBar`). A hard-coded `['approval_approve', …]`
 * list would silently miss that ninth action — it would render as an ordinary
 * decision again, which is the exact defect being fixed.
 *
 * So {@link actionAdmittedByOverride} reads the action's OWN declared `visible`
 * gate — the very predicate that admitted the button — and asks whether it ORs
 * in `can_override`. The three core levers do
 * (`… record.viewer.can_act == true || … record.viewer.can_override == true`);
 * `approval_remind` / `approval_resubmit` gate on `is_submitter` alone and
 * never match.
 *
 * `approval_recall` declares BOTH arms: the submitter's own, and, since
 * objectstack#12716, the override arm spelled like the core levers'. A
 * submitter who also holds override rights reaches that button through their
 * own arm, so withdrawing their own request is the ordinary path, not an
 * override. {@link isOverrideDecision} therefore reads the served
 * `is_submitter` flag for any lever whose gate names it (objectui#13225).
 *
 * ## Fail-safe direction
 *
 * Both predicates are deliberately asymmetric: an UNKNOWN reads as "not an
 * override". Labelling an ordinary approval as an override would be a false
 * accusation written into a surface people audit; failing to label one leaves
 * today's behaviour. `viewer` absent (a backend predating framework#3310) and
 * `can_act` absent both therefore yield `false` — which is why the checks are
 * `=== false` / `=== true` rather than truthiness.
 */

/** The viewer capability block `getRequest` / `listRequests` attach (framework#3310). */
interface ViewerBlockLike {
  can_act?: unknown;
  is_submitter?: unknown;
  can_override?: unknown;
}

function viewerOf(record: unknown): ViewerBlockLike | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const viewer = (record as { viewer?: unknown }).viewer;
  if (!viewer || typeof viewer !== 'object') return undefined;
  return viewer as ViewerBlockLike;
}

/**
 * Is this viewer admitted to the request ONLY through the admin-override door?
 *
 * `can_act: false` AND `can_override: true` — the exact pair objectui#5178
 * names. Strict comparisons on both sides: a backend that never sent `viewer`
 * (or sent it without `can_act`) leaves us unable to tell, and "unable to tell"
 * must not render as "override".
 */
export function isOverrideOnlyViewer(record: unknown): boolean {
  const viewer = viewerOf(record);
  if (!viewer) return false;
  return viewer.can_act === false && viewer.can_override === true;
}

/**
 * Read the source text out of a declared predicate.
 *
 * `visible` reaches us in the three spellings `toPredicateInput` normalizes
 * (`packages/core/src/evaluator/predicateInput.ts`): a bare/`${…}` string, a
 * `{ dialect, source }` envelope, or a boolean. Only the two string-bearing
 * arms can name a viewer flag; a boolean gate declares no flag at all.
 */
function predicateSource(predicate: unknown): string {
  if (typeof predicate === 'string') return predicate;
  if (predicate && typeof predicate === 'object') {
    const source = (predicate as { source?: unknown }).source;
    if (typeof source === 'string') return source;
  }
  return '';
}

/**
 * Does this declared action's own `visible` gate OR in `can_override`?
 *
 * True for exactly the actions the override flag can admit. Combined with
 * {@link isOverrideOnlyViewer} — where `can_act` is `false` — the flag is then
 * the ONLY term that can have made the button visible, so the button the viewer
 * is looking at is an override.
 */
export function actionAdmittedByOverride(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  return predicateSource((action as { visible?: unknown }).visible).includes('can_override');
}

/**
 * Could this viewer hold the action through its SUBMITTER arm (objectui#13225)?
 *
 * A lever whose declared gate names `is_submitter` admits the request's
 * submitter on that arm, whatever else it ORs in. `approval_recall` is the
 * shipped case: its gate is the submitter arm OR the override arm, so for a
 * submitter who also holds override rights the override flag is NOT the only
 * term that can have made the button visible.
 *
 * Same fail-safe direction as the rest of this module: only an explicit
 * `is_submitter: false` rules the submitter arm out. Absent or not a boolean,
 * we cannot tell, and "cannot tell" must not render as "override". A gate that
 * names the flag in some other sense (say, `is_submitter == false`) would read
 * here as a submitter arm too; that errs the same safe way, towards no label.
 */
function mayHoldAsSubmitter(action: unknown, viewer: ViewerBlockLike): boolean {
  if (!action || typeof action !== 'object') return false;
  if (!predicateSource((action as { visible?: unknown }).visible).includes('is_submitter')) return false;
  return viewer.is_submitter !== false;
}

/**
 * Is the button this viewer sees for this action an ADMIN OVERRIDE?
 *
 * The single question every affordance decision in objectui#5178 asks. Every
 * part must hold: the viewer holds no slot but may override, this particular
 * action is one the override flag admits, and the viewer does not hold it
 * through its submitter arm instead (objectui#13225: the submitter's own
 * recall).
 */
export function isOverrideDecision(action: unknown, record: unknown): boolean {
  const viewer = viewerOf(record);
  if (!viewer || !isOverrideOnlyViewer(record) || !actionAdmittedByOverride(action)) return false;
  return !mayHoldAsSubmitter(action, viewer);
}

/**
 * The pending approvers an override would bypass, in display form.
 *
 * These names are the load-bearing half of the confirm copy: objectui#5178's
 * report turns on a click that a warning naming *who* was about to be bypassed
 * would have stopped. `pending_approver_names` is the server's id → name
 * resolution; an id with no resolved name falls back to `formatId` (the
 * surface's own identity formatter) so a raw `role:sales_manager` literal still
 * reads.
 *
 * Empty is a REAL and legitimate answer, not an error: the motivating rescue
 * case for framework#3424 is a request routed to an unstaffed position, which
 * has no pending approvers to name. Callers must have wording for that case
 * rather than rendering an empty list.
 */
export function bypassedApproverNames(
  record: unknown,
  formatId: (id: string) => string = (id) => id,
): string[] {
  if (!record || typeof record !== 'object') return [];
  const row = record as {
    pending_approvers?: unknown;
    pending_approver_names?: unknown;
  };
  const pending = Array.isArray(row.pending_approvers) ? row.pending_approvers : [];
  const names =
    row.pending_approver_names && typeof row.pending_approver_names === 'object'
      ? (row.pending_approver_names as Record<string, unknown>)
      : {};
  const out: string[] = [];
  for (const raw of pending) {
    if (typeof raw !== 'string' || !raw) continue;
    const resolved = names[raw];
    out.push(typeof resolved === 'string' && resolved ? resolved : formatId(raw));
  }
  return out;
}

/**
 * Was this recorded `sys_approval_action` row written through the override door?
 *
 * The read half of objectui#5178. framework#4466 writes
 * `sys_approval_action.via_override` and the REST action list carries it
 * (`rowFromAction` in `plugin-approvals`), but no console surface read it — an
 * override rendered byte-for-byte like an ordinary approval in every timeline.
 *
 * Tri-state on purpose, mirroring the column: `true` = override, `false` =
 * checked and NOT an override, `undefined` = a row written before the column
 * existed. Only an explicit `true` marks a row; "not recorded" is not the same
 * claim as "not an override", and must not be rendered as either.
 */
export function isViaOverrideRow(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  return (action as { via_override?: unknown }).via_override === true;
}
