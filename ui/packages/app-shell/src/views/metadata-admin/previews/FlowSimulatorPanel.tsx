// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowSimulatorPanel — the designer-time debug runner UI. Drives a
 * `FlowSimulator` (pure engine) and lifts its highlight state up so the canvas
 * can paint the active node / traversed edges. Side effects are mocked; the
 * panel only collects the flow's input variables as the run seed.
 */

import * as React from 'react';
import { Play, StepForward, RotateCcw, ChevronRight, AlertTriangle, CircleAlert, Plus, Trash2 } from 'lucide-react';
import { Button, EmptyDescription, Input, Label, cn } from '@object-ui/components';
import { t as tr, tFormat } from '../i18n.js';
import { FlowSimulator } from './simulator/flow-simulator.js';
import { flowNodeDisplayName } from './flow-canvas-parts.js';
import { ScreenPreview } from './ScreenPreview.js';
import type { FlowValidation, SimEdge, SimNode, SimState, SimStep } from './simulator/flow-sim-types.js';

export interface FlowVariableDecl {
  name: string;
  type?: string;
  defaultValue?: unknown;
  isInput?: boolean;
}

export interface FlowSimulatorPanelProps {
  nodes: SimNode[];
  edges: SimEdge[];
  variables: FlowVariableDecl[];
  /** UI locale for the panel's labels and hints. */
  locale?: string;
  onRunStateChange?: (s: { activeNodeId: string | null; visitedNodeIds: string[]; traversedEdgeIds: string[] } | null) => void;
}

/** Coerce a free-text seed value: number / boolean / JSON object|array / string. */
function parseSeed(raw: string): unknown {
  const s = raw.trim();
  if (s === '') return undefined;
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'))) {
    try {
      return JSON.parse(s);
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Node types whose side effects are mocked — authors can pin their output. */
const MOCKABLE = new Set([
  'create_record',
  'update_record',
  'delete_record',
  'get_record',
  'http',
  'connector_action',
  'script',
]);

/** A side-effect node the author can supply a mock result for. */
interface MockableNode {
  id: string;
  label: string;
  type: string;
  /** Variable name(s) this node writes, for the field hint. */
  outputs: string[];
}

function mockableNodes(nodes: SimNode[], locale?: string): MockableNode[] {
  const out: MockableNode[] = [];
  for (const n of nodes) {
    if (!MOCKABLE.has(n.type)) continue;
    const cfg = (n.config ?? {}) as Record<string, unknown>;
    const outputs: string[] = [];
    // Singular only — the engine never binds the script node's legacy
    // `outputVariables` list (framework#4278), so the simulator no longer
    // pretends it does.
    if (typeof cfg.outputVariable === 'string' && cfg.outputVariable) outputs.push(cfg.outputVariable);
    out.push({ id: n.id, label: flowNodeDisplayName(n, locale), type: n.type, outputs });
  }
  return out;
}

const STATUS_TONE: Record<SimStep['status'], string> = {
  ok: 'bg-emerald-100 text-emerald-700',
  mocked: 'bg-violet-100 text-violet-700',
  paused: 'bg-amber-100 text-amber-700',
  skipped: 'bg-zinc-100 text-zinc-600',
  error: 'bg-rose-100 text-rose-700',
};

export function FlowSimulatorPanel({ nodes, edges, variables, locale, onRunStateChange }: FlowSimulatorPanelProps) {
  const simRef = React.useRef<FlowSimulator | null>(null);
  const [snapshot, setSnapshot] = React.useState<SimState | null>(null);
  const [validation, setValidation] = React.useState<FlowValidation | null>(null);
  const inputs = React.useMemo(() => variables.filter((v) => v.isInput), [variables]);
  const mockNodes = React.useMemo(() => mockableNodes(nodes, locale), [nodes, locale]);
  // objectui#13242 — an unguarded out-edge's row names its target by the rule;
  // its id only where no node answers to it.
  const targetName = (id: string): string => {
    const node = nodes.find((n) => n.id === id);
    return node ? flowNodeDisplayName(node, locale) : id;
  };
  const [seed, setSeed] = React.useState<Record<string, string>>({});
  /** Free-form variable overrides so any branch can be exercised (e.g. a
   * decision that reads a computed value no input declares). */
  const [scratch, setScratch] = React.useState<{ k: string; v: string }[]>([]);
  /** Per-node mock outputs, keyed by node id (raw text, parsed on run). */
  const [mocks, setMocks] = React.useState<Record<string, string>>({});

  const sync = React.useCallback(() => {
    const sim = simRef.current;
    if (!sim) return;
    const st = sim.state;
    setSnapshot({
      ...st,
      steps: [...st.steps],
      variables: { ...st.variables },
      frontier: [...st.frontier],
      visitedNodeIds: [...st.visitedNodeIds],
      traversedEdgeIds: [...st.traversedEdgeIds],
    });
    onRunStateChange?.({
      activeNodeId: st.activeNodeId,
      visitedNodeIds: [...st.visitedNodeIds],
      traversedEdgeIds: [...st.traversedEdgeIds],
    });
  }, [onRunStateChange]);

  const buildSeed = React.useCallback((): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const v of inputs) {
      const raw = seed[v.name];
      const parsed = raw != null ? parseSeed(raw) : undefined;
      out[v.name] = parsed !== undefined ? parsed : v.defaultValue;
    }
    // Scratch overrides win — they let an author drive any branch.
    for (const row of scratch) {
      const key = row.k.trim();
      if (key) out[key] = parseSeed(row.v);
    }
    return out;
  }, [inputs, seed, scratch]);

  const buildMocks = React.useCallback((): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [id, raw] of Object.entries(mocks)) {
      if (raw != null && raw.trim() !== '') out[id] = parseSeed(raw);
    }
    return out;
  }, [mocks]);

  const reset = React.useCallback(() => {
    const sim = new FlowSimulator(nodes, edges, locale);
    simRef.current = sim;
    setValidation(sim.reset(buildSeed(), buildMocks()));
    sync();
  }, [nodes, edges, buildSeed, buildMocks, sync, locale]);

  const ensure = React.useCallback(() => {
    if (!simRef.current) reset();
    return simRef.current!;
  }, [reset]);

  const onRun = () => {
    // A paused run (wait / screen) continues from where it halted. Any other
    // state — fresh, done, or errored — starts a clean run that re-seeds with
    // the current Set-variables and Mock-outputs editors, so editing them and
    // pressing Run again always reflects the new values.
    let sim = simRef.current;
    if (sim && sim.state.status === 'paused') {
      // An approval pause needs an explicit decision (use the branch buttons);
      // blind-resuming would fan out to every branch — so leave it for the user.
      if (sim.state.pausedReason === 'approval') { sync(); return; }
      sim.resume();
    } else {
      reset();
      sim = simRef.current!;
    }
    sim.runToEnd();
    sync();
  };
  const onStep = () => {
    const sim = ensure();
    sim.step();
    sync();
  };
  const onResume = () => onDecision();
  /** Continue a paused run; `decision` routes an approval down one out-edge. */
  const onDecision = (decision?: string) => {
    const sim = ensure();
    sim.resume(decision ? { decision } : {});
    sim.runToEnd();
    sync();
  };
  const onReset = () => {
    simRef.current = null;
    setSnapshot(null);
    setValidation(null);
    onRunStateChange?.(null);
  };

  const status = snapshot?.status ?? 'idle';
  const blocked = (validation?.errors.length ?? 0) > 0;

  // When the run pauses at a `screen` node, preview the form the end user would
  // see (the shared runtime renderer) instead of just showing "paused".
  const screenPause = React.useMemo(() => {
    if (snapshot?.status !== 'paused' || snapshot.pausedReason !== 'screen' || !snapshot.activeNodeId) return null;
    const node = nodes.find((n) => n.id === snapshot.activeNodeId);
    return node ? { node, variables: snapshot.variables } : null;
  }, [snapshot, nodes]);

  // When paused at an approval node, offer its out-edge labels (approve /
  // reject / revise) as decision buttons so the run resumes down ONE branch —
  // letting an author walk a revise loop instead of fanning out to every edge.
  const approvalPause = React.useMemo(() => {
    if (snapshot?.status !== 'paused' || snapshot.pausedReason !== 'approval' || !snapshot.activeNodeId) return null;
    const node = nodes.find((n) => n.id === snapshot.activeNodeId);
    if (!node) return null;
    const decisions = [
      ...new Set(
        edges
          .filter((e) => e.source === node.id && typeof e.label === 'string' && (e.label as string).trim())
          .map((e) => (e.label as string).trim()),
      ),
    ];
    return { node, decisions };
  }, [snapshot, nodes, edges]);

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-1.5 border-b bg-muted/30 px-3 py-2">
        <Button size="sm" className="h-7 gap-1 px-2" onClick={onRun} disabled={blocked}>
          <Play className="h-3.5 w-3.5" /> {tr('engine.flowSim.run', locale)}
        </Button>
        <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={onStep} disabled={blocked || status === 'done' || status === 'error'}>
          <StepForward className="h-3.5 w-3.5" /> {tr('engine.flowSim.step', locale)}
        </Button>
        {status === 'paused' &&
          (approvalPause && approvalPause.decisions.length > 0 ? (
            <div className="flex items-center gap-1">
              {approvalPause.decisions.map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 px-2 capitalize"
                  onClick={() => onDecision(d)}
                  title={tFormat('engine.flowSim.resumeBranch', locale, { branch: d })}
                >
                  <ChevronRight className="h-3.5 w-3.5" /> {d}
                </Button>
              ))}
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-7 gap-1 px-2" onClick={onResume}>
              <ChevronRight className="h-3.5 w-3.5" /> {tr('engine.flowSim.continue', locale)}
            </Button>
          ))}
        <Button size="sm" variant="ghost" className="h-7 gap-1 px-2 text-muted-foreground" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" /> {tr('engine.flowSim.reset', locale)}
        </Button>
        <span className={cn('ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', STATUS_TONE[status === 'idle' || status === 'running' ? 'ok' : (status as SimStep['status'])] ?? 'bg-muted')}>
          {tr(`engine.flowSim.status.${status}`, locale)}
        </span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {/* Validation diagnostics */}
        {validation && (validation.errors.length > 0 || validation.warnings.length > 0) && (
          <div className="space-y-1">
            {validation.errors.map((d, i) => (
              <div key={`e${i}`} className="flex items-start gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
                <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{d.message}</span>
              </div>
            ))}
            {validation.warnings.map((d, i) => (
              <div key={`w${i}`} className="flex items-start gap-1.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>{d.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Paused at a screen — render the end-user form the runtime would show. */}
        {screenPause && (
          <section className="space-y-1.5">
            <div className="font-medium text-muted-foreground">{tr('engine.flowSim.screen', locale)}</div>
            <ScreenPreview node={screenPause.node} variables={screenPause.variables} locale={locale} />
          </section>
        )}

        {/* Seed inputs */}
        {inputs.length > 0 && (
          <section className="space-y-1.5">
            <div className="font-medium text-muted-foreground">{tr('engine.flowSim.inputs', locale)}</div>
            {inputs.map((v) => (
              <div key={v.name} className="flex items-center gap-2">
                <Label className="w-24 shrink-0 truncate font-mono text-[11px]" title={v.name}>{v.name}</Label>
                <Input
                  value={seed[v.name] ?? (v.defaultValue != null ? String(v.defaultValue) : '')}
                  onChange={(e) => setSeed((p) => ({ ...p, [v.name]: e.target.value }))}
                  placeholder={v.type ?? tr('engine.flowSim.valuePlaceholder', locale)}
                  className="h-7 flex-1 text-xs"
                />
              </div>
            ))}
          </section>
        )}

        {/* Scratch variables — set/override any variable to drive a branch a
            declared input cannot reach (e.g. a computed value a decision reads). */}
        <section className="space-y-1.5">
          <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
            <span>{tr('engine.flowSim.setVariables', locale)}</span>
            <button
              type="button"
              className="ml-auto inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] hover:bg-muted/50"
              onClick={() => setScratch((p) => [...p, { k: '', v: '' }])}
            >
              <Plus className="h-3 w-3" /> {tr('engine.flowSim.add', locale)}
            </button>
          </div>
          {scratch.length === 0 ? (
            <EmptyDescription className="text-xs italic">{tr('engine.flowSim.setVariablesHint', locale)}</EmptyDescription>
          ) : (
            scratch.map((row, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <Input
                  value={row.k}
                  onChange={(e) => setScratch((p) => p.map((r, j) => (j === i ? { ...r, k: e.target.value } : r)))}
                  placeholder={tr('engine.flowSim.namePlaceholder', locale)}
                  className="h-7 w-24 shrink-0 font-mono text-[11px]"
                />
                <span className="text-muted-foreground">=</span>
                <Input
                  value={row.v}
                  onChange={(e) => setScratch((p) => p.map((r, j) => (j === i ? { ...r, v: e.target.value } : r)))}
                  placeholder={tr('engine.flowSim.valuePlaceholder', locale)}
                  className="h-7 flex-1 text-xs"
                />
                <button
                  type="button"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted/50 hover:text-rose-600"
                  onClick={() => setScratch((p) => p.filter((_, j) => j !== i))}
                  aria-label={tr('engine.flowSim.removeVariable', locale)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </section>

        {/* Per-node mock outputs — what each mocked side effect "returns". */}
        {mockNodes.length > 0 && (
          <section className="space-y-1.5">
            <div className="font-medium text-muted-foreground">{tr('engine.flowSim.mockOutputs', locale)}</div>
            {mockNodes.map((m) => (
              <div key={m.id} className="space-y-0.5">
                <Label className="flex items-baseline gap-1.5 text-[11px]" title={m.id}>
                  <span className="truncate font-medium">{m.label}</span>
                  <span className="text-[9px] uppercase text-muted-foreground">{m.type.replace(/_/g, ' ')}</span>
                  {m.outputs.length > 0 && (
                    <span className="truncate font-mono text-[10px] text-violet-600">→ {m.outputs.join(', ')}</span>
                  )}
                </Label>
                <Input
                  value={mocks[m.id] ?? ''}
                  onChange={(e) => setMocks((p) => ({ ...p, [m.id]: e.target.value }))}
                  placeholder={m.type === 'script' && m.outputs.length ? `{ "${m.outputs[0]}": … }` : tr('engine.flowSim.mockPlaceholder', locale)}
                  className="h-7 w-full font-mono text-[11px]"
                />
              </div>
            ))}
          </section>
        )}

        {/* Variable watch */}
        {snapshot && (
          <section className="space-y-1.5">
            <div className="font-medium text-muted-foreground">{tr('engine.flowSim.variables', locale)}</div>
            {Object.keys(snapshot.variables).length === 0 ? (
              <EmptyDescription className="text-xs italic">{tr('engine.flowSim.noVars', locale)}</EmptyDescription>
            ) : (
              <ul className="space-y-1">
                {Object.entries(snapshot.variables).map(([k, val]) => (
                  <li key={k} className="flex items-baseline gap-1.5 rounded border bg-background px-1.5 py-1">
                    <span className="font-mono text-[11px]">{k}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground">
                      = {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Step timeline */}
        {snapshot && snapshot.steps.length > 0 && (
          <section className="space-y-1.5">
            <div className="font-medium text-muted-foreground">{tr('engine.flowSim.timeline', locale)}</div>
            <ol className="space-y-1">
              {snapshot.steps.map((s) => (
                <li key={s.seq} className="rounded border bg-background p-1.5">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground">{s.seq + 1}</span>
                    <span className="truncate font-medium">{s.label}</span>
                    <span className="text-[10px] uppercase text-muted-foreground">{s.type}</span>
                    <span className={cn('ml-auto rounded px-1 py-0.5 text-[9px] font-semibold uppercase', STATUS_TONE[s.status])}>
                      {tr(`engine.flowSim.stepStatus.${s.status}`, locale)}
                    </span>
                  </div>
                  {s.note && <div className="mt-0.5 text-[10px] text-muted-foreground">{s.note}</div>}
                  {s.error && <div className="mt-0.5 text-[10px] text-rose-600">{s.error}</div>}
                  {s.wrote && (
                    <div className="mt-0.5 truncate font-mono text-[10px] text-violet-600">
                      → {Object.keys(s.wrote).join(', ')}
                    </div>
                  )}
                  {s.edges && s.edges.length > 0 && (
                    <ul className="mt-0.5 space-y-0.5">
                      {s.edges.map((ed) => (
                        <li key={ed.edgeId} className="space-y-0.5">
                          <div className={cn('flex items-center gap-1 font-mono text-[10px]', ed.selected ? 'text-sky-700' : 'text-muted-foreground')}>
                            <span>{ed.selected ? '▶' : '·'}</span>
                            {/* An unguarded out-edge has no condition text: name it by its target (objectui#10692). */}
                            <span className="truncate">{ed.isDefault ? 'else' : (ed.condition ?? `→ ${targetName(ed.target)}`)}</span>
                            {/* `true` / `false` are the guard's CEL value, printed on the row's code line like the condition beside it. */}
                            <span className={cn('ml-auto', ed.error && 'text-rose-600')}>
                              {ed.error ? tr('engine.flowSim.edge.error', locale) : ed.result ? 'true' : 'false'}
                            </span>
                          </div>
                          {ed.error && <div className="pl-3 text-[10px] text-rose-600">{ed.error}</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          </section>
        )}

        {!snapshot && !blocked && (
          <p className="italic text-muted-foreground">{tr('engine.flowSim.idleHint', locale)}</p>
        )}
      </div>
    </div>
  );
}
