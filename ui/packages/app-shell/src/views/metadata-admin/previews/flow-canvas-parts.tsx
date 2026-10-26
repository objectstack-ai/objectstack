// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-canvas-parts — presentational building blocks for `FlowCanvas.tsx`:
 * the per-node-type icon/tone mapping, the node card, and the add-node
 * palette popover (the one picker every add-node entry point opens, and the
 * list the inspector's Node Type select offers). Kept dependency-free and
 * Shadcn-native (Tailwind + lucide).
 */

import * as React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Bell,
  ChevronRight,
  Code,
  CircleDot,
  CircleStop,
  Diamond,
  FilePen,
  FilePlus,
  FileSearch,
  FileX,
  GitFork,
  Globe,
  IterationCcw,
  ListChecks,
  MonitorSmartphone,
  Play,
  Plug,
  Plus,
  Repeat,
  ShieldAlert,
  TimerReset,
  UserCheck,
  Variable,
  Workflow,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  cn,
  Popover,
  PopoverTrigger,
  PopoverContent,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@object-ui/components';
import { t as tr, translateNodeLabel, translateNodeHint } from '../i18n.js';
import { NODE_W, NODE_H, type Point, type LabeledRegion, type FlowDesignerNode } from './flow-canvas-layout.js';
import { FlowRegionView } from './flow-region-view.js';
import { EXPANDED_REGION_MAX_W, NODE_REGION_GAP, REGION_PANEL_PAD } from './flow-region-metrics.js';
import { useFlowPaletteRecents } from '../../../context/FlowPaletteRecentsProvider.js';

export function nodeIcon(type: string): LucideIcon {
  switch (type) {
    case 'start':
      return Play;
    case 'end':
      return CircleStop;
    case 'decision':
    case 'branch':
    case 'gateway':
      return Diamond;
    case 'wait':
    case 'timer':
    case 'delay':
      return TimerReset;
    case 'boundary_event':
    case 'signal':
      return Zap;
    case 'subflow':
    case 'flow':
      return Workflow;
    case 'create_record':
      return FilePlus;
    case 'update_record':
      return FilePen;
    case 'delete_record':
      return FileX;
    case 'get_record':
      return FileSearch;
    case 'http':
      return Globe;
    case 'notify':
      return Bell;
    case 'script':
    case 'script_task':
      return Code;
    case 'screen':
    case 'user_task':
      return MonitorSmartphone;
    case 'approval':
      return UserCheck;
    case 'connector_action':
    case 'service_task':
      return Plug;
    case 'assignment':
      return Variable;
    case 'loop':
    case 'for_each':
      return Repeat;
    case 'map':
      return ListChecks;
    case 'parallel_gateway':
    case 'join_gateway':
    case 'parallel':
      return GitFork;
    case 'try_catch':
      return ShieldAlert;
    default:
      return CircleDot;
  }
}

interface NodeTone {
  /** Icon color (used inside the tinted chip). */
  icon: string;
  /** Card accent border (left edge) + selected ring color. */
  accent: string;
  /** Small type-label text color. */
  label: string;
  /** The icon tile's tint — the card's primary color cue. */
  chip: string;
}

/**
 * objectui#12488 — the card's 28 px tile is a solid tint of the kind's hue with
 * the glyph in its deep shade (the Studio artboard's swatches): start green,
 * screen pink, record blue, decision amber, loop violet, end grey. The other
 * kinds take the same form in their own hue, kept apart from those six.
 */
const TONES: Record<string, NodeTone> = {
  start: {
    icon: 'text-emerald-700 dark:text-emerald-300',
    accent: 'border-l-emerald-500',
    label: 'text-emerald-700 dark:text-emerald-400',
    chip: 'bg-emerald-100 dark:bg-emerald-500/15',
  },
  end: {
    icon: 'text-muted-foreground',
    accent: 'border-l-slate-400',
    label: 'text-muted-foreground',
    chip: 'bg-muted',
  },
  decision: {
    icon: 'text-amber-700 dark:text-amber-300',
    accent: 'border-l-amber-500',
    label: 'text-amber-700 dark:text-amber-400',
    chip: 'bg-amber-100 dark:bg-amber-500/15',
  },
  wait: {
    icon: 'text-sky-700 dark:text-sky-300',
    accent: 'border-l-sky-500',
    label: 'text-sky-700 dark:text-sky-400',
    chip: 'bg-sky-100 dark:bg-sky-500/15',
  },
  signal: {
    icon: 'text-fuchsia-700 dark:text-fuchsia-300',
    accent: 'border-l-fuchsia-500',
    label: 'text-fuchsia-700 dark:text-fuchsia-400',
    chip: 'bg-fuchsia-100 dark:bg-fuchsia-500/15',
  },
  subflow: {
    icon: 'text-indigo-700 dark:text-indigo-300',
    accent: 'border-l-indigo-500',
    label: 'text-indigo-700 dark:text-indigo-400',
    chip: 'bg-indigo-100 dark:bg-indigo-500/15',
  },
  task: {
    icon: 'text-slate-600 dark:text-slate-300',
    accent: 'border-l-slate-400',
    label: 'text-slate-600 dark:text-slate-400',
    chip: 'bg-slate-100 dark:bg-slate-500/15',
  },
  record: {
    icon: 'text-blue-700 dark:text-blue-300',
    accent: 'border-l-blue-500',
    label: 'text-blue-700 dark:text-blue-400',
    chip: 'bg-blue-100 dark:bg-blue-500/15',
  },
  integration: {
    icon: 'text-orange-700 dark:text-orange-300',
    accent: 'border-l-orange-500',
    label: 'text-orange-700 dark:text-orange-400',
    chip: 'bg-orange-100 dark:bg-orange-500/15',
  },
  approval: {
    icon: 'text-teal-700 dark:text-teal-300',
    accent: 'border-l-teal-500',
    label: 'text-teal-700 dark:text-teal-400',
    chip: 'bg-teal-100 dark:bg-teal-500/15',
  },
  loop: {
    icon: 'text-violet-700 dark:text-violet-300',
    accent: 'border-l-violet-500',
    label: 'text-violet-700 dark:text-violet-400',
    chip: 'bg-violet-100 dark:bg-violet-500/15',
  },
  screen: {
    icon: 'text-pink-700 dark:text-pink-300',
    accent: 'border-l-pink-500',
    label: 'text-pink-700 dark:text-pink-400',
    chip: 'bg-pink-100 dark:bg-pink-500/15',
  },
  assignment: {
    icon: 'text-purple-700 dark:text-purple-300',
    accent: 'border-l-purple-500',
    label: 'text-purple-700 dark:text-purple-400',
    chip: 'bg-purple-100 dark:bg-purple-500/15',
  },
};

export function nodeTone(type: string): NodeTone {
  switch (type) {
    case 'start':
      return TONES.start;
    case 'end':
      return TONES.end;
    case 'decision':
    case 'branch':
    case 'gateway':
    case 'parallel_gateway':
    case 'join_gateway':
    case 'parallel':
      return TONES.decision;
    case 'wait':
    case 'timer':
    case 'delay':
      return TONES.wait;
    case 'boundary_event':
    case 'signal':
    case 'try_catch':
      return TONES.signal;
    case 'subflow':
    case 'flow':
      return TONES.subflow;
    case 'approval':
      return TONES.approval;
    case 'loop':
    case 'for_each':
    case 'map':
      return TONES.loop;
    case 'screen':
    case 'user_task':
      return TONES.screen;
    case 'assignment':
      return TONES.assignment;
    case 'create_record':
    case 'update_record':
    case 'delete_record':
    case 'get_record':
      return TONES.record;
    case 'http':
    case 'notify':
    case 'connector_action':
    case 'script':
    case 'service_task':
    case 'script_task':
      return TONES.integration;
    default:
      return TONES.task;
  }
}

/**
 * Renders the glyph for a node type. Uses `createElement` (rather than binding
 * the resolved icon to a capitalized local) so the renderer stays a stable
 * module-scope component instead of one re-created on every parent render.
 */
export function NodeTypeIcon({ type, className }: { type: string; className?: string }) {
  return React.createElement(nodeIcon(type), { className, 'aria-hidden': true });
}

/** Palette grouping — keeps the add-node list scannable as it grows. */
export type NodeCategory = 'Data' | 'Logic' | 'Human' | 'Integration' | 'Flow';

/** Display order of the palette's category sections. */
export const NODE_CATEGORY_ORDER: NodeCategory[] = ['Data', 'Logic', 'Human', 'Integration', 'Flow'];

export interface PaletteItem {
  type: string;
  label: string;
  hint?: string;
  /** Section this item belongs to in the grouped palette. */
  category?: NodeCategory;
}

/**
 * Category for a node type — drives palette grouping and gives engine-only
 * (plugin-contributed) types a sensible section. Mirrors the `nodeTone`
 * families so color and grouping stay consistent.
 */
export function nodeCategory(type: string): NodeCategory {
  switch (type) {
    case 'create_record':
    case 'update_record':
    case 'delete_record':
    case 'get_record':
      return 'Data';
    case 'decision':
    case 'branch':
    case 'gateway':
    case 'loop':
    case 'for_each':
    case 'map':
    case 'assignment':
    case 'parallel_gateway':
    case 'join_gateway':
    case 'parallel':
    case 'try_catch':
      return 'Logic';
    case 'approval':
    case 'screen':
    case 'user_task':
      return 'Human';
    case 'http':
    case 'notify':
    case 'connector_action':
    case 'script':
    case 'service_task':
    case 'script_task':
      return 'Integration';
    default:
      // subflow, wait, boundary_event, end, and anything unknown → Flow control.
      return 'Flow';
  }
}

/** Node types offered by the add-node palette (spec `FlowNodeAction`). */
export const NODE_PALETTE: PaletteItem[] = [
  { type: 'create_record', label: 'Create record', hint: 'Insert a new record', category: 'Data' },
  { type: 'update_record', label: 'Update record', hint: 'Modify an existing record', category: 'Data' },
  { type: 'get_record', label: 'Get record', hint: 'Query records', category: 'Data' },
  { type: 'delete_record', label: 'Delete record', hint: 'Remove matching records', category: 'Data' },
  { type: 'decision', label: 'Decision', hint: 'Branch on a condition', category: 'Logic' },
  { type: 'loop', label: 'Loop', hint: 'Iterate over a collection', category: 'Logic' },
  { type: 'assignment', label: 'Set variables', hint: 'Assign flow variables', category: 'Logic' },
  // ADR-0031: authors get the structured constructs (well-formed by
  // construction); the BPMN `parallel_gateway` / `join_gateway` pair is an
  // import/export representation only — the engine has no executor for it.
  { type: 'parallel', label: 'Parallel', hint: 'Run branches concurrently, join at end', category: 'Logic' },
  { type: 'try_catch', label: 'Try / Catch', hint: 'Protect steps with error handling and retry', category: 'Logic' },
  { type: 'approval', label: 'Approval', hint: 'Pause for a human decision', category: 'Human' },
  { type: 'screen', label: 'Screen', hint: 'Collect input from a user', category: 'Human' },
  { type: 'http', label: 'HTTP request', hint: 'Call an external API', category: 'Integration' },
  { type: 'notify', label: 'Notify', hint: 'Send a notification to users', category: 'Integration' },
  { type: 'connector_action', label: 'Connector', hint: 'Run an integration action', category: 'Integration' },
  { type: 'script', label: 'Script', hint: 'Run custom code', category: 'Integration' },
  { type: 'subflow', label: 'Subflow', hint: 'Invoke another flow', category: 'Flow' },
  { type: 'wait', label: 'Wait', hint: 'Pause for an event or timer', category: 'Flow' },
  { type: 'end', label: 'End', hint: 'Terminate the flow', category: 'Flow' },
];

/**
 * Human-friendly default label for a newly created node of `type`. Localized
 * for the active locale so a node added from the (localized) palette gets a
 * matching default label — e.g. picking 创建记录 under zh-CN seeds the node
 * label 创建记录, not "Create record". English (no locale) is unchanged, so
 * programmatic / test callers keep the English default.
 */
export function defaultNodeLabel(type: string, locale?: string): string {
  const item = NODE_PALETTE.find((p) => p.type === type);
  const english = item
    ? item.label
    : type
        .split('_')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
  return translateNodeLabel(type, locale, english);
}

/**
 * The name a flow node goes by wherever the designer refers to it in words
 * (objectui#13143): the Problems messages, a connection's `source → target`
 * title, a run step. The one rule, in order:
 *
 * 1. the author's `label`, when it is a non-blank string;
 * 2. else the palette label of the node's type, when the palette offers it
 *    (localized as {@link defaultNodeLabel} localizes it);
 * 3. else the node's `id`.
 *
 * An unknown type does not get the title-cased name {@link defaultNodeLabel}
 * makes up for a new node: a made-up name would read as a label nobody wrote.
 */
export function flowNodeDisplayName(
  node: { id: string; type?: unknown; label?: unknown },
  locale?: string,
): string {
  if (typeof node.label === 'string' && node.label.trim()) return node.label;
  const item = typeof node.type === 'string' ? NODE_PALETTE.find((p) => p.type === node.type) : undefined;
  if (item) return translateNodeLabel(item.type, locale, item.label);
  return node.id;
}

/**
 * A connection's title, `source → target`, each end named by
 * {@link flowNodeDisplayName} (objectui#13143). An end naming no node of
 * `nodes` reads as its id: there is no node to name it by.
 */
export function flowEdgeDisplayName(
  edge: { source: string; target: string },
  nodes: readonly unknown[],
  locale?: string,
): string {
  const end = (id: string) => {
    const node = nodes.find(
      (n): n is { id: string; type?: unknown; label?: unknown } =>
        typeof n === 'object' && n !== null && (n as { id?: unknown }).id === id,
    );
    return node ? flowNodeDisplayName(node, locale) : id;
  };
  return `${end(edge.source)} → ${end(edge.target)}`;
}

/**
 * Spec-valid seed fields for a newly created node, so structured blocks start
 * in a valid-ish shape (e.g. a wait node already has a timer eventType) rather
 * than an empty intermediate state. Returns extra node props to spread in.
 *
 * Every branch here must survive `FlowNodeSchema.parse()` on the installed
 * `@objectstack/spec` — a seed the loader rejects makes the designer's own
 * output unpublishable the moment the author saves. Pinned by
 * `flow-canvas-seeds.spec-parse.test.tsx` (#3316).
 */
export function defaultNodeExtras(type: string): Record<string, unknown> {
  switch (type) {
    case 'start':
      return {};
    case 'wait':
      // No `onTimeout`: retired in spec 17 (framework#4158) as a `retiredKey()`
      // tombstone, so writing it is a hard `FlowNodeSchema` error, not a
      // silently-stripped extra. A wait node has no timeout — it resumes when
      // its timer elapses or its signal arrives.
      //
      // `timerDuration: 'PT1H'` is seeded because `@objectstack/spec` 17.5.0
      // REFUSES a timer wait without one: a timer with no duration schedules no
      // wake-up and parks the run forever while reporting success. The value is
      // the spec's own example, ruled as this seed by the maintainer on
      // objectui#11088 (decision 2 = A) — a product default they may change —
      // and it is visible and editable at once, because the inspector shows
      // `Duration` whenever `eventType` is `timer`.
      return { waitEventConfig: { eventType: 'timer', timerDuration: 'PT1H' } };
    case 'connector_action':
      return { connectorConfig: { connectorId: '', actionId: '', input: {} } };
    case 'boundary_event':
      return { boundaryConfig: { attachedToNodeId: '', eventType: 'error', interrupting: true } };
    case 'approval':
      // Seed a node-model approval: at least one approver + spec defaults. The
      // author wires the out-edges with labels `approve` / `reject`.
      return { config: { approvers: [{ type: 'manager' }], behavior: 'first_response', lockRecord: true } };
    case 'notify':
      // Seed a sensible notify node: inbox channel + one empty recipient slot,
      // matching the built-in node's defaults (framework#1895).
      return { config: { channels: ['inbox'], recipients: [] } };
    case 'http':
      return { config: { method: 'GET' } };
    case 'script':
      return {};
    default:
      return {};
  }
}

export interface NodeCardProps {
  id: string;
  /** UI locale for the card's affordance tooltips. */
  locale?: string;
  type: string;
  label: string;
  summary?: string;
  position: Point;
  selected: boolean;
  editable: boolean;
  /** Simulation overlay: the currently-executing or already-visited node. */
  runState?: 'active' | 'visited';
  /** Dim nodes not yet reached while a simulation is in progress. */
  dimmed?: boolean;
  /** Structural-validation error highlight (e.g. part of an un-declared cycle). */
  invalid?: boolean;
  /**
   * Validation badge shown at the card's top-right corner (error or warning),
   * with the issue message(s) as its tooltip. Cleared when the issue resolves.
   */
  badge?: { level: 'error' | 'warning'; title: string };
  onPointerDown?: (e: React.PointerEvent) => void;
  onSelect?: () => void;
  /**
   * objectui#11778 — the bottom "+" ("Add connected node") opens the add-node
   * palette, and this receives the node type the author picked there. The
   * canvas decides where the node goes (after this one, in its path).
   */
  onAppend?: (type: string) => void;
  /** The palette's node types, as the canvas's toolbar palette offers them. */
  paletteItems?: PaletteItem[];
  /** Whether this card's "+" palette is the one open on the canvas. */
  appendPaletteOpen?: boolean;
  onAppendPaletteOpenChange?: (open: boolean) => void;
  /**
   * ADR-0044: when set (approval nodes without an existing revise loop), render
   * the one-click "add revision loop" affordance — drops a wait node + the
   * `revise` and declared `back` edges in a single gesture.
   */
  onAddReviseLoop?: () => void;
  /**
   * #2670: structured-region sub-graphs this node contains (`loop.body`,
   * `parallel.branches`, `try_catch.try`/`catch`). When present, the card gains
   * an expand toggle that renders them read-only, INLINE beneath the header —
   * the card grows and the canvas pushes lower layers down. Empty / absent for
   * ordinary nodes and legacy flat loops → a plain card.
   */
  regions?: LabeledRegion[];
  /** #2670: whether the region tray is expanded (controlled by FlowCanvas). */
  expanded?: boolean;
  /** #2670: toggle the region tray. Absent → no expand affordance. */
  onToggleExpand?: () => void;
  /**
   * #2670 Phase 3: the selected nested node within THIS container's tray,
   * scoped to its region key — drives the selection ring. `null` when nothing
   * (or a node in another container) is selected.
   */
  selectedNestedNode?: { regionKey: string; nodeId: string } | null;
  /**
   * #2670 Phase 3: select a nested node in the tray, tagged with its region
   * key. Absent → the tray stays read-only (Phase 2 behavior).
   */
  onSelectNestedNode?: (regionKey: string, node: FlowDesignerNode) => void;
  /**
   * #2670: the card's rendered height from the layout geometry — the SAME
   * number that positioned every card below this one, so the DOM can never
   * disagree with the layout. `NODE_H` (or absent) when collapsed/plain.
   */
  height?: number;
}

/**
 * A single draggable flow node rendered at an absolute canvas coordinate.
 * The card body drives selection + reposition; a dedicated bottom "+" handle
 * (edit mode only) opens the add-node palette to add a node after this one.
 */
export function NodeCard({
  id,
  locale,
  type,
  label,
  summary,
  position,
  selected,
  editable,
  runState,
  dimmed,
  invalid,
  badge,
  onPointerDown,
  onSelect,
  onAppend,
  paletteItems,
  appendPaletteOpen,
  onAppendPaletteOpenChange,
  onAddReviseLoop,
  regions,
  expanded,
  onToggleExpand,
  height,
  selectedNestedNode,
  onSelectNestedNode,
}: NodeCardProps) {
  const tone = nodeTone(type);
  const hasRegions = !!regions && regions.length > 0;
  return (
    <div
      // `group` so the hover-revealed affordances (append "+", revise loop)
      // appear when the pointer is anywhere over the card, not only over the
      // tiny button itself.
      className="group absolute transition-opacity duration-200"
      data-invalid={invalid || undefined}
      data-node-id={id}
      style={{ left: position.x, top: position.y, width: NODE_W, height: height ?? NODE_H, opacity: dimmed ? 0.35 : 1 }}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        onPointerDown={onPointerDown}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelect?.();
          }
        }}
        // #2670: the header band stays exactly one node tall even when the card
        // grows to hold its expanded region tray below.
        style={{ height: NODE_H }}
        // objectui#12488 — the Studio artboard's card: 8 px radius, a 1 px
        // border that darkens on hover, and the primary border with a 3 px soft
        // ring when selected. The run overlay and the invalid mark keep their
        // own colors. Width and height stay the layout engine's.
        className={cn(
          'group flex w-full items-center gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-left shadow-sm outline-none',
          'transition-[box-shadow,border-color] duration-150 ease-out',
          'focus-visible:ring-2 focus-visible:ring-primary/40',
          editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
          runState === 'active'
            ? 'border-sky-500 shadow-md shadow-sky-500/20 ring-2 ring-sky-400/60'
            : runState === 'visited'
              ? 'border-emerald-500/70 ring-1 ring-emerald-400/40'
              : selected
                ? 'border-primary ring-[3px] ring-primary/15'
                : invalid
                  ? 'border-destructive ring-2 ring-destructive/50'
                  : 'border-border hover:border-foreground/25',
        )}
      >
        <div
          data-testid="flow-node-tile"
          className={cn(
            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md',
            tone.chip,
            runState === 'active' && 'animate-pulse',
          )}
        >
          <NodeTypeIcon type={type} className={cn('h-3.5 w-3.5', tone.icon)} />
        </div>
        <div className="min-w-0 flex-1">
          {/* Label gets the full card width (the summary moved to line 2), and a
              native title tooltip surfaces the full text when it does truncate. */}
          <div title={label} className="truncate text-[13px] font-semibold leading-tight text-foreground">
            {label}
          </div>
          <div className="mt-1 flex items-baseline gap-1.5 leading-tight">
            {/* objectui#12488 — the kind by its display name (the palette's,
                in the designer locale), not the raw type id; the raw id stays
                on the tooltip. */}
            <span
              data-testid="flow-node-kind"
              title={type}
              className={cn('shrink-0 text-[10px] font-semibold uppercase tracking-[0.05em]', tone.label)}
            >
              {defaultNodeLabel(type, locale)}
            </span>
            {summary && (
              <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground" title={summary}>
                {summary}
              </span>
            )}
          </div>
        </div>
      </div>
      {hasRegions && onToggleExpand && (
        // #2670 Phase 2: the container's regions render INLINE — the card grows
        // and the geometry-aware layout pushes lower layers down (replaces the
        // Phase-1 read-only popover). The chevron toggles view-only state owned
        // by FlowCanvas; height comes in via the `height` prop so DOM and
        // layout can never disagree.
        <button
          type="button"
          aria-label={tr(expanded ? 'engine.flowCanvas.collapseRegions' : 'engine.flowCanvas.expandRegions', locale)}
          title={tr(expanded ? 'engine.flowCanvas.collapseRegions' : 'engine.flowCanvas.expandRegions', locale)}
          aria-expanded={!!expanded}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          className="absolute right-1.5 top-1.5 z-20 inline-flex h-5 w-5 items-center justify-center rounded-md border bg-background/90 text-muted-foreground shadow-sm transition-colors hover:border-primary hover:text-primary"
        >
          <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-90')} />
        </button>
      )}
      {hasRegions && expanded && (
        <div
          className="rounded-lg border bg-card shadow-sm"
          style={{ marginTop: NODE_REGION_GAP, padding: REGION_PANEL_PAD }}
          // Read-only tray: interacting with it must never start a card drag.
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <FlowRegionView
            regions={regions!}
            maxWidth={EXPANDED_REGION_MAX_W}
            selected={selectedNestedNode}
            onSelectNode={onSelectNestedNode}
            locale={locale}
          />
        </div>
      )}
      {badge && (
        <span
          title={badge.title}
          data-problem={badge.level}
          className={cn(
            'absolute -right-2 -top-2 z-20 inline-flex h-5 w-5 items-center justify-center rounded-full border bg-background shadow-sm',
            badge.level === 'error'
              ? 'border-destructive/50 text-destructive'
              : 'border-amber-500/50 text-amber-600 dark:text-amber-400',
          )}
        >
          {badge.level === 'error' ? (
            <AlertCircle className="h-3 w-3" />
          ) : (
            <AlertTriangle className="h-3 w-3" />
          )}
        </span>
      )}
      {editable && type !== 'end' && (
        // objectui#11778 — the same palette the toolbar's Add node opens: the
        // author picks the type here, rather than getting a `create_record`.
        <NodePalette
          locale={locale}
          items={paletteItems}
          open={!!appendPaletteOpen}
          onOpenChange={(open) => onAppendPaletteOpenChange?.(open)}
          onPick={(picked) => onAppend?.(picked)}
        >
          <button
            type="button"
            title={tr('engine.flowCanvas.addConnected', locale)}
            aria-label={tr('engine.flowCanvas.addConnected', locale)}
            onPointerDown={(e) => e.stopPropagation()}
            // Stops the card's own select; the palette trigger still toggles.
            onClick={(e) => e.stopPropagation()}
            className={cn(
              'absolute left-1/2 -bottom-3 z-10 inline-flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-sm transition-colors',
              'opacity-0 hover:border-primary hover:text-primary group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100',
            )}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </NodePalette>
      )}
      {onAddReviseLoop && (
        <button
          type="button"
          title={tr('engine.flowCanvas.addReviseLoop', locale)}
          aria-label={tr('engine.flowCanvas.addReviseLoopShort', locale)}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onAddReviseLoop();
          }}
          // Anchored to the right edge — where the back-edge's return arc
          // attaches — and tinted amber to match the rendered back-edge.
          className={cn(
            'absolute -right-3 top-1/2 z-10 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border bg-background text-amber-600 shadow-sm transition-colors dark:text-amber-400',
            'opacity-0 hover:border-amber-500 hover:text-amber-600 group-hover:opacity-100 focus-visible:opacity-100 dark:hover:text-amber-400',
          )}
        >
          <IterationCcw className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

export interface NodePaletteProps {
  locale?: string;
  /** Node types to offer. Defaults to the hardcoded {@link NODE_PALETTE}. */
  items?: PaletteItem[];
  onPick: (type: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The trigger button — rendered as the Popover anchor. */
  children: React.ReactNode;
}

/**
 * objectui#11778 — the palette's node types as one flat option list, for the
 * inspector's Node Type select: the order the palette shows them in (category
 * sections in {@link NODE_CATEGORY_ORDER}, registry order inside each) and the
 * palette's display names. One list for both, so the select can offer every
 * type the palette adds (`notify` included) and none it does not.
 */
export function paletteTypeOptions(
  items: PaletteItem[],
  locale?: string,
): Array<{ value: string; label: string }> {
  const rank = (item: PaletteItem) => NODE_CATEGORY_ORDER.indexOf(item.category ?? nodeCategory(item.type));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index)
    .map(({ item }) => ({ value: item.type, label: translateNodeLabel(item.type, locale, item.label) }));
}

/** Section heading style shared by the category groups and the recents group. */
const PALETTE_GROUP_CLASS =
  'p-0 [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1 ' +
  '[&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold ' +
  '[&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.08em] ' +
  '[&_[cmdk-group-heading]]:text-muted-foreground ' +
  '[&:not(:first-child)]:mt-1 [&:not(:first-child)]:border-t [&:not(:first-child)]:border-border/60 [&:not(:first-child)]:pt-1';

/**
 * Searchable popover listing the node types an author can add (#1943).
 * Grouped by category when the query is empty; typing filters across all
 * categories (label + hint + type, case-insensitive). Built on cmdk's
 * `Command` for ↑/↓ + Enter keyboard navigation — with `shouldFilter`
 * disabled so our exact substring filter keeps the canonical category order
 * instead of cmdk's fuzzy re-ranking. A "Recently used" group (localStorage
 * MRU) tops the empty-query view.
 */
export function NodePalette({ locale, items = NODE_PALETTE, onPick, open, onOpenChange, children }: NodePaletteProps) {
  const [q, setQ] = React.useState('');
  // Per-user "recently used" (cloud-synced when a provider is mounted; falls
  // back to a localStorage MRU outside one — tests, the dev preview gallery).
  const { recents, recordRecent } = useFlowPaletteRecents();
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  // Watching `open` (not onOpenChange) covers both close paths: outside-click/
  // Escape fires onOpenChange, but a pick closes via the parent's setState
  // only. Render-phase adjustment (not an effect) per react.dev's "adjusting
  // state when a prop changes" — clear the query when the palette closes.
  const [prevOpen, setPrevOpen] = React.useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setQ('');
  }

  const query = q.trim().toLowerCase();

  // Filter before grouping, so a query naturally matches across every
  // category — including server-merged plugin items (they are just entries in
  // `items`). `type` is matched too so plugin nodes are findable by their
  // registered type even when a descriptor's display name differs.
  const filtered = React.useMemo(() => {
    if (!query) return items;
    return items.filter(
      (i) =>
        i.label.toLowerCase().includes(query) ||
        (i.hint ?? '').toLowerCase().includes(query) ||
        i.type.toLowerCase().includes(query) ||
        // Also match the localized label/hint so a zh-CN author can search in
        // Chinese (the display strings differ from the English `label`).
        translateNodeLabel(i.type, locale, i.label).toLowerCase().includes(query) ||
        (translateNodeHint(i.type, locale, i.hint) ?? '').toLowerCase().includes(query),
    );
  }, [items, query, locale]);

  // Bucket items by category (falling back to the type's inferred category, so
  // engine-only / plugin nodes still land in a sensible section), then render
  // sections in the canonical order. Empty sections are skipped.
  const grouped = React.useMemo(() => {
    const buckets = new Map<NodeCategory, PaletteItem[]>();
    for (const item of filtered) {
      const cat = item.category ?? nodeCategory(item.type);
      const list = buckets.get(cat) ?? [];
      list.push(item);
      buckets.set(cat, list);
    }
    return NODE_CATEGORY_ORDER.map((cat) => [cat, buckets.get(cat) ?? []] as const).filter(
      ([, list]) => list.length > 0,
    );
  }, [filtered]);

  // "Recently used" — empty-query state only, intersected against the live
  // items so types from since-uninstalled plugins silently drop out.
  const recentItems = React.useMemo(() => {
    if (query) return [];
    const byType = new Map(items.map((i) => [i.type, i] as const));
    return recents.map((t) => byType.get(t)).filter((i): i is PaletteItem => !!i);
  }, [items, recents, query]);

  const handlePick = (type: string) => {
    recordRecent(type);
    onPick(type);
  };

  const renderItem = (item: PaletteItem, recent?: boolean) => {
    const tone = nodeTone(item.type);
    // Localize the built-in node types; server/plugin descriptors keep their
    // own (server-authoritative) label/hint via the fallback.
    const label = translateNodeLabel(item.type, locale, item.label);
    const hint = translateNodeHint(item.type, locale, item.hint);
    return (
      <CommandItem
        key={recent ? `recent:${item.type}` : item.type}
        // cmdk requires unique values; recents duplicate grouped entries.
        value={recent ? `recent:${item.type}` : item.type}
        onSelect={() => handlePick(item.type)}
        className="gap-2.5 rounded-lg px-2 py-1.5 [&_svg]:size-[15px]"
      >
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tone.chip)}>
          <NodeTypeIcon type={item.type} className={cn('h-[15px] w-[15px]', tone.icon)} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium">{label}</div>
          {hint && <div className="truncate text-[11px] text-muted-foreground">{hint}</div>}
        </div>
      </CommandItem>
    );
  };

  // Radix Popover (portaled to <body>) — the flow canvas root is
  // `overflow-hidden` (pan/zoom), so an `absolute` panel used to be clipped at
  // the canvas edge instead of overlaying it. Portaling escapes that clip.
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={6}
        className="w-60 overflow-hidden rounded-xl border bg-popover/95 p-0 shadow-xl shadow-foreground/[0.08] ring-1 ring-black/[0.03] backdrop-blur-md"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
        // objectui#11778 — a palette opened from an edge or a node card sits
        // INSIDE the canvas viewport in the React tree (the portal moves only
        // the DOM), so a press on an item would bubble to the viewport's pan
        // handler: it clears the selection and takes pointer capture, and the
        // browser then fires the click at the viewport, not at the item
        // (objectui#11546's shape). The press is the palette's.
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Command shouldFilter={false} loop className="bg-transparent">
          <CommandInput
            ref={inputRef}
            value={q}
            onValueChange={setQ}
            placeholder={tr('engine.flowPalette.search', locale)}
            className="h-9 text-[13px]"
          />
          <CommandList className="max-h-[56vh] p-1">
            <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
              {tr('engine.flowPalette.empty', locale)}
            </CommandEmpty>
            {recentItems.length > 0 && (
              <CommandGroup heading={tr('engine.flowPalette.recent', locale)} className={PALETTE_GROUP_CLASS}>
                {recentItems.map((item) => renderItem(item, true))}
              </CommandGroup>
            )}
            {grouped.map(([category, list]) => (
              <CommandGroup
                key={category}
                heading={tr(`engine.flowPalette.category.${category.toLowerCase()}`, locale)}
                className={PALETTE_GROUP_CLASS}
              >
                {list.map((item) => renderItem(item))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
