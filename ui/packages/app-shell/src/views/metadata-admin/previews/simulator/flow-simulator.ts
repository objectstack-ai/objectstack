// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowSimulator — a deterministic, backend-free interpreter that walks a flow
 * draft for designer-time debugging. See `flow-sim-types.ts` for the contract.
 *
 * Supported faithfully: start, decision (its `config.conditions` branch and
 * CEL-guarded out-edges), the CRUD / get / http / connector /
 * script(notification|code) side-effects (MOCKED), and end. Every node leaves
 * by the same successor selection, the runtime's `traverseNext` (see
 * {@link FlowSimulator.route}). `wait`, `screen`, and `approval` PAUSE for manual continuation (an approval
 * resumes down the chosen decision's branch — approve / reject / revise). `loop` resolves its
 * collection the way its executor does and exposes the iterator, but is a
 * labelled single pass (the edge model has no separate body/exit edge).
 *
 * Values are what the engine makes of them since objectstack#19939 S7 deleted
 * its single-brace resolver (objectui#12329): a CEL value envelope is evaluated,
 * a literal is used as written, and a `{…}` token the spec refuses at a value
 * slot fails the node with the spec's own refusal. Nothing here reads that
 * dialect. `parallel_gateway` fans out WITHOUT
 * join synchronization; the ADR-0031 structured containers (`parallel`,
 * `try_catch` — nested body regions), `join_gateway`, `subflow` and
 * `boundary_event` are marked unsupported rather than faked. Fault edges are
 * not modelled: a node that fails stops the run, and a `fault` edge is never
 * walked as an ordinary successor. A hard step ceiling guards cycles.
 */

import {
  flowNodeConfigRefusals,
  flowNodeValueTemplateRefusals,
  isExpressionEnvelopeShaped,
} from '@objectstack/spec/automation';
import type {
  MockResults,
  SimEdge,
  SimEdgeEval,
  SimNode,
  SimState,
  SimStep,
  SimStepStatus,
} from './flow-sim-types.js';
import { evalBranchPredicate, evalGuard, evalValueEnvelope, validateFlowDraft } from './flow-sim-validate.js';
import { conditionText } from '../flow-canvas-layout.js';
import { flowNodeDisplayName } from '../flow-canvas-parts.js';
import { unevaluableVisibleWhen } from '../screen-spec.js';
import { isValueEnvelopeSlot } from '../../inspectors/flow-value-envelope.js';
import { t as tr, tFormat } from '../../i18n.js';

const MAX_STEPS = 500;

/**
 * The branch a decision reports when none of its `config.conditions` matched:
 * the runtime's `DEFAULT_BRANCH_LABEL` (`@objectstack/service-automation`),
 * which the spec does not export. An out-edge labelled so, or failing that the
 * `isDefault` edge, claims it.
 */
const DEFAULT_BRANCH_LABEL = 'default';

/** A branch label that narrows a node's out-edges (see {@link FlowSimulator.route}). */
interface BranchSelection {
  label: string;
  /** Whether an out-edge's `label` claims this branch. */
  claims: (edgeLabel: string | undefined) => boolean;
}

/** What successor selection did with one node's out-edges. */
interface Routing {
  /** Every out-edge it considered, in bucket order: guarded, default, unguarded. */
  evals: SimEdgeEval[];
  /** A guard was refused or failed: no out-edge is taken and the run stops. */
  error?: string;
  /** At least one considered out-edge carries a guard or `isDefault`. */
  gated: boolean;
  note?: string;
}

/** Join the non-empty notes of one step. */
const joinNotes = (...notes: Array<string | undefined>): string | undefined =>
  notes.filter((n): n is string => !!n).join(' ') || undefined;

const PASS_THROUGH = new Set(['start']);
const MOCKED_SIDE_EFFECT = new Set([
  'create_record',
  'update_record',
  'delete_record',
  'get_record',
  'http',
  'connector_action',
]);
// `parallel` / `try_catch` carry nested body regions (ADR-0031) the flat
// stepper can't walk — pass through honestly instead of faking their semantics.
const UNSUPPORTED = new Set(['join_gateway', 'subflow', 'boundary_event', 'parallel', 'try_catch']);

const edgeId = (e: SimEdge, i: number): string => e.id || `${e.source}->${e.target}#${i}`;
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * The runtime's `copyLiteral` (`value-slot-map.ts` in
 * `@objectstack/service-automation`): a literal handed on as written, with
 * arrays and plain objects copied at every depth so a later write never
 * reaches the node's config. Every other value is returned as it is.
 */
function copyLiteral(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(copyLiteral);
  if (value !== null && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return value;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = copyLiteral(v);
    return out;
  }
  return value;
}

/**
 * The first refusal the spec's two config judges make of `config` on a node of
 * `type` — `flowNodeValueTemplateRefusals` (a `{…}` token at a value slot) and
 * `flowNodeConfigRefusals` (the node's contract) — as one line naming the
 * path, or `undefined`. They are the judges `registerFlow` and `objectstack
 * validate` call, and an executor's run-time twin refuses the same set.
 */
function configRefusal(type: string, config: Record<string, unknown>): string | undefined {
  const token = flowNodeValueTemplateRefusals(type, config)[0];
  if (token) return `${token.label} at config.${token.path}: ${token.message}`;
  const contract = flowNodeConfigRefusals(type, config)[0];
  return contract ? `config.${contract.path}: ${contract.message}` : undefined;
}

export class FlowSimulator {
  private nodes = new Map<string, SimNode>();
  private edges: SimEdge[] = [];
  private mocks: MockResults = {};
  private seq = 0;

  state: SimState = {
    status: 'idle',
    variables: {},
    steps: [],
    frontier: [],
    activeNodeId: null,
    visitedNodeIds: [],
    traversedEdgeIds: [],
  };

  /**
   * The designer locale: `validateFlowDraft`'s messages and every note and
   * error sentence a step records are written in it (objectui#10835), through
   * {@link say}; the evaluators in `flow-sim-validate` take it for the frame
   * they put around a CEL failure (objectui#10848). Absent, they read the en
   * rows — the English they always were.
   */
  private readonly locale?: string;

  constructor(nodes: SimNode[], edges: SimEdge[], locale?: string) {
    for (const n of nodes) this.nodes.set(n.id, n);
    this.edges = edges;
    this.locale = locale;
  }

  /** The `engine.flowSim.note.*` row `key` in the designer locale, formatted with `vars`. */
  private say(key: string, vars?: Record<string, string | number>): string {
    return vars ? tFormat(key, this.locale, vars) : tr(key, this.locale);
  }

  /** Validate + seed variables and queue the entry node. Returns the validation. */
  reset(seedVariables: Record<string, unknown> = {}, mocks: MockResults = {}) {
    const validation = validateFlowDraft([...this.nodes.values()], this.edges, this.locale);
    this.mocks = mocks;
    this.seq = 0;
    this.state = {
      status: validation.errors.length ? 'error' : 'idle',
      variables: { ...seedVariables },
      steps: [],
      frontier: validation.startNodeId ? [validation.startNodeId] : [],
      activeNodeId: null,
      visitedNodeIds: [],
      traversedEdgeIds: [],
      error: validation.errors.length ? validation.errors[0].message : undefined,
    };
    return validation;
  }

  get done(): boolean {
    return this.state.status === 'done' || this.state.status === 'error';
  }

  /** Execute one queued node. Returns the recorded step, or null when idle. */
  step(): SimStep | null {
    const s = this.state;
    if (s.status === 'error' || s.status === 'done' || s.status === 'paused') return null;
    if (this.seq >= MAX_STEPS) {
      s.status = 'error';
      s.error = this.say('engine.flowSim.note.stepLimit', { max: MAX_STEPS });
      return null;
    }
    const nodeId = s.frontier.shift();
    if (!nodeId) {
      s.status = 'done';
      s.activeNodeId = null;
      return null;
    }
    const node = this.nodes.get(nodeId);
    if (!node) {
      return this.record(nodeId, 'unknown', nodeId, 'error', { error: this.say('engine.flowSim.note.nodeNotFound', { id: nodeId }) });
    }
    s.status = 'running';
    s.activeNodeId = nodeId;
    if (!s.visitedNodeIds.includes(nodeId)) s.visitedNodeIds.push(nodeId);

    const step = this.execute(node);
    // Settle the run status. A pause halts the queue until resume(); a decision
    // dead-end / missing node already set 'error' inside execute(). Only a still
    // -'running' branch that drained the frontier completes as 'done'.
    if (s.status === 'running' && s.frontier.length === 0) {
      s.status = 'done';
      s.activeNodeId = null;
    }
    return step;
  }

  /** Run to completion (or until a pause / error). */
  runToEnd(): SimState {
    let guard = 0;
    while (this.state.status !== 'done' && this.state.status !== 'error' && this.state.status !== 'paused') {
      if (++guard > MAX_STEPS + 5) break;
      this.step();
    }
    return this.state;
  }

  /**
   * Continue a flow paused on a `wait`, `screen`, or `approval` node.
   *  - `screenOutputs` — inputs captured from a paused screen.
   *  - `decision` — the branch an approval resumes down (ADR-0019/0044:
   *    `approve` / `reject` / `revise`). The run takes ONLY the out-edge whose
   *    label matches, mirroring how the engine resumes a suspended approval by
   *    branch label — instead of fanning out to every out-edge.
   */
  resume(opts: { screenOutputs?: Record<string, unknown>; decision?: string } = {}) {
    const s = this.state;
    if (s.status !== 'paused' || !s.activeNodeId) return;
    const node = this.nodes.get(s.activeNodeId);
    if (opts.screenOutputs && node?.type === 'screen') {
      Object.assign(s.variables, opts.screenOutputs);
    }
    s.pausedReason = undefined;
    s.status = 'running';
    if (node?.type === 'approval') this.resumeApproval(node, opts.decision);
    else if (node) {
      const routing = this.route(node);
      // A step only when leaving says something: a guard, a default, an error.
      if (routing.gated || routing.error) {
        this.record(node.id, node.type, node.label, routing.error ? 'error' : 'ok', {
          edges: routing.evals,
          error: routing.error,
          note: joinNotes(this.say('engine.flowSim.note.resumed'), routing.note),
        });
      }
    }
    if (s.status === 'running' && s.frontier.length === 0) {
      s.status = 'done';
      s.activeNodeId = null;
    }
  }

  /**
   * Resume a suspended approval down the chosen decision's branch: the
   * out-edges whose `label` equals `decision` (case-insensitive — `approve` /
   * `reject` / `revise`), as the runtime's resume narrows `traverseNext` to
   * the decision's branch label. With no match it considers every out-edge —
   * the engine's unmatched-`branchLabel` fallback — and says so, so the author
   * notices the unrouted decision. Either way the chosen edges go through the
   * same successor selection as every node ({@link route}).
   */
  private resumeApproval(node: SimNode, decision?: string) {
    const want = (decision ?? '').trim();
    const routing = this.route(
      node,
      want
        ? { label: want, claims: (l) => (l ?? '').trim().toLowerCase() === want.toLowerCase() }
        : undefined,
    );
    const taken = routing.evals.filter((x) => x.selected).map((x) => x.target);
    this.record(node.id, 'approval', node.label, routing.error ? 'error' : 'ok', {
      edges: routing.gated || routing.error ? routing.evals : undefined,
      error: routing.error,
      note: joinNotes(
        want
          ? this.say('engine.flowSim.note.decisionTaken', {
              decision: decision ?? '',
              taken: taken.length ? taken.join(', ') : this.say('engine.flowSim.note.decisionNoneTaken'),
            })
          : this.say('engine.flowSim.note.noDecision'),
        routing.note,
      ),
    });
  }

  // ---- node execution -----------------------------------------------------

  private execute(node: SimNode): SimStep {
    const type = node.type;

    if (type === 'end') {
      // Terminate this branch only; other queued branches still run.
      return this.record(node.id, type, node.label, 'ok', { note: this.say('engine.flowSim.note.flowEnd') });
    }

    if (type === 'decision') return this.executeDecision(node);

    if (type === 'assignment') return this.executeAssignment(node);

    if (UNSUPPORTED.has(type)) {
      return this.proceed(node, 'skipped', {
        note: this.say('engine.flowSim.note.unsupported', { type }),
      });
    }

    if (type === 'parallel_gateway') {
      return this.proceed(node, 'ok', {
        note: this.say('engine.flowSim.note.parallelSplit'),
      });
    }

    if (type === 'approval') {
      // ADR-0019: an approval node opens a request and SUSPENDS the run until a
      // decision is recorded. Model that as a pause; the author resumes down the
      // chosen approve / reject / revise out-edge (see resumeApproval) rather
      // than fanning out to every out-edge at once.
      this.state.status = 'paused';
      this.state.pausedReason = 'approval';
      return this.record(node.id, type, node.label, 'paused', { note: this.say('engine.flowSim.note.approvalReached') });
    }

    if (type === 'wait') {
      this.state.status = 'paused';
      this.state.pausedReason = 'wait';
      return this.record(node.id, type, node.label, 'paused', { note: this.say('engine.flowSim.note.waitReached') });
    }

    if (type === 'screen') {
      // Mirror the engine's `shouldPause`: a screen suspends only when it
      // collects input (`fields`) or explicitly opts in (`waitForInput`).
      // A field-less / `waitForInput:false` screen is a server pass-through.
      const fields = Array.isArray(node.config?.fields) ? (node.config!.fields as unknown[]) : [];
      const waitForInput = node.config?.waitForInput;
      const shouldPause = waitForInput === true || (fields.length > 0 && waitForInput !== false);
      if (shouldPause) {
        this.state.status = 'paused';
        this.state.pausedReason = 'screen';
        // The screen renderer decides each field's `visibleWhen` live, over the
        // screen's declared fields and the values being collected (`ScreenView`,
        // objectui#10743); the Debug run does not decide it here. What it judges
        // is the SCOPE: a predicate that names something the renderer cannot
        // bind — an identifier that is not a field on this screen, or a shape
        // `registerFlow` refuses — is an error on the step, per field. Whether
        // the renderer then shows or hides that field is its own fallback
        // (objectui#8069), not a reading the Debug run makes.
        // The reason names the root in the designer locale where objectui owns
        // the sentence (`engine.flowRef.notAScreenField*`); a parse or shape
        // refusal is the producer's own text and passes through.
        const unevaluable = unevaluableVisibleWhen(node, this.locale);
        return this.record(node.id, type, node.label, 'paused', {
          note: this.say('engine.flowSim.note.screenReached'),
          error: unevaluable.length
            ? this.say('engine.flowSim.note.screenUnevaluable', {
                fields: unevaluable
                  .map((u) =>
                    this.say('engine.flowSim.note.screenUnevaluableField', {
                      name: u.name,
                      reason: u.error.split('\n')[0],
                    }),
                  )
                  .join('; '),
              })
            : undefined,
        });
      }
      return this.proceed(node, 'ok', { note: this.say('engine.flowSim.note.screenNoInput') });
    }

    if (type === 'loop') return this.executeLoop(node);

    if (MOCKED_SIDE_EFFECT.has(type) || type === 'script') {
      const wrote = this.applyMock(node);
      return this.proceed(node, 'mocked', {
        wrote,
        note: this.mockNote(node),
      });
    }

    // start / anything else: pass straight through.
    return this.proceed(node, 'ok', {
      note: PASS_THROUGH.has(type) ? undefined : this.say('engine.flowSim.note.passThrough', { type }),
    });
  }

  /**
   * Record `node`'s step and leave it by {@link route}. A guard that is refused
   * or fails makes the step an error: the runtime throws in `traverseNext`,
   * after the node itself ran, and the run fails there.
   */
  private proceed(node: SimNode, status: SimStepStatus, extra: Partial<SimStep> = {}): SimStep {
    const routing = this.route(node);
    return this.record(node.id, node.type, node.label, routing.error ? 'error' : status, {
      ...extra,
      edges: routing.gated || routing.error ? routing.evals : undefined,
      error: routing.error,
      note: joinNotes(extra.note, routing.note),
    });
  }

  /**
   * A decision routes the way the runtime's `decision` executor and
   * `traverseNext` route it (objectui#10692):
   *
   * - It declares `config.conditions` → the first entry whose `expression` is
   *   true names the branch (its `label`); none true → the branch is
   *   {@link DEFAULT_BRANCH_LABEL}. Each `expression` is CEL, through
   *   `evalBranchPredicate`. The branch narrows the out-edges in {@link route}.
   * - It declares none → there is no branch, and its out-edges route alone,
   *   exactly as any other node's do.
   *
   * A refused or failing `expression` stops the run on the decision: the
   * runtime refuses the flow at `registerFlow`, or throws.
   */
  private executeDecision(node: SimNode): SimStep {
    const branch = this.decisionBranch(node);
    if ('error' in branch) {
      return this.record(node.id, 'decision', node.label, 'error', { error: branch.error });
    }
    const routing = this.route(node, branch.selection);
    const leaves = this.edges.some((e) => e.source === node.id && e.type !== 'fault');
    return this.record(node.id, 'decision', node.label, routing.error ? 'error' : 'ok', {
      edges: routing.evals,
      error: routing.error,
      note: joinNotes(
        branch.note,
        routing.note,
        leaves ? undefined : this.say('engine.flowSim.note.decisionNoOutEdge'),
      ),
    });
  }

  /** The runtime `decision` executor's branch: see {@link executeDecision}. */
  private decisionBranch(node: SimNode): { selection?: BranchSelection; note?: string } | { error: string } {
    const conditions = node.config?.conditions;
    if (!Array.isArray(conditions) || conditions.length === 0) return {};
    for (const [k, entry] of conditions.entries()) {
      const cond = (entry && typeof entry === 'object' ? entry : {}) as { label?: unknown; expression?: unknown };
      const g = evalBranchPredicate(cond.expression, this.state.variables, this.locale);
      if (g.kind === 'fault') return { error: `config.conditions[${k}].expression: ${g.error}` };
      if (!g.result) continue;
      // An empty label is no branch at all (the runtime's `if (branchLabel)`).
      const label = typeof cond.label === 'string' && cond.label ? cond.label : undefined;
      return label
        ? { selection: { label, claims: (l) => l === label }, note: this.say('engine.flowSim.note.branchMatched', { label }) }
        : {};
    }
    return {
      selection: { label: DEFAULT_BRANCH_LABEL, claims: (l) => l === DEFAULT_BRANCH_LABEL },
      note: this.say('engine.flowSim.note.noConditionMatched', { label: DEFAULT_BRANCH_LABEL }),
    };
  }

  /**
   * assignment node — set flow variables. Normalizes the three authoring
   * shapes the engine accepts (Studio's `{ assignments: { var: value } }`
   * map, the example `{ assignments: [{ variable, value }] }` array, and the
   * legacy flat `{ var: value }`), so the Debug run mirrors runtime instead of
   * silently no-oping.
   *
   * objectui#12329 — as the runtime's assignment executor does since
   * objectstack#19939 S7, a value that spells a `{…}` token of the retired
   * single-brace dialect, in any of the three shapes, fails the node before
   * any variable is set, with the spec's refusal (`flowNodeValueTemplateRefusals`,
   * the judge `registerFlow` refuses the flow with). Every other value is a
   * literal, written as it is (a copy, as the runtime's `copyLiteral` makes).
   *
   * A CEL value envelope `{ dialect: 'cel', source }` is evaluated, the way the
   * runtime's assignment executor evaluates it (objectui#10537). That applies
   * only in the map: the spec's expression ledger names `assignments.*` as the
   * `value` slot (`isValueEnvelopeSlot`), and an object naming a `dialect`
   * there is an envelope (`isExpressionEnvelopeShaped`, the executor's own
   * test). In both legacy shapes an envelope-shaped object stays the literal
   * object it always was, as it does at runtime.
   *
   * Pairs run in order against the live variables, so an envelope sees the
   * earlier writes of the same node. An envelope that fails (malformed, or a
   * CEL error) is not written: the step reports the error and the run stops
   * there, because the runtime throws on it and fails the node. The pairs
   * before it stay written, as at runtime.
   */
  private executeAssignment(node: SimNode): SimStep {
    const cfg = node.config ?? {};
    const refused = flowNodeValueTemplateRefusals('assignment', cfg)[0];
    if (refused) {
      return this.record(node.id, 'assignment', node.label, 'error', {
        error: `${refused.label} at config.${refused.path}: ${refused.message}`,
      });
    }
    const raw = cfg.assignments;
    // `slot` = the pair sits in the ledger's `value` slot, where an envelope is
    // an expression. False for both legacy shapes.
    const pairs: Array<{ key: string; value: unknown; slot: boolean }> = [];
    if (Array.isArray(raw)) {
      for (const item of raw) {
        if (item && typeof item === 'object') {
          const e = item as Record<string, unknown>;
          const name = e.variable ?? e.name ?? e.key;
          if (typeof name === 'string' && name) pairs.push({ key: name, value: e.value, slot: false });
        }
      }
    } else if (raw && typeof raw === 'object') {
      const slot = isValueEnvelopeSlot(node.type, ['config', 'assignments']);
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) pairs.push({ key: k, value: v, slot });
    } else {
      for (const [k, v] of Object.entries(cfg)) pairs.push({ key: k, value: v, slot: false });
    }
    const wrote: Record<string, unknown> = {};
    for (const { key, value, slot } of pairs) {
      let resolved: unknown;
      if (slot && isExpressionEnvelopeShaped(value)) {
        const evaluated = evalValueEnvelope(value, this.state.variables, this.locale);
        if (!evaluated.ok) {
          return this.record(node.id, 'assignment', node.label, 'error', {
            wrote: Object.keys(wrote).length ? wrote : undefined,
            error: `assignments.${key}: ${evaluated.error}`,
          });
        }
        resolved = evaluated.value;
      } else {
        resolved = copyLiteral(value);
      }
      this.state.variables[key] = resolved;
      wrote[key] = resolved;
    }
    return this.proceed(node, 'ok', {
      wrote: Object.keys(wrote).length ? wrote : undefined,
      note: Object.keys(wrote).length ? undefined : this.say('engine.flowSim.note.noAssignments'),
    });
  }

  /**
   * loop node — resolve its collection the way the runtime's `loop` executor
   * does, and bind the iterator to the first item (the body region is not
   * walked: a labelled single pass). objectui#12329 — two forms, as at runtime
   * since objectstack#19939 S7:
   *
   * - With a `body` (the ADR-0031 container): `collection` is a value slot. The
   *   spec's config judges refuse a `{…}` token and a bare variable name there,
   *   and the step fails with that refusal, as the executor's config parse
   *   fails the node. A CEL value envelope is evaluated (`evalValueEnvelope`);
   *   an inline array is iterated as written. Anything that is not a list fails
   *   the node, as the executor does.
   * - Without a `body` (the legacy flat-graph form, judged by no door): the
   *   executor reads `collection` as the name of a list variable, exactly as
   *   written. A `{name}` string is not that name, so it finds nothing and the
   *   loop is a pass that binds nothing.
   */
  private executeLoop(node: SimNode): SimStep {
    const cfg = node.config ?? {};
    const iterVar = str(cfg.iteratorVariable);
    const bindFirst = (items: unknown[]) => {
      if (iterVar && items.length) this.state.variables[iterVar] = items[0];
    };

    if (cfg.body == null) {
      const name = str(cfg.collection);
      const vars = this.state.variables;
      const resolved = name && Object.prototype.hasOwnProperty.call(vars, name) ? vars[name] : undefined;
      if (name && Array.isArray(resolved)) {
        bindFirst(resolved);
        return this.proceed(node, 'ok', {
          note: this.say('engine.flowSim.note.loopCollection', { ref: name, count: resolved.length }),
        });
      }
      return this.proceed(node, 'ok', {
        note:
          name && resolved !== undefined
            ? this.say('engine.flowSim.note.loopNotArray', { ref: name })
            : this.say('engine.flowSim.note.loopSinglePass'),
      });
    }

    const refused = configRefusal('loop', cfg);
    if (refused) return this.record(node.id, node.type, node.label, 'error', { error: refused });
    let items: unknown = cfg.collection;
    let ref: string;
    if (isExpressionEnvelopeShaped(cfg.collection)) {
      const evaluated = evalValueEnvelope(cfg.collection, this.state.variables, this.locale);
      if (!evaluated.ok) {
        return this.record(node.id, node.type, node.label, 'error', { error: `collection: ${evaluated.error}` });
      }
      items = evaluated.value;
      ref = String((cfg.collection as { source?: unknown }).source ?? '');
    } else {
      ref = JSON.stringify(cfg.collection) ?? '';
    }
    if (!Array.isArray(items)) {
      return this.record(node.id, node.type, node.label, 'error', {
        error: this.say('engine.flowSim.note.loopCollectionNotList', { ref }),
      });
    }
    bindFirst(items);
    return this.proceed(node, 'ok', {
      note: this.say('engine.flowSim.note.loopCollection', { ref, count: items.length }),
    });
  }

  // ---- helpers ------------------------------------------------------------

  /**
   * Apply a node's mock output to the simulation variables; returns what it
   * wrote. Only the singular `outputVariable` binds — the script node's legacy
   * `outputVariables` list is deliberately ignored, because the engine never
   * binds those names (framework#4278); simulating them taught authors a
   * binding that does not exist at run time.
   */
  private applyMock(node: SimNode): Record<string, unknown> | undefined {
    const cfg = node.config ?? {};
    const mock = this.mocks[node.id];
    const wrote: Record<string, unknown> = {};

    const single = str(cfg.outputVariable);
    if (single) {
      wrote[single] = mock !== undefined ? mock : {};
      this.state.variables[single] = wrote[single];
    }
    return Object.keys(wrote).length ? wrote : undefined;
  }

  private mockNote(node: SimNode): string {
    if (node.type === 'script') {
      // A script node calls a registered function and nothing else
      // (framework#4343) — the branches below describe a stored node that has
      // not been migrated yet, and say plainly that they never ran.
      const fn = str(node.config?.function);
      if (fn) return this.say('engine.flowSim.note.mockedCall', { fn });
      const action = str(node.config?.actionType);
      if (action && action !== 'code') {
        return this.say('engine.flowSim.note.retiredAction', { action });
      }
      return this.say('engine.flowSim.note.retiredScript');
    }
    return this.say('engine.flowSim.note.mocked', { type: node.type.replace(/_/g, ' ') });
  }

  /**
   * Successor selection — the runtime's `traverseNext` (`AutomationEngine` in
   * `@objectstack/service-automation`), one path for every node kind
   * (objectui#10692). It has no rule of its own for a node type: the one input
   * that differs is a branch label, which a decision reports from its
   * `config.conditions` and an approval from the decision it resumes with.
   *
   * 1. A `fault` edge is never a successor. (What a fault edge does when a node
   *    fails is not modelled: the simulator stops the run there.)
   * 2. A branch label narrows the out-edges to the ones whose `label` claims
   *    it; {@link DEFAULT_BRANCH_LABEL} is claimed by the `isDefault` edge too.
   *    No out-edge claims it → every out-edge is considered, as the runtime
   *    does (it logs a warning), and the step says so.
   * 3. An edge with a `condition` is GUARDED, `isDefault` or not (the
   *    condition wins, as at runtime; the linter flags the pair). Guards are
   *    evaluated in declared order through `evalGuard`. The first true one is
   *    taken. The runtime takes every true one: objectstack#15429 is pending,
   *    and until it rules the Debug run keeps first-true, as it always has.
   *    A refused or failing guard takes nothing and fails the run.
   * 4. An `isDefault` edge with no condition is taken only when no guard was
   *    true.
   * 5. Every other edge is UNGUARDED and always taken.
   * 6. Nothing taken → the branch ends here. The runtime ends it too, with
   *    no error; the step says so.
   *
   * Only an omitted `condition` (`undefined`) is "no condition"; any other
   * value is a guard for `evalGuard` to evaluate or refuse (objectui#10615).
   */
  private route(node: SimNode, branch?: BranchSelection): Routing {
    const vars = this.state.variables;
    const out = this.edges
      .map((e, i) => ({ e, i }))
      .filter((x) => x.e.source === node.id && x.e.type !== 'fault');
    const notes: string[] = [];
    let considered = out;
    if (branch) {
      let claimed = out.filter((x) => branch.claims(x.e.label));
      if (claimed.length === 0 && branch.label === DEFAULT_BRANCH_LABEL) claimed = out.filter((x) => x.e.isDefault === true);
      if (claimed.length > 0) considered = claimed;
      else {
        notes.push(this.say('engine.flowSim.note.noBranchLabel', { label: branch.label }));
      }
    }

    const evals: SimEdgeEval[] = [];
    const taken: Array<{ e: SimEdge; i: number }> = [];
    let gated = false;
    let trueGuards = 0;
    for (const { e, i } of considered) {
      if (e.condition === undefined) continue;
      gated = true;
      const cond = conditionText(e.condition);
      const g = evalGuard(e.condition, vars, this.locale);
      if (g.kind !== 'value') {
        const error = g.kind === 'fault' ? g.error : this.say('engine.flowSim.note.evaluationFailed');
        evals.push({ edgeId: edgeId(e, i), target: e.target, condition: cond, result: false, error, selected: false });
        return { evals, gated, error: cond ? `${cond}: ${error}` : error };
      }
      const selected = g.result && trueGuards === 0;
      if (g.result) trueGuards++;
      if (selected) taken.push({ e, i });
      evals.push({ edgeId: edgeId(e, i), target: e.target, condition: cond, result: g.result, selected });
    }
    for (const { e, i } of considered) {
      if (e.condition !== undefined || !e.isDefault) continue;
      gated = true;
      const selected = trueGuards === 0;
      if (selected) taken.push({ e, i });
      evals.push({ edgeId: edgeId(e, i), target: e.target, isDefault: true, result: selected, selected });
    }
    for (const { e, i } of considered) {
      if (e.condition !== undefined || e.isDefault) continue;
      taken.push({ e, i });
      evals.push({ edgeId: edgeId(e, i), target: e.target, result: true, selected: true });
    }

    if (trueGuards > 1) {
      notes.push(this.say('engine.flowSim.note.multipleMatched'));
    }
    if (considered.length > 0 && taken.length === 0) {
      notes.push(this.say('engine.flowSim.note.noEdgeTaken'));
    }
    for (const { e, i } of taken) this.traverse(e, i);
    return { evals, gated, note: notes.length ? notes.join(' ') : undefined };
  }

  private traverse(e: SimEdge, i: number) {
    const id = edgeId(e, i);
    if (!this.state.traversedEdgeIds.includes(id)) this.state.traversedEdgeIds.push(id);
    if (this.nodes.has(e.target)) this.state.frontier.push(e.target);
  }

  private record(
    nodeId: string,
    type: string,
    label: string | undefined,
    status: SimStepStatus,
    extra: Partial<SimStep> = {},
  ): SimStep {
    // objectui#13242 — the step names its node by the rule the canvas reads.
    const step: SimStep = { seq: this.seq++, nodeId, type, label: flowNodeDisplayName({ id: nodeId, type, label }, this.locale), status, ...extra };
    this.state.steps.push(step);
    if (status === 'error' && this.state.status !== 'paused') {
      this.state.status = 'error';
      this.state.error = extra.error;
    }
    return step;
  }
}
