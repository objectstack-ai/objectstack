// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * flow-region-view — read-only rendering of a structured control-flow region
 * (ADR-0031 `loop.body` / `parallel.branches[]` / `try_catch.try`/`catch`) as a
 * nested mini-canvas inside its container's card on the flow designer canvas
 * (#2670, Phase 1).
 *
 * It reuses the top-level canvas layout math (`computeLayout` / `diagramSize` /
 * `forwardEdgeRoute`) at full scale, then fits the whole region into the container's
 * width with a single CSS `scale` transform — so there is **no new layout
 * engine**, and a region reads as the same top-to-bottom flow as the parent
 * graph. Read-only: no drag / insert; a nested container inside a region renders
 * as a plain box (recursive on-canvas expansion is a later increment).
 */

import * as React from 'react';
import { cn } from '@object-ui/components';
import {
  computeLayout,
  diagramSize,
  forwardEdgeRoute,
  bottomAnchor,
  topAnchor,
  isBackEdge,
  rightAnchor,
  backEdgePath,
  NODE_W,
  NODE_H,
  type FlowDesignerNode,
  type LabeledRegion,
} from './flow-canvas-layout.js';
import { NodeTypeIcon, nodeTone } from './flow-canvas-parts.js';
import { REGION_BLOCK_PAD, REGION_GAP, REGION_LABEL_H } from './flow-region-metrics.js';
// The localized region header: `extractRegions` bakes English structural
// fallbacks, and `displayRegionLabel` translates them at render, keyed off the
// stable region `key`. It lives in its own module so the nested-node inspector
// breadcrumb reads the same rows (objectui#10696).
import { displayRegionLabel } from './flow-region-label.js';

/**
 * Node box inside a region — a compact echo of `NodeCard`. Read-only by default
 * (identical to Phase 1/2); when `onSelect` is supplied it becomes a selectable
 * control (button role, keyboard, selection ring) so a nested node can be routed
 * to the shared inspector (#2670 Phase 3). The `data-region-node-id` hook is
 * always emitted for test / deep-link targeting.
 */
function RegionNode({
  node,
  x,
  y,
  selected,
  onSelect,
}: {
  node: FlowDesignerNode;
  x: number;
  y: number;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const tone = nodeTone(node.type);
  const interactive = !!onSelect;
  return (
    <div
      data-region-node-id={node.id}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? !!selected : undefined}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation();
              onSelect();
            }
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                onSelect();
              }
            }
          : undefined
      }
      className={cn(
        'absolute flex items-center gap-2 rounded-lg border bg-card px-2 py-1.5 shadow-sm',
        interactive && 'cursor-pointer',
        selected ? 'border-primary ring-2 ring-primary/30' : 'border-border/70',
      )}
      style={{ left: x, top: y, width: NODE_W, height: NODE_H }}
    >
      <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tone.chip)}>
        <NodeTypeIcon type={node.type} className={cn('h-4 w-4', tone.icon)} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-semibold leading-tight text-foreground" title={node.label || node.id}>
          {node.label || node.id}
        </div>
        <div className={cn('text-[10px] font-semibold uppercase tracking-[0.08em]', tone.label)}>{node.type}</div>
      </div>
    </div>
  );
}

/** One region laid out with the shared engine, then scaled to fit `maxWidth`. */
function RegionCanvas({
  region,
  maxWidth,
  selectedNodeId,
  onSelectNode,
}: {
  region: LabeledRegion;
  maxWidth: number;
  selectedNodeId?: string | null;
  onSelectNode?: (node: FlowDesignerNode) => void;
}) {
  const layout = React.useMemo(() => computeLayout(region.nodes, region.edges), [region.nodes, region.edges]);
  const { width, height } = React.useMemo(() => diagramSize(layout), [layout]);
  const scale = Math.min(1, maxWidth / Math.max(width, 1));
  return (
    <div className="relative" style={{ width: width * scale, height: height * scale }}>
      <div
        className="absolute left-0 top-0"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}
      >
        <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={width} height={height}>
          {region.edges.map((edge, i) => {
            const sp = layout.get(edge.source);
            const tp = layout.get(edge.target);
            if (!sp || !tp) return null;
            const back = isBackEdge(edge);
            const from = back ? rightAnchor(sp) : bottomAnchor(sp);
            const to = back ? rightAnchor(tp) : topAnchor(tp);
            // objectui#13144 — routed around a node it would cross, as on the top-level canvas.
            const obstacles = region.nodes
              .filter((n) => n.id !== edge.source && n.id !== edge.target)
              .flatMap((n) => {
                const p = layout.get(n.id);
                return p ? [{ x: p.x, y: p.y, width: NODE_W, height: NODE_H }] : [];
              });
            return (
              <path
                key={edge.id || `${edge.source}-${edge.target}-${i}`}
                d={back ? backEdgePath(from, to) : forwardEdgeRoute(from, to, obstacles).d}
                strokeDasharray={back ? '5 4' : undefined}
                className={cn('fill-none', back ? 'stroke-amber-500/60' : 'stroke-muted-foreground/40')}
                strokeWidth={1.5}
              />
            );
          })}
        </svg>
        {region.nodes.map((n) => {
          const p = layout.get(n.id);
          return p ? (
            <RegionNode
              key={n.id}
              node={n}
              x={p.x}
              y={p.y}
              selected={selectedNodeId === n.id}
              onSelect={onSelectNode ? () => onSelectNode(n) : undefined}
            />
          ) : null;
        })}
      </div>
    </div>
  );
}

/**
 * Render a container's nested regions read-only, each fit to `maxWidth`, with a
 * header per region (`Branch N` / `Try` / `Catch`; a loop body has no header).
 */
export function FlowRegionView({
  regions,
  maxWidth,
  selected,
  onSelectNode,
  locale,
}: {
  regions: LabeledRegion[];
  maxWidth: number;
  /** The selected nested node, scoped to its region — highlighted with a ring. */
  selected?: { regionKey: string; nodeId: string } | null;
  /** Selecting a nested node, tagged with its region key (for the container path). */
  onSelectNode?: (regionKey: string, node: FlowDesignerNode) => void;
  /** UI locale for the region header labels. */
  locale?: string;
}) {
  // #2670: every dimension in this height stack is an explicit px from
  // flow-region-metrics so the layout height PREDICTOR matches the DOM exactly
  // (rem-based Tailwind spacing and font-metric line-heights would drift).
  return (
    <div className="flex flex-col" style={{ gap: REGION_GAP }}>
      {regions.map((region) => {
        const label = displayRegionLabel(region, locale);
        return (
        <div
          key={region.key}
          className="rounded-md border border-dashed border-border/60 bg-muted/20"
          style={{ padding: REGION_BLOCK_PAD }}
        >
          {label && (
            <div
              className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground/80"
              style={{ height: REGION_LABEL_H, lineHeight: '12px', paddingBottom: 4 }}
            >
              {label}
            </div>
          )}
          <RegionCanvas
            region={region}
            maxWidth={maxWidth}
            selectedNodeId={selected && selected.regionKey === region.key ? selected.nodeId : null}
            onSelectNode={onSelectNode ? (node) => onSelectNode(region.key, node) : undefined}
          />
        </div>
        );
      })}
    </div>
  );
}
