// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Shared types for the designer-time flow simulator.
 *
 * The simulator is a CLIENT-SIDE, BACKEND-FREE interpreter used to debug a flow
 * draft inside the visual designer. It NEVER calls a `dataSource`: every
 * side-effecting node (CRUD / connector / http / script) is MOCKED, so running
 * a simulation can never write or delete real data and never needs a live
 * environment. Its guiding rule (per design review) is: *never silently
 * simulate semantics that differ from the runtime* — anything we cannot
 * faithfully model (join synchronization, subflows, boundary events, arbitrary
 * script code) is surfaced as an explicit pause/notice instead of a fake
 * "success".
 */

import type { EvaluatedExpressionInput } from '@objectstack/spec/shared';

export interface SimNode {
  id: string;
  type: string;
  label?: string;
  config?: Record<string, unknown>;
  connectorConfig?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface SimEdge {
  id?: string;
  source: string;
  target: string;
  /**
   * Optional guard, in the spec's authoring shape: a bare CEL string, or the
   * ADR-0089 envelope (`{ dialect, source }`) that the edge slot's schema,
   * `EvaluatedExpressionInputSchema`, normalizes every authored string INTO at
   * parse time — so the envelope is the form a persisted flow actually carries,
   * not an exotic alternative.
   *
   * It is the EVALUATED input type, the same one `FlowDesignerEdge.condition`
   * carries, because `FlowEdgeSchema.condition` composes that schema
   * (objectstack#15807): an envelope there must carry a `source`. The spec's
   * wider `ExpressionInput` is the persistence contract (`source` OR `ast`);
   * this member imported it until objectui#8946, which let it describe an
   * `ast`-only guard the server refuses at parse. The simulator still refuses
   * such a guard at run time, because a draft is data and not a type
   * (`evalGuard` in `flow-sim-validate.ts` takes `unknown` for that reason).
   *
   * Imported from the spec rather than restated. The local spelling used to be
   * `string | { source?: string }`, and a restatement gets it wrong in BOTH
   * directions at once: too WIDE, because it describes a `dialect`-less
   * envelope that `FlowEdgeSchema` rejects outright; too NARROW, because
   * excess-property checking then refuses the canonical envelope written as a
   * literal (`dialect` "does not exist" on `{ source?: string }`). Correcting
   * it by hand only moves the drift — the next spelling omits `ast` or `meta`.
   * objectui#3202 removed the same restatement from `FlowDesignerEdge`; this
   * was its last copy, and the reason the simulator could not read a guard the
   * platform itself produces (objectui#3216).
   */
  condition?: EvaluatedExpressionInput;
  isDefault?: boolean;
  label?: string;
  /**
   * Connection type (FlowEdgeSchema). A `'back'` edge is an ADR-0044 declared
   * back-edge: traversed normally at run time, but excluded from DAG cycle
   * validation so a revise/rework loop can re-enter an earlier node.
   */
  type?: string;
}

export type SimStatus = 'idle' | 'running' | 'paused' | 'done' | 'error';

/**
 * One outgoing edge successor selection considered (kept for the debug
 * timeline): on a decision, and on any node that leaves by a guard or a default
 * edge (objectui#10692). An edge with no guard reads `result: true`.
 */
export interface SimEdgeEval {
  edgeId: string;
  target: string;
  condition?: string;
  result: boolean;
  error?: string;
  isDefault?: boolean;
  selected: boolean;
}

export type SimStepStatus = 'ok' | 'mocked' | 'paused' | 'skipped' | 'error';

/** A single executed node, rich enough to debug decisions and data writes. */
export interface SimStep {
  seq: number;
  nodeId: string;
  type: string;
  label: string;
  status: SimStepStatus;
  /** Variable names → values written by this node (mocked side effects). */
  wrote?: Record<string, unknown>;
  /** Per-edge diagnostics of the node's successor selection (see {@link SimEdgeEval}). */
  edges?: SimEdgeEval[];
  /** Human-readable note (e.g. "mocked", "paused for screen input"). */
  note?: string;
  /** Evaluation/structural error surfaced to the author. */
  error?: string;
}

export interface SimState {
  status: SimStatus;
  variables: Record<string, unknown>;
  steps: SimStep[];
  /** Node ids waiting to execute. */
  frontier: string[];
  /** Last executed (or currently paused) node. */
  activeNodeId: string | null;
  visitedNodeIds: string[];
  traversedEdgeIds: string[];
  /** Set while `status === 'paused'` ("wait" or "screen"). */
  pausedReason?: string;
  error?: string;
}

export type DiagnosticLevel = 'error' | 'warning';

/**
 * One finding of the client-side structural check (`validateFlowDraft`,
 * `missingNodeRefDiagnostics`), anchored on a node, an edge or a cycle.
 *
 * Named `FlowSimDiagnostic`, not `Diagnostic`: `@object-ui/sdui-parser`
 * publishes `Diagnostic` for a parser finding (`severity` + `code`), a
 * different thing, and one exported name has one authority (objectui#6349,
 * batch 6).
 */
export interface FlowSimDiagnostic {
  level: DiagnosticLevel;
  /** The node this diagnostic points at (for an inline badge + click-to-reveal). */
  nodeId?: string;
  /**
   * The edge this diagnostic points at (e.g. a dangling endpoint). Carries the
   * endpoints so the designer can key the inline badge by `source->target`.
   */
  edge?: { source: string; target: string };
  message: string;
  /**
   * For a cycle error: the node path that closes the loop (e.g. `['a','b','a']`),
   * so the designer can paint the offending edges/nodes inline on the canvas.
   */
  cycle?: string[];
}

export interface FlowValidation {
  errors: FlowSimDiagnostic[];
  warnings: FlowSimDiagnostic[];
  /** Resolved entry node id, when exactly one is determinable. */
  startNodeId?: string;
}

/**
 * Author-supplied mock outputs, keyed by node id. The value is bound to the
 * node's `outputVariable` (the engine's only output binding — the legacy
 * script `outputVariables` list is ignored, framework#4278). For a `screen`
 * node it supplies the captured inputs.
 */
export type MockResults = Record<string, unknown>;
