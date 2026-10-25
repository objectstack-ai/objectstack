// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Preflight graph validation + CEL helpers for the flow simulator.
 *
 * Validation runs BEFORE a simulation so the debugger refuses to "Run" a
 * structurally broken flow (which the real runtime would reject) instead of
 * producing misleading partial output. Guard and value evaluation never
 * swallow a failure: a debugger must tell the author *why* (parse error,
 * missing variable, type error), so the message is returned to the caller,
 * which fails the node the way the runtime does.
 *
 * The evaluators take the designer `locale` as an optional trailing argument
 * (objectui#10848), as {@link validateFlowDraft} does. It reaches only the
 * frame this file puts around a CEL failure (`engine.flowSim.note.cel*`) and
 * the fallback when the producer gives no message
 * (`engine.flowSim.note.evaluationFailed`). The producer's own text inside
 * the frame, and every spec refusal returned as is, pass through unchanged.
 * Absent, the frames read the en rows.
 */

import { ExpressionEngine, validateExpression } from '@objectstack/formula';
import {
  ASSIGNMENT_VALUE_ENVELOPE_REFUSAL,
  predicateSlotRefusal,
  structuralConditionRefusal,
  type AssignmentExpressionValue,
} from '@objectstack/spec/automation';
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED, EvaluatedExpressionSchema } from '@objectstack/spec/shared';
import type { FlowSimDiagnostic, FlowValidation, SimEdge, SimNode } from './flow-sim-types.js';
import { conditionText } from '../flow-canvas-layout.js';
import { missingNodePositions } from '../flow-node-refs.js';
import { flowNodeDisplayName } from '../flow-canvas-parts.js';
import { valueEnvelopeRefusal } from '../../inspectors/flow-value-envelope.js';
import { t as tr, tFormat } from '../../i18n.js';

/**
 * The CEL scope the runtime evaluates a flow expression in: the automation
 * engine's `celScope` (`AutomationEngine` in `@objectstack/service-automation`),
 * which its predicate and value paths share. A dotted variable key
 * (`step.result`) becomes a nested path, and the variables are bound three
 * ways: bare (`n`), under `vars` (`vars.n`) and as `record` (`record.n`).
 * There is no `data` root, unlike the scope `@object-ui/core`'s legacy
 * `ExpressionEvaluator` was given here before objectui#10615 and objectui#10692.
 *
 * One deliberate difference: the runtime descends into a variable's own object
 * when it nests a dotted key, and so writes into it. Here each object on the
 * path is copied first, so evaluating never changes the simulated variables.
 */
function flowCelScope(variables: Record<string, unknown>): {
  extra: Record<string, unknown>;
  record: Record<string, unknown>;
} {
  const vars: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(variables)) {
    const segs = key.split('.');
    let cursor = vars;
    for (const seg of segs.slice(0, -1)) {
      const next = cursor[seg];
      const copy = next !== null && typeof next === 'object' ? Object.assign(Array.isArray(next) ? [] : {}, next) : {};
      cursor[seg] = copy;
      cursor = copy as Record<string, unknown>;
    }
    cursor[segs[segs.length - 1]] = value;
  }
  return { extra: { ...vars, vars }, record: vars };
}

/**
 * Evaluate an assignment's CEL value envelope, `{ dialect: 'cel', source }`,
 * to the value the variable takes (objectui#10537). This follows the runtime's
 * `evaluateValueEnvelope` step for step, on the runtime's own engine,
 * `@objectstack/formula`'s `ExpressionEngine`:
 *
 * 1. Shape: the spec's `AssignmentValueSchema` refusal, read through the
 *    editor's `valueEnvelopeRefusal`. A dialect other than `cel`, or a missing
 *    or blank `source`, is refused.
 * 2. CEL: `validateExpression('value', …)`, the parse the runtime refuses a
 *    flow with at registration.
 * 3. Value: `ExpressionEngine.evaluate` against {@link flowCelScope}.
 *
 * `@object-ui/core`'s `ExpressionEvaluator` is not used for this. Its
 * bare-expression path is not CEL: when this landed it had no CEL stdlib
 * (`joinNonEmpty`, `size`), no macros (`rows.map(r, …)`) and no `in`, and it
 * bound `data` where the runtime binds `vars`. The engine and scope pins in
 * `__tests__/flow-simulator.valueEnvelope-10537.test.ts` go red if this
 * evaluation is moved onto it.
 *
 * A failure is returned, never swallowed to a value. The runtime throws at
 * this point, so the run fails on the node.
 */
export function evalValueEnvelope(
  envelope: unknown,
  variables: Record<string, unknown>,
  locale?: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  const refusal = valueEnvelopeRefusal(envelope);
  if (refusal) return { ok: false, error: refusal.join(' ') };
  // The spec accepted it, so it is the slot's dialect with a non-blank source.
  const { dialect, source } = envelope as AssignmentExpressionValue;
  try {
    const parsed = validateExpression('value', { dialect, source });
    if (parsed.errors.length > 0) {
      return {
        ok: false,
        error: parsed.errors.map((e) => `${ASSIGNMENT_VALUE_ENVELOPE_REFUSAL} ${e.message}`).join(' '),
      };
    }
    const result = ExpressionEngine.evaluate({ dialect, source }, flowCelScope(variables));
    if (!result.ok) {
      return { ok: false, error: tFormat('engine.flowSim.note.celEvaluationFailed', locale, { message: result.error.message }) };
    }
    return { ok: true, value: result.value };
  } catch (err) {
    return { ok: false, error: (err as Error).message || tr('engine.flowSim.note.evaluationFailed', locale) };
  }
}

/** What {@link evalGuard} made of one edge guard. */
export type GuardEvaluation =
  /** No guard: the condition is omitted (`undefined`). */
  | { kind: 'absent' }
  /**
   * Refused or failed. A refused guard never runs at runtime (`registerFlow`
   * refuses the flow); a CEL fault on live values throws and fails the run.
   */
  | { kind: 'fault'; error: string }
  /** Evaluated. `result` is the value's truthiness, as the runtime reads it. */
  | { kind: 'value'; result: boolean };

/**
 * Evaluate an edge guard the way the runtime does (objectui#10615): on
 * {@link evalValueEnvelope}'s engine and scope, `ExpressionEngine.evaluate`
 * against {@link flowCelScope}. There is no second evaluator. The runtime's
 * reading on objectstack main, in order: `FlowSchema.parse` (the edge's
 * `condition` schema), `registerFlow`'s edge pass, then `evaluateCondition`
 * in `AutomationEngine` (`@objectstack/service-automation`).
 *
 * 1. Absent: only an omitted guard (`undefined`). `FlowEdgeSchema.condition`
 *    is `.optional()`, which admits a missing value and nothing else, so no
 *    other value is read as "no condition".
 * 2. Shape: the spec's `structuralConditionRefusal`, the first thing
 *    `registerFlow`'s edge pass and `evaluateCondition` do. A boolean, number,
 *    array or source-less object is refused — an `ast`-only envelope included,
 *    which `@objectstack/spec` 17.5.0 moved to this step (objectui#11073).
 * 3. Evaluated slot: the rule `FlowEdgeSchema.condition` applies on main
 *    (`EvaluatedExpressionInputSchema`), from its two installed parts. A string
 *    must be non-blank (main's `NON_BLANK_STRING`), so `''` and `'   '` are
 *    refused with the spec's `EVALUATED_EXPRESSION_SOURCE_REQUIRED`. Anything
 *    else must satisfy `EvaluatedExpressionSchema`: an envelope with a
 *    `dialect` (`ExpressionSchema` requires one, so `{ source: 'n == 2' }` is
 *    refused) and a non-blank `source` (so `{ dialect: 'cel', source: '' }` is
 *    refused; an `ast`-only envelope was refused here through 17.4.0 and is
 *    caught by step 2 since). `null` is not an envelope and is refused here too.
 * 4. CEL: `validateExpression('predicate', …)`, the parse `registerFlow`
 *    refuses a flow with. A dialect other than `cel` is refused, and so is a
 *    `{var}` or `${…}` template, which is not CEL.
 * 5. Value: `ExpressionEngine.evaluate`. A CEL error is a fault. A value is
 *    read as `Boolean(value)`, as `evaluateCondition` reads it.
 *
 * Steps 2 to 4 are refusals the runtime makes before any node runs; step 5's
 * fault is the one it throws mid-run. The simulator reports both on the node
 * whose out-edge it is, and stops there.
 *
 * A bare string is CEL. The runtime's legacy `{var}` template dialect is never
 * reached for an edge: `FlowEdgeSchema` turns every bare string into a
 * `{ dialect: 'cel', source }` envelope, and `registerFlow` refuses a
 * `template` envelope at step 4. So this has no template branch to mirror.
 *
 * Steps 4 and 5 are {@link evalCelPredicate}, the one CEL call every predicate
 * in the simulator goes through (objectui#10692).
 */
export function evalGuard(condition: unknown, variables: Record<string, unknown>, locale?: string): GuardEvaluation {
  try {
    if (condition === undefined) return { kind: 'absent' };
    const shape = structuralConditionRefusal(condition);
    if (shape) return { kind: 'fault', error: shape.message };
    if (typeof condition === 'string') {
      if (!condition.trim()) return { kind: 'fault', error: EVALUATED_EXPRESSION_SOURCE_REQUIRED };
    } else {
      const envelope = EvaluatedExpressionSchema.safeParse(condition);
      if (!envelope.success) {
        return {
          kind: 'fault',
          error: envelope.error.issues.map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message)).join(' '),
        };
      }
    }
    const input = condition as SimEdge['condition'];
    return evalCelPredicate(input as string | { dialect?: string; source?: string }, conditionText(input) ?? '', variables, locale);
  } catch (err) {
    return { kind: 'fault', error: (err as Error).message || tr('engine.flowSim.note.evaluationFailed', locale) };
  }
}

/**
 * The one CEL call every predicate the simulator evaluates goes through: an
 * edge guard ({@link evalGuard}) and a decision branch's `expression`
 * ({@link evalBranchPredicate}). There is no second evaluator (objectui#10692).
 * A screen field's `visibleWhen` is not evaluated by the simulator at all: the
 * screen renderer decides it live over the screen's declared fields
 * (`ScreenView`, objectui#10743), and `screen-spec.ts` judges only its scope.
 *
 * 1. `validateExpression('predicate', …)`, the parse `registerFlow` refuses a
 *    flow with. A `{var}` or `${…}` template is not CEL and is refused here,
 *    and so is a dialect other than `cel`.
 * 2. `ExpressionEngine.evaluate` against {@link flowCelScope}. A CEL error is a
 *    fault. A value is read as `Boolean(value)`, as the runtime's
 *    `evaluateCondition` reads it.
 */
function evalCelPredicate(
  input: string | { dialect?: string; source?: string },
  source: string,
  variables: Record<string, unknown>,
  locale?: string,
): Exclude<GuardEvaluation, { kind: 'absent' }> {
  try {
    const parsed = validateExpression('predicate', input);
    if (parsed.errors.length > 0) {
      return { kind: 'fault', error: parsed.errors.map((e) => e.message).join(' ') };
    }
    const result = ExpressionEngine.evaluate({ dialect: 'cel', source }, flowCelScope(variables));
    if (!result.ok) {
      return { kind: 'fault', error: tFormat('engine.flowSim.note.celConditionFailed', locale, { message: result.error.message }) };
    }
    return { kind: 'value', result: Boolean(result.value) };
  } catch (err) {
    return { kind: 'fault', error: (err as Error).message || tr('engine.flowSim.note.evaluationFailed', locale) };
  }
}

/**
 * Evaluate one entry of a decision's `config.conditions` (`{ label,
 * expression }`), the way the runtime's `decision` executor does
 * (`registerLogicNodes` in `@objectstack/service-automation`): as a
 * `{ dialect: 'cel', source: expression }` predicate, through
 * {@link evalCelPredicate} (objectui#10692).
 *
 * - A blank `expression` is read as `false`, as `evaluateCondition` reads an
 *   empty source. The platform refuses it at `registerFlow`
 *   (`predicateSlotRefusal`, objectstack#17493), and so does the installed
 *   17.5.0's `FlowSchema` at parse, at `config.conditions[i].expression` (it
 *   admitted it through 17.4.0; objectui#11073) — so only a draft that has
 *   not passed that door reaches this read.
 * - A non-string `expression` is refused with the spec's
 *   `predicateSlotRefusal`, the refusal `registerFlow` applies to this slot.
 */
export function evalBranchPredicate(
  expression: unknown,
  variables: Record<string, unknown>,
  locale?: string,
): Exclude<GuardEvaluation, { kind: 'absent' }> {
  const shape = predicateSlotRefusal(expression);
  if (shape) return { kind: 'fault', error: shape.message };
  const source = expression as string;
  if (!source.trim()) return { kind: 'value', result: false };
  // Parsed as the bare text `registerFlow` checks this slot as.
  return evalCelPredicate(source, source, variables, locale);
}

/**
 * Find a directed cycle in `edges` over `nodeIds`, returned as the node path
 * that closes the loop (e.g. `['a','b','a']`), or `null` when the graph is a
 * DAG. Iterative DFS with a recursion-stack colour map; the first cycle found
 * wins (enough to report — the author fixes one at a time).
 */
export function findCycle(nodeIds: string[], edges: SimEdge[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) adj.set(id, []);
  for (const e of edges) {
    if (adj.has(e.source) && adj.has(e.target)) adj.get(e.source)!.push(e.target);
  }
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>(nodeIds.map((id) => [id, WHITE]));
  const stack: string[] = [];

  const visit = (start: string): string[] | null => {
    // Explicit stack of {node, next-child-index} frames so a deep graph can't
    // blow the JS call stack.
    const frames: Array<{ id: string; i: number }> = [{ id: start, i: 0 }];
    color.set(start, GRAY);
    stack.push(start);
    while (frames.length) {
      const frame = frames[frames.length - 1];
      const children = adj.get(frame.id) ?? [];
      if (frame.i < children.length) {
        const next = children[frame.i++];
        const c = color.get(next);
        if (c === GRAY) {
          // Back into the active path → cycle. Slice from `next` to close it.
          const from = stack.indexOf(next);
          return [...stack.slice(from), next];
        }
        if (c === WHITE) {
          color.set(next, GRAY);
          stack.push(next);
          frames.push({ id: next, i: 0 });
        }
      } else {
        color.set(frame.id, BLACK);
        stack.pop();
        frames.pop();
      }
    }
    return null;
  };

  for (const id of nodeIds) {
    if (color.get(id) === WHITE) {
      const cycle = visit(id);
      if (cycle) return cycle;
    }
  }
  return null;
}

/**
 * A cycle as the Problems row reads it (objectui#13242): each node named by
 * {@link flowNodeDisplayName}, joined by ` → ` (`Check budget → Notify team →
 * Check budget`). A name two distinct nodes of the cycle share is followed by
 * the node's id in parentheses, so the loop still says which node is which; an
 * id naming no node reads as itself.
 */
function cycleDisplayName(cycle: string[], nodes: SimNode[], locale?: string): string {
  const named = new Map<string, string>();
  for (const id of cycle) {
    if (named.has(id)) continue;
    const node = nodes.find((n) => n.id === id);
    named.set(id, node ? flowNodeDisplayName(node, locale) : id);
  }
  const holders = new Map<string, number>();
  for (const name of named.values()) holders.set(name, (holders.get(name) ?? 0) + 1);
  return cycle
    .map((id) => {
      const name = named.get(id)!;
      return (holders.get(name) ?? 0) > 1 ? `${name} (${id})` : name;
    })
    .join(' → ');
}

/** Static structural checks; `errors` block Run, `warnings` are advisory. */
export function validateFlowDraft(nodes: SimNode[], edges: SimEdge[], locale?: string): FlowValidation {
  const errors: FlowSimDiagnostic[] = [];
  const warnings: FlowSimDiagnostic[] = [];

  const ids = nodes.map((n) => n.id);
  const idSet = new Set<string>();
  for (const id of ids) {
    if (!id) {
      errors.push({ level: 'error', message: tr('engine.flowValidate.nodeMissingId', locale) });
      continue;
    }
    if (idSet.has(id)) errors.push({ level: 'error', nodeId: id, message: tFormat('engine.flowValidate.duplicateNodeId', locale, { id }) });
    idSet.add(id);
  }

  for (const e of edges) {
    // Attach the endpoints so a dangling-edge error can badge the offending
    // connection on the canvas (not just appear as a flow-level message).
    if (!idSet.has(e.source))
      errors.push({ level: 'error', edge: { source: e.source, target: e.target }, message: tFormat('engine.flowValidate.edgeSourceMissing', locale, { source: e.source }) });
    if (!idSet.has(e.target))
      errors.push({ level: 'error', edge: { source: e.source, target: e.target }, message: tFormat('engine.flowValidate.edgeTargetMissing', locale, { target: e.target }) });
  }

  // Entry resolution: prefer an explicit `start` node, else a node with no
  // incoming edge. Zero or many → the author must fix it before running.
  const incoming = new Set(edges.map((e) => e.target));
  const startNodes = nodes.filter((n) => n.type === 'start');
  const roots = nodes.filter((n) => !incoming.has(n.id));
  let startNodeId: string | undefined;

  if (startNodes.length === 1) {
    startNodeId = startNodes[0].id;
    if (incoming.has(startNodeId)) {
      warnings.push({ level: 'warning', nodeId: startNodeId, message: tr('engine.flowValidate.startHasIncoming', locale) });
    }
  } else if (startNodes.length > 1) {
    errors.push({ level: 'error', message: tFormat('engine.flowValidate.multipleStart', locale, { count: startNodes.length }) });
  } else if (roots.length === 1) {
    startNodeId = roots[0].id;
    warnings.push({ level: 'warning', nodeId: startNodeId, message: tr('engine.flowValidate.noStartUsingRoot', locale) });
  } else if (roots.length === 0) {
    errors.push({ level: 'error', message: tr('engine.flowValidate.noEntry', locale) });
  } else {
    errors.push({ level: 'error', message: tFormat('engine.flowValidate.ambiguousEntry', locale, { count: roots.length }) });
  }

  // Per-decision: at most one default; warn on missing default (possible dead end).
  for (const n of nodes) {
    if (n.type !== 'decision') continue;
    const out = edges.filter((e) => e.source === n.id);
    const defaults = out.filter((e) => e.isDefault);
    // Named by the author's label, with the id kept beside it so two decisions
    // that share a label stay apart (objectui#13143).
    const name = flowNodeDisplayName(n, locale);
    if (defaults.length > 1) {
      errors.push({ level: 'error', nodeId: n.id, message: tFormat('engine.flowValidate.decisionMultipleDefaults', locale, { name, id: n.id, count: defaults.length }) });
    }
    // "Every branch is guarded" is read through `conditionText`, the same ONE
    // reader the stepper routes on (objectui#3216) — a decision whose guards
    // are stored as `{ dialect, source }` envelopes is exactly as capable of
    // dead-ending as one written with bare strings, and used to be silently
    // exempt from this warning.
    if (out.length === 0) {
      warnings.push({ level: 'warning', nodeId: n.id, message: tFormat('engine.flowValidate.decisionNoBranches', locale, { name, id: n.id }) });
    } else if (defaults.length === 0 && out.every((e) => conditionText(e.condition))) {
      warnings.push({ level: 'warning', nodeId: n.id, message: tFormat('engine.flowValidate.decisionNoDefault', locale, { name, id: n.id }) });
    }
  }

  // Unreachable nodes (advisory) — BFS from the resolved entry.
  if (startNodeId) {
    const reachable = new Set<string>([startNodeId]);
    const queue = [startNodeId];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const e of edges) {
        if (e.source === cur && idSet.has(e.target) && !reachable.has(e.target)) {
          reachable.add(e.target);
          queue.push(e.target);
        }
      }
    }
    for (const n of nodes) {
      if (!reachable.has(n.id)) {
        // Named as the decision messages name a node: the label, the id beside it (objectui#13200).
        const name = flowNodeDisplayName(n, locale);
        warnings.push({ level: 'warning', nodeId: n.id, message: tFormat('engine.flowValidate.nodeUnreachable', locale, { name, id: n.id }) });
      }
    }
  }

  // DAG-modulo-back-edges (ADR-0044): the engine requires the flow graph MINUS
  // declared back-edges to be acyclic. A declared revise loop (its closing edge
  // marked `type: 'back'`) is excluded and passes; any *unmarked* cycle is an
  // error — the author must opt in, edge by edge, exactly as `registerFlow`
  // enforces server-side.
  const forwardEdges = edges.filter((e) => e.type !== 'back');
  const cycle = findCycle(ids.filter((id): id is string => !!id), forwardEdges);
  if (cycle) {
    errors.push({
      level: 'error',
      nodeId: cycle[0],
      cycle,
      message: tFormat('engine.flowValidate.cycleDetected', locale, { cycle: cycleDisplayName(cycle, nodes, locale) }),
    });
  }

  return { errors, warnings, startNodeId };
}

/**
 * The rows beside `edgeSourceMissing` / `edgeTargetMissing` for the other
 * positions that name a node by its id (objectui#11838, the list
 * `nodeIdPositions` in `../flow-node-refs.ts` keeps): an error for each
 * expression reference whose root names a node the flow does not have
 * (`x.decision` once `x` is gone — the engine reads a node's outputs by its id,
 * and a CEL reference to a missing root faults, ADR-0032 §1c), and for each
 * boundary event attached to a host the flow does not have (it monitors
 * nothing, and nothing else says so).
 *
 * An expression's row points at the top-level node or edge that holds it, so
 * the badge sits where the author edits it; one row per reference text there.
 * The edge endpoints themselves stay `validateFlowDraft`'s rows above.
 *
 * Kept out of `validateFlowDraft`, which is also the debugger's Run preflight:
 * that refuses what `registerFlow` refuses, and the platform registers a flow
 * with either of these — a missing root faults only when its node runs, which
 * the debugger reports as that node's fault. `variables` are the flow's
 * declared variables: a root one of them answers to is not a node reference.
 */
export function missingNodeRefDiagnostics(
  flow: { nodes?: unknown; edges?: unknown; variables?: unknown },
  locale?: string,
): FlowSimDiagnostic[] {
  const out: FlowSimDiagnostic[] = [];
  const seen = new Set<string>();
  for (const p of missingNodePositions(flow)) {
    let diag: FlowSimDiagnostic;
    if (p.kind === 'boundary-host') {
      const name = flowNodeDisplayName(p.node, locale);
      diag = { level: 'error', nodeId: p.nodeId, message: tFormat('engine.flowValidate.boundaryHostMissing', locale, { name, id: p.nodeId, host: p.id }) };
    } else if (p.kind === 'expression-root') {
      const message = tFormat('engine.flowValidate.exprRefNodeMissing', locale, { ref: p.ref.text, id: p.id });
      const owner = p.site.owner;
      diag = owner.kind === 'edge'
        ? { level: 'error', edge: { source: owner.source, target: owner.target }, message }
        : { level: 'error', nodeId: owner.id, message };
    } else {
      continue;
    }
    const key = JSON.stringify([diag.nodeId ?? null, diag.edge ?? null, diag.message]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(diag);
  }
  return out;
}
