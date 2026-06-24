// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module studio/flow-builder
 *
 * Studio Flow Builder Protocol
 *
 * Defines the specification for the visual Flow Builder (automation canvas)
 * within ObjectStack Studio. Covers:
 * - **Node Shape Registry**: Shape and visual style per FlowNodeAction type
 * - **Canvas Node**: Position, size, and rendering hints for each node on canvas
 * - **Canvas Edge**: Visual properties for sequence flows (normal, default, fault, back-edge)
 * - **Flow Builder Config**: Canvas settings, palette, minimap, and toolbar
 *
 * ## Architecture
 *
 * ```
 * ┌──────────────────────────────────────────────────────────────┐
 * │  Toolbar (run / save / undo / zoom / layout)                │
 * ├──────────┬───────────────────────────────────┬───────────────┤
 * │  Node    │       Canvas                      │  Property     │
 * │  Palette │  ┌─────┐    ┌──────────┐          │  Panel        │
 * │          │  │start│───▶│ decision │──▶ ...   │  (node-aware) │
 * │  ─ BPMN  │  └─────┘    └──────────┘          │               │
 * │  ─ CRUD  │       ┌──────────┐                │  ─ config     │
 * │  ─ Logic │       │parallel  │                │  ─ edges      │
 * │  ─ HTTP  │       │ gateway  │                │  ─ validation │
 * ├──────────┴───────────────────────────────────┴───────────────┤
 * │  Minimap / Zoom Controls                                     │
 * └──────────────────────────────────────────────────────────────┘
 * ```
 */

import { z } from 'zod';

// ─── Node Shape ──────────────────────────────────────────────────────

/**
 * Shape used to render a flow node on the canvas.
 * Matches BPMN conventions where applicable.
 */
import { lazySchema } from '../shared/lazy-schema';
export const FlowNodeShapeSchema = lazySchema(() => z.enum([
  'rounded_rect',   // Default activity shape (assignments, CRUD, HTTP, script, subflow)
  'circle',         // Start / End events
  'diamond',        // Decision (XOR gateway)
  'parallelogram',  // Loop / iteration
  'hexagon',        // Wait / timer event
  'diamond_thick',  // Parallel gateway (AND-split) & Join gateway (AND-join)
  'attached_circle', // Boundary event (attached to host node)
  'screen_rect',    // Screen / user-interaction node
]).describe('Visual shape for rendering a flow node on the canvas'));

export type FlowNodeShape = z.infer<typeof FlowNodeShapeSchema>;

/**
 * Maps each FlowNodeAction to its canvas rendering descriptor.
 * Used by the Studio flow canvas to determine shape, icon, and default size.
 */
export const FlowNodeRenderDescriptorSchema = lazySchema(() => z.object({
  /** The node action type this descriptor applies to */
  action: z.string().describe('FlowNodeAction value (e.g., "parallel_gateway")'),

  /** Visual shape on the canvas */
  shape: FlowNodeShapeSchema.describe('Shape to render'),

  /** Lucide icon name displayed inside the node */
  icon: z.string().describe('Lucide icon name'),

  /** Default label shown on the node when no user label is set */
  defaultLabel: z.string().describe('Default display label'),

  /** Default width in canvas pixels */
  defaultWidth: z.number().int().min(20).default(120).describe('Default width in pixels'),

  /** Default height in canvas pixels */
  defaultHeight: z.number().int().min(20).default(60).describe('Default height in pixels'),

  /** CSS color for the node fill */
  fillColor: z.string().default('#ffffff').describe('Node fill color (CSS value)'),

  /** CSS color for the node border */
  borderColor: z.string().default('#94a3b8').describe('Node border color (CSS value)'),

  /** Whether this node type can have boundary events attached */
  allowBoundaryEvents: z.boolean().default(false)
    .describe('Whether boundary events can be attached to this node type'),

  /** Category for palette grouping */
  paletteCategory: z.enum(['event', 'gateway', 'activity', 'data', 'subflow'])
    .describe('Palette category for grouping'),
}).describe('Visual render descriptor for a flow node type'));

export type FlowNodeRenderDescriptor = z.infer<typeof FlowNodeRenderDescriptorSchema>;

// ─── Canvas Node ─────────────────────────────────────────────────────

/**
 * A node instance on the flow canvas, containing position and visual overrides.
 */
export const FlowCanvasNodeSchema = lazySchema(() => z.object({
  /** Reference to the flow node id */
  nodeId: z.string().describe('Corresponding FlowNode.id'),

  /** X position on the canvas (pixels) */
  x: z.number().describe('X position on canvas'),

  /** Y position on the canvas (pixels) */
  y: z.number().describe('Y position on canvas'),

  /** Width override (pixels, optional — uses descriptor default) */
  width: z.number().int().min(20).optional().describe('Width override in pixels'),

  /** Height override (pixels, optional — uses descriptor default) */
  height: z.number().int().min(20).optional().describe('Height override in pixels'),

  /** Whether the node is collapsed (hides internal details) */
  collapsed: z.boolean().default(false).describe('Whether the node is collapsed'),

  /** Custom fill color override */
  fillColor: z.string().optional().describe('Fill color override'),

  /** Custom border color override */
  borderColor: z.string().optional().describe('Border color override'),

  /** User-defined comment/annotation visible on canvas */
  annotation: z.string().optional().describe('User annotation displayed near the node'),
}).describe('Canvas layout data for a flow node'));

export type FlowCanvasNode = z.infer<typeof FlowCanvasNodeSchema>;

// ─── Canvas Edge ─────────────────────────────────────────────────────

/**
 * Visual style for a sequence flow edge on the canvas. The `back` style marks an
 * ADR-0044 declared back-edge (a `revise` loop's resubmit edge): consumers render
 * it as a distinct curved/dashed return arc, set apart from forward flow.
 */
export const FlowCanvasEdgeStyleSchema = lazySchema(() => z.enum([
  'solid',    // Normal sequence flow
  'dashed',   // Default sequence flow (isDefault: true)
  'dotted',   // Conditional edge
  'bold',     // Fault / error edge
  'back',     // ADR-0044 back-edge (revise loop) — curved dashed return arc
]).describe('Edge line style'));

export type FlowCanvasEdgeStyle = z.infer<typeof FlowCanvasEdgeStyleSchema>;

/**
 * A sequence-flow edge on the flow canvas with visual properties.
 */
export const FlowCanvasEdgeSchema = lazySchema(() => z.object({
  /** Reference to the flow edge id */
  edgeId: z.string().describe('Corresponding FlowEdge.id'),

  /** Line style */
  style: FlowCanvasEdgeStyleSchema.default('solid').describe('Line style'),

  /** Line color (CSS value) */
  color: z.string().default('#94a3b8').describe('Edge line color'),

  /** Label position along the edge (0–1, 0.5 = midpoint) */
  labelPosition: z.number().min(0).max(1).default(0.5)
    .describe('Position of the condition label along the edge'),

  /** Optional waypoints for routing the edge around nodes */
  waypoints: z.array(z.object({
    x: z.number().describe('Waypoint X'),
    y: z.number().describe('Waypoint Y'),
  })).optional().describe('Manual waypoints for edge routing'),

  /** Whether to show an animated flow indicator */
  animated: z.boolean().default(false).describe('Show animated flow indicator'),
}).describe('Canvas layout and visual data for a flow edge'));

export type FlowCanvasEdge = z.infer<typeof FlowCanvasEdgeSchema>;

// ─── Flow Canvas Layout ──────────────────────────────────────────────

/**
 * Auto-layout algorithm for the flow canvas.
 */
export const FlowLayoutAlgorithmSchema = lazySchema(() => z.enum([
  'dagre',       // Directed acyclic graph layout (top-down or left-right)
  'elk',         // Eclipse Layout Kernel (advanced hierarchical)
  'force',       // Force-directed graph
  'manual',      // User-positioned (no auto-layout)
]).describe('Auto-layout algorithm for the flow canvas'));

export type FlowLayoutAlgorithm = z.infer<typeof FlowLayoutAlgorithmSchema>;

/**
 * Direction for the auto-layout.
 */
export const FlowLayoutDirectionSchema = lazySchema(() => z.enum([
  'TB',  // Top to bottom
  'BT',  // Bottom to top
  'LR',  // Left to right
  'RL',  // Right to left
]).describe('Auto-layout direction'));

export type FlowLayoutDirection = z.infer<typeof FlowLayoutDirectionSchema>;

// ─── Flow Builder Config ─────────────────────────────────────────────

/**
 * Flow Builder configuration — top-level config for the Studio
 * automation flow canvas editor.
 */
export const FlowBuilderConfigSchema = lazySchema(() => z.object({
  /** Canvas snap settings */
  snap: z.object({
    enabled: z.boolean().default(true).describe('Enable snap-to-grid'),
    gridSize: z.number().int().min(1).default(16).describe('Snap grid size in pixels'),
    showGrid: z.boolean().default(true).describe('Show grid overlay'),
  }).default({ enabled: true, gridSize: 16, showGrid: true })
    .describe('Canvas snap-to-grid settings'),

  /** Canvas zoom settings */
  zoom: z.object({
    min: z.number().min(0.1).default(0.25).describe('Minimum zoom level'),
    max: z.number().max(10).default(3).describe('Maximum zoom level'),
    default: z.number().default(1).describe('Default zoom level'),
    step: z.number().default(0.1).describe('Zoom step'),
  }).default({ min: 0.25, max: 3, default: 1, step: 0.1 })
    .describe('Canvas zoom settings'),

  /** Auto-layout algorithm */
  layoutAlgorithm: FlowLayoutAlgorithmSchema.default('dagre')
    .describe('Default auto-layout algorithm'),

  /** Auto-layout direction */
  layoutDirection: FlowLayoutDirectionSchema.default('TB')
    .describe('Default auto-layout direction'),

  /** Node render descriptors (override defaults per node type) */
  nodeDescriptors: z.array(FlowNodeRenderDescriptorSchema).optional()
    .describe('Custom node render descriptors (merged with built-in defaults)'),

  /** Show minimap for navigation */
  showMinimap: z.boolean().default(true).describe('Show minimap panel'),

  /** Show the node property panel */
  showPropertyPanel: z.boolean().default(true).describe('Show property panel'),

  /** Show the node palette sidebar */
  showPalette: z.boolean().default(true).describe('Show node palette sidebar'),

  /** Maximum undo history steps */
  undoLimit: z.number().int().min(1).default(50).describe('Maximum undo history steps'),

  /** Enable edge animation during execution preview */
  animateExecution: z.boolean().default(true)
    .describe('Animate edges during execution preview'),

  /** Connection validation — prevent invalid edges (e.g., duplicate, self-loop) */
  connectionValidation: z.boolean().default(true)
    .describe('Validate connections before creating edges'),
}).describe('Studio Flow Builder configuration'));

export type FlowBuilderConfig = z.infer<typeof FlowBuilderConfigSchema>;

// ─── Built-in Node Descriptors ───────────────────────────────────────

/**
 * Built-in node render descriptors for all standard FlowNodeAction types.
 * Studio implementations should merge user overrides on top of these defaults.
 */
export const BUILT_IN_NODE_DESCRIPTORS: FlowNodeRenderDescriptor[] = [
  { action: 'start', shape: 'circle', icon: 'play', defaultLabel: 'Start', defaultWidth: 60, defaultHeight: 60, fillColor: '#dcfce7', borderColor: '#16a34a', allowBoundaryEvents: false, paletteCategory: 'event' },
  { action: 'end', shape: 'circle', icon: 'square', defaultLabel: 'End', defaultWidth: 60, defaultHeight: 60, fillColor: '#fee2e2', borderColor: '#dc2626', allowBoundaryEvents: false, paletteCategory: 'event' },
  { action: 'decision', shape: 'diamond', icon: 'git-branch', defaultLabel: 'Decision', defaultWidth: 80, defaultHeight: 80, fillColor: '#fef9c3', borderColor: '#ca8a04', allowBoundaryEvents: false, paletteCategory: 'gateway' },
  { action: 'parallel_gateway', shape: 'diamond_thick', icon: 'git-fork', defaultLabel: 'Parallel Gateway', defaultWidth: 80, defaultHeight: 80, fillColor: '#dbeafe', borderColor: '#2563eb', allowBoundaryEvents: false, paletteCategory: 'gateway' },
  { action: 'join_gateway', shape: 'diamond_thick', icon: 'git-merge', defaultLabel: 'Join Gateway', defaultWidth: 80, defaultHeight: 80, fillColor: '#dbeafe', borderColor: '#2563eb', allowBoundaryEvents: false, paletteCategory: 'gateway' },
  { action: 'wait', shape: 'hexagon', icon: 'clock', defaultLabel: 'Wait', defaultWidth: 100, defaultHeight: 60, fillColor: '#f3e8ff', borderColor: '#7c3aed', allowBoundaryEvents: true, paletteCategory: 'event' },
  { action: 'boundary_event', shape: 'attached_circle', icon: 'alert-circle', defaultLabel: 'Boundary Event', defaultWidth: 40, defaultHeight: 40, fillColor: '#fff7ed', borderColor: '#ea580c', allowBoundaryEvents: false, paletteCategory: 'event' },
  { action: 'assignment', shape: 'rounded_rect', icon: 'pen-line', defaultLabel: 'Assignment', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'activity' },
  { action: 'create_record', shape: 'rounded_rect', icon: 'plus-circle', defaultLabel: 'Create Record', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'data' },
  { action: 'update_record', shape: 'rounded_rect', icon: 'edit', defaultLabel: 'Update Record', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'data' },
  { action: 'delete_record', shape: 'rounded_rect', icon: 'trash-2', defaultLabel: 'Delete Record', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'data' },
  { action: 'get_record', shape: 'rounded_rect', icon: 'search', defaultLabel: 'Get Record', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'data' },
  { action: 'http_request', shape: 'rounded_rect', icon: 'globe', defaultLabel: 'HTTP Request', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'activity' },
  { action: 'script', shape: 'rounded_rect', icon: 'code', defaultLabel: 'Script', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'activity' },
  { action: 'screen', shape: 'screen_rect', icon: 'monitor', defaultLabel: 'Screen', defaultWidth: 140, defaultHeight: 80, fillColor: '#f0f9ff', borderColor: '#0284c7', allowBoundaryEvents: false, paletteCategory: 'activity' },
  { action: 'loop', shape: 'parallelogram', icon: 'repeat', defaultLabel: 'Loop', defaultWidth: 120, defaultHeight: 60, fillColor: '#fef3c7', borderColor: '#d97706', allowBoundaryEvents: true, paletteCategory: 'activity' },
  { action: 'subflow', shape: 'rounded_rect', icon: 'layers', defaultLabel: 'Subflow', defaultWidth: 140, defaultHeight: 70, fillColor: '#ede9fe', borderColor: '#7c3aed', allowBoundaryEvents: true, paletteCategory: 'subflow' },
  { action: 'connector_action', shape: 'rounded_rect', icon: 'plug', defaultLabel: 'Connector', defaultWidth: 120, defaultHeight: 60, fillColor: '#ffffff', borderColor: '#94a3b8', allowBoundaryEvents: true, paletteCategory: 'activity' },
];

// ─── Helper: defineFlowBuilderConfig ─────────────────────────────────

/**
 * Type-safe helper for defining Flow Builder configuration.
 *
 * @example
 * ```typescript
 * const config = defineFlowBuilderConfig({
 *   layoutAlgorithm: 'dagre',
 *   layoutDirection: 'LR',
 *   showMinimap: true,
 *   snap: { gridSize: 20 },
 * });
 * ```
 */
export function defineFlowBuilderConfig(
  input: z.input<typeof FlowBuilderConfigSchema>,
): FlowBuilderConfig {
  return FlowBuilderConfigSchema.parse(input);
}
