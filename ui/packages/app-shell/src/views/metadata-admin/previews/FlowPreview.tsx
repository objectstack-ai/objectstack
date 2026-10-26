// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FlowPreview — read-only summary of a Flow metadata draft.
 *
 * A full DAG canvas lives in `@object-ui/plugin-designer` and would
 * pull in ReactFlow + its deps every time the metadata-admin loads,
 * which is too heavy for a glance-preview. Instead we render:
 *
 *   1. A header strip with trigger / status / runAs / version — the trigger
 *      the Start node declares, and the status the deployment reports
 *      (objectui#11779).
 *   2. A topologically ordered step list inferred from `nodes` +
 *      `edges`. Each step shows label, action type, branch markers,
 *      and outgoing edge conditions so authors can sanity-check the
 *      logic without launching the designer.
 *   3. A variables side panel listing declared flow variables.
 *
 * The renderer is defensive — drafts may be mid-edit with dangling
 * edges or duplicate node ids; we never throw, we just degrade.
 */

import * as React from 'react';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';
import {
  AlertCircle,
  Bug,
  CircleDot,
  GitBranch,
  History,
  PanelRight,
  Plus,
  Settings2,
  Variable,
  Zap,
} from 'lucide-react';
import { EmptyDescription } from '@object-ui/components';
import type { MetadataPreviewProps, MetadataSelection } from '../preview-registry.js';
import { PreviewShell, PreviewMessage, PreviewErrorBoundary } from './PreviewShell.js';
import { appendArray } from '../inspectors/_shared.js';
import { useObjectCatalog, type ObjectCatalogEntry } from '../inspectors/ObjectPicker.js';
import { t as tr, translateFlowMeta } from '../i18n.js';
import { FlowCanvas } from './FlowCanvas.js';
import { defaultNodeLabel, flowEdgeDisplayName, flowNodeDisplayName } from './flow-canvas-parts.js';
import { edgeKey, type FlowDesignerEdge, type FlowDesignerNode } from './flow-canvas-layout.js';
import { NESTED_NODE_KIND, parseNestedNodeId, encodeNestedNodeId, locateFlowNode } from '../inspectors/flow-nested-selection.js';
import { FlowSimulatorPanel } from './FlowSimulatorPanel.js';
import { FlowRunsPanel } from './FlowRunsPanel.js';
import { ProblemsPanel } from './ProblemsPanel.js';
import {
  FlowRegistrationContext,
  FlowRuntimeContext,
  buildFlowProblems,
  deriveFlowRunStatus,
  deriveInvalidElements,
  describeFlowRunStatus,
  freshNodeId,
  type FlowProblem,
  type FlowRunStatus,
  type FlowRunStatusView,
} from './flow-problems.js';
import { useConnectorRegistry } from '../inspectors/connector-input-fields.js';
import { hasCommittedConnectorAction } from '../inspectors/flow-scope.js';
import { fieldsForNodeType, localizeFlowFields } from '../inspectors/flow-node-config.js';

/**
 * This preview reads the draft's nodes and edges and hands them straight to
 * {@link FlowCanvas}, so it reads them as the canvas's own types rather than
 * restating the shapes. It used to restate both — the edge including a
 * `condition` typed `string | { source?: string }`, an envelope the spec's
 * `FlowEdgeSchema` rejects for want of `dialect`; the node including a
 * `ui?: { x?: number; y?: number }` geometry key the spec's `.strict()`
 * `FlowNodeSchema` rejects outright (objectui#3172). Two copies of one shape is
 * how the wrong one survives being fixed (objectui#3202).
 */
type FlowNode = FlowDesignerNode;
type FlowEdge = FlowDesignerEdge;

/** The sections a host's tab row offers over one flow (objectui#12454). */
export type FlowPreviewSection = 'canvas' | 'variables' | 'runs' | 'problems' | 'debug';

/** The problem count a host's Problems tab carries: all of them, and how many are errors. */
export interface FlowProblemTally {
  count: number;
  errors: number;
}

/**
 * Host chrome for the flow preview (objectui#12454).
 *
 * A host whose own item header already carries the flow's meta and a tab row
 * over {@link FlowPreviewSection} — the Studio's Automations pillar — provides
 * this. The preview then draws no info bar and no frame of its own, and shows
 * the section the host's tab row has open: the canvas; the variables, the run
 * history or the problem list as the section's body; or the canvas with the
 * debug simulator beside it, since the simulator paints its run on the canvas.
 *
 * Without it — the metadata-admin designer, which has no item header — the
 * preview is as it was: its info bar holds the meta pills and the Variables,
 * Runs, Problems and Debug buttons, each opening a panel beside the canvas.
 */
export interface FlowPreviewChrome {
  section: FlowPreviewSection;
  /** Open a section. Picking a problem in the Problems body opens the canvas on the element it reveals. */
  onSectionChange: (section: FlowPreviewSection) => void;
  /**
   * Receives the problem tally for the host's Problems tab. Called from an
   * effect keyed on the tally's numbers and on this function, so hand in a
   * state setter (whose identity React keeps), never a fresh closure.
   */
  onProblemsChange: (tally: FlowProblemTally) => void;
}

const FlowPreviewChromeContext = React.createContext<FlowPreviewChrome | null>(null);

/** Provides {@link FlowPreviewChrome} to the flow preview below it. */
export function FlowPreviewChromeProvider({ value, children }: { value: FlowPreviewChrome; children?: React.ReactNode }) {
  return <FlowPreviewChromeContext.Provider value={value}>{children}</FlowPreviewChromeContext.Provider>;
}

/**
 * objectui#12488 — what a host's own inspector header says for a flow
 * selection, when it frames the flow inspectors itself (Studio's Configuration
 * aside, under `InspectorShellHostProvider`): the eyebrow names the kind — a
 * node with its type's display name ("Node · Decision"), or a connection — and
 * the title is the one the inspector's own header would show (the node's label
 * or id; the connection's `source → target`, each end by its node's name).
 */
export function flowSelectionHeading(
  draft: Record<string, unknown>,
  selection: MetadataSelection,
  locale?: string,
): { eyebrow: string; title: string } {
  if (selection.kind === 'edge') {
    const edges = Array.isArray(draft.edges) ? (draft.edges as FlowDesignerEdge[]) : [];
    const edge = edges.find((e, i) => edgeKey(e, i) === selection.id);
    return {
      eyebrow: tr('engine.inspector.flowEdge.kind', locale),
      // Each end by its node's name (objectui#13143), read off the edge, as
      // `FlowEdgeInspector` titles it.
      title: edge
        ? flowEdgeDisplayName(edge, Array.isArray(draft.nodes) ? draft.nodes : [], locale)
        : (selection.label ?? selection.id),
    };
  }
  const kind = tr('engine.inspector.flowNode.kind', locale);
  const node = locateFlowNode(draft, selection)?.node;
  if (!node) {
    const nested = selection.kind === NESTED_NODE_KIND ? parseNestedNodeId(selection.id) : null;
    return { eyebrow: kind, title: selection.label ?? nested?.nodeId ?? selection.id };
  }
  const type = typeof node.type === 'string' ? node.type : '';
  return {
    eyebrow: type ? `${kind} · ${defaultNodeLabel(type, locale)}` : kind,
    title: (typeof node.label === 'string' && node.label) || node.id,
  };
}

/**
 * The header's Trigger pill (objectui#11779): the trigger the engine arms this
 * flow on, read from its Start node by the spec's own resolver
 * (`resolveFlowTriggerKind`, the authoring-time mirror of the engine's binding
 * resolution, in the engine's precedence). The flow-level `type` used to be
 * shown instead, so a record-triggered flow read "autolaunched".
 *
 *   - a record trigger reads as its event (the Start node's `triggerType`, e.g.
 *     "Record updated"), with the object it watches;
 *   - a time-relative sweep reads as one, with the object it sweeps;
 *   - a schedule (a `schedule` cadence on the Start node, or `type: 'schedule'`)
 *     and an inbound API hook each read as that kind;
 *   - a flow the resolver finds no trigger on — a manual / autolaunched Start,
 *     a screen flow — falls back to the flow's `type`, as before.
 *
 * The words are the Start node inspector's own option labels for the same
 * tokens (`flow-node-config`), localized the way the inspector localizes them,
 * so the header and the inspector name one trigger one way.
 *
 * The object reads as its label (objectui#13056), from the catalog the Start
 * node's object picker reads, with its name on the pill's `title`; while the
 * catalog loads, when it fails, or for an object it does not label, the name
 * is the text, as before.
 */
function flowTriggerLabel(
  d: Record<string, unknown>,
  nodes: FlowNode[],
  objects: readonly ObjectCatalogEntry[],
  locale?: string,
): { value: string; title?: string } {
  const kind = resolveFlowTriggerKind(d);
  if (!kind) return { value: translateFlowMeta('type', String(d.type ?? 'autolaunched'), locale) };
  const config = nodes.find((n) => n?.type === 'start')?.config ?? {};
  // A record kind means the Start node's `triggerType` IS a `record-*` token —
  // the resolver read it to answer.
  const token = kind === 'record_change' ? String(config.triggerType) : kind;
  const options = localizeFlowFields('start', fieldsForNodeType('start'), locale).find((f) => f.id === 'triggerType')?.options;
  const label = options?.find((o) => o.value === token)?.label ?? token;
  const sweep = config.timeRelative as { object?: unknown } | undefined;
  const object =
    kind === 'record_change'
      ? config.objectName
      : kind === 'time_relative'
        ? (typeof sweep?.object === 'string' ? sweep.object : config.objectName)
        : undefined;
  if (typeof object !== 'string' || !object) return { value: label };
  const objectLabel = objects.find((o) => o.name === object)?.label;
  return objectLabel ? { value: `${label} · ${objectLabel}`, title: object } : { value: `${label} · ${object}` };
}

/** The catalog before it answered, or when it failed: one stable empty list. */
const NO_OBJECTS: ObjectCatalogEntry[] = [];

/**
 * The flow's meta — Trigger, Status, Run as, version and, when set, On error —
 * as the designer's info bar shows it and as the Studio's item header shows it
 * (objectui#12454). One component, so the two read one trigger and one run
 * status the same way (objectui#11779). `bar` keeps the info bar's glyphs;
 * `header` drops them and separates the items with dots, at the header's meta
 * size. Each item keeps its `Label:` caption and its value as sibling spans.
 *
 * objectui#13135 — the header lays its items out as a one-row grid whose
 * columns may shrink to nothing (`minmax(0, max-content)`), so the row's own
 * minimum width is near zero and it fits the meta slot instead of overflowing
 * it. Each item then truncates with an ellipsis, and a cut item names its
 * whole `Label: value` on hover. The row never wraps, so the header keeps its
 * height. (A flex row cannot do it: its minimum width is the sum of its
 * items' text, so the slot clipped it mid-word with no ellipsis.)
 */
export function FlowMetaPills({
  draft,
  runStatus,
  locale,
  variant = 'bar',
}: {
  draft: Record<string, unknown>;
  runStatus: FlowRunStatus;
  locale?: string;
  variant?: 'bar' | 'header';
}) {
  const nodes = Array.isArray(draft.nodes) ? (draft.nodes as FlowNode[]) : [];
  const runView = describeFlowRunStatus(runStatus, locale);
  const runAs = String(draft.runAs ?? 'user');
  const version = draft.version != null ? String(draft.version) : undefined;
  const errorStrategy = (draft.errorHandling as { strategy?: unknown } | undefined)?.strategy;
  const onError = typeof errorStrategy === 'string' && errorStrategy ? errorStrategy : undefined;
  const header = variant === 'header';
  const catalog = useObjectCatalog();
  const trigger = flowTriggerLabel(draft, nodes, catalog.status === 'loaded' ? catalog.data : NO_OBJECTS, locale);
  const items: React.ReactNode[] = [
    <Pill
      key="trigger"
      icon={header ? undefined : Zap}
      label={tr('engine.flowPreview.pill.trigger', locale)}
      value={trigger.value}
      title={trigger.title}
      compact={header}
    />,
    <Pill
      key="status"
      icon={header ? undefined : CircleDot}
      label={tr('engine.flowPreview.pill.status', locale)}
      value={runView.label}
      tone={runView.tone}
      title={runView.title}
      compact={header}
    />,
    <Pill
      key="runAs"
      icon={header ? undefined : Settings2}
      label={tr('engine.flowPreview.pill.runAs', locale)}
      value={translateFlowMeta('runAs', runAs, locale)}
      compact={header}
    />,
  ];
  if (version) {
    items.push(
      header ? (
        <span key="version" className="truncate">
          v{version}
        </span>
      ) : (
        <Pill key="version" label="v" value={version} />
      ),
    );
  }
  if (onError) {
    items.push(
      <Pill
        key="onError"
        icon={header ? undefined : GitBranch}
        label={tr('engine.flowPreview.pill.onError', locale)}
        value={translateFlowMeta('onError', onError, locale)}
        compact={header}
      />,
    );
  }
  if (!header) return <>{items}</>;
  return (
    <span className="inline-grid min-w-0 max-w-full auto-cols-[minmax(0,max-content)] grid-flow-col items-center gap-x-1.5">
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <span aria-hidden className="text-muted-foreground/50">
              ·
            </span>
          )}
          {item}
        </React.Fragment>
      ))}
    </span>
  );
}

interface FlowVariable {
  name: string;
  type?: string;
  defaultValue?: unknown;
  description?: string;
  isInput?: boolean;
  isOutput?: boolean;
}

export function FlowPreview({ draft, editing, selection, onSelectionChange, onPatch, locale, diagnostics }: MetadataPreviewProps) {
  const d = draft as Record<string, unknown>;
  // Memoized so hook deps (validation memo, handleAddNode) get a stable array
  // reference across renders instead of a fresh `[]`/cast each time.
  const nodes = React.useMemo<FlowNode[]>(() => (Array.isArray(d.nodes) ? (d.nodes as FlowNode[]) : []), [d.nodes]);
  const edges = React.useMemo<FlowEdge[]>(() => (Array.isArray(d.edges) ? (d.edges as FlowEdge[]) : []), [d.edges]);
  const variables: FlowVariable[] = Array.isArray(d.variables) ? (d.variables as FlowVariable[]) : [];

  // objectui#11779 — the host's runtime row for this flow (see
  // `FlowRuntimeContext`): the ONE run status the header's Status pill and the
  // Problems panel show, derived as the host's rail derives it. Read before the
  // empty-flow return below, so the hook order never depends on the draft.
  const runtime = React.useContext(FlowRuntimeContext);
  // objectui#12349 — and the engine's registration verdict, which decides a
  // refused or unregistered flow's status (the stored `status` stays as read).
  const registration = React.useContext(FlowRegistrationContext);
  const runStatus = deriveFlowRunStatus(runtime, d.status, registration);
  // objectui#12454 — a host that carries the meta and the tab row itself.
  const chrome = React.useContext(FlowPreviewChromeContext);

  const designMode = !!(editing && onSelectionChange);
  const canEdit = designMode && !!onPatch;
  const selectedId = selection && selection.kind === 'node' ? selection.id : null;
  const selectedEdgeId = selection && selection.kind === 'edge' ? selection.id : null;
  // #2670 Phase 3: a nested-node selection carries an encoded container path in
  // the flat selection id. Decode it HERE — FlowPreview is the only place that
  // speaks the codec; the canvas only ever handles the structured path.
  const selectedNestedPath = React.useMemo(
    () => (selection && selection.kind === NESTED_NODE_KIND ? parseNestedNodeId(selection.id) : null),
    [selection],
  );

  const [showDebug, setShowDebug] = React.useState(false);
  // Variables panel is opt-in: opening a flow should show the full-width canvas,
  // not a mostly-empty side panel (most flows declare no variables).
  const [showVars, setShowVars] = React.useState(false);
  const [showRuns, setShowRuns] = React.useState(false);
  const [showProblems, setShowProblems] = React.useState(false);
  const [runHL, setRunHL] = React.useState<{
    activeNodeId: string | null;
    visitedNodeIds: string[];
    traversedEdgeIds: string[];
  } | null>(null);

  // Unified problem list (structural + server `_diagnostics`) is the SINGLE
  // source for every validation surface — the clickable inline banner, the
  // per-element badges, the red error ring/stroke, and the Problems panel.
  // Recomputed from the live draft so they all clear as the author fixes each issue.
  // The runtime connector registry is read the way the inspectors read it —
  // only when the draft holds a committed `connector_action` — so the
  // expression scan judges that action's declared output keys in scope
  // downstream, as the inspectors do (objectui#11085).
  const connectors = useConnectorRegistry(hasCommittedConnectorAction(d));
  const problems = React.useMemo<FlowProblem[]>(
    () => buildFlowProblems({ nodes, edges, serverDiagnostics: diagnostics, variables, locale, connectors }),
    [nodes, edges, diagnostics, d.variables, locale, connectors],
  );
  const errorCount = problems.filter((p) => p.level === 'error').length;
  // objectui#12454 — the host's Problems tab carries the count. Keyed on the
  // two numbers and the host's setter, never on the memoised list (AGENTS.md #10).
  const reportProblems = chrome?.onProblemsChange;
  React.useEffect(() => {
    reportProblems?.({ count: problems.length, errors: errorCount });
  }, [reportProblems, problems.length, errorCount]);
  // Red error ring/stroke derived from the same list (errors only; a cycle
  // paints its whole loop) — no second validateFlowDraft pass.
  const { invalidNodeIds, invalidEdges } = React.useMemo(
    () => deriveInvalidElements(problems),
    [problems],
  );

  // "Reveal" handshake with the canvas: a changing nonce pans to the element.
  const [reveal, setReveal] = React.useState<{ target: FlowProblem['target']; nonce: number } | null>(null);
  const selectedKey = selectedId ? `node:${selectedId}` : (selectedEdgeId ?? null);
  const handleSelectProblem = React.useCallback(
    (p: FlowProblem) => {
      if (p.target.kind === 'node') {
        // Destructure before the .find() closure — TS drops the union narrowing
        // of `p.target` inside a nested callback, so capture nodeId as a string.
        const { nodeId } = p.target;
        const node = nodes.find((n) => n.id === nodeId);
        // Named by the designer's one rule (objectui#13200), as the canvas and inspectors name it.
        onSelectionChange?.({ kind: 'node', id: nodeId, label: node ? flowNodeDisplayName(node, locale) : nodeId });
      } else if (p.target.kind === 'edge') {
        onSelectionChange?.({ kind: 'edge', id: p.target.edgeKey, label: flowEdgeDisplayName(p.target, nodes, locale) });
      }
      setReveal((r) => ({ target: p.target, nonce: (r?.nonce ?? 0) + 1 }));
    },
    [nodes, onSelectionChange, locale],
  );

  // objectui#11772 — this editing session's memory of node ids: every id it
  // has seen on a node or at either end of an edge. A node removed earlier in
  // the session — its edges gone with it, so the draft no longer names it
  // anywhere — is still never minted again: a fresh node never takes over an
  // identity the author has already seen on another node. The session is this
  // preview's mount (Studio remounts it when another flow is opened). The
  // ledger is written after each render commits and read only when a node is
  // added, by `mintNodeId`, which also takes the current draft's ids directly
  // (`freshNodeId`), so a render whose effect has not run yet loses nothing.
  // Keyed on the draft's own arrays, never on the memoised `nodes` / `edges`
  // (AGENTS.md #10); recording is idempotent, so an extra run changes nothing.
  const seenNodeIds = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const seen = seenNodeIds.current;
    // Read as defensively as the rest of this preview: a mid-edit draft may
    // hold a hole or a half-written edge, and nothing here may throw on it.
    for (const n of Array.isArray(d.nodes) ? (d.nodes as Array<{ id?: unknown } | null>) : []) {
      if (typeof n?.id === 'string') seen.add(n.id);
    }
    for (const e of Array.isArray(d.edges) ? (d.edges as Array<{ source?: unknown; target?: unknown } | null>) : []) {
      if (typeof e?.source === 'string') seen.add(e.source);
      if (typeof e?.target === 'string') seen.add(e.target);
    }
  }, [d.nodes, d.edges]);
  const mintNodeId = React.useCallback(() => freshNodeId(nodes, edges, seenNodeIds.current), [nodes, edges]);

  const handleAddNode = React.useCallback(() => {
    if (!canEdit) return;
    // A flow's first node is its trigger — seed a `start` node (not a generic
    // `task`) so the canvas opens on the canonical entry point and the author
    // adds subsequent steps from there.
    const newNode: FlowNode = { id: mintNodeId(), type: 'start', label: defaultNodeLabel('start', locale) };
    const next = appendArray(nodes, newNode);
    onPatch!({ nodes: next });
    onSelectionChange?.({ kind: 'node', id: newNode.id, label: flowNodeDisplayName(newNode, locale) });
  }, [canEdit, nodes, onPatch, onSelectionChange, locale, mintNodeId]);

  // Run history needs the published flow name (the engine keys runs by it).
  const flowName = typeof d.name === 'string' && d.name ? d.name : '';

  const empty = canEdit ? (
    <div className="p-3">
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded border border-dashed px-3 py-2 text-xs text-muted-foreground hover:bg-muted/30 hover:text-foreground"
        onClick={handleAddNode}
      >
        <Plus className="h-3 w-3" />
        {tr('engine.inspector.add.node', locale)}
      </button>
    </div>
  ) : (
    <PreviewMessage>{tr('engine.flowPreview.emptyHint', locale)}</PreviewMessage>
  );
  if (nodes.length === 0 && !chrome) {
    return <PreviewShell hint={`flow${designMode ? ' · design' : ''}`}>{empty}</PreviewShell>;
  }

  // The canvas, the same element in both chromes (objectui#12454). Under a
  // host's chrome a flow with no node yet keeps its tabs: the canvas section
  // offers the first node, and the other sections read as they do.
  const canvasEl = nodes.length === 0 ? (
    <div className="h-full">{empty}</div>
  ) : (
    <FlowCanvas
      nodes={nodes}
      edges={edges}
      editable={canEdit}
      designMode={designMode}
      selectedId={selectedId}
      selectedEdgeId={selectedEdgeId}
      locale={locale}
      activeNodeId={runHL?.activeNodeId ?? null}
      visitedNodeIds={runHL?.visitedNodeIds}
      traversedEdgeIds={runHL?.traversedEdgeIds}
      invalidNodeIds={invalidNodeIds}
      invalidEdges={invalidEdges}
      onRevealProblem={handleSelectProblem}
      problems={problems}
      revealSignal={reveal}
      onSelect={(n) =>
        n
          ? onSelectionChange?.({ kind: 'node', id: n.id, label: flowNodeDisplayName(n, locale) })
          : onSelectionChange?.(null)
      }
      onSelectEdge={(e, key) =>
        e
          ? onSelectionChange?.({ kind: 'edge', id: key, label: flowEdgeDisplayName(e, nodes, locale) })
          : onSelectionChange?.(null)
      }
      selectedNestedPath={selectedNestedPath}
      onSelectNested={(path, node) =>
        path
          ? onSelectionChange?.({
              kind: NESTED_NODE_KIND,
              id: encodeNestedNodeId(path),
              label: node ? flowNodeDisplayName(node, locale) : path.nodeId,
            })
          : onSelectionChange?.(null)
      }
      onPatch={onPatch}
      mintNodeId={mintNodeId}
    />
  );

  // The bar's four panel toggles, as the designer has them: one panel at a time beside the canvas.
  const togglePanel = (panel: 'vars' | 'runs' | 'problems' | 'debug') => {
    if (panel === 'vars') {
      setShowVars((v) => !v);
      return;
    }
    setShowRuns((v) => (panel === 'runs' ? !v : false));
    setShowProblems((v) => (panel === 'problems' ? !v : false));
    setShowDebug((v) => (panel === 'debug' ? !v : false));
  };

  if (chrome) {
    // objectui#12454 — the host's item header holds the meta and the tab row,
    // so the preview draws neither, and no frame: the section fills the body.
    const section = chrome.section;
    const panelBody = section === 'variables' || section === 'runs' || section === 'problems';
    return (
      <PreviewErrorBoundary fallbackHint={tr('engine.flowPreview.malformed', locale)}>
        <div
          data-testid="flow-preview-section"
          data-section={section}
          className={'grid h-full min-h-0 gap-0 ' + (section === 'debug' ? 'lg:grid-cols-[1fr_240px]' : 'grid-cols-1')}
        >
          {/* Kept mounted under a body section, so its pan, zoom and opened
              regions are where the author left them when the canvas returns. */}
          <div className={panelBody ? 'hidden' : 'flex min-h-0 min-w-0 flex-col'}>
            <div className="min-h-0 flex-1">{canvasEl}</div>
          </div>
          {section === 'debug' && (
            <div className="border-l bg-muted/20">
              <FlowSimulatorPanel nodes={nodes} edges={edges} variables={variables} locale={locale} onRunStateChange={setRunHL} />
            </div>
          )}
          {section === 'variables' && (
            <div className="min-h-0 overflow-auto">
              <div className="mx-auto max-w-3xl space-y-2 px-6 py-5 text-xs">
                <FlowVariablesList variables={variables} locale={locale} />
              </div>
            </div>
          )}
          {section === 'runs' && (
            <div className="min-h-0 overflow-hidden">
              <div className="mx-auto h-full max-w-3xl px-3 py-2">
                {/* The engine keys runs by the flow's name; the host offers this section only with one. */}
                {flowName && <FlowRunsPanel flowName={flowName} nodes={nodes} locale={locale} />}
              </div>
            </div>
          )}
          {section === 'problems' && (
            <div className="min-h-0 overflow-hidden">
              <div className="mx-auto h-full max-w-3xl px-3 py-2">
                <ProblemsPanel
                  problems={problems}
                  nodes={nodes}
                  selectedKey={selectedKey}
                  onSelectProblem={(p) => {
                    handleSelectProblem(p);
                    // The problem's element is selected and revealed on the canvas.
                    if (p.target.kind !== 'flow') chrome.onSectionChange('canvas');
                  }}
                  locale={locale}
                  runStatus={runStatus}
                />
              </div>
            </div>
          )}
        </div>
      </PreviewErrorBoundary>
    );
  }

  return (
    <PreviewShell hint={`flow · ${nodes.length} node${nodes.length === 1 ? '' : 's'}`}>
      <PreviewErrorBoundary fallbackHint={tr('engine.flowPreview.malformed', locale)}>
        <div className={
          'grid gap-0 h-full min-h-[440px] ' +
          (showDebug || showVars || showRuns || showProblems ? 'lg:grid-cols-[1fr_240px]' : 'grid-cols-1')
        }>
          {/* Visual canvas */}
          <div className="flex flex-col min-w-0 min-h-0">
            <div className="rounded-none border-b bg-muted/30 px-3 py-2 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
              <FlowMetaPills draft={d} runStatus={runStatus} locale={locale} />
              <div className="ml-auto flex items-center gap-1.5">
                {!showDebug && !showRuns && !showProblems && (
                  <button
                    type="button"
                    onClick={() => togglePanel('vars')}
                    className={
                      'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                      (showVars
                        ? 'border-violet-500 bg-violet-50 text-violet-700'
                        : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground')
                    }
                    title={tr(showVars ? 'engine.flowPreview.hideVars' : 'engine.flowPreview.showVars', locale)}
                  >
                    <PanelRight className="h-3 w-3" /> {tr('engine.flowPreview.variables', locale)}
                  </button>
                )}
                {flowName && (
                  <button
                    type="button"
                    onClick={() => togglePanel('runs')}
                    className={
                      'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                      (showRuns
                        ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                        : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground')
                    }
                    title={tr('engine.flowPreview.runsTitle', locale)}
                  >
                    <History className="h-3 w-3" /> {tr('engine.flowPreview.runs', locale)}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => togglePanel('problems')}
                  className={
                    'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                    (showProblems
                      ? 'border-rose-500 bg-rose-50 text-rose-700'
                      : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground')
                  }
                  title={tr('engine.flowPreview.problemsTitle', locale)}
                >
                  <AlertCircle className="h-3 w-3" /> {tr('engine.flowPreview.problems', locale)}
                  {problems.length > 0 && (
                    <span
                      className={
                        'ml-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ' +
                        (errorCount > 0 ? 'bg-destructive/15 text-destructive' : 'bg-amber-500/15 text-amber-600')
                      }
                    >
                      {problems.length}
                    </span>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => togglePanel('debug')}
                  className={
                    'inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium transition-colors ' +
                    (showDebug
                      ? 'border-sky-500 bg-sky-50 text-sky-700'
                      : 'border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground')
                  }
                >
                  <Bug className="h-3 w-3" /> {tr('engine.flowPreview.debug', locale)}
                </button>
              </div>
            </div>
            <div className="flex-1 min-h-0">{canvasEl}</div>
          </div>

          {/* Right side panel: Variables (default), the debug simulator, or
              the engine run history. Collapsible so the canvas can use the
              full width. */}
          {showProblems ? (
            <div className="border-l bg-muted/20">
              <ProblemsPanel
                problems={problems}
                nodes={nodes}
                selectedKey={selectedKey}
                onSelectProblem={handleSelectProblem}
                locale={locale}
                runStatus={runStatus}
              />
            </div>
          ) : showDebug ? (
            <div className="border-l bg-muted/20">
              <FlowSimulatorPanel
                nodes={nodes}
                edges={edges}
                variables={variables}
                locale={locale}
                onRunStateChange={setRunHL}
              />
            </div>
          ) : showRuns && flowName ? (
            <div className="border-l bg-muted/20">
              <FlowRunsPanel flowName={flowName} nodes={nodes} locale={locale} />
            </div>
          ) : showVars ? (
            <div className="border-l bg-muted/20 p-3 text-xs space-y-2">
              <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <Variable className="h-3 w-3" /> {tr('engine.flowPreview.variables', locale)}
              </div>
              <FlowVariablesList variables={variables} locale={locale} />
            </div>
          ) : null}
        </div>
      </PreviewErrorBoundary>
    </PreviewShell>
  );
}

function Pill({
  icon: Icon,
  label,
  value,
  tone = 'plain',
  title,
  compact = false,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  tone?: FlowRunStatusView['tone'];
  /** Hover text — the run status's reason, for the Status pill; the trigger object's name, for the Trigger pill. */
  title?: string;
  /** The item header's meta (objectui#12454): the value at the caption's weight, plain text muted. */
  compact?: boolean;
}) {
  const ref = React.useRef<HTMLSpanElement | null>(null);
  const cut = useCutText(ref, compact);
  // objectui#13135 — a cut header item says its whole text first, then the
  // hover text it already had (the run status's reason, the object's name).
  const hover = cut ? [`${label}: ${value}`, title].filter(Boolean).join('\n') : title;
  const cls =
    tone === 'green'
      ? 'text-emerald-700 dark:text-emerald-400'
      : tone === 'amber'
        ? 'text-amber-700 dark:text-amber-300'
        : tone === 'muted' || compact
          ? 'text-muted-foreground'
          : 'text-foreground';
  return (
    <span ref={ref} className={compact ? 'min-w-0 truncate' : 'inline-flex items-center gap-1'} title={hover}>
      {Icon && <Icon className="h-3 w-3 text-muted-foreground" />}
      <span className="text-muted-foreground">{label}:</span>
      <span className={compact ? `ml-1 ${cls}` : `font-medium ${cls}`}>{value}</span>
    </span>
  );
}

/**
 * objectui#13135 — whether the element's text is cut (wider than its box),
 * measured on every render and on resize, as the Studio header's title
 * measures its own (objectui#12897). `false` while `enabled` is off.
 */
function useCutText(ref: React.RefObject<HTMLElement | null>, enabled: boolean): boolean {
  const [cut, setCut] = React.useState(false);
  const measure = React.useCallback(() => {
    const el = ref.current;
    setCut(enabled && !!el && el.scrollWidth > el.clientWidth + 0.5);
  }, [ref, enabled]);
  // Every render: the text can change without the box resizing.
  React.useLayoutEffect(measure);
  React.useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, enabled, measure]);
  return cut;
}

/** The flow's declared variables: the designer's side panel, and the Studio's Variables body (objectui#12454). */
function FlowVariablesList({ variables, locale }: { variables: FlowVariable[]; locale?: string }) {
  if (variables.length === 0) {
    return <EmptyDescription className="text-xs italic">{tr('engine.flowPreview.noVars', locale)}</EmptyDescription>;
  }
  return (
    <ul className="space-y-1.5">
      {variables.map((v, i) => (
        <li key={v.name || i} className="rounded border bg-background p-1.5">
          <div className="flex items-baseline gap-1 flex-wrap">
            <span className="font-mono">{v.name}</span>
            {v.type && (
              <span className="text-[10px] uppercase text-muted-foreground">
                {v.type}
              </span>
            )}
            {v.isInput && (
              <span className="text-[9px] font-semibold uppercase px-1 rounded bg-sky-100 text-sky-700">
                {tr('engine.flowPreview.varIn', locale)}
              </span>
            )}
            {v.isOutput && (
              <span className="text-[9px] font-semibold uppercase px-1 rounded bg-emerald-100 text-emerald-700">
                {tr('engine.flowPreview.varOut', locale)}
              </span>
            )}
          </div>
          {v.defaultValue !== undefined && (
            <div className="text-[10px] text-muted-foreground font-mono truncate">
              = {String(v.defaultValue)}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
