// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowRunsPanel — run history for a flow, fetched from the automation engine
 * (`GET /api/v1/automation/{name}/runs`, the observability surface next to
 * resume/screen). Renders each run's status / start time / duration with an
 * expandable step log (the `ExecutionLog.steps` ADR-0019 / objectstack-ai/objectstack#1479 shape). Body
 * steps that ran inside a structured control-flow region — a `loop` iteration,
 * a `parallel` branch, or a `try`/`catch` handler — are nested under their
 * container node and grouped by iteration / branch (objectstack-ai/objectstack#1505), so authors can see
 * where a run paused or failed *and which iteration did it*, without leaving the
 * Studio. A step may also carry advisory `warnings` (objectstack-ai/objectstack#3407) — e.g. a write to a
 * `readonly` field the data layer legally stripped — rendered amber beneath the
 * step without demoting its `success` status.
 *
 * Degrades like the palette fetch: offline / plugin-absent / older backend →
 * a quiet "history unavailable" note, never an error state that blocks the
 * designer.
 */

import * as React from 'react';
import { useDisplayLocale } from '@object-ui/i18n';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Clock, Loader2, PauseCircle, RefreshCw, SkipForward } from 'lucide-react';
import { EmptyDescription, cn } from '@object-ui/components';
import { collectFlowGraphs } from '@objectstack/spec/automation';
import { apiBase } from './useFlowNodePalette.js';
import { t as tr, tFormat } from '../i18n.js';
import { flowNodeDisplayName } from './flow-canvas-parts.js';

/** An error on a run/step. The engine sends the run-level `error` as a plain
 *  string (`ExecutionLog.error`) while a step-level error is a `{code,message}`
 *  object — the panel accepts either shape. */
type RunError = string | { code?: string; message?: string };

/** Step entry of a run log (spec `ExecutionStepLogSchema`, fields we render). */
interface RunStep {
  nodeId: string;
  nodeType?: string;
  status: 'success' | 'failure' | 'skipped' | string;
  durationMs?: number;
  error?: RunError;
  // objectstack-ai/objectstack#1505: structured-region grouping. A step that ran inside a `loop` /
  // `parallel` / `try_catch` body region is tagged by the engine with its
  // immediate container so the panel can nest it, instead of showing the
  // container as one opaque step. Absent on top-level (main-graph) steps.
  parentNodeId?: string;
  /** Zero-based iteration of the enclosing `loop`, carried through any nesting. */
  iteration?: number;
  /** Zero-based index of the enclosing `parallel` branch (objectstack#14414). */
  branch?: number;
  /** Region kind the step ran in: `loop-body` | `parallel-branch` | `try` | `catch`. */
  regionKind?: string;
  // objectstack-ai/objectstack#3407: advisory warnings the engine attaches to an otherwise-successful step
  // — e.g. an `update_record` whose write to a `readonly` / `readonlyWhen` field
  // was legally stripped by the data layer. The step still `success`es (the strip
  // is legitimate semantics); the warning is the only signal the intended write
  // didn't land, which the server-side WARN log never surfaced in the run trace.
  warnings?: string[];
}

/** A step plus the region body steps that ran under it — the execution tree the
 *  panel renders. Reconstructed from the engine's flat, pre-order step log by
 *  {@link buildStepTree}. */
export interface StepTreeNode {
  step: RunStep;
  children: StepTreeNode[];
}

/** Run log entry (spec `ExecutionLogSchema`, fields we render). */
export interface FlowRun {
  id: string;
  status: 'completed' | 'failed' | 'paused' | 'running' | 'cancelled' | string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  trigger?: { type?: string; userId?: string; object?: string };
  steps?: RunStep[];
  error?: RunError;
}

/**
 * Normalize a run/step error to its human-readable message. The engine emits a
 * run-level `error` as a plain string but a step-level error as `{code,message}`
 * — reading `.message` off the string case silently dropped the run failure
 * reason (the whole point of the Runs panel for a failed run), so accept both.
 */
export function errorText(e: RunError | undefined | null): string | undefined {
  if (!e) return undefined;
  if (typeof e === 'string') return e || undefined;
  const m = e.message;
  return typeof m === 'string' && m ? m : undefined;
}

/**
 * Reconstruct the execution tree from the engine's flat, pre-order step log
 * (objectstack-ai/objectstack#1505). Each step carries its **immediate** structured-region container in
 * `parentNodeId`; the container's own step always precedes its body steps in the
 * array, and a whole region's steps are contiguous (the engine appends
 * `NodeExecutionResult.childSteps` in one shot). A stack walk therefore rebuilds
 * the nesting exactly, and it is robust to the two things that break naive
 * grouping: repeated `nodeId`s (a loop body node runs once per iteration) and
 * regions nested inside regions.
 *
 * Degrades safely: a step whose `parentNodeId` has no open ancestor — e.g. a
 * container step was dropped by durable-history truncation — is surfaced at the
 * top level rather than silently discarded.
 */
export function buildStepTree(steps: RunStep[]): StepTreeNode[] {
  const roots: StepTreeNode[] = [];
  const stack: StepTreeNode[] = [];
  for (const step of steps) {
    const node: StepTreeNode = { step, children: [] };
    if (step.parentNodeId == null) {
      stack.length = 0; // a top-level step closes every open region
      roots.push(node);
    } else {
      // Pop until the stack top is this step's container.
      while (stack.length > 0 && stack[stack.length - 1].step.nodeId !== step.parentNodeId) {
        stack.pop();
      }
      if (stack.length > 0) {
        stack[stack.length - 1].children.push(node);
      } else {
        roots.push(node); // container not found (truncated log) — don't lose the step
      }
    }
    stack.push(node); // every step may itself contain a nested region
  }
  return roots;
}

/** The two indexes a `parallel-branch` step is grouped and labelled by. */
export interface ParallelBranchIndex {
  /** Zero-based branch index; absent when the record carries none. */
  branch?: number;
  /** Zero-based iteration of the enclosing `loop` (the row); absent when there
   *  is no enclosing loop, or when the record never recorded it. */
  iteration?: number;
  /** `true` when the record was written by an engine that predates `branch`
   *  (see {@link parallelBranchIndex}). */
  legacy: boolean;
}

/**
 * Read a `parallel-branch` step's branch and loop row (objectui#7614).
 *
 * `iteration` has ONE meaning since objectstack#14414 (maintainer ruling A,
 * ADR-0087 entry `execution-step-iteration-single-valued`): the enclosing
 * loop's row. The branch index has its own key, `branch`, so a branch step of
 * a `parallel` inside a loop body carries both.
 *
 * A record written by an older engine is told apart by the record itself, not
 * by a date or version guess: a `parallel-branch` step with NO `branch` key.
 * The older engine's `parallel` executor tagged every branch region with
 * `iteration: i` and never wrote `branch`; since objectstack#15230 it tags
 * `branch: i`, and `runRegion`'s tagger writes `regionKind` and `branch` in the
 * same pass, so it cannot emit a `parallel-branch` step without `branch`. That
 * reading of the objectstack engine was taken when this was written; nothing in
 * this repository re-derives it. The spec alone would not decide it:
 * `ExecutionStepLogSchema` declares `branch` optional, with nothing tying it to
 * `regionKind`.
 *
 * Such a legacy step is read the way it was written: its `iteration` is the
 * BRANCH index, and its loop row is unknown (the older engine discarded it). It
 * is never read as a row and never defaulted to branch 0. This is the legacy
 * rule the ADR-0087 entry's acceptance criteria name.
 */
export function parallelBranchIndex(step: RunStep): ParallelBranchIndex {
  if (step.branch == null) return { branch: step.iteration, legacy: true };
  return { branch: step.branch, iteration: step.iteration, legacy: false };
}

/**
 * Human label for a body step's enclosing region (objectstack-ai/objectstack#1505). `loop-body` carries a
 * zero-based `iteration`, `parallel-branch` a zero-based `branch` plus the
 * enclosing loop's `iteration` when it has one (read by
 * {@link parallelBranchIndex}), each surfaced 1-based; `try`/`catch` carry only
 * the region kind. Returns `null` for a top-level step (no region grouping).
 */
export function regionLabel(step: RunStep, locale?: string): string | null {
  const { regionKind, iteration } = step;
  if (!regionKind) return null;
  switch (regionKind) {
    case 'loop-body':
      return iteration == null
        ? tr('engine.flowRuns.iteration', locale)
        : tFormat('engine.flowRuns.iterationN', locale, { n: iteration + 1 });
    case 'parallel-branch': {
      const idx = parallelBranchIndex(step);
      if (idx.branch == null) return tr('engine.flowRuns.branch', locale);
      return idx.iteration == null
        ? tFormat('engine.flowRuns.branchN', locale, { n: idx.branch + 1 })
        : tFormat('engine.flowRuns.branchNIterationM', locale, { n: idx.branch + 1, m: idx.iteration + 1 });
    }
    case 'try':
      return tr('engine.flowRuns.try', locale);
    case 'catch':
      return tr('engine.flowRuns.catch', locale);
    default:
      return iteration == null ? regionKind : `${regionKind} ${iteration + 1}`;
  }
}

/** Grouping key so consecutive body steps of the same iteration/branch/handler
 *  share one header. A `parallel-branch` step keys on its branch AND, when it
 *  has one, its loop row (objectui#7614); every other region keys on
 *  `iteration`. */
function regionSignature(step: RunStep): string {
  if (step.regionKind === 'parallel-branch') {
    const { branch, iteration, legacy } = parallelBranchIndex(step);
    return `parallel-branch#${legacy ? 'legacy:' : ''}branch=${branch ?? ''}#iteration=${iteration ?? ''}`;
  }
  return `${step.regionKind ?? ''}#${step.iteration ?? ''}`;
}

/** Split a container's children into consecutive runs that share a region label
 *  (an iteration, a branch, a try/catch handler), so each gets one header.
 *  Exposed for tests. */
export function groupChildren(children: StepTreeNode[], locale?: string): { label: string | null; items: StepTreeNode[] }[] {
  const groups: { label: string | null; items: StepTreeNode[] }[] = [];
  let sig: string | undefined;
  for (const child of children) {
    const s = regionSignature(child.step);
    if (groups.length === 0 || s !== sig) {
      groups.push({ label: regionLabel(child.step, locale), items: [child] });
      sig = s;
    } else {
      groups[groups.length - 1].items.push(child);
    }
  }
  return groups;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

/** Fetch a flow's run history. Exposed for tests. */
export async function fetchFlowRuns(flowName: string, signal?: AbortSignal): Promise<FlowRun[] | null> {
  try {
    const res = await fetch(
      `${apiBase()}/automation/${encodeURIComponent(flowName)}/runs?limit=25`,
      { credentials: 'include', headers: { 'Content-Type': 'application/json' }, signal },
    );
    if (!res.ok) return null; // 404/501 — plugin absent or older backend
    const payload = (await res.json()) as { data?: { runs?: FlowRun[] }; runs?: FlowRun[] };
    const runs = payload?.data?.runs ?? payload?.runs;
    return Array.isArray(runs) ? runs : null;
  } catch {
    return null; // offline / aborted
  }
}

const STATUS_META: Record<string, { icon: React.ComponentType<{ className?: string }>; cls: string; labelKey: string }> = {
  completed: { icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-400', labelKey: 'engine.flowRuns.status.completed' },
  failed: { icon: AlertCircle, cls: 'text-rose-600 dark:text-rose-400', labelKey: 'engine.flowRuns.status.failed' },
  paused: { icon: PauseCircle, cls: 'text-amber-600 dark:text-amber-400', labelKey: 'engine.flowRuns.status.paused' },
  running: { icon: Loader2, cls: 'text-sky-600 dark:text-sky-400', labelKey: 'engine.flowRuns.status.running' },
  cancelled: { icon: SkipForward, cls: 'text-muted-foreground', labelKey: 'engine.flowRuns.status.cancelled' },
};

/** Resolve a run status to its icon, tone and localized label. Unknown statuses
 *  fall back to the raw status string (no key). */
/** Node id → the name the designer gives that node, at every depth. */
type NodeNames = ReadonlyMap<string, string>;

/**
 * The name of every node of the flow, at every depth: a body step runs a
 * region's node, so the walk is the spec's `collectFlowGraphs`. Each name is
 * {@link flowNodeDisplayName}'s (objectui#13143). A step whose node is not in
 * the flow any more (deleted since the run) has no name here and reads as its
 * id.
 */
function flowNodeNames(nodes: readonly unknown[] | undefined, locale?: string): NodeNames {
  const names = new Map<string, string>();
  if (!nodes?.length) return names;
  const graphs = collectFlowGraphs({ nodes, edges: [] } as Parameters<typeof collectFlowGraphs>[0]);
  for (const graph of graphs) {
    for (const node of graph.nodes) {
      if (typeof node.id === 'string' && node.id && !names.has(node.id)) names.set(node.id, flowNodeDisplayName(node, locale));
    }
  }
  return names;
}

function statusMeta(status: string, locale?: string) {
  const meta = STATUS_META[status];
  if (meta) return { icon: meta.icon, cls: meta.cls, label: tr(meta.labelKey, locale) };
  return { icon: Clock, cls: 'text-muted-foreground', label: status };
}

/**
 * `displayLocale` is the session's DISPLAY locale (`useDisplayLocale()`), not
 * the `locale` the rows thread for their UI strings. The bare
 * `toLocaleString()` this replaced used the MACHINE's locale (objectui#9909).
 */
function fmtTime(iso: string | undefined, displayLocale: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(displayLocale);
}

function fmtDuration(ms?: number): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

function StepRow({ step, depth = 0, names }: { step: RunStep; depth?: number; names: NodeNames }) {
  const cls =
    step.status === 'success'
      ? 'text-emerald-600 dark:text-emerald-400'
      : step.status === 'failure'
        ? 'text-rose-600 dark:text-rose-400'
        : 'text-muted-foreground';
  const stepErr = errorText(step.error);
  // objectstack-ai/objectstack#3407: advisory warnings are amber and never recolor the status — a step
  // that legally stripped a write is still a `success`, just not silent. The
  // status badge keeps its tone; the ⚠ marker and the amber sub-lines below
  // carry the "your write didn't fully land" signal.
  const warnings = Array.isArray(step.warnings)
    ? step.warnings.filter((w): w is string => typeof w === 'string' && w.length > 0)
    : [];
  return (
    <>
      <li className="flex items-baseline gap-1.5 py-0.5" style={depth ? { paddingLeft: depth * 12 } : undefined}>
        <span className={cn('shrink-0 text-[9px] font-semibold uppercase', cls)}>{step.status}</span>
        <span className="truncate font-mono text-[10px]" title={step.nodeId}>{names.get(step.nodeId) ?? step.nodeId}</span>
        {step.nodeType && <span className="shrink-0 text-[9px] uppercase text-muted-foreground">{step.nodeType}</span>}
        {warnings.length > 0 && (
          <AlertTriangle aria-hidden className="h-2.5 w-2.5 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        {fmtDuration(step.durationMs) && (
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">{fmtDuration(step.durationMs)}</span>
        )}
        {stepErr && (
          <span className="min-w-0 truncate text-[9px] text-rose-600" title={stepErr}>
            {stepErr}
          </span>
        )}
      </li>
      {warnings.map((w, i) => (
        <li
          key={i}
          className="flex items-baseline gap-1 py-0.5 text-amber-700 dark:text-amber-400"
          style={{ paddingLeft: (depth + 1) * 12 }}
        >
          <AlertTriangle aria-hidden className="h-2.5 w-2.5 shrink-0 self-center" />
          <span className="min-w-0 break-words text-[9px]" title={w}>
            {w}
          </span>
        </li>
      ))}
    </>
  );
}

/** Header for a run of body steps in one iteration / branch / try-catch handler. */
function RegionHeader({ label, depth }: { label: string; depth: number }) {
  return (
    <li
      className="flex items-center gap-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80"
      style={{ paddingLeft: depth * 12 }}
    >
      <span aria-hidden className="text-muted-foreground/50">
        ↳
      </span>
      {label}
    </li>
  );
}

/** Render a step and, nested beneath it, its structured-region body steps —
 *  grouped by iteration / branch / handler (objectstack-ai/objectstack#1505). Recurses for nested regions. */
function StepNode({ node, depth, locale, names }: { node: StepTreeNode; depth: number; locale?: string; names: NodeNames }) {
  const groups = node.children.length > 0 ? groupChildren(node.children, locale) : [];
  return (
    <>
      <StepRow step={node.step} depth={depth} names={names} />
      {groups.map((g, gi) => (
        <React.Fragment key={gi}>
          {g.label != null && <RegionHeader label={g.label} depth={depth + 1} />}
          {g.items.map((child, ci) => (
            <StepNode
              key={`${child.step.nodeId}#${ci}`}
              node={child}
              depth={g.label != null ? depth + 2 : depth + 1}
              locale={locale}
              names={names}
            />
          ))}
        </React.Fragment>
      ))}
    </>
  );
}

function RunRow({ run, locale, names }: { run: FlowRun; locale?: string; names: NodeNames }) {
  const displayLocale = useDisplayLocale();
  const [open, setOpen] = React.useState(false);
  const meta = statusMeta(run.status, locale);
  const Icon = meta.icon;
  const steps = Array.isArray(run.steps) ? run.steps : [];
  const runErr = errorText(run.error);
  return (
    <li className="rounded border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 p-1.5 text-left"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
        )}
        <Icon className={cn('h-3.5 w-3.5 shrink-0', meta.cls, run.status === 'running' && 'animate-spin')} />
        <span className={cn('shrink-0 text-[10px] font-semibold', meta.cls)}>{meta.label}</span>
        <span className="min-w-0 truncate text-[10px] text-muted-foreground" title={run.id}>
          {fmtTime(run.startedAt, displayLocale)}
        </span>
        {fmtDuration(run.durationMs) && (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{fmtDuration(run.durationMs)}</span>
        )}
      </button>
      {open && (
        <div className="border-t px-2 py-1.5">
          <div className="pb-1 font-mono text-[9px] text-muted-foreground" title={run.id}>
            {tFormat('engine.flowRuns.runId', locale, { id: run.id })}
            {run.trigger?.type && ` · ${tFormat('engine.flowRuns.trigger', locale, { type: run.trigger.type })}`}
          </div>
          {runErr && (
            <div className="pb-1 text-[10px] text-rose-600">{runErr}</div>
          )}
          {steps.length === 0 ? (
            <EmptyDescription className="text-[10px] italic">{tr('engine.flowRuns.noSteps', locale)}</EmptyDescription>
          ) : (
            <ul>
              {buildStepTree(steps).map((node, i) => (
                <StepNode key={`${node.step.nodeId}#${i}`} node={node} depth={0} locale={locale} names={names} />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

export function FlowRunsPanel({
  flowName,
  nodes,
  locale,
}: {
  flowName: string;
  /** The flow's `nodes`, so a step reads by its node's name (objectui#13143). */
  nodes?: readonly unknown[];
  locale?: string;
}) {
  const names = React.useMemo(() => flowNodeNames(nodes, locale), [nodes, locale]);
  const [runs, setRuns] = React.useState<FlowRun[]>([]);
  const [state, setState] = React.useState<LoadState>('loading');
  const [reloadKey, setReloadKey] = React.useState(0);

  React.useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    setState('loading');
    (async () => {
      const result = await fetchFlowRuns(flowName, controller.signal);
      if (!alive) return;
      if (result === null) setState('unavailable');
      else {
        setRuns(result);
        setState('ready');
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [flowName, reloadKey]);

  return (
    <div className="flex h-full flex-col p-3 text-xs">
      <div className="flex items-center gap-1.5 pb-2 font-medium text-muted-foreground">
        <Clock className="h-3 w-3" /> {tr('engine.flowRuns.title', locale)}
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          title={tr('engine.flowRuns.refresh', locale)}
          aria-label={tr('engine.flowRuns.refresh', locale)}
          className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
        >
          <RefreshCw className={cn('h-3 w-3', state === 'loading' && 'animate-spin')} />
        </button>
      </div>
      {state === 'unavailable' ? (
        <div className="italic text-muted-foreground">
          {tr('engine.flowRuns.unavailable', locale)}
        </div>
      ) : state === 'ready' && runs.length === 0 ? (
        <EmptyDescription className="text-xs italic">{tr('engine.flowRuns.empty', locale)}</EmptyDescription>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto">
          {runs.map((r) => (
            <RunRow key={r.id} run={r} locale={locale} names={names} />
          ))}
        </ul>
      )}
    </div>
  );
}
