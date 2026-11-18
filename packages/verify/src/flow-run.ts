// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// @objectstack/verify — the local flow run (`os verify --flow`).
//
// A flow is the item most often saved clean and dead at run time, and the one
// a static rule sees least of: a node type no executor runs, a trigger that
// never binds, a write the data layer refuses. This family runs ONE flow once
// against the booted ephemeral stack and reports what the engine did: each
// node's status, the first failure with its code and the node named, and what
// the run wrote.
//
// ## How the run starts: the way production starts it
//
//  - A record-change flow is started by its own trigger: the run writes the
//    triggering record through the engine's write door as the signed-in dev
//    admin (`hooks.run`), so the record-change trigger the boot bound fires the
//    flow exactly as a save does. A create or write leg inserts the record; an
//    update leg seeds it first (the seed door fires no trigger) and then saves
//    it unchanged, so a condition comparing old and new values sees no change;
//    a delete leg seeds it and deletes it.
//  - A flow its own trigger starts with no caller (a schedule, an API trigger,
//    or a flow declared `runAs: 'system'`) is started as that trigger starts it:
//    the `automation` service's own `execute`, with no caller (`flows.run(…,
//    { system: true })`).
//  - Every other flow is started by a person: through the runtime's trigger
//    route as the dev admin (`flows.run(…, { as })`).
//
// Nothing here re-derives an engine decision. Whether the trigger is bound,
// and why not, is the engine's own runtime state (`getFlowRuntimeStates`, the
// sentence `/automation/_status` serves); which node types no executor runs is
// the engine's own audit (`getUnknownNodeTypeAudit`); the node trace is the
// run's own log (`listRuns`); what the run wrote is the engine's middleware
// chain (`observeWrites`). All of them are read-only seams the engine already
// exposes.
//
// ## Confinement: the run writes to the ephemeral stack only
//
// `bootStack` boots the app on an in-memory database, but an app that declares
// datasources gets them connected too (a federated object writes through its
// own driver). Before the run starts, this family registers one middleware on
// the engine's chain that refuses every write (insert, update, delete, purge,
// restore) whose object resolves to any driver other than the stack's own
// default one, the in-memory database the boot created. The refusal happens
// before the driver is called, so the other datasource is never touched; the
// node that wrote fails with the refusal, and the report names the object and
// its datasource. `flow-run.test.ts` pins it against a recording driver.

import { isServiceNotRegisteredError } from '@objectstack/core';
import { collectFlowGraphs } from '@objectstack/spec/automation';
import type { ObjectQL, OperationContext } from '@objectstack/objectql';
import type { AutomationEngine } from '@objectstack/service-automation';
import type { VerifyStack } from './harness.js';
import type { EngineRow, FlowRun, ObservedWrite } from './handle.js';

/** What the caller asks to run. */
export interface FlowRunRequest {
  /** The flow's machine name. */
  flow: string;
  /**
   * For a record-change flow: the field values of the record whose write
   * starts it. Ignored (and said so) for any other flow.
   */
  record?: EngineRow;
  /** For a flow started directly: its input, handed as the start's `params`. */
  input?: EngineRow;
}

/** What the run came to. */
export type FlowRunVerdict = 'completed' | 'failed' | 'paused' | 'refused' | 'skipped' | 'not_run';

/** How the run was started (see the file header). */
export type FlowRunStart = 'record_write' | 'trigger_route' | 'system' | 'none';

/** One node the run executed, as the run's own log records it. */
export interface FlowRunStep {
  nodeId: string;
  nodeType: string;
  label?: string;
  status: 'success' | 'failure' | 'skipped';
  /** The container the step ran in (a loop body, a parallel branch, a try or catch region). */
  region?: string;
  error?: { code: string; message: string };
}

/** One write the engine received while the run was open. */
export interface FlowRunWrite {
  object: string;
  operation: ObservedWrite['operation'];
  /** The ids written, as the engine answered them (an insert) or as the write addressed them. */
  ids: string[];
  outcome: 'written' | 'refused';
  /** The refusal's own code, when the engine refused it and the error carries one. */
  code?: string;
  /** The datasource the object routes to: the stack's own default driver's name, or the bound datasource. */
  datasource: string;
  /** `true` when this family's confinement refused it: the object routes outside the ephemeral stack. */
  confined?: boolean;
}

/** Why the run did not prove the flow. */
export type FlowRunFailureKind =
  /** The app's composition holds no automation service. */
  | 'no_automation'
  /** No flow of that name is registered. */
  | 'flow_not_registered'
  /** The flow is switched off. */
  | 'flow_disabled'
  /** The flow's trigger never binds, or binds to an object nobody can write. */
  | 'trigger_unbound'
  /** A node type no executor runs. */
  | 'no_executor'
  /** A record-change flow was asked to run with no record to write. */
  | 'record_required'
  /** The start itself was refused before any node ran. */
  | 'start_refused'
  /** The triggering write landed and no run of the flow followed it. */
  | 'not_started'
  /** A node failed. */
  | 'node_failed'
  /** The run failed with no failing step in its log. */
  | 'run_failed'
  /** A write outside the ephemeral stack was refused. */
  | 'confined_write'
  /** The ephemeral driver could not be identified, so the run was not started. */
  | 'confinement_unavailable';

export interface FlowRunFailure {
  kind: FlowRunFailureKind;
  message: string;
  /** The engine's own code, when it gave one. */
  code?: string;
  nodeId?: string;
  nodeType?: string;
  /** The trigger, named: its type and the object it watches. */
  trigger?: string;
}

/** The flow's trigger, as the engine's runtime state reports it. */
export interface FlowRunTrigger {
  type: string;
  object?: string;
  /** The start node's `triggerType` token (`record-after-create`, …), when it declares one. */
  event?: string;
  bound: boolean;
  reason?: string;
  cause?: string;
}

export interface FlowRunReport {
  app: string;
  flow: string;
  verdict: FlowRunVerdict;
  start: FlowRunStart;
  trigger?: FlowRunTrigger;
  /** The triggering record a record-change run wrote. */
  record?: { object: string; operation: 'insert' | 'update' | 'delete'; id?: string };
  runId?: string;
  /** Every node the run executed, in the order the log records them. */
  steps: FlowRunStep[];
  /** Every node whose type no executor runs, reached or not. */
  missingExecutors: Array<{ nodeId: string; nodeType: string; region?: string }>;
  firstFailure?: FlowRunFailure;
  /** What the run wrote: every write the engine received while it was open, the triggering write excluded. */
  writes: FlowRunWrite[];
  /** The confinement: the one datasource the run may write, and how many writes it refused. */
  confinement: { datasource: string; refused: number };
  /** Notes the reader needs (a skipped start, an ignored record, a paused node). */
  notes: string[];
  summary: { steps: number; failedSteps: number; writes: number; hardFailures: number };
}

/** The writes the confinement judges: every verb that changes a row. */
const CONFINED_OPERATIONS: ReadonlySet<OperationContext['operation']> = new Set([
  'insert',
  'update',
  'delete',
  'purge',
  'restore',
]);

/**
 * The run history the engine keeps for itself. Its rows are the engine's
 * bookkeeping of the run, not something the flow wrote.
 */
const RUN_HISTORY_OBJECTS: ReadonlySet<string> = new Set(['sys_automation_run']);

/** The automation members this family reads, each typed as the engine's own member. */
type FlowRunAutomation = Pick<
  AutomationEngine,
  'getFlow' | 'listRuns' | 'getFlowRuntimeStates' | 'getUnknownNodeTypeAudit'
>;
type RunLogEntry = Awaited<ReturnType<AutomationEngine['listRuns']>>[number];
type RuntimeState = ReturnType<AutomationEngine['getFlowRuntimeStates']>[number];

/**
 * The engines whose chain already carries the confinement middleware, each
 * with the list the current run's refusals go to (the engine has no way to
 * take a middleware back, so a second run on the same stack swaps the list).
 */
const confinedEngines = new WeakMap<object, { refused: ConfinedRefusal[] }>();

/** One write the confinement refused. */
interface ConfinedRefusal {
  object: string;
  datasource: string;
  operation: ObservedWrite['operation'];
}

/** How a failing step's message is recognised as the confinement's refusal (the engine wraps the node's code). */
const CONFINEMENT_SENTENCE = /a flow run writes to the ephemeral stack only/;

/** The refusal the confinement throws: the ADR-0112 pair, and the object and datasource named. */
function confinementRefusal(object: string, datasource: string, operation: string): Error {
  const error = new Error(
    `verify --flow: a flow run writes to the ephemeral stack only, and '${object}' routes to datasource ` +
      `'${datasource}', which is not the in-memory database this run booted — the ${operation} was refused before ` +
      'that datasource was called.',
  ) as Error & { code: string; status: number; statusCode: number; confinedObject: string };
  error.code = 'PERMISSION_DENIED';
  error.status = 403;
  error.statusCode = 403;
  error.confinedObject = object;
  return error;
}

/** The name of the datasource `object` routes to, as the engine resolves it. */
function datasourceOf(ql: ObjectQL, object: string): string {
  return ql.resolveEffectiveDatasource(object) ?? ql.getDefaultDriverName() ?? 'default';
}

/**
 * Register the confinement middleware on the stack's engine, once. Answers the
 * ephemeral datasource's name, or `undefined` when the engine names no default
 * driver (then nothing can be judged, and the run is not started).
 */
function confineToEphemeral(ql: ObjectQL, refused: ConfinedRefusal[]): string | undefined {
  const defaultName = ql.getDefaultDriverName();
  const ephemeral = defaultName ? ql.getDriverByName(defaultName) : undefined;
  if (!defaultName || !ephemeral) return undefined;
  const held = confinedEngines.get(ql);
  if (held) {
    held.refused = refused;
    return defaultName;
  }
  const sink = { refused };
  confinedEngines.set(ql, sink);
  ql.registerMiddleware(async (op: OperationContext, next: () => Promise<void>) => {
    if (!CONFINED_OPERATIONS.has(op.operation)) return next();
    if (ql.getDriverForObject(op.object) === ephemeral) return next();
    const datasource = datasourceOf(ql, op.object);
    sink.refused.push({ object: op.object, datasource, operation: op.operation as ConfinedRefusal['operation'] });
    throw confinementRefusal(op.object, datasource, op.operation);
  });
  return defaultName;
}

function strings(values: unknown[]): string[] {
  return values.filter((v) => typeof v === 'string' || typeof v === 'number').map(String);
}

/** The ids one observed write wrote or addressed. */
function idsOf(write: ObservedWrite): string[] {
  if (write.outcome.status === 'resolved' && write.operation === 'insert') {
    const result = write.outcome.result as unknown;
    const rows = Array.isArray(result) ? result : [result];
    return strings(rows.map((r) => (r as EngineRow | null)?.id));
  }
  const id = write.where?.id ?? (Array.isArray(write.data) ? undefined : write.data?.id);
  return id === undefined ? [] : strings([id]);
}

/** The start node's `triggerType` token, when it declares a single one. */
function startEventOf(definition: { nodes?: unknown } | null): string | undefined {
  const nodes = Array.isArray(definition?.nodes) ? (definition!.nodes as Array<{ type?: unknown; config?: unknown }>) : [];
  const start = nodes.find((n) => n?.type === 'start');
  const token = (start?.config as { triggerType?: unknown } | undefined)?.triggerType;
  return typeof token === 'string' ? token : undefined;
}

/** Whether the start node declares a start condition. */
function hasStartCondition(definition: { nodes?: unknown } | null): boolean {
  const nodes = Array.isArray(definition?.nodes) ? (definition!.nodes as Array<{ type?: unknown; config?: unknown }>) : [];
  const start = nodes.find((n) => n?.type === 'start');
  return (start?.config as { condition?: unknown } | undefined)?.condition != null;
}

/** The write a record-change leg makes: create and write legs insert, the others act on a seeded row. */
function legOperation(event: string | undefined): 'insert' | 'update' | 'delete' {
  if (event && /-update$/.test(event)) return 'update';
  if (event && /-delete$/.test(event)) return 'delete';
  return 'insert';
}

/** Every node whose type the engine's audit names as having no executor, with where it sits. */
function missingExecutorNodes(
  definition: { nodes?: unknown; edges?: unknown } | null,
  unknownTypes: readonly string[],
): FlowRunReport['missingExecutors'] {
  if (!definition || unknownTypes.length === 0 || !Array.isArray(definition.nodes)) return [];
  const unknown = new Set(unknownTypes);
  const found: FlowRunReport['missingExecutors'] = [];
  const graphs = collectFlowGraphs({
    nodes: definition.nodes as never,
    edges: (Array.isArray(definition.edges) ? definition.edges : []) as never,
  });
  for (const graph of graphs) {
    for (const node of graph.nodes as ReadonlyArray<{ id?: unknown; type?: unknown }>) {
      if (typeof node.type !== 'string' || !unknown.has(node.type)) continue;
      found.push({
        nodeId: typeof node.id === 'string' ? node.id : node.type,
        nodeType: node.type,
        ...(graph.scope ? { region: graph.scope } : {}),
      });
    }
  }
  return found;
}

function stepOf(entry: RunLogEntry['steps'][number]): FlowRunStep {
  return {
    nodeId: entry.nodeId,
    nodeType: entry.nodeType,
    ...(entry.nodeLabel ? { label: entry.nodeLabel } : {}),
    status: entry.status,
    ...(entry.regionKind && entry.parentNodeId ? { region: `${entry.regionKind} of '${entry.parentNodeId}'` } : {}),
    ...(entry.error ? { error: { code: entry.error.code, message: entry.error.message } } : {}),
  };
}

const VERDICT_OF_STATUS: Readonly<Record<string, FlowRunVerdict>> = {
  completed: 'completed',
  failed: 'failed',
  paused: 'paused',
  refused: 'refused',
  cancelled: 'failed',
  timed_out: 'failed',
};

/**
 * Run one flow once against the booted stack and report what the engine did.
 * Never throws for anything the flow does: every failure is on the report.
 * The stack should be one booted for this run alone: the confinement
 * middleware stays on its engine for the stack's life.
 */
export async function runFlowProof(stack: VerifyStack, config: any, request: FlowRunRequest): Promise<FlowRunReport> {
  const flow = request.flow;
  const report: FlowRunReport = {
    app: config?.manifest?.id ?? config?.manifest?.namespace ?? 'app',
    flow,
    verdict: 'not_run',
    start: 'none',
    steps: [],
    missingExecutors: [],
    writes: [],
    confinement: { datasource: 'default', refused: 0 },
    notes: [],
    summary: { steps: 0, failedSteps: 0, writes: 0, hardFailures: 0 },
  };
  const finish = (): FlowRunReport => summarize(report);

  // 1. The automation service the app's composition holds.
  let automation: FlowRunAutomation;
  try {
    automation = stack.kernel.getService<FlowRunAutomation>('automation');
  } catch (e) {
    if (!isServiceNotRegisteredError(e)) throw e;
    report.firstFailure = {
      kind: 'no_automation',
      message:
        "this app's composition holds no automation service, so no flow runs here or under `os serve` — declare " +
        "requires: ['automation'] (and 'triggers' for a flow its own trigger starts)",
    };
    return finish();
  }

  // 2. The flow as the engine registered it: what a run executes.
  const definition = (await automation.getFlow(flow)) as ({ nodes?: unknown; edges?: unknown; runAs?: unknown } & EngineRow) | null;
  if (!definition) {
    report.firstFailure = {
      kind: 'flow_not_registered',
      message: `no flow named '${flow}' is registered on the booted stack`,
    };
    return finish();
  }

  // 3. The node types no executor runs: the engine's own audit, read after the
  //    boot sealed the vocabulary, mapped onto the nodes that carry them.
  const audit = automation.getUnknownNodeTypeAudit().find((entry) => entry.flowName === flow);
  report.missingExecutors = missingExecutorNodes(definition, audit?.unknownTypes ?? []);

  // 4. The trigger, as the engine's runtime state reports it.
  const state: RuntimeState | undefined = automation.getFlowRuntimeStates().find((row) => row.name === flow);
  const event = startEventOf(definition);
  if (state?.triggerType) {
    report.trigger = {
      type: state.triggerType,
      ...(state.object ? { object: state.object } : {}),
      ...(event ? { event } : {}),
      bound: state.bound,
      ...(state.reason ? { reason: state.reason } : {}),
      ...(state.unboundCause ? { cause: state.unboundCause } : {}),
    };
  }
  if (state && !state.enabled) {
    report.firstFailure = { kind: 'flow_disabled', message: `flow '${flow}' is switched off, so nothing starts it` };
    return finish();
  }
  const triggerName = report.trigger
    ? `'${report.trigger.type}'${report.trigger.object ? ` on '${report.trigger.object}'` : ''}`
    : undefined;
  if (report.trigger && !report.trigger.bound) {
    report.firstFailure = {
      kind: 'trigger_unbound',
      trigger: triggerName,
      message:
        `the flow's trigger ${triggerName} never binds, so nothing ever starts it: ` +
        (report.trigger.reason ?? 'the engine reports it unbound'),
    };
    return finish();
  }
  const recordChange = report.trigger?.type === 'record_change';
  if (recordChange && report.trigger?.object && !stack.metadata.object(report.trigger.object)) {
    report.firstFailure = {
      kind: 'trigger_unbound',
      trigger: triggerName,
      message: `the flow's trigger ${triggerName} watches an object this stack does not register, so no write ever fires it`,
    };
    return finish();
  }

  // 5. The confinement, before anything writes.
  const ql = stack.kernel.getService<ObjectQL>('objectql');
  const refused: ConfinedRefusal[] = [];
  const ephemeral = confineToEphemeral(ql, refused);
  if (!ephemeral) {
    report.firstFailure = {
      kind: 'confinement_unavailable',
      message: 'the booted engine names no default driver, so the run cannot be confined to the ephemeral stack and was not started',
    };
    return finish();
  }
  report.confinement.datasource = ephemeral;

  // 6. Start it, the way production starts it, observing every write.
  const runsBefore = new Set((await automation.listRuns(flow, { limit: 100 })).map((r) => r.id));
  let result: FlowRun | undefined;
  let startRefusal: { code?: string; message: string } | undefined;
  let triggerWrite: ObservedWrite | undefined;
  let observed: ObservedWrite[] = [];

  if (recordChange) {
    const object = report.trigger!.object!;
    if (!request.record) {
      report.firstFailure = {
        kind: 'record_required',
        trigger: triggerName,
        message:
          `a record-change flow starts from a write of a '${object}' record; name the record's fields ` +
          `(--flow-record '{"field":"value"}') and the run writes it to fire the trigger`,
      };
      return finish();
    }
    if (request.input) report.notes.push('the input was ignored: a record-change flow starts from the record it is handed');
    const operation = legOperation(event);
    report.start = 'record_write';
    report.record = { object, operation };
    if (operation !== 'insert') {
      report.notes.push(
        operation === 'update'
          ? 'the record was seeded and then saved unchanged: a condition comparing old and new values sees no change'
          : 'the record was seeded and then deleted',
      );
    }
    const admin = await stack.signIn();
    try {
      let id: string | undefined;
      if (operation !== 'insert') {
        const [seeded] = await stack.seed(object, [{ ...request.record }]);
        id = seeded?.id === undefined ? undefined : String(seeded.id);
      }
      observed = await stack.observeWrites(async () => {
        if (operation === 'insert') {
          const row = await stack.hooks.run(object, 'insert', { ...request.record }, { as: admin });
          id = row?.id === undefined ? undefined : String(row.id);
        } else if (operation === 'update') {
          await stack.hooks.run(object, 'update', { ...request.record, id }, { as: admin });
        } else {
          await stack.hooks.run(object, 'delete', { id }, { as: admin });
        }
      });
      if (id !== undefined) report.record.id = id;
    } catch (e) {
      startRefusal = { code: (e as { code?: string })?.code, message: (e as Error)?.message ?? String(e) };
    }
    triggerWrite = observed.find((w) => w.object === object && w.operation === operation);
  } else {
    if (request.record) report.notes.push('the record was ignored: only a record-change flow starts from a record');
    const selfStarted = report.trigger !== undefined || definition.runAs === 'system';
    report.start = selfStarted ? 'system' : 'trigger_route';
    const opts = selfStarted ? ({ system: true } as const) : { as: await stack.signIn() };
    try {
      observed = await stack.observeWrites(async () => {
        result = await stack.flows.run(flow, request.input, opts as never);
      });
    } catch (e) {
      startRefusal = { code: (e as { code?: string })?.code, message: (e as Error)?.message ?? String(e) };
    }
  }

  // 7. The run the start caused: the run log's entries that were not there before.
  const fresh = (await automation.listRuns(flow, { limit: 100 })).filter((r) => !runsBefore.has(r.id));
  fresh.sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  const run = fresh[0];
  if (fresh.length > 1) report.notes.push(`${fresh.length} runs of the flow started; the first is reported`);

  // The engine's observer sits on the same chain; a write the confinement
  // refused never reaches the driver, and is reported from the confinement's
  // own record of it, after the writes the observer saw.
  report.writes = [
    ...observed
      .filter((w) => w !== triggerWrite && !RUN_HISTORY_OBJECTS.has(w.object))
      .map((w): FlowRunWrite => ({
        object: w.object,
        operation: w.operation,
        ids: idsOf(w),
        outcome: w.outcome.status === 'refused' ? 'refused' : 'written',
        ...(w.outcome.status === 'refused' && w.outcome.code ? { code: w.outcome.code } : {}),
        datasource: datasourceOf(ql, w.object),
      })),
    ...refused.map((r): FlowRunWrite => ({
      object: r.object,
      operation: r.operation,
      ids: [],
      outcome: 'refused',
      code: 'PERMISSION_DENIED',
      datasource: r.datasource,
      confined: true,
    })),
  ];
  report.confinement.refused = refused.length;

  if (run) {
    report.runId = run.id;
    report.steps = (run.steps ?? []).map(stepOf);
    report.verdict = VERDICT_OF_STATUS[run.status] ?? 'failed';
    const failing = report.steps.find((s) => s.status === 'failure');
    if (failing) {
      const confinedWrite = refused.length > 0 && CONFINEMENT_SENTENCE.test(failing.error?.message ?? '');
      const missing = report.missingExecutors.some((m) => m.nodeId === failing.nodeId);
      report.firstFailure = {
        kind: confinedWrite ? 'confined_write' : missing ? 'no_executor' : 'node_failed',
        nodeId: failing.nodeId,
        nodeType: failing.nodeType,
        ...(failing.error?.code ? { code: failing.error.code } : {}),
        message: failing.error?.message ?? `node '${failing.nodeId}' failed`,
      };
    } else if (report.verdict === 'failed') {
      report.firstFailure = { kind: 'run_failed', message: run.error ?? `run ${run.id} failed with no failing step in its log` };
    }
    if (report.verdict === 'paused') {
      const last = report.steps[report.steps.length - 1];
      report.notes.push(`the run paused${last ? ` after node '${last.nodeId}' (${last.nodeType})` : ''}; that is normal for a screen, wait or approval`);
    }
  } else if (startRefusal) {
    report.firstFailure = {
      kind: refused.length > 0 ? 'confined_write' : 'start_refused',
      ...(startRefusal.code ? { code: startRefusal.code } : {}),
      message: startRefusal.message,
    };
  } else if (result && result.success === false) {
    report.verdict = 'failed';
    report.firstFailure = {
      kind: 'start_refused',
      ...(result.code ? { code: result.code } : {}),
      message: result.error ?? 'the engine refused to start the flow',
    };
  } else if (result && (result.output as { skipped?: unknown } | undefined)?.skipped === true) {
    report.verdict = 'skipped';
    const reason = (result.output as { reason?: unknown }).reason;
    report.notes.push(`the engine skipped the run (${typeof reason === 'string' ? reason : 'no reason given'}), so no node ran: this is not a proof that the flow works`);
  } else if (recordChange && hasStartCondition(definition)) {
    report.verdict = 'skipped';
    report.notes.push("the write started no run: the start node's condition decides whether it runs, and no run means it did not hold for this record — not a proof that the flow works");
  } else {
    report.firstFailure = {
      kind: 'not_started',
      ...(triggerName ? { trigger: triggerName } : {}),
      message: recordChange
        ? `the ${report.record?.operation ?? 'write'} of the '${report.trigger?.object}' record landed and no run of the flow followed it: its trigger ${triggerName} did not fire`
        : 'the start returned and no run of the flow is in its log',
    };
  }
  return finish();
}

/** Count what the report proves and what it failed. */
function summarize(report: FlowRunReport): FlowRunReport {
  const failedSteps = report.steps.filter((s) => s.status === 'failure').length;
  let hardFailures = report.firstFailure ? 1 : 0;
  // A node with no executor the run did not reach is still a node that cannot run.
  hardFailures += report.missingExecutors.filter((m) => m.nodeId !== report.firstFailure?.nodeId).length;
  // A confined write the flow swallowed (a fault edge, a try region) left the run green and the write unlanded.
  if (report.firstFailure?.kind !== 'confined_write') hardFailures += report.confinement.refused > 0 ? 1 : 0;
  report.summary = { steps: report.steps.length, failedSteps, writes: report.writes.length, hardFailures };
  return report;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** The text face of a {@link FlowRunReport}, in the shape of the other families' reports. */
export function formatFlowRunReport(report: FlowRunReport): string {
  const lines: string[] = [`\n=== objectstack verify — flow run — ${report.app} ===`];
  const t = report.trigger;
  lines.push(
    `  flow: ${report.flow}; started by ${report.start === 'record_write' ? 'a record write' : report.start === 'system' ? 'its own trigger (no caller)' : report.start === 'trigger_route' ? 'the trigger route, as the dev admin' : 'nothing'}` +
      (t ? `; trigger ${t.type}${t.object ? ` on ${t.object}` : ''}${t.event ? ` (${t.event})` : ''} ${t.bound ? 'bound' : 'NOT BOUND'}` : ''),
  );
  if (report.record) {
    lines.push(`  record: ${report.record.operation} ${report.record.object}${report.record.id ? ` ${report.record.id}` : ''}`);
  }
  lines.push(`  confined to datasource '${report.confinement.datasource}' (the in-memory database this run booted)`);
  for (const s of report.steps) {
    const mark = s.status === 'success' ? '✓' : s.status === 'failure' ? '✗' : '–';
    const where = s.region ? ` [${s.region}]` : '';
    const label = s.label && s.label !== s.nodeId ? ` "${s.label}"` : '';
    lines.push(
      `  ${mark} ${s.nodeId} <${s.nodeType}>${label}${where}  ${s.status}` +
        (s.error ? ` — ${s.error.code}: ${clip(s.error.message, 200)}` : ''),
    );
  }
  // A node the run reached is already on its step line above; one it did not reach is named here.
  for (const m of report.missingExecutors.filter((x) => !report.steps.some((s) => s.nodeId === x.nodeId))) {
    lines.push(`  ✗ ${m.nodeId} <${m.nodeType}>${m.region ? ` [${m.region}]` : ''}  NO EXECUTOR: not reached by this run, and no installed plugin runs this node type`);
  }
  for (const w of report.writes) {
    lines.push(
      `  ${w.outcome === 'written' ? '+' : '✗'} wrote ${w.operation} ${w.object}${w.ids.length ? ` ${w.ids.join(', ')}` : ''}` +
        ` (datasource ${w.datasource})` +
        (w.outcome === 'refused' ? ` REFUSED${w.code ? ` ${w.code}` : ''}${w.confined ? ': outside the ephemeral stack' : ''}` : ''),
    );
  }
  const f = report.firstFailure;
  if (f) {
    const where = f.nodeId ? ` at node '${f.nodeId}'${f.nodeType ? ` <${f.nodeType}>` : ''}` : f.trigger ? ` at trigger ${f.trigger}` : '';
    lines.push(`  first failure${where}: ${f.kind}${f.code ? ` ${f.code}` : ''} — ${clip(f.message, 300)}`);
  }
  for (const note of report.notes) lines.push(`  note: ${note}`);
  const s = report.summary;
  lines.push(
    `  ── run ${report.verdict.toUpperCase()}${report.runId ? ` (${report.runId})` : ''}: ${s.steps} step(s), ${s.failedSteps} failed, ` +
      `${s.writes} write(s), ${report.confinement.refused} refused outside the ephemeral stack; ${s.hardFailures} hard failure(s)`,
  );
  return lines.join('\n');
}
