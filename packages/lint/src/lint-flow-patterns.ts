// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Build-time lint for flow authoring ANTI-PATTERNS — metadata that is valid
 * (passes schema + expression checks) but is semantically a footgun at runtime.
 * Most are emitted as WARNINGS: they guide the author (very often an AI
 * generating templates) toward the robust pattern without failing the build on
 * a technically-legal construct.
 *
 * A finding carrying `severity: 'error'` FAILS the build. The bar is: **no
 * reading of the author's metadata does what it says, deterministically, on
 * every run.** Warning about such a shape is just a slower way of finding out.
 * That covers two kinds, and only these:
 *
 *  - **The runtime refuses.** {@link FLOW_RUNAS_UNSCOPED} — a user-less trigger
 *    with `runAs:'user'` has no identity to scope to, so the data operation is
 *    refused outright (#3760).
 *    {@link FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED} — a `revise` edge
 *    into anything but the service-owned revise window is refused by
 *    `ApprovalService.sendBack` before it mutates anything, so the branch can
 *    never run; and the shape it replaces was a pause anyone holding the run id
 *    could resume (#3823, amended ADR-0044).
 *  - **The declaration is inert and the route silently differs from what is
 *    written.** {@link FLOW_BRANCH_LABEL_UNMATCHED} — a decision computes a
 *    branch no out-edge carries, so the branch is discarded and every out-edge
 *    is considered instead. {@link FLOW_DEFAULT_EDGE_WITH_CONDITION} — an edge
 *    that is both the default and conditional; the condition wins and the
 *    marker routes nothing. Neither *fails*; both are wrong every time, and
 *    silently, which is worse (#4414).
 *
 * The bar is deliberately about *provability*, not severity of consequence. A
 * shape with a legitimate reading stays a warning even when it is usually a
 * mistake — {@link FLOW_DECISION_UNCONDITIONAL_BRANCH} covers a guard that does
 * not guard AND a decision that declares no branching at all, yet a decision
 * with one guarded and one unconditional out-edge is a legal "maybe notify,
 * always continue" fan-out, an all-unconditional one is that same fan-out under
 * a mis-chosen node type rather than a route that is broken, and
 * {@link FLOW_MULTIPLE_DEFAULT_EDGES} can genuinely mean "when nothing matched,
 * do both". Failing a customer's build on a shape we cannot prove wrong is a
 * worse trade than letting the warning be ignored.
 *
 * #5482 — the declared WHOLE-OBJECT write. A `delete_record`/`update_record`
 * with `multi: true` and no filter condition empties (or rewrites) the object on
 * every run. It stays a warning under the bar above — the engine's own dispatch
 * table grants "bulk intent, no predicate" on purpose, so the shape has a
 * legitimate reading — but before this rule the author's only feedback was the
 * step's `acted` count, after the rows were gone. See
 * {@link scanUnboundedBulkWrites}, including why it is not a second copy of the
 * #3810 run-time erased-condition guard.
 *
 * #1874 — time-relative rules via record-change date-EQUALITY. A start-node
 * trigger condition like `end_date == daysFromNow(60)` on a `record-*` trigger
 * only fires if the record happens to be written on that exact day; the robust
 * shape is a daily SCHEDULE trigger + a range query. We flag the equality form
 * specifically (range operators `>=`/`<=` are not flagged — they're the building
 * block of the correct pattern), keeping false positives near zero.
 *
 * #13681 / #14394 — per-iteration containment, as a PAIR of rules. A `loop`
 * body has no error handling of its own: `loop-node.ts` iterates with a bare
 * `await`, so the first item whose node fails ends the entire run and every
 * later item goes unprocessed, silently. The containment spelling exists and was
 * measured to work — `loop { body: [ try_catch { try, catch } ] }` processed all
 * 5 rows of a sweep whose 3rd row fails — but it is undiscoverable, and its
 * near-miss form fails *identically to no wrapper at all*: with `catch` omitted
 * the container fails through (`try-catch-node.ts:190`). So
 * {@link FLOW_LOOP_BODY_UNCONTAINED} names the uncontained body and
 * {@link FLOW_TRY_CATCH_WITHOUT_CATCH} names the wrapper that contains nothing,
 * and they divide one node between them: any enclosing `try_catch` counts as
 * containment for the first rule, so a catch-less one is reported once, by the
 * second, which is the rule that can name the missing key. Both stay warnings —
 * fail-fast on the first bad row, and retry-then-fail, are legitimate readings.
 *
 * ## Every graph in the flow, not just the top-level one (#5383)
 *
 * These rules used to read `flow.nodes` / `flow.edges` flat, so every one of
 * them was blind to anything authored inside an ADR-0031 container: a `loop`
 * body, a `parallel` branch, a `try_catch` try/catch. That is not a corner —
 * a per-item gate inside a sweep is the standard shape for a scheduled flow, and
 * it is exactly where the rules were needed. Measured in a real app (HotCRM):
 * 8 `decision` nodes carried the inert singular `config.condition` that
 * {@link FLOW_INERT_NODE_CONDITION} exists to catch, all 8 inside a `loop` body,
 * and `pnpm lint` reported none of them. The identical key on a TOP-LEVEL
 * decision in the same repo fired immediately — same key, same node type, only
 * the nesting depth differed. The blind spot also explains its own survival: the
 * gate visibly worked where it could see, so the top-level copies got cleaned up
 * and the nested ones read as approved.
 *
 * The fix is to iterate {@link collectFlowGraphs} — the same traversal the
 * engine's registration pass uses (`validateNodeConfigKeys`,
 * `validateFlowExpressions`) and that `validate-expressions.ts` already uses on
 * the author side — and to prefix each finding's `where` with
 * {@link FlowGraph.scope}, so a message still points at exactly one node
 * (`flow 'x' · loop 'sweep' body · node 'y' (decision)`).
 *
 * Two things about that walk are load-bearing here, not incidental:
 *
 *  - **nodes and edges stay PAIRED per region.** A region is a self-contained
 *    sub-graph: its edges join its own nodes, and no top-level edge reaches into
 *    it. Flattening every region into one node bag plus one edge bag would break
 *    the branch-routing family in both directions — a nested `decision`'s
 *    out-edges would be absent from the top-level edge list, so it would read as
 *    having none and be skipped outright (`outs.length === 0`), while two nodes
 *    in *different* regions sharing an id (ids are unique per graph, not per
 *    flow) would have their out-edges merged into one phantom fan-out. Each
 *    graph is therefore scanned against its own `edges`.
 *  - **a container's own config is read region-STRIPPED for the recursive
 *    scans.** {@link collectTemplateStrings} walks a node's config to its string
 *    leaves, and a container's config physically CONTAINS every descendant's.
 *    Before this change that produced a *mis-attributed* finding rather than a
 *    missing one: a `{{ }}` inside a loop body was reported against the `loop`
 *    node, the same failure mode `validate-flow-template-paths` had (#4380) —
 *    visible, but judged against the wrong node. Descending without stripping
 *    would have turned that into a DOUBLE report (once at the container, once at
 *    the node). Stripping the region slots moves each such finding onto the node
 *    that actually carries the string, and the count stays 1.
 *
 * Deliberately still flow-level, i.e. read off the top-level nodes only: the
 * start-node trigger rules. A trigger is a property of the flow, and a region has
 * an entry node, not a `start` — there is nothing one level down for them to read.
 *
 * ## The one rule whose VERDICT is flow-level but whose EVIDENCE is not (#5633)
 *
 * {@link FLOW_RUNAS_UNSCOPED} was the third case, and it is neither of the two
 * above. #5383 left it top-level-only on purpose — it is the family's only
 * build-GATING member, so widening it turns green builds red and deserved its own
 * change — and #5633 is that change. Its two halves sit at different altitudes:
 *
 *  - the **verdict** is flow-level and stays there. `flow.runAs` is one
 *    declaration and the trigger is the start node's, so a flow is either
 *    unscoped or it is not: one finding per flow, `where` = `flow 'x' · runAs`,
 *    never per region and never once per data node.
 *  - the **evidence** — "does this flow perform a data operation at all", the
 *    condition that makes `runAs` matter — is a question about the whole flow.
 *    A `loop` body is as much part of it as the top level, and the runtime agrees:
 *    `resolveRunAsIdentity` refuses a nested write for exactly the reason it
 *    refuses a top-level one (#3760). Nesting depth is not a property it consults.
 *
 * So {@link findDataNodeAnywhere} searches every graph while the finding stays
 * flow-level, and the region is named in the **message** rather than in `where`
 * (`its data node 'touch' (update_record), in loop 'loop_rows' body,`): `where`
 * says which declaration is wrong, the message says where to find the proof. A
 * top-level hit adds no region clause at all — pinned in the tests, since a
 * top-level finding is what most authors see.
 *
 * What this fixes is not a corner. Query a set, loop it, write per item is *the*
 * shape of a scheduled data flow, so the write is almost always the nested node —
 * and because this rule gates the build, the shape it was missing built clean and
 * then could not run at all. That is precisely what promoting it to `error`
 * (#3760) was for.
 *
 * #5693 rewrote how that same message names the identity — one wording true of
 * both authoring inputs instead of a branch on `flow.runAs` that no CLI command
 * could take. See {@link RUNAS_EFFECTIVE_IDENTITY}.
 */

import {
  APPROVAL_NODE_TYPE,
  APPROVAL_REVISE_NODE_TYPE,
  collectFlowGraphs,
} from '@objectstack/spec/automation';
import type { FlowNodeParsed, FlowEdgeParsed } from '@objectstack/spec/automation';
// [#5659] The Filter Protocol's boolean identity reduction — the same predicate
// driver-sql, driver-mongodb and driver-memory execute. This linter asks it
// rather than hand-writing a fourth copy; see {@link filterCarriesNoCondition}.
import { reduceFilterVerdict } from '@objectstack/spec/data';
import { stripRegions, REGION_SLOTS, MAX_REGION_DEPTH } from './flow-walk.js';
import { recordsOf } from './object-graph.js';

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
 * #3823 — the `revise` edge targets a node that is not the service-owned revise
 * window. `error`: `ApprovalService.sendBack` refuses this metadata outright
 * (see {@link scanApprovalReviseLoops}).
 */
export const FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED = 'flow-approval-revise-target-not-service-owned';
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
/** #4414 — `config.condition` on a node whose executor never reads it. */
export const FLOW_INERT_NODE_CONDITION = 'flow-inert-node-condition';
/**
 * #5482 — a `delete_record` / `update_record` node that declares `multi: true`
 * and bounds it with NOTHING: the whole-object write, by declaration.
 *
 * Named descriptor-first per the family note on
 * `flow-time-relative-descriptor-invalid` in `validate-flow-trigger-readiness.ts`
 * (`flow-<descriptor>-<verdict>`, #5496): the descriptor is the
 * `multi` bulk declaration on a write node, the verdict is that no predicate
 * bounds it. See {@link scanUnboundedBulkWrites} for why this is a warning and
 * how it divides labour with the #3810 run-time guard.
 */
export const FLOW_MULTI_WRITE_UNFILTERED = 'flow-multi-write-unfiltered';
/**
 * #13681 / #14394 — a `loop` body that runs a node which can fail, with no
 * `try_catch` between the loop and that node. The first failing item kills the
 * whole sweep: `loop-node.ts:123-135` iterates with a bare `await` and no
 * `try`/`catch` anywhere in the file, so the body's failure propagates out of
 * the container and the remaining items are never processed.
 *
 * A **warning**, per the severity policy at the top of this file: a loop whose
 * body is deliberately allowed to die (fail fast on the first bad row) is a
 * legitimate reading, and the rule cannot prove the author did not mean it. What
 * it can do is make the choice visible at authoring time — today it is silent,
 * and the measured consequence is a 5-row sweep that processes 3 rows and
 * reports a run that "completed" nothing unusual.
 *
 * See {@link scanUncontainedLoopBodies} for the containment judgement, and
 * {@link FALLIBLE_NODE_TYPES} for what counts as fallible and why.
 */
export const FLOW_LOOP_BODY_UNCONTAINED = 'flow-loop-body-uncontained';
/**
 * #13681 / #14394 — the near-miss shape: a `try_catch` that declares no `catch`
 * region. `catch` is optional in the schema (`control-flow.zod.ts:315`) and
 * omitting it makes the container **fail** (`try-catch-node.ts:190`), so the
 * wrapped region dies exactly like an unwrapped one — measured side by side, the
 * no-`catch` run and the no-wrapper control produce identical output.
 *
 * This is the family's first target for the containment pair, not an extra: an
 * author who reaches for `try_catch` has recognised the hazard and stopped one
 * key short, and before this rule got **zero containment and zero diagnostics**.
 * A warning rather than an error under the same policy — a `retry`-only
 * `try_catch` (retry the region, then fail loudly) is a legitimate reading.
 *
 * See {@link scanTryCatchWithoutCatch}.
 */
export const FLOW_TRY_CATCH_WITHOUT_CATCH = 'flow-try-catch-without-catch';

/**
 * Node types that ship in the box. `config.condition` is only ever READ on the
 * `start` node (the trigger gate — `AutomationEngine.execute` and the trigger
 * bindings); every other builtin ignores it, so a predicate written there is a
 * guard that does not guard.
 *
 * Deliberately a closed list rather than "any node type": ADR-0018 keeps
 * `node.type` open so plugins can register their own, and a plugin executor is
 * free to declare and read `config.condition` from its own `configSchema`. We
 * can only prove the key is inert for the types we ship.
 *
 * Kept as a literal rather than imported from `FLOW_BUILTIN_NODE_TYPES` because
 * membership here means "we have read this executor and it ignores the key",
 * which is a stronger claim than "this id is built in" — a new builtin must be
 * checked, not silently inherited.
 */
const INERT_CONDITION_NODE_TYPES = new Set([
  'decision', 'assignment', 'loop', 'parallel', 'try_catch',
  'create_record', 'update_record', 'delete_record', 'get_record',
  'http', 'notify', 'script', 'screen', 'wait', 'subflow', 'map',
  'connector_action', 'approval', 'end',
]);

/** Node types that perform a data operation — the ones `flow.runAs` governs (#1888). */
const DATA_NODE_TYPES = new Set(['get_record', 'create_record', 'update_record', 'delete_record']);

/**
 * #14394 — node types whose executor can end a run: it returns `success: false`
 * (or throws) for a reason that is **not knowable at authoring time** — an
 * absent row, a refused write, a 500, a connector outage, a child flow that
 * died. These are the nodes {@link FLOW_LOOP_BODY_UNCONTAINED} judges a loop
 * body by.
 *
 * Membership means "we have READ this executor and found such a path", the same
 * stronger claim {@link INERT_CONDITION_NODE_TYPES} makes, and for the same
 * reason: `node.type` is an open namespace (ADR-0018), so a literal list is the
 * only honest one. Per-type, with the failure the reading found:
 *
 *  - `get_record` / `create_record` / `update_record` / `delete_record` — each
 *    wraps its ObjectQL call in `try`/`catch` and returns
 *    `success: false, error: '<op>(<object>) failed: …'`
 *    (`crud-nodes.ts:262, :359, :452, :515`).
 *  - `http` — a non-2xx (when `failOnError`), a timeout/abort, or a failed
 *    durable enqueue (`http-nodes.ts:208, :249-253`).
 *  - `notify` — no title, an empty resolved recipient set, or a delivery throw
 *    (`notify-node.ts:293, :300, :446`). The measured #13681 case exactly: one
 *    row with a null owner killed the sweep.
 *  - `connector_action` — a degraded connector, an unresolvable action, or a
 *    throwing call (`connector-nodes.ts:69, :76, :124`).
 *  - `script` — the named function is not registered on this host, or it threw
 *    (`screen-nodes.ts:250, :294`).
 *  - `subflow` — the child flow failed, or paused without a run id
 *    (`subflow-node.ts:118, :147`).
 *  - `map` — the collection did not resolve to an array, exceeded the item cap,
 *    or an item's child run failed (`map-node.ts:115, :118, :189`).
 *  - `approval` — invalid config, a missing `$runId` / object / record id in
 *    context, or a throwing request (`plugin-approvals/src/approval-node.ts:136,
 *    :145-147, :212`). Plugin-registered but in-box, and this file already
 *    imports its type constant for the ADR-0044 rules.
 *
 * Deliberately **absent**, each also by reading the executor:
 *
 *  - `assignment`, `decision` — every path returns `success: true`
 *    (`logic-nodes.ts:76-78, :137-141`). `assignment` is also the documented
 *    minimal `catch` handler, so flagging it would warn about the fix.
 *  - `wait`, `screen` — they suspend (`success: true, suspend: true`) and have
 *    no failure return (`wait-node.ts:262, :284, :290`; `screen-nodes.ts:44-96`).
 *  - `start` / `end` — sentinels, and a region may not contain them at all.
 *  - `loop` / `parallel` / `try_catch` — containers. They do fail, but only
 *    *because* something inside them failed, so the walk descends to the leaf
 *    that carries the real failure instead of reporting the wrapper (which would
 *    also double-report).
 *  - **Every node type not in this list**, including plugin-registered ones. An
 *    unknown executor can certainly return `success: false`, so counting them
 *    fallible would be defensible for a warning — but it would flag nodes nobody
 *    here has read, and this family's precedent is that the list is a record of
 *    readings, not a guess. The cost is a false negative on a third-party node;
 *    the alternative is a false positive on every one of them.
 */
const FALLIBLE_NODE_TYPES: ReadonlySet<string> = new Set([
  'get_record', 'create_record', 'update_record', 'delete_record',
  'http', 'notify', 'connector_action', 'script', 'subflow', 'map',
  APPROVAL_NODE_TYPE,
]);

/**
 * The container that provides containment inside a loop body, and the config key
 * whose absence makes it provide none (#14394).
 *
 * Rule A treats **any** enclosing `try_catch` as containment — including one
 * with no `catch`, which contains nothing. That is deliberate division of
 * labour, not an oversight: the catch-less container is reported once, by
 * {@link FLOW_TRY_CATCH_WITHOUT_CATCH}, naming the one key that fixes it.
 * Reporting it from both rules would tell an author who wrapped their node that
 * they must wrap it, which is the one thing they did do.
 */
const TRY_CATCH_NODE_TYPE = 'try_catch';
const LOOP_NODE_TYPE = 'loop';

/**
 * How {@link FLOW_RUNAS_UNSCOPED} names the identity the run would use — ONE
 * wording, true whether the author wrote `runAs:'user'` or wrote nothing (#5693).
 *
 * It replaces a ternary that told the author which of the two they had done:
 * `` `runAs:'user'` `` when `flow.runAs` was a string, `the default …` when it
 * was absent. That distinction is real, but the rule cannot observe it, and the
 * arm it picked depended on the SURFACE rather than on the metadata:
 *
 *  - **CLI (`os validate` / `os build` / `os lint`) — always the explicit arm.**
 *    `FlowSchema.runAs` carries `.default('user')`, and the registry wires this
 *    rule `input: 'parsed'`, so `flow.runAs` is the string `'user'` either way.
 *    `os lint` does not parse and would have escaped that, except that
 *    `defineStack` (and `defineFlow`) parse at *definition* time, so the config
 *    module hands even the non-parsing command a stack with the default already
 *    materialized. Measured on `examples/app-todo` with the `runAs` line deleted:
 *    both commands printed the EXPLICIT arm at an author who had declared nothing.
 *  - **Runtime publish gate (#4463) — both arms.** It judges `request.item`, the
 *    verbatim authored body (`saveMetaItem` keeps it verbatim past the schema
 *    check), so an omitted key really is absent there.
 *
 * So the same flow was told two different things by two shipped surfaces, and on
 * the surface an author uses first it was told the one that reads as an
 * accusation: *"you declared `runAs:'user'`"* to someone who declared nothing —
 * inviting "the tool is confused" at the exact moment the tool is right and the
 * fix is one line. Restoring the distinction would mean giving a `parsed`-tier
 * rule a second, pre-parse input; #5693 chose the wording instead.
 *
 * The parenthetical is a statement about the VALUE, not an accusation about the
 * author, so it stays true for someone who did write `runAs:'user'`. That is the
 * house pattern, not a new one: `flow-draft-status-ambiguous` says `has status
 * 'draft' (the default when none is authored)` for exactly this reason, on
 * exactly this mechanism (`validate-flow-trigger-readiness.ts`).
 *
 * `'user'` is spelled out rather than interpolated from `flow.runAs` because the
 * branch that uses this has already excluded `'system'` and the enum holds only
 * those two — so on every surface that reaches the message (CLI: parsed; runtime
 * gate: `safeParse`d against the overlay schema before the gate runs) the
 * effective identity IS `'user'`. Interpolating would re-introduce a limb only
 * an off-spec literal could reach, which is the defect this replaced.
 */
const RUNAS_EFFECTIVE_IDENTITY = "`runAs:'user'` (the default when none is declared)";

/**
 * The first data node ANYWHERE in a flow, with the region it was found in —
 * {@link FLOW_RUNAS_UNSCOPED}'s evidence that the flow performs a data operation
 * at all (#5633).
 *
 * Three properties of this search are load-bearing:
 *
 *  - **It returns the FIRST hit, not all of them.** The rule's verdict is about
 *    `flow.runAs`, a single declaration, so the finding is one per flow and the
 *    node is only cited to point the author at it. Collecting every data node
 *    would invite a per-node push and turn one wrong declaration into N
 *    identical build errors.
 *  - **Top-level first.** {@link collectFlowGraphs} yields the flow's own graph
 *    before it descends, so a flow with data nodes at both altitudes still cites
 *    the same node it cited before this widening — the top-level behaviour is
 *    bit-for-bit unchanged, including which node appears in the message.
 *  - **No region strip is needed.** A container's `config` physically contains
 *    its descendants', which is what forces {@link stripRegions} on the
 *    recursive config scans — but this search reads `node.type` only, and no
 *    container type (`loop`/`parallel`/`try_catch`) is a data node type. A nested
 *    write is therefore seen exactly once, in the region graph that owns it,
 *    never a second time through its enclosing container.
 */
function findDataNodeAnywhere(
  nodes: AnyRec[],
  edges: AnyRec[],
): { readonly node: AnyRec; readonly scope: string } | null {
  // A cast, not a parse — same contract as the main per-graph walk below: the
  // walk touches only `type` / `config`, and the guarded arrays are passed so a
  // malformed region cannot make this throw (this module never throws).
  for (const graph of collectFlowGraphs({
    nodes: nodes as unknown as FlowNodeParsed[],
    edges: edges as unknown as FlowEdgeParsed[],
  })) {
    for (const node of graph.nodes as unknown as AnyRec[]) {
      if (DATA_NODE_TYPES.has(typeof node.type === 'string' ? (node.type as string) : '')) {
        return { node, scope: graph.scope };
      }
    }
  }
  return null;
}

/**
 * #5482 — the two node types that carry the `multi` bulk declaration, with the
 * words their diagnostic uses for what an unbounded one does.
 *
 * `create_record` has no `filter` and no `multi`; `get_record` has a `filter`
 * but no `multi` and does not write. So this is the whole set, and it is spelled
 * out rather than derived from {@link DATA_NODE_TYPES} because membership means
 * "this executor forwards `config.multi` to the engine as bulk intent", which is
 * a claim about the executor, not about being a data node.
 */
const BULK_WRITE_CONSEQUENCE: ReadonlyMap<
  string,
  { readonly verb: string; readonly engineCall: string; readonly dispatchNote: string }
> = new Map([
  ['delete_record', {
    verb: 'deleted',
    engineCall: 'driver.deleteMany',
    // The delete dispatch is the one that is EXTRACTED and case-set-pinned
    // (`engine-delete-dispatch.ts`), so it can be cited by name.
    dispatchNote: "the engine's delete-dispatch case-set lists `multi with no predicate at all` as a legal `multi` call",
  }],
  ['update_record', {
    verb: 'overwritten',
    engineCall: 'driver.updateMany',
    // Update has no extracted dispatch module, so the branch itself is the
    // authority — and its refusal fires only WITHOUT the declaration.
    dispatchNote: "the engine takes its bulk branch on `options.multi` alone (`Update requires an ID or options.multi=true` is refused only when the declaration is absent)",
  }],
]);

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
 * `revise` out-edge — the shapes an AI authoring an approval flow gets wrong:
 *  - the revise branch never loops back to the approval (the submitter reworks
 *    the record with nowhere to resubmit). This is a VALID DAG, so `registerFlow`
 *    ACCEPTS it — the linter is the only place that catches the dead end.
 *  - the loop DOES return to the approval, but the closing edge isn't declared
 *    `type: 'back'`, so `registerFlow` rejects it as an un-declared cycle. The
 *    lint fires at compile time with the specific fix (mark the resubmit edge).
 *  - the revise edge targets a plain `wait` — the shape ADR-0044 D3 originally
 *    prescribed, reversed by its 2026-07-28 amendment (#3823). An AI author
 *    following the old text generates it verbatim, which is exactly why this one
 *    is an `error` rather than a warning: nothing in the metadata itself said the
 *    node sat in a privileged position.
 */
/**
 * #3863 — flag edges labelled like an error path but left at the default type.
 * See {@link ERROR_LABELS} for why this is a footgun and what is excluded.
 */
function scanErrorLabelledEdges(
  at: string,
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
      where: `${at} · edge '${src}' → '${String(e.target)}'`,
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
 *  (2) `flow-decision-unconditional-branch` — an out-edge nothing can gate: no
 *      `condition`, no `isDefault`, and no label the decision can select. It is
 *      traversed on EVERY pass, in parallel with whichever branch did match, so
 *      the guard next to it does not guard. #16093 gave the same id a second
 *      message for the strictly worse shape it could not previously see: NO
 *      out-edge gated and no `conditions[]` declared either. The rule was framed
 *      as "an unconditional edge undercuts a guarded one", so zero guarded edges
 *      read as nothing to undercut and the node was skipped — but a decision
 *      with no guard anywhere does not have less wrong with it, it selects no
 *      branch at all: every successor runs on every pass and the gateway is
 *      decoration. It is also the harder shape to notice in review, because the
 *      node still says `type: 'decision'`. A decision routing by
 *      `config.conditions[]` labels alone has declared its branching on the node
 *      and is not this shape; (1) already owns it when a declared label goes
 *      unclaimed.
 *  (3) `flow-default-edge-with-condition` — `isDefault` means "when nothing else
 *      matched"; a condition on the same edge contradicts it (BPMN forbids a
 *      conditional default flow). The condition wins and the marker is inert.
 *  (4) `flow-multiple-default-edges` — two fallbacks out of one node. Both are
 *      traversed when nothing matched, which is a parallel fan-out, not the
 *      exclusive "otherwise" the marker promises.
 *  (5) `flow-inert-node-condition` — `config.condition` on a node that never
 *      reads it. The key is the trigger gate on `start` and dead on every other
 *      builtin, so the predicate reads like a guard and gates nothing.
 *
 * (1) and (3) GATE — neither has a reading under which the author's metadata
 * routes what it says, on any run, so a warning would just be a slower way of
 * finding out. (2) and (4) stay advisory: an unconditional sibling is a legal
 * "maybe notify, always continue" fan-out, an all-unconditional decision is that
 * same fan-out written on the wrong node type — the successors it names do run,
 * every one of them, every pass — and two defaults can mean "when nothing
 * matched, do both". See the severity policy at the top of this file.
 *
 * The engine also warns when it hits (1) live — a stored flow authored before
 * this rule existed still reaches run time.
 */
function scanBranchRouting(
  at: string,
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
          where: `${at} · edge '${src}' → '${String(e.target)}'`,
          message:
            `edge sets \`isDefault: true\` AND a \`condition\` — contradictory. \`isDefault\` means ` +
            `"take this edge when NO sibling condition matched"; a condition makes it an ordinary ` +
            `guarded branch. The condition wins and the default marker routes nothing.`,
          hint:
            `Drop one: keep \`condition\` for a guarded branch, or drop it and keep \`isDefault: true\` ` +
            `for the "otherwise" path. (#4414)`,
          rule: FLOW_DEFAULT_EDGE_WITH_CONDITION,
          // Gating: the two keys contradict, the condition always wins, and the
          // marker never routes. No reading makes it do what it says.
          severity: 'error',
        });
      }
    }
    const defaults = outs.filter((e) => e.isDefault === true && !e.condition);
    if (defaults.length > 1) {
      findings.push({
        where: `${at} · node '${src}'`,
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

  // (5) #4414 — `config.condition` on a node that never reads it.
  //
  // The key is LIVE on `start`, where it is the trigger gate, and dead
  // everywhere else: the engine parse-validates it on every node at
  // registration (so a malformed one is caught), and then no executor but the
  // start path looks at it. On a `decision` the name makes it read as the
  // branch predicate — app-todo's `check_recurring` carried one for exactly
  // that reason, a third copy of a predicate its out-edges were already
  // enforcing. Where the out-edges are NOT already deciding, the same shape is
  // a guard that does nothing and every out-edge runs.
  //
  // Advisory: the surrounding edges usually still route correctly, so this is
  // dead weight rather than a provable misroute (the gating bar is at the top
  // of this file).
  for (const node of nodes) {
    const nodeType = typeof node.type === 'string' ? node.type : '';
    if (!INERT_CONDITION_NODE_TYPES.has(nodeType)) continue;
    const cfg = (node.config ?? {}) as AnyRec;
    if (cfg.condition == null || conditionSource(cfg.condition).trim() === '') continue;
    findings.push({
      where: `${at} · node '${String(node.id)}' (${nodeType})`,
      message:
        `\`config.condition\` is set but nothing reads it — the key is the trigger gate on a \`start\` ` +
        `node and is ignored on every other node type, so this predicate never gates anything. ` +
        `(It is still parse-validated at registration, which is why a malformed one is caught and an ` +
        `inert one is not.)`,
      hint:
        nodeType === 'decision'
          ? `Branching lives on the OUT-EDGES: give each branch its own \`condition\` and mark the ` +
            `fallback \`isDefault: true\`. If the edges already carry the predicate, delete this copy. (#4414)`
          : `Delete it, or move the predicate to the incoming edge's \`condition\` if this step was ` +
            `meant to be conditional. (#4414)`,
      rule: FLOW_INERT_NODE_CONDITION,
    });
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
        where: `${at} · decision '${nid}'`,
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
        // Gating: a label nothing claims cannot route under ANY reading, on
        // every run. See the severity policy at the top of this file.
        severity: 'error',
      });
    }

    // (2) an out-edge nothing can gate: no condition, not the default, and not
    //     selectable by a label the decision declares.
    const gated = outs.filter((e) => e.condition || e.isDefault === true);
    const declaresConditions = Array.isArray(cfg.conditions) && (cfg.conditions as unknown[]).length > 0;

    if (gated.length === 0) {
      // (2a) #16093 — the decision gates on NOTHING. The old framing read this
      //      as "no branching declared at all, nothing to undercut" and skipped
      //      it; that reads zero guarded edges as an absence when it is the
      //      defect. A decision routing by `config.conditions[]` labels alone
      //      is NOT inert — its branching is declared on the node — and (1)
      //      above already reports it when no out-edge claims a declared label,
      //      so it is excluded here rather than reported twice.
      if (!declaresConditions) {
        findings.push({
          where: `${at} · decision '${nid}'`,
          message:
            `gates on NOTHING — none of its out-edge(s) ` +
            `(${outs.map((e) => `'${String(e.target)}'`).join(', ')}) carries a \`condition\` or ` +
            `\`isDefault\`, and the decision declares no \`config.conditions[]\`. With no branch to ` +
            `select, EVERY out-edge is traversed on EVERY pass, in parallel — the node is typed ` +
            `\`decision\` but routes exactly as a non-decision step would, so the gateway is decoration.`,
          hint:
            `Declare the branching one way and one way only: a \`condition\` per branch plus ` +
            `\`isDefault: true\` on the fallback, or \`config.conditions[]\` whose \`label\` matches an ` +
            `out-edge's. If the unconditional fan-out is what you meant, drop \`type: 'decision'\` and ` +
            `use the node it already behaves as.`,
          rule: FLOW_DECISION_UNCONDITIONAL_BRANCH,
        });
      }
      // Either way no out-edge is gated, so the mixed-branch check below — an
      // unconditional edge undercutting a guarded sibling — has no sibling to
      // read and would only report the same node a second time.
      continue;
    }
    const ungated = outs.filter(
      (e) => !e.condition && e.isDefault !== true && !declaredLabels.has(edgeLabelOf(e)),
    );
    if (ungated.length > 0) {
      findings.push({
        where: `${at} · decision '${nid}'`,
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

/**
 * #5482 — is this AUTHORED `filter` provably carrying no condition at all, so
 * that the write it is supposed to bound is bounded by nothing?
 *
 * The question is "does this filter reduce to TRUE", and #5659 stopped it being
 * answered by hand. Three shapes answer `true`:
 *
 *  - the key is **absent** (`undefined` / `null`). The executor substitutes `{}`
 *    (`resolveNodeFilter(cfg.filter ?? {}, …)` in `crud-nodes.ts`).
 *  - a plain object with **zero own keys** (`{}`), which the executor passes
 *    through unchanged.
 *  - anything the shared identity reduction resolves to TRUE — `{ $and: [] }`
 *    (the AND identity: a conjunction of zero conditions constrains nothing) and
 *    `{ $or: [{}] }` (a TRUE disjunct absorbs its `$or`) are the two that occur
 *    in authored metadata, and both were INVISIBLE here until #5659.
 *
 * All of them arrive at the engine as an unbounded write:
 * `resolveEngineDeleteDispatch` classifies `where: {}` as `multi` (its case-set
 * lists `multi with no predicate at all` as legal) and every driver reads a
 * TRUE-reducing filter as every row.
 *
 * ## Why the third bullet is a CALL and not a third `if`
 *
 * This function used to end at the second bullet, and said so in a paragraph
 * that is now this change's own justification: the empty combinators were left
 * alone not because their answer was unclear — #5322/#5134 ruled it — but
 * because deciding which is which requires the identity REDUCTION, and that
 * reduction existed three times over (`reduceFilterNode` in driver-sql, in
 * driver-mongodb, and the matcher's algebra in driver-memory). "Hand-writing a
 * fourth copy inside a linter is how the scan and the validator come to answer
 * with two different predicates." #5659 removed the reason to choose: the
 * reduction is `@objectstack/spec`'s {@link reduceFilterVerdict} now, proven
 * against `FILTER_LOGIC_CASES`, and all four consumers read it.
 *
 * What the reduction does NOT warn about matters as much as what it does:
 * `{ $or: [] }` is FALSE (matches NOTHING — the opposite of a whole-object
 * write) and `{ $not: {} }` is FALSE likewise. A hand-written "is it an empty
 * combinator" test would have warned about both; the shared verdict cannot,
 * because it is the same verdict the drivers execute.
 *
 * Everything else is left alone, deliberately:
 *
 *  - **any node carrying a real predicate** (verdict `'clause'`) — including an
 *    authored `{token}` that will interpolate to nothing. That is the #3810
 *    guard's fact, judged at run time against the interpolation result, and this
 *    rule must not pre-empt it: at authoring time the condition IS written.
 *  - **a non-object `filter`** (string, array, number). `DeleteRecordConfigSchema`
 *    /`UpdateRecordConfigSchema` type it `z.record(z.string(), z.unknown())`, so
 *    the node is refused BY NAME at execute time (`parseNodeConfig`). Warning
 *    "the object is unbounded" about metadata the schema already rejects would
 *    describe a run that never happens. Kept as a guard HERE rather than left to
 *    the reduction: the shared predicate takes a node, and a linter that hands
 *    it a string would be asking a question the schema already answered.
 */
function filterCarriesNoCondition(filter: unknown): boolean {
  if (filter === undefined || filter === null) return true;
  if (typeof filter !== 'object' || Array.isArray(filter)) return false;
  // Hookless: this linter refuses nothing. A shape the reduction cannot resolve
  // answers `'clause'`, i.e. no warning — the conservative direction for a rule
  // whose message asserts "every row of this object is written".
  return reduceFilterVerdict(filter as AnyRec) === 'true';
}

/**
 * #5659 — name the shape the author actually wrote, for a message that has to be
 * right about "this is the whole object".
 *
 * The two combinator spellings get their own wording rather than being folded
 * into "an EMPTY `filter`": `{ $and: [] }` is not empty, it is a conjunction of
 * zero conditions, and an author told their non-empty filter is "empty" will
 * look for a typo instead of reading the identity. Only reached for a filter
 * {@link filterCarriesNoCondition} already resolved to TRUE.
 */
function describeUnboundedFilter(filter: unknown): string {
  if (filter === undefined || filter === null) return 'no `filter` key';
  if (Object.keys(filter as AnyRec).length === 0) return 'an EMPTY `filter`';
  return `a \`filter\` that REDUCES TO TRUE (\`${previewFilter(filter)}\`)`;
}

/** A short, non-throwing rendering of the offending filter for the message. */
function previewFilter(filter: unknown): string {
  try {
    const json = JSON.stringify(filter);
    if (typeof json !== 'string') return typeof filter;
    return json.length > 80 ? `${json.slice(0, 77)}...` : json;
  } catch {
    return typeof filter;
  }
}

/**
 * #5482 — a `delete_record` / `update_record` that DECLARES `multi: true` and
 * bounds it with nothing: the whole-object write.
 *
 * Reachable only since #5393 gave these nodes a bulk declaration at all. Before
 * it, the executor never passed `options.multi`, so the engine refused every
 * predicate write (`Delete requires an ID or options.multi=true`) and "empty
 * filter + bulk" was not an authoring surface. It is one now, and it is a
 * legitimate one: the engine's own dispatch case-set lists `multi with no
 * predicate at all` as a valid `multi` call, so an explicit whole-object purge
 * is expressible by design (`engine-delete-dispatch.ts`).
 *
 * Which is why this WARNS and does not gate, and why the fix for #5482 is not a
 * spec refine: forbidding the shape would delete an intent the platform grants
 * on purpose. What was missing is only that the author hears about it BEFORE the
 * rows go — until now the sole feedback was the step's `acted` count, reported
 * after the fact.
 *
 * ## Not a second copy of the #3810 guard
 *
 * `crud-nodes.ts` refuses a node at run time when a condition the author WROTE
 * interpolated to nothing (`{record.ownr}` — a typo — leaving `{}`), and it is
 * deliberately keyed on "a condition the author wrote is gone", not on "the
 * filter is empty": losing one of two conditions still widens the blast radius,
 * and an intentionally empty filter erases nothing, so `crud-filter-guard.test.ts`
 * pins that such a filter is still allowed.
 *
 * So the two judge different facts and neither subsumes the other:
 *
 * | fact                                  | judged by            | when      | verdict |
 * |---------------------------------------|----------------------|-----------|---------|
 * | a written condition vanished          | #3810 filter guard   | run time  | refuse  |
 * | no condition was ever written         | this rule            | authoring | warn    |
 *
 * A node with `filter: { owner: '{record.ownr}' }` is silent here (a condition
 * IS written) and refused there. A node with no `filter` at all is warned about
 * here and — correctly — allowed there.
 */
function scanUnboundedBulkWrites(
  at: string,
  nodes: AnyRec[],
  findings: FlowLintFinding[],
): void {
  for (const node of nodes) {
    const nodeType = typeof node.type === 'string' ? node.type : '';
    const consequence = BULK_WRITE_CONSEQUENCE.get(nodeType);
    if (!consequence) continue;
    const cfg = (node.config ?? {}) as AnyRec;
    // `=== true` is the executor's own test (`multi: cfg.multi === true`), and
    // the schema types the key `z.boolean()` — a `multi: 'true'` is refused by
    // the parse, so treating it as declared bulk intent would warn about a node
    // that cannot run.
    if (cfg.multi !== true) continue;
    if (!filterCarriesNoCondition(cfg.filter)) continue;

    const objectName = typeof cfg.objectName === 'string' && cfg.objectName ? cfg.objectName : '(unnamed object)';
    const filterState = describeUnboundedFilter(cfg.filter);
    findings.push({
      where: `${at} · node '${String(node.id)}' (${nodeType})`,
      message:
        `declares \`multi: true\` with ${filterState} — this is a WHOLE-OBJECT write, by declaration: every ` +
        `row of '${objectName}' is ${consequence.verb} on every run. The executor forwards the filter as \`where\` ` +
        `(an absent key becomes \`{}\`) plus the bulk intent, ${consequence.dispatchNote}, and it lands on ` +
        `\`${consequence.engineCall}\` bounded by nothing — a filter that reduces to TRUE constrains no row. ` +
        `Nothing refuses it at run time, so the only feedback is the step's \`acted\` row count — reported ` +
        `AFTER the rows are gone.`,
      hint:
        `Write the constraint you mean into \`filter\` (e.g. \`{ status: 'closed' }\` — see ` +
        `examples/app-showcase \`showcase_inquiry_purge\`, bulk intent bounded by a predicate). If emptying ` +
        `'${objectName}' really is the intent, keep it: this is a warning, not a gate, and the run-time path ` +
        `stays open. Distinct from the #3810 erased-condition guard, which REFUSES this node at run time when ` +
        `a condition you WROTE interpolated to nothing — that guard is keyed on "a written condition is gone" ` +
        `and deliberately not on "the filter is empty", which is the fact this rule judges at authoring ` +
        `time. (#5482, #5393)`,
      // Warning, not `error`: see the severity policy at the top of this file.
      // The shape has a legitimate reading the engine grants on purpose, so it is
      // not provably wrong — unlike the gating members of this family.
      rule: FLOW_MULTI_WRITE_UNFILTERED,
    });
  }
}

function scanApprovalReviseLoops(
  at: string,
  nodes: AnyRec[],
  edges: AnyRec[],
  findings: FlowLintFinding[],
): void {
  const approvals = nodes.filter((n) => n.type === APPROVAL_NODE_TYPE);
  if (approvals.length === 0) return;
  const nodeIds = new Set(nodes.map((n) => (typeof n.id === 'string' ? n.id : '')).filter(Boolean));
  const nodeTypeById = new Map<string, string>(
    nodes
      .filter((n) => typeof n.id === 'string')
      .map((n) => [n.id as string, typeof n.type === 'string' ? n.type : '']),
  );
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
    const where = `${at} \u00b7 approval '${aid}'`;

    // #3823 / amended ADR-0044 \u2014 the revise window must be the service-owned
    // pause. `error`, under this module's stated bar ("the runtime refuses"):
    // `ApprovalService.sendBack` refuses any other target before it mutates
    // anything, so on this metadata send-back cannot run at all. Before that
    // refusal existed the shape was worse than dead \u2014 the pause landed on a
    // node anyone holding the run id could resume, walking the resubmit
    // back-edge with no submitter check and no audit row.
    for (const target of reviseTargets) {
      const targetType = nodeTypeById.get(target) ?? '';
      if (targetType === APPROVAL_REVISE_NODE_TYPE) continue;
      findings.push({
        where,
        severity: 'error',
        message:
          `has a 'revise' out-edge into node '${target}' of type '${targetType || '(untyped)'}' \u2014 the revise ` +
          `window must be an '${APPROVAL_REVISE_NODE_TYPE}' node. Send-back parks the run there while the ` +
          `record is unlocked, and only the approvals service may continue it (submitter-only, audited, and ` +
          `refusing a colliding pending request); \`sendBack\` refuses any other target, so this flow's ` +
          `revise branch cannot run.`,
        hint:
          `Set node '${target}' to \`type: '${APPROVAL_REVISE_NODE_TYPE}'\` (drop any \`waitEventConfig\` \u2014 the ` +
          `window is ended by POST /api/v1/approvals/requests/:id/resubmit, not by a signal). ADR-0044 D3 ` +
          `originally said 'wait' here; its 2026-07-28 amendment reversed that, because a 'wait' is ` +
          `resumable by anyone with the run id (#3823, #3801).`,
        rule: FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED,
      });
    }

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
          `Close the loop: the 'revise' edge should reach an '${APPROVAL_REVISE_NODE_TYPE}' node whose resubmit ` +
          `edge returns to '${aid}' marked \`type: 'back'\` (ADR-0044). See examples/app-showcase ` +
          `showcase_budget_approval.`,
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
 * The minimal `catch` region, measured end to end on the real `AutomationEngine`
 * (#13681) and quoted verbatim by both containment rules and by
 * `content/docs/automation/flows.mdx`.
 *
 * `catch` cannot be empty: `FlowRegionSchema.nodes` is `.min(1)`
 * (`control-flow.zod.ts:142`), so `catch: {}` and `catch: { nodes: [] }` are
 * both refused by the parse. The shortest handler that works is one bare
 * `assignment` node with no `config` at all — its descriptor declares no
 * `required` keys and its executor with no assignments sets nothing and returns
 * success. `edges` may be omitted (it defaults to `[]`), and `errorVariable` may
 * be omitted (it defaults to `$error`).
 */
const MINIMAL_CATCH_SPELLING =
  "`catch: { nodes: [ { id: 'handled', type: 'assignment', label: 'Handled' } ] }` — one bare " +
  '`assignment` node with no `config` is the shortest handler that works; `edges` and ' +
  '`errorVariable` may both be omitted';

/** `catch` cannot be empty — the two spellings the schema refuses. */
const EMPTY_CATCH_REFUSALS =
  'A `catch` region cannot be empty: its `nodes` is `.min(1)`, so `catch: {}` and ' +
  '`catch: { nodes: [] }` are both refused by the parse.';

/**
 * Is this value a region dictionary — `{ nodes: [...] }` — as authored?
 *
 * Read raw rather than parsed, like the rest of this module: `FlowNodeSchema.config`
 * is an open `z.record`, so a region arrives as an ordinary record even in a
 * parsed stack, and this file promises never to throw on a malformed one.
 */
function regionNodesOf(value: unknown): AnyRec[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const nodes = (value as AnyRec).nodes;
  return Array.isArray(nodes) ? (nodes as AnyRec[]) : undefined;
}

/**
 * #14394 rule A — a `loop` body that runs a fallible node with no `try_catch`
 * between the loop and that node.
 *
 * The judgement is **ancestry, not depth**: a `try_catch` two levels down inside
 * a `parallel` branch still contains what it wraps, and a fallible node three
 * levels down with no `try_catch` on the path to the loop still kills the sweep.
 * So the descent from a loop body reports a fallible node and otherwise walks on
 * through any container, with two stops:
 *
 *  - **`try_catch` — stop.** Everything below it is contained (see
 *    {@link TRY_CATCH_NODE_TYPE} for why a catch-less one counts here and is
 *    reported by rule B instead). One finding per fallible node, never two.
 *  - **a nested `loop` — stop.** That loop is its own subject: it appears as a
 *    node of its own graph in {@link collectFlowGraphs}, this scan runs per
 *    graph, and it is judged there. Without the stop every fallible node in a
 *    nested body would be reported once per enclosing loop, and the finding that
 *    matters — the innermost loop, where the wrap belongs — would be the one
 *    buried in duplicates.
 *
 * Loops with **no `body`** are skipped entirely: `LoopConfigSchema.body` is
 * optional (`control-flow.zod.ts:216`) and a body-less `loop` is the legacy
 * flat-graph form, which has no region to judge.
 */
function scanUncontainedLoopBodies(
  at: string,
  nodes: AnyRec[],
  findings: FlowLintFinding[],
): void {
  for (const node of nodes) {
    if (node.type !== LOOP_NODE_TYPE) continue;
    const bodyNodes = regionNodesOf(((node.config ?? {}) as AnyRec).body);
    if (!bodyNodes) continue;
    const loopId = typeof node.id === 'string' && node.id ? node.id : '(unnamed loop)';

    const visit = (region: AnyRec[], trail: string, depth: number): void => {
      if (depth > MAX_REGION_DEPTH) return;
      for (const child of region) {
        if (!child || typeof child !== 'object') continue;
        const type = typeof child.type === 'string' ? child.type : '';
        if (type === TRY_CATCH_NODE_TYPE || type === LOOP_NODE_TYPE) continue;

        const childId = typeof child.id === 'string' && child.id ? child.id : '(unnamed node)';
        if (FALLIBLE_NODE_TYPES.has(type)) {
          findings.push({
            where: `${at} · ${trail} · node '${childId}' (${type})`,
            message:
              `runs inside loop '${loopId}' with no \`try_catch\` between them — a '${type}' node can return ` +
              `\`success: false\` or throw, and the loop body's failure propagates straight out of the ` +
              `container (\`loop-node.ts\` iterates with a bare \`await\` and has no \`try\`/\`catch\` at all). ` +
              `The first failing item therefore ends the whole run: every later item is never processed, and ` +
              `the work already done is not even reported (measured on the real engine — a 5-item sweep ` +
              `failing at item 3 touched 3 items and reported \`acted: 0\`).`,
            hint:
              `Contain the failure per iteration: put a \`try_catch\` INSIDE the body and move this node into ` +
              `its \`try\` region — \`loop { body: { nodes: [ { type: 'try_catch', config: { try, catch } } ] } }\`. ` +
              `${EMPTY_CATCH_REFUSALS} The minimal handler is ${MINIMAL_CATCH_SPELLING}. Measured: with it, all ` +
              `5 items are processed and the run completes. If this loop is MEANT to stop at the first failure, ` +
              `that is a legitimate reading and this stays a warning. ` +
              // The tracker ids stay OUT of the runtime string (`check:doc-authoring`):
              // an author reading this hint cannot resolve `#NNNN`. The measurement
              // and the ruling behind this rule are #13681 / #14394; the docblock on
              // {@link FLOW_LOOP_BODY_UNCONTAINED} carries them for the reader who can.
              `See content/docs/automation/flows.mdx §"Per-iteration containment".`,
            // Warning, not `error`: see the severity policy at the top of this
            // file. Fail-fast on the first bad row is a real intent this rule
            // cannot distinguish from an oversight.
            rule: FLOW_LOOP_BODY_UNCONTAINED,
          });
          continue;
        }

        // Any other container (`parallel` today; whatever the protocol adds
        // next) is walked through: its region slots come from the one shared
        // table, so a new construct is descended without editing this rule.
        const slots = REGION_SLOTS.get(type);
        if (!slots) continue;
        const cfg = (child.config ?? {}) as AnyRec;
        for (const slot of slots) {
          const value = cfg[slot];
          if (Array.isArray(value)) {
            // A `many` slot (`parallel.config.branches`) — an array of regions.
            value.forEach((branch, index) => {
              const branchNodes = regionNodesOf(branch);
              if (branchNodes) visit(branchNodes, `${trail} → ${type} '${childId}' branch ${index}`, depth + 1);
            });
            continue;
          }
          const slotNodes = regionNodesOf(value);
          if (slotNodes) visit(slotNodes, `${trail} → ${type} '${childId}' ${slot}`, depth + 1);
        }
      }
    };

    visit(bodyNodes, `loop '${loopId}' body`, 0);
  }
}

/**
 * #14394 rule B — a `try_catch` with no `catch` region, anywhere in the flow.
 *
 * Measured (#13681): the container fails through, and the run is byte-identical
 * to the one with no `try_catch` at all. `retry`, when present, only delays it.
 *
 * A `catch` that is PRESENT but malformed is deliberately not this rule's
 * business: `catch: {}` and `catch: { nodes: [] }` are refused by the parse
 * itself, loudly, with the schema's own message. Lint speaks for the shape the
 * schema accepts and the runtime then makes useless.
 */
function scanTryCatchWithoutCatch(
  at: string,
  nodes: AnyRec[],
  findings: FlowLintFinding[],
): void {
  for (const node of nodes) {
    if (node.type !== TRY_CATCH_NODE_TYPE) continue;
    const cfg = (node.config ?? {}) as AnyRec;
    if (cfg.catch !== undefined) continue;
    const nodeId = typeof node.id === 'string' && node.id ? node.id : '(unnamed node)';
    const hasRetry = (cfg as AnyRec).retry !== undefined;
    findings.push({
      where: `${at} · node '${nodeId}' (${TRY_CATCH_NODE_TYPE})`,
      message:
        `declares no \`catch\` region, so it contains NOTHING — when the \`try\` region fails the container ` +
        `fails with it and the failure propagates exactly as if the nodes had never been wrapped (measured: ` +
        `the no-\`catch\` run and the unwrapped control produce identical output).` +
        (hasRetry
          ? ' Its `retry` policy re-runs the `try` region first, which delays that outcome rather than changing it.'
          : '') +
        ` Inside a \`loop\` body this is the silent one: the author has recognised the hazard, wrapped the ` +
        `node, and still loses every item after the first failure.`,
      hint:
        `Add the handler: ${MINIMAL_CATCH_SPELLING}. ${EMPTY_CATCH_REFUSALS} If failing loudly really is the ` +
        `intent, a \`try_catch\` with only \`try\` (and optionally \`retry\`) is a legitimate retry-then-fail ` +
        `shape — this is a warning, not a gate. ` +
        // Tracker ids stay out of the runtime string — see the sibling rule above.
        `See content/docs/automation/flows.mdx §"Per-iteration containment".`,
      // Warning, not `error`: retry-then-fail is a real reading of this shape.
      rule: FLOW_TRY_CATCH_WITHOUT_CATCH,
    });
  }
}

/**
 * Lint every flow for known authoring anti-patterns — its own graph AND every
 * nested ADR-0031 region (#5383). Returns a (possibly empty) list of findings;
 * never throws. A finding marked `severity: 'error'` fails the build, and since
 * #5383 it can be raised by a node inside a `loop` body too.
 */
export function lintFlowPatterns(stack: AnyRec): FlowLintFinding[] {
  const findings: FlowLintFinding[] = [];
  for (const flow of recordsOf(stack.flows)) {
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
    //      #5633 — the data-node EVIDENCE is searched across every region, while
    //      the verdict stays flow-level. The two are at different altitudes on
    //      purpose: `runAs` is a flow property and the trigger is the start
    //      node's, so "is this flow unscoped" has exactly one answer per flow —
    //      but "does it touch data at all" is a question about the whole flow,
    //      and a `loop` body is as much part of it as the top level. The runtime
    //      agrees: `resolveRunAsIdentity` refuses a nested write for the same
    //      reason it refuses a top-level one; nesting depth is not a property it
    //      consults. Left top-level-only by #5383/#5635 because widening a
    //      build-GATING rule is its own change with its own blast radius — this
    //      is that change. The shape it was missing is the DEFAULT one for a
    //      scheduled data flow: query a set, loop it, write per item.
    //      #5693 — the message states the EFFECTIVE identity in one wording that
    //      is true of both authoring inputs, and does not branch on whether the
    //      author wrote `runAs` (see {@link RUNAS_EFFECTIVE_IDENTITY}).
    const runAs = typeof flow.runAs === 'string' ? flow.runAs : 'user';
    const userLessKind = userLessTriggerKind(flow, startCfg);
    if (userLessKind && runAs !== 'system') {
      const dataNode = findDataNodeAnywhere(nodes, edges);
      if (dataNode) {
        // The region is named in the MESSAGE, not in `where`: `where` says which
        // declaration is wrong (`flow 'x' · runAs`, unchanged), the message says
        // where to look for the node that proves it. A top-level hit adds nothing
        // here, so its wording carries no region clause (pinned in the tests).
        const at = dataNode.scope ? `, in ${dataNode.scope},` : '';
        findings.push({
          where: `flow '${flowName}' · runAs`,
          message:
            `${userLessKind}-triggered flow runs under ${RUNAS_EFFECTIVE_IDENTITY}, but a ${userLessKind} run ` +
            `has no trigger user — so its data node '${dataNode.node.id}' (${dataNode.node.type})${at} has no identity to scope to and ` +
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

    // (b)–(e) #5383 — every graph in the flow, not just the top-level one: its
    //     own `nodes`/`edges` plus each nested ADR-0031 region, each scanned
    //     against ITS OWN edge list. `scope` is empty for the flow's own graph,
    //     so `at` is byte-identical to the old prefix there and only a nested
    //     finding gains the region breadcrumb. See the module header for why the
    //     per-region pairing and the region-strip below are load-bearing.
    for (const graph of collectFlowGraphs({
      // A cast, not a parse. `FlowNodeSchema.config` is an open `z.record`, so a
      // region's contents arrive as raw authored records even in a parsed stack —
      // a nested edge `condition` may still be a bare string where a top-level
      // one is an Expression envelope. Every rule below reads both
      // (`conditionSource`), and the walk itself only touches `type` / `config`.
      // The already-guarded arrays are passed rather than `flow` itself so a
      // non-array `nodes` still cannot throw: this function promises it never does.
      nodes: nodes as unknown as FlowNodeParsed[],
      edges: edges as unknown as FlowEdgeParsed[],
    })) {
      const at = graph.scope ? `flow '${flowName}' · ${graph.scope}` : `flow '${flowName}'`;
      const graphNodes = graph.nodes as unknown as AnyRec[];
      const graphEdges = graph.edges as unknown as AnyRec[];

      // (b) #1315 — wrong interpolation syntax in any node's template values. Flow
      //     node values use SINGLE braces; double-brace `{{ }}` and bare `$ref.x`
      //     are carried over from the formula template dialect / other platforms.
      for (const node of graphNodes) {
        const nodeWhere = `${at} · node '${node.id}' (${node.type})`;

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

        // Region-STRIPPED: this scan is recursive and a container's config
        // physically contains every descendant's, which the walk above already
        // visits in its own right. Without the strip a `{{ }}` in a loop body
        // would be reported twice — once here against the `loop`, once against the
        // node that carries it. With it, the count stays 1 and the finding lands
        // on the right node (before #5383 it landed only on the container).
        const strings: string[] = [];
        collectTemplateStrings(stripRegions(node.config), undefined, strings);
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
      scanApprovalReviseLoops(at, graphNodes, graphEdges, findings);

      // (d) #3863 — an edge labelled like an error path but typed 'default' is an
      //     unconditional out-edge: the handler runs on every SUCCESS, in parallel
      //     with the real path, and never on a failure.
      scanErrorLabelledEdges(at, graphNodes, graphEdges, findings);

      // (e) #4414 — a decision that declares a branch it cannot route: an
      //     unclaimable branch label, an unconditional sibling that runs anyway,
      //     or a self-contradictory / duplicated `isDefault` marker.
      scanBranchRouting(at, graphNodes, graphEdges, findings);

      // (f) #5482 — a `multi: true` write with nothing bounding it: the declared
      //     whole-object delete/update. Scanned per graph like the rest, which is
      //     what puts the loop-body sweep — the standard shape for a scheduled
      //     purge, and this rule's main habitat — in range (#5383/#5635).
      scanUnboundedBulkWrites(at, graphNodes, findings);

      // (g) #13681/#14394 — a `loop` body running a fallible node with no
      //     `try_catch` between the loop and it. Per graph like the rest, and
      //     that is what keeps the count right: every `loop` node belongs to
      //     exactly one graph, so its body is descended exactly once, and a
      //     nested loop is judged in its own graph rather than through its
      //     parent (see {@link scanUncontainedLoopBodies}).
      scanUncontainedLoopBodies(at, graphNodes, findings);

      // (h) #13681/#14394 — the near-miss: a `try_catch` with no `catch`. Scanned
      //     everywhere, not only inside a loop: the container fails through
      //     wherever it is written. Inside a loop body it is the shape (g)
      //     deliberately treats as contained, so exactly one of the two rules
      //     ever speaks about a given node.
      scanTryCatchWithoutCatch(at, graphNodes, findings);
    }
  }
  return findings;
}
