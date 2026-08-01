// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint for flow authoring ANTI-PATTERNS — metadata that is valid
 * (passes schema + expression checks) but is semantically a footgun at runtime.
 * Most are emitted as WARNINGS: they guide the author (very often an AI
 * generating templates) toward the robust pattern without failing the build on
 * a technically-legal construct.
 *
 * A finding carrying `severity: 'error'` FAILS the build. That is reserved for
 * shapes that are a *guaranteed* runtime failure rather than a risk — currently
 * only {@link FLOW_RUNAS_UNSCOPED}, where the runtime refuses the data
 * operation outright (#3760), so warning about it would just be a slower way of
 * finding out.
 *
 * #1874 — time-relative rules via record-change date-EQUALITY. A start-node
 * trigger condition like `end_date == daysFromNow(60)` on a `record-*` trigger
 * only fires if the record happens to be written on that exact day; the robust
 * shape is a daily SCHEDULE trigger + a range query. We flag the equality form
 * specifically (range operators `>=`/`<=` are not flagged — they're the building
 * block of the correct pattern), keeping false positives near zero.
 */

export interface FlowLintFinding {
  where: string;
  message: string;
  hint: string;
  rule: string;
  /**
   * `'error'` FAILS the build; `'warning'` (the default when absent) prints and
   * continues. Most rules here flag a technically-legal footgun and stay
   * advisory. A rule is only promoted to `'error'` when the shape it flags is a
   * *guaranteed* runtime failure — then a warning would just be a slower way of
   * finding out (#3760).
   *
   * `os build` and `os validate` both filter on this field, so promoting a rule
   * gates both surfaces at once — neither can report clean while the other
   * rejects the same stack (#3782).
   */
  severity?: 'error' | 'warning';
}

type AnyRec = Record<string, unknown>;

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') return Object.entries(v as AnyRec).map(([name, def]) => ({ name, ...(def as AnyRec) }));
  return [];
}

/** Extract the raw predicate source from a `condition` (string or Expression envelope). */
function conditionSource(raw: unknown): string {
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object' && typeof (raw as AnyRec).source === 'string') return (raw as AnyRec).source as string;
  return '';
}

const TIME_FNS = 'daysFromNow|daysAgo|today|now|date|datetime';
const TIME_FN_RE = new RegExp(`\\b(?:${TIME_FNS})\\s*\\(`);
// A time function adjacent to an equality operator, either side:
//   `end_date == daysFromNow(60)`  /  `today() != record.start`
const DATE_EQ = new RegExp(
  `(?:(?:${TIME_FNS})\\s*\\([^)]*\\)\\s*(?:==|!=))|(?:(?:==|!=)\\s*(?:${TIME_FNS})\\s*\\()`,
);

export const FLOW_TIME_RELATIVE_ANTIPATTERN = 'flow-time-relative-antipattern';
export const FLOW_DATE_EQUALITY_FILTER = 'flow-date-equality-filter';
export const FLOW_PHANTOM_AGGREGATION = 'flow-phantom-aggregation';
export const FLOW_DOUBLE_BRACE_INTERP = 'flow-double-brace-interpolation';
export const FLOW_BARE_DOLLAR_REF = 'flow-bare-dollar-reference';
export const FLOW_APPROVAL_REVISE_DEAD_END = 'flow-approval-revise-dead-end';
export const FLOW_APPROVAL_REVISE_UNMARKED_BACKEDGE = 'flow-approval-revise-unmarked-backedge';
export const FLOW_APPROVAL_REVISE_DISABLED = 'flow-approval-revise-disabled';
/**
 * #3760 — renamed from `flow-schedule-runas-unscoped`. The old id named the
 * *schedule*, which was never the boundary: the rule is about a trigger that
 * resolves NO USER, and a schedule is only the most obvious such trigger.
 */
export const FLOW_RUNAS_UNSCOPED = 'flow-runas-unscoped';
export const FLOW_ERROR_LABEL_NOT_FAULT = 'flow-error-label-not-fault';
/** #4414 — the four ways a decision's declared branching fails to route. */
export const FLOW_BRANCH_LABEL_UNMATCHED = 'flow-branch-label-unmatched';
export const FLOW_DECISION_UNCONDITIONAL_BRANCH = 'flow-decision-unconditional-branch';
export const FLOW_DEFAULT_EDGE_WITH_CONDITION = 'flow-default-edge-with-condition';
export const FLOW_MULTIPLE_DEFAULT_EDGES = 'flow-multiple-default-edges';

/** Node types that perform a data operation — the ones `flow.runAs` governs (#1888). */
const DATA_NODE_TYPES = new Set(['get_record', 'create_record', 'update_record', 'delete_record']);

/**
 * #3863 — an edge LABELLED like an error path but not TYPED as one.
 *
 * Error routing is `type: 'fault'`. `label` is cosmetic on an ordinary edge, so
 * `{ source, target, label: 'error' }` without the type does not mean "go here
 * on failure" — it is an unconditional out-edge, and `traverseNext` runs every
 * unconditional out-edge in parallel. The handler therefore fires on every
 * SUCCESSFUL run of the source node, concurrently with the real success path,
 * and never on a failure.
 *
 * Silent in both directions: the author believes errors are handled (they are
 * not — the run still aborts) and never notices the handler running when
 * nothing went wrong. The reading is especially natural for an AI author, since
 * `label: 'error'` is exactly what the intent sounds like.
 *
 * Deliberately narrow, because a label IS meaningful on a branching node: a
 * `decision`/`approval` executor returns a `branchLabel` and traversal then
 * prefers the edge with that label, so `label: 'error'` there is a real branch
 * selector. Conditional edges are likewise legitimate. Both are excluded.
 */
const ERROR_LABELS = new Set(['error', 'fault', 'failure', 'failed', 'catch', 'on_error', 'onerror', 'on error']);

/** Node types whose executor selects an out-edge BY LABEL (`branchLabel`). */
const BRANCH_LABEL_NODE_TYPES = new Set(['decision', 'approval', 'screen', 'try_catch']);

/**
 * Does this flow auto-launch on a SCHEDULE (so a run carries no trigger user)?
 * Accepts the three author-time signals: `flow.type === 'schedule'`, a start-node
 * `config.triggerType === 'schedule'`, or a start-node `config.schedule` descriptor.
 */
function isScheduleTriggered(flow: AnyRec, startCfg: AnyRec): boolean {
  if (flow.type === 'schedule') return true;
  if (typeof startCfg.triggerType === 'string' && startCfg.triggerType === 'schedule') return true;
  return startCfg.schedule != null;
}

/**
 * The trigger shapes that PROVABLY resolve no trigger user, with a human label
 * for the diagnostic (ADR-0073 D5, #3760). `null` when the flow's trigger either
 * supplies a user (`screen`) or may or may not, depending on who made the
 * triggering write (`record_change`, `autolaunched`) — those are not decidable
 * here and are caught at run time instead.
 *
 * Each entry is grounded in the trigger's own dispatch code, all of which build
 * an `AutomationContext` with no `userId` field at all:
 *   - schedule       — `trigger-schedule/src/schedule-trigger.ts`
 *   - time_relative  — `trigger-schedule/src/time-relative-trigger.ts`
 *   - api            — `trigger-api/src/api-trigger.ts` (webhook / queue)
 */
function userLessTriggerKind(flow: AnyRec, startCfg: AnyRec): string | null {
  if (isScheduleTriggered(flow, startCfg)) return 'schedule';
  if (startCfg.timeRelative != null) return 'time-relative';
  if (typeof startCfg.triggerType === 'string' && startCfg.triggerType === 'time_relative') return 'time-relative';
  if (flow.type === 'api') return 'api';
  if (typeof startCfg.triggerType === 'string' && startCfg.triggerType === 'api') return 'api';
  return null;
}

/**
 * Node-config keys that name a capability the automation engine does NOT have.
 * There is no aggregate node, so a `script`/`loop`/… node carrying these keys is
 * silently ignored — the node runs and computes nothing (templates #1870,
 * `publication_rollup`). Aggregation belongs in the data layer, not a flow.
 */
const PHANTOM_AGG_KEYS = new Set(['aggregations', 'aggregate', 'groupBy', 'rollup', 'having']);

/** If `v` is a CEL expression whose source calls a time function, return that source. */
function celTimeSource(v: unknown): string | null {
  if (v && typeof v === 'object' && (v as AnyRec).dialect === 'cel') {
    const src = (v as AnyRec).source;
    if (typeof src === 'string' && TIME_FN_RE.test(src)) return src;
  }
  return null;
}

/** Range operators — the building block of the CORRECT time-window pattern, never flagged. */
const RANGE_OPS = new Set(['$gte', '$gt', '$lte', '$lt', '$ne']);

/**
 * Walk a get_record/query `filter` for the date-EQUALITY footgun: a field bound
 * directly (`field: daysFromNow(N)`) or via `$eq` / `$in` to a time-function value.
 * A `Field.date` is stored with a time component, so two independently-computed
 * timestamps never compare equal — the query silently returns nothing (#1928 /
 * templates #1874). Range operators (`$gte`/`$lt` day windows) are the correct
 * shape and are never flagged.
 */
function scanFilterForDateEquality(
  filter: unknown,
  where: string,
  findings: FlowLintFinding[],
): void {
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return;
  for (const [key, val] of Object.entries(filter as AnyRec)) {
    if (key === '$or' || key === '$and') {
      if (Array.isArray(val)) for (const sub of val) scanFilterForDateEquality(sub, where, findings);
      continue;
    }
    // `key` is a field name; `val` is its constraint.
    const direct = celTimeSource(val); // `field: daysFromNow(N)` → implicit equality
    let hit: { op: string; src: string } | null = direct ? { op: '==', src: direct } : null;
    if (!hit && val && typeof val === 'object' && (val as AnyRec).dialect !== 'cel') {
      for (const [op, operand] of Object.entries(val as AnyRec)) {
        if (RANGE_OPS.has(op)) continue; // correct pattern — leave it
        if (op === '$eq') {
          const s = celTimeSource(operand);
          if (s) { hit = { op: '$eq', src: s }; break; }
        } else if (op === '$in' && Array.isArray(operand)) {
          for (const item of operand) {
            const s = celTimeSource(item);
            if (s) { hit = { op: '$in', src: s }; break; }
          }
          if (hit) break;
        }
      }
    }
    if (hit) {
      findings.push({
        where,
        message:
          `filter matches \`${key}\` by ${hit.op} against a time value (\`${hit.src}\`) — a date field carries a ` +
          `time component, so exact equality against \`${hit.src}\` (re-computed each run) silently matches nothing.`,
        hint:
          `Use a one-day window instead: \`${key}: { $gte: daysFromNow(N), $lt: daysFromNow(N+1) }\` ` +
          `(wrap multiple tiers in \`$or\`). The abutting windows tile the timeline so each row matches exactly once. (#1874)`,
        rule: FLOW_DATE_EQUALITY_FILTER,
      });
    }
  }
}

// Flow node VALUES interpolate with SINGLE braces (`{var}` / `{rec.field}` /
// `{$User.Id}`). Two wrong-syntax mistakes AI/human authors carry over from the
// *formula* template dialect (`{{ path }}`) or other platforms:
//   - `{{ai_reply}}`  — double-brace (verified: no flow node uses `{{ }}`).
//   - `$source.id`    — a `$`-prefixed reference written bare (resolves as a
//                       literal string), instead of `{source.id}`.
const DOUBLE_BRACE = /\{\{\s*[\w$][\w$.\s]*\}\}/;
// A `$Ident.field` not immediately inside a `{` (so `{$User.Id}` is NOT flagged).
// Require a letter/_ after `$` so currency like `$5.00` is never matched.
const BARE_DOLLAR_REF = /(?:^|[^{])\$[A-Za-z_]\w*\.[A-Za-z_]/;

/** Config keys whose string values are CEL predicates, not interpolated templates. */
const CEL_KEYS = new Set(['condition', 'expression', 'conditions']);

/** Collect every interpolated-template string value in a node config (skips CEL keys). */
function collectTemplateStrings(value: unknown, key: string | undefined, out: string[]): void {
  if (key && CEL_KEYS.has(key)) return;
  if (typeof value === 'string') { out.push(value); return; }
  if (Array.isArray(value)) { for (const v of value) collectTemplateStrings(v, key, out); return; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as AnyRec)) collectTemplateStrings(v, k, out);
  }
}

/** Edge `label`, normalized (trimmed, lowercased) for branch matching. */
function edgeLabelOf(e: AnyRec): string {
  return typeof e.label === 'string' ? e.label.trim().toLowerCase() : '';
}

/**
 * ADR-0044 send-back-for-revision footguns on an approval node that declares a
 * `revise` out-edge — the two shapes an AI authoring an approval flow gets wrong:
 *  - the revise branch never loops back to the approval (the submitter reworks
 *    the record with nowhere to resubmit). This is a VALID DAG, so `registerFlow`
 *    ACCEPTS it — the linter is the only place that catches the dead end.
 *  - the loop DOES return to the approval, but the closing edge isn't declared
 *    `type: 'back'`, so `registerFlow` rejects it as an un-declared cycle. The
 *    lint fires at compile time with the specific fix (mark the resubmit edge).
 */
/**
 * #3863 — flag edges labelled like an error path but left at the default type.
 * See {@link ERROR_LABELS} for why this is a footgun and what is excluded.
 */
function scanErrorLabelledEdges(
  flowName: string,
  nodes: AnyRec[],
  edges: AnyRec[],
  findings: FlowLintFinding[],
): void {
  const typeById = new Map<string, string>();
  for (const n of nodes) {
    if (typeof n.id === 'string') typeById.set(n.id, typeof n.type === 'string' ? n.type : '');
  }

  for (const e of edges) {
    const label = typeof e.label === 'string' ? e.label.trim().toLowerCase() : '';
    if (!ERROR_LABELS.has(label)) continue;
    if (e.type === 'fault') continue; // already an error path — nothing to say
    if (e.condition) continue; // a guarded edge is not the unconditional footgun
    const src = typeof e.source === 'string' ? e.source : '';
    // A branching node picks its out-edge BY label, so the label is load-bearing.
    if (BRANCH_LABEL_NODE_TYPES.has(typeById.get(src) ?? '')) continue;

    findings.push({
      where: `flow '${flowName}' · edge '${src}' → '${String(e.target)}'`,
      message:
        `edge is labelled '${String(e.label)}' but its type is '${String(e.type ?? 'default')}', not 'fault' — ` +
        `so it is an ORDINARY out-edge. Unconditional out-edges all run in parallel, so '${String(e.target)}' ` +
        `executes on every SUCCESSFUL run of '${src}' and never on a failure. The error path the label ` +
        `describes does not exist, and the run still aborts when '${src}' fails.`,
      hint:
        `Add \`type: 'fault'\` to this edge. Only runtime failures route — a guard refusal (a filter token ` +
        `that resolved to nothing, a missing required config key, an unscoped run) stays fatal by design and ` +
        `must be fixed in the metadata, not handled. (#3863)`,
      rule: FLOW_ERROR_LABEL_NOT_FAULT,
    });
  }
}

/**
 * #4414 — a decision node that DECLARES a branch it cannot route.
 *
 * A decision has three declared ways to pick a branch, and until #4414 only one
 * of them worked. They now compose (`branchLabel` narrows the edge set →
 * `condition` gates → `isDefault` catches the rest), but composing them still
 * leaves four authorable shapes where what the author wrote does not route what
 * they meant. All four are silent at run time — the flow completes green, having
 * taken the wrong path — so they are caught here, at authoring time:
 *
 *  (1) `flow-branch-label-unmatched` — the decision's `conditions[].label` names
 *      a branch no out-edge carries. Traversal cannot honour a label nothing
 *      claims, so it falls back to considering EVERY out-edge. This is the
 *      shipped defect: app-crm's convert-lead guard computed `'No — proceed'`
 *      against out-edges labelled `'Yes'` / `'No'`, matched nothing, and ran
 *      both branches.
 *  (2) `flow-decision-unconditional-branch` — an out-edge of a decision that has
 *      no `condition`, no `isDefault`, and no label the decision can select. It
 *      is traversed on EVERY pass, in parallel with whichever branch did match,
 *      so the guard next to it does not guard.
 *  (3) `flow-default-edge-with-condition` — `isDefault` means "when nothing else
 *      matched"; a condition on the same edge contradicts it (BPMN forbids a
 *      conditional default flow). The condition wins and the marker is inert.
 *  (4) `flow-multiple-default-edges` — two fallbacks out of one node. Both are
 *      traversed when nothing matched, which is a parallel fan-out, not the
 *      exclusive "otherwise" the marker promises.
 *
 * Advisory, not build-failing: each shape is a wrong ROUTE, not a guaranteed
 * runtime failure, and the engine now also warns when it hits (1) live.
 */
function scanBranchRouting(
  flowName: string,
  nodes: AnyRec[],
  edges: AnyRec[],
  findings: FlowLintFinding[],
): void {
  const outEdgesBySource = new Map<string, AnyRec[]>();
  for (const e of edges) {
    if (e.type === 'fault') continue; // error routing, not branch selection
    const src = typeof e.source === 'string' ? e.source : '';
    if (!src) continue;
    if (!outEdgesBySource.has(src)) outEdgesBySource.set(src, []);
    outEdgesBySource.get(src)!.push(e);
  }

  // (3) + (4) apply to every node's out-edges, not just decisions — `isDefault`
  //     is meaningful wherever conditional siblings exist.
  for (const [src, outs] of outEdgesBySource) {
    for (const e of outs) {
      if (e.isDefault === true && e.condition) {
        findings.push({
          where: `flow '${flowName}' · edge '${src}' → '${String(e.target)}'`,
          message:
            `edge sets \`isDefault: true\` AND a \`condition\` — contradictory. \`isDefault\` means ` +
            `"take this edge when NO sibling condition matched"; a condition makes it an ordinary ` +
            `guarded branch. The condition wins and the default marker routes nothing.`,
          hint:
            `Drop one: keep \`condition\` for a guarded branch, or drop it and keep \`isDefault: true\` ` +
            `for the "otherwise" path. (#4414)`,
          rule: FLOW_DEFAULT_EDGE_WITH_CONDITION,
        });
      }
    }
    const defaults = outs.filter((e) => e.isDefault === true && !e.condition);
    if (defaults.length > 1) {
      findings.push({
        where: `flow '${flowName}' · node '${src}'`,
        message:
          `${defaults.length} out-edges are marked \`isDefault: true\` (${defaults
            .map((e) => `'${String(e.target)}'`)
            .join(', ')}) — a node has at most ONE default path. All of them are traversed together ` +
          `when no condition matches, which is a parallel fan-out, not an "otherwise".`,
        hint:
          `Keep \`isDefault: true\` on the single fallback edge and give the others a \`condition\` ` +
          `(or leave them unconditional if the fan-out really is intended). (#4414)`,
        rule: FLOW_MULTIPLE_DEFAULT_EDGES,
      });
    }
  }

  // (1) + (2) are about a DECISION's own declared branching.
  for (const node of nodes) {
    if (node.type !== 'decision') continue;
    const nid = typeof node.id === 'string' ? node.id : '';
    if (!nid) continue;
    const outs = outEdgesBySource.get(nid) ?? [];
    if (outs.length === 0) continue;

    const cfg = (node.config ?? {}) as AnyRec;
    const declaredLabels = new Set(
      (Array.isArray(cfg.conditions) ? (cfg.conditions as AnyRec[]) : [])
        .map((c) => (typeof c?.label === 'string' ? c.label.trim().toLowerCase() : ''))
        .filter(Boolean),
    );
    const edgeLabels = new Set(outs.map(edgeLabelOf).filter(Boolean));

    // (1) a declared branch label nothing claims. `default` is the engine's own
    //     sentinel for "no declared condition matched" and is additionally
    //     claimed by the BPMN default edge, so it is never counted as unclaimed.
    const unclaimed = [...declaredLabels].filter((l) => !edgeLabels.has(l));
    if (unclaimed.length > 0) {
      findings.push({
        where: `flow '${flowName}' · decision '${nid}'`,
        message:
          `declares branch label(s) ${unclaimed.map((l) => `'${l}'`).join(', ')} that no out-edge ` +
          `carries — out-edge labels are [${[...edgeLabels].map((l) => `'${l}'`).join(', ') || 'none'}]. ` +
          `Traversal cannot honour a label nothing claims, so it falls back to considering EVERY ` +
          `out-edge and the branch the decision computed is ignored.`,
        hint:
          `Make an out-edge's \`label\` match the declared branch exactly, or drop \`config.conditions\` ` +
          `and branch on the edges instead (\`condition\` per branch + \`isDefault: true\` on the ` +
          `fallback) — one mechanism per decision, never both. (#4414)`,
        rule: FLOW_BRANCH_LABEL_UNMATCHED,
      });
    }

    // (2) an out-edge nothing can gate: no condition, not the default, and not
    //     selectable by a label the decision declares.
    const gated = outs.filter((e) => e.condition || e.isDefault === true);
    if (gated.length === 0) continue; // no branching declared at all — nothing to undercut
    const ungated = outs.filter(
      (e) => !e.condition && e.isDefault !== true && !declaredLabels.has(edgeLabelOf(e)),
    );
    if (ungated.length > 0) {
      findings.push({
        where: `flow '${flowName}' · decision '${nid}'`,
        message:
          `has guarded out-edge(s) alongside unconditional one(s) ` +
          `(${ungated.map((e) => `'${String(e.target)}'`).join(', ')}) — an unconditional out-edge is ` +
          `traversed on EVERY pass, in parallel with whichever guarded branch matched, so the ` +
          `decision does not actually exclude it. A \`label\` alone does not select a path unless the ` +
          `decision declares a matching \`conditions[].label\`.`,
        hint:
          `Mark the fallback \`isDefault: true\` so it is taken only when no sibling condition matched ` +
          `(BPMN default flow), or give it its own \`condition\`. (#4414)`,
        rule: FLOW_DECISION_UNCONDITIONAL_BRANCH,
      });
    }
  }
}

function scanApprovalReviseLoops(
  flowName: string,
  nodes: AnyRec[],
  edges: AnyRec[],
  findings: FlowLintFinding[],
): void {
  const approvals = nodes.filter((n) => n.type === 'approval');
  if (approvals.length === 0) return;
  const nodeIds = new Set(nodes.map((n) => (typeof n.id === 'string' ? n.id : '')).filter(Boolean));
  const outEdges = new Map<string, AnyRec[]>();
  for (const e of edges) {
    const src = typeof e.source === 'string' ? e.source : '';
    if (!src) continue;
    if (!outEdges.has(src)) outEdges.set(src, []);
    outEdges.get(src)!.push(e);
  }

  for (const a of approvals) {
    const aid = typeof a.id === 'string' ? a.id : '';
    if (!aid) continue;
    const reviseTargets = edges
      .filter((e) => e.source === aid && edgeLabelOf(e) === 'revise')
      .map((e) => (typeof e.target === 'string' ? e.target : ''))
      .filter((t) => t && nodeIds.has(t));
    if (reviseTargets.length === 0) continue; // only approvals that declare a revise branch
    const where = `flow '${flowName}' \u00b7 approval '${aid}'`;

    // maxRevisions:0 alongside a revise edge is self-contradictory — send-back is
    // disabled, so the branch always auto-rejects and never actually runs.
    const cfg = (a.config ?? {}) as AnyRec;
    if (cfg.maxRevisions === 0) {
      findings.push({
        where,
        message:
          `declares a 'revise' out-edge but \`maxRevisions: 0\` disables send-back — every revise ` +
          `auto-rejects, so the revise branch never runs.`,
        hint:
          `Set \`maxRevisions\` >= 1 to allow N send-backs before auto-reject, or drop the 'revise' edge ` +
          `if send-back isn't intended (ADR-0044).`,
        rule: FLOW_APPROVAL_REVISE_DISABLED,
      });
    }

    // BFS from the revise target(s) over ALL edges; collect edges returning to
    // the approval (target === aid). A declared loop has >=1 such edge typed `back`.
    const seen = new Set<string>(reviseTargets);
    const queue = [...reviseTargets];
    const returnEdges: AnyRec[] = [];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of outEdges.get(cur) ?? []) {
        if (e.target === aid) returnEdges.push(e);
        const t = typeof e.target === 'string' ? e.target : '';
        if (t && nodeIds.has(t) && !seen.has(t)) {
          seen.add(t);
          queue.push(t);
        }
      }
    }

    if (returnEdges.length === 0) {
      findings.push({
        where,
        message:
          `has a 'revise' out-edge but no path loops back to it — the submitter reworks the record with ` +
          `nowhere to resubmit, so the revise branch dead-ends. (registerFlow accepts this — it's a valid DAG.)`,
        hint:
          `Close the loop: the 'revise' edge should reach a wait node whose resubmit edge returns to ` +
          `'${aid}' marked \`type: 'back'\` (ADR-0044). See examples/app-showcase showcase_budget_approval.`,
        rule: FLOW_APPROVAL_REVISE_DEAD_END,
      });
    } else if (!returnEdges.some((e) => e.type === 'back')) {
      findings.push({
        where,
        message:
          `has a 'revise' loop that returns to it, but the closing edge isn't declared \`type: 'back'\` — ` +
          `registerFlow rejects this as an un-declared cycle.`,
        hint:
          `Mark the resubmit edge (whose target is '${aid}') \`type: 'back'\` so cycle validation skips it ` +
          `while it still traverses at runtime; \`maxRevisions\` guards the loop (ADR-0044).`,
        rule: FLOW_APPROVAL_REVISE_UNMARKED_BACKEDGE,
      });
    }
  }
}

/**
 * Lint every flow's start node for known authoring anti-patterns. Returns a
 * (possibly empty) list of advisory findings — never throws, never fails a build.
 */
export function lintFlowPatterns(stack: AnyRec): FlowLintFinding[] {
  const findings: FlowLintFinding[] = [];
  for (const flow of asArray(stack.flows)) {
    const flowName = typeof flow.name === 'string' ? flow.name : '(unnamed flow)';
    const nodes = Array.isArray(flow.nodes) ? (flow.nodes as AnyRec[]) : [];
    const edges = Array.isArray(flow.edges) ? (flow.edges as AnyRec[]) : [];

    // (a) #1874 — date-equality time condition on a record-change start node.
    const start = nodes.find((n) => n.type === 'start');
    const startCfg = (start?.config ?? {}) as AnyRec;
    const triggerType = typeof startCfg.triggerType === 'string' ? startCfg.triggerType : '';
    if (triggerType.startsWith('record-')) {
      const src = conditionSource(startCfg.condition).trim();
      if (src && DATE_EQ.test(src)) {
        findings.push({
          where: `flow '${flowName}' · start condition`,
          message:
            `record-change trigger uses a date-EQUALITY time condition (\`${src}\`) — it only fires if the ` +
            `record happens to be written on that exact day, so unattended "N days before" rules never run.`,
          hint:
            `Use a SCHEDULE trigger (daily cron) + a range query instead — e.g. a scheduled flow whose ` +
            `get_record filters \`end_date\` BETWEEN {TODAY()} and {TODAY()+N}. (#1874)`,
          rule: FLOW_TIME_RELATIVE_ANTIPATTERN,
        });
      }
    }

    // (a4) #1888 / ADR-0049 / ADR-0073 D5 — a trigger that resolves NO USER at
    //      runtime (schedule, time-relative, api/webhook/queue) combined with an
    //      effective `runAs:'user'` (explicit, or unset → the spec default) is a
    //      CONFIGURATION ERROR: there is no user to scope to. Since #3760 the
    //      runtime REFUSES the data operation rather than running it unscoped, so
    //      this shape is a guaranteed run-time failure — which is why it fails the
    //      build instead of warning. Only flagged when the flow actually performs
    //      a data operation (otherwise `runAs` is moot and the run is fine).
    //
    //      This rule is necessary but NOT sufficient, and deliberately so: a
    //      record-change flow fired by a write that carried no user hits exactly
    //      the same refusal, but whether a given write carries a user is not
    //      knowable at authoring time. That case is caught at run time only
    //      (#3760) — do not try to approximate it here.
    const runAs = typeof flow.runAs === 'string' ? flow.runAs : 'user';
    const userLessKind = userLessTriggerKind(flow, startCfg);
    if (userLessKind && runAs !== 'system') {
      const dataNode = nodes.find((n) => DATA_NODE_TYPES.has(typeof n.type === 'string' ? (n.type as string) : ''));
      if (dataNode) {
        const declared = typeof flow.runAs === 'string' ? `\`runAs:'${runAs}'\`` : `the default \`runAs:'user'\``;
        findings.push({
          where: `flow '${flowName}' · runAs`,
          message:
            `${userLessKind}-triggered flow runs as ${declared}, but a ${userLessKind} run has no trigger ` +
            `user — so its data node '${dataNode.id}' (${dataNode.type}) has no identity to scope to and ` +
            `will be REFUSED at run time.`,
          hint:
            `Declare \`runAs:'system'\` to make the elevation explicit and intended (the run reads/writes ` +
            `every record). A ${userLessKind} flow cannot scope to a user — there is none. ` +
            `(ADR-0049, ADR-0073 D5, #1888, #3760)`,
          rule: FLOW_RUNAS_UNSCOPED,
          severity: 'error',
        });
      }
    }

    // (b) #1315 — wrong interpolation syntax in any node's template values. Flow
    //     node values use SINGLE braces; double-brace `{{ }}` and bare `$ref.x`
    //     are carried over from the formula template dialect / other platforms.
    for (const node of nodes) {
      const nodeWhere = `flow '${flowName}' · node '${node.id}' (${node.type})`;

      // (a2) #1874 — date-EQUALITY (`==`/`$eq`/`$in`) against a time value in a
      //      query filter. A scheduled flow that filters this way silently matches
      //      nothing; the robust shape is a `$gte`/`$lt` day window.
      const cfg = (node.config ?? {}) as AnyRec;
      if (cfg.filter) scanFilterForDateEquality(cfg.filter, `${nodeWhere} filter`, findings);

      // (a3) #1870 — a node-config key naming a non-existent capability (there is
      //      no aggregate node) is silently ignored at runtime, so the node
      //      computes nothing. Point the author at the data-layer equivalent.
      for (const key of Object.keys(cfg)) {
        if (PHANTOM_AGG_KEYS.has(key)) {
          findings.push({
            where: nodeWhere,
            message:
              `node config has \`${key}\` — the automation engine has no aggregate node, so \`${key}\` is ` +
              `silently ignored and this node computes nothing at runtime.`,
            hint:
              `Aggregation belongs in the data layer: use \`Field.summary\` for a cross-object rollup ` +
              `(sum/count of children), or \`Field.formula\` for a per-record computed value. (#1870)`,
            rule: FLOW_PHANTOM_AGGREGATION,
          });
        }
      }

      const strings: string[] = [];
      collectTemplateStrings(node.config, undefined, strings);
      for (const str of strings) {
        if (DOUBLE_BRACE.test(str)) {
          findings.push({
            where: nodeWhere,
            message: `double-brace interpolation \`${str.trim().slice(0, 80)}\` — flow node values use SINGLE braces.`,
            hint: `Use \`{var}\` (e.g. \`{record.title}\`). Double-brace \`{{ }}\` is the formula/template-field dialect, not flow node values. (#1315)`,
            rule: FLOW_DOUBLE_BRACE_INTERP,
          });
        }
        if (BARE_DOLLAR_REF.test(str)) {
          findings.push({
            where: nodeWhere,
            message: `\`${str.trim().slice(0, 80)}\` looks like a reference written as a literal — a bare \`$ref.field\` is NOT interpolated.`,
            hint: `Wrap it and bind a variable: \`{source.id}\` (or \`{$User.Id}\` for the current user). (#1315)`,
            rule: FLOW_BARE_DOLLAR_REF,
          });
        }
      }
    }

    // (c) ADR-0044 — approval send-back-for-revision loop footguns.
    scanApprovalReviseLoops(flowName, nodes, edges, findings);

    // (d) #3863 — an edge labelled like an error path but typed 'default' is an
    //     unconditional out-edge: the handler runs on every SUCCESS, in parallel
    //     with the real path, and never on a failure.
    scanErrorLabelledEdges(flowName, nodes, edges, findings);

    // (e) #4414 — a decision that declares a branch it cannot route: an
    //     unclaimable branch label, an unconditional sibling that runs anyway,
    //     or a self-contradictory / duplicated `isDefault` marker.
    scanBranchRouting(flowName, nodes, edges, findings);
  }
  return findings;
}
