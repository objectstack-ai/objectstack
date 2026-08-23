// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @module studio/object-designer
 *
 * Object Designer Protocol — Visual Field Editor, Relationship Mapper & ER Diagram
 *
 * Defines the specification for the Object Designer experience within ObjectStack Studio,
 * including:
 * - **Field Editor**: Visual field creation/editing with type-aware property panels
 * - **Relationship Mapper**: Visual lookup/master-detail relationship configuration
 * - **ER Diagram**: Entity-Relationship diagram rendering and interaction
 * - **Object Manager**: Unified object list with search, filtering, and bulk operations
 *
 * ## Architecture
 *
 * The Object Designer is composed of four interconnected panels:
 *
 * ```
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     Object Manager (list / search)             │
 * ├──────────────┬──────────────────────────┬──────────────────────┤
 * │  Object List │  Field Editor            │  Property Panel      │
 * │  (sidebar)   │  (table + inline edit)   │  (type-specific)     │
 * │              │                          │                      │
 * │  ─ search    │  ─ drag-to-reorder       │  ─ constraints       │
 * │  ─ filter    │  ─ inline type picker    │  ─ validation        │
 * │  ─ group     │  ─ batch add/remove      │  ─ security          │
 * │  ─ create    │  ─ field groups           │  ─ relationships     │
 * ├──────────────┴──────────────────────────┴──────────────────────┤
 * │                     ER Diagram (toggle panel)                  │
 * │  ─ auto-layout (force / hierarchy / grid)                     │
 * │  ─ interactive: click node → navigate to object               │
 * │  ─ hover: highlight connected relationships                   │
 * │  ─ zoom/pan/minimap                                           │
 * └─────────────────────────────────────────────────────────────────┘
 * ```
 *
 * @example
 * <!-- os:check -->
 * ```typescript
 * import {
 *   ObjectDesignerConfigSchema,
 *   ERDiagramConfigSchema,
 * } from '@objectstack/spec/studio';
 *
 * const config = ObjectDesignerConfigSchema.parse({
 *   defaultView: 'field-editor',
 *   fieldEditor: {
 *     inlineEditing: true,
 *     dragReorder: true,
 *     showFieldGroups: true,
 *   },
 *   erDiagram: {
 *     enabled: true,
 *     layout: 'force',
 *     showFieldDetails: true,
 *   },
 * });
 * ```
 */

import { z } from 'zod';

// ─── Field Editor ────────────────────────────────────────────────────

/**
 * Field property panel section — groups related field properties
 * in the right-side property inspector.
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';

/**
 * Shared history for this file (#4001).
 *
 * The object designer is the surface where a human shapes the data model, so a
 * dropped key here quietly narrows what the designer can express — a field group
 * that never renders, a filter that never applies — while the designer itself
 * looks like it is working.
 */
const OBJECT_DESIGNER_HISTORY =
  'Until #4001 closed these shapes an unknown key was dropped silently — the designer still '
  + 'rendered, without whatever the key was meant to configure.';

export const FieldPropertySectionSchema = lazySchema(() => strictObject({
  surface: 'this field property section',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Unique section key */
  key: z.string().describe('Section key (e.g., "basics", "constraints", "security")'),

  /** Display label */
  label: z.string().describe('Section display label'),

  /** Lucide icon name */
  icon: z.string().optional().describe('Lucide icon name'),

  /** Whether section is expanded by default */
  defaultExpanded: z.boolean().default(true).describe('Whether section is expanded by default'),

  /** Sort order — lower values appear first */
  order: z.number().default(0).describe('Sort order (lower = higher)'),
}));

export type FieldPropertySection = z.input<typeof FieldPropertySectionSchema>;
/** Post-parse shape of {@link FieldPropertySection} — defaults applied, transforms run (ADR-0122). */
export type FieldPropertySectionParsed = z.infer<typeof FieldPropertySectionSchema>;

/**
 * Field grouping configuration — organizes fields into collapsible groups
 * within the field editor table (e.g., "Contact Info", "Billing", "System").
 */
export const FieldGroupSchema = lazySchema(() => strictObject({
  surface: 'this field group',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Group key (matches field.group value) */
  key: z.string().describe('Group key matching field.group values'),

  /** Display label */
  label: z.string().describe('Group display label'),

  /** Lucide icon name */
  icon: z.string().optional().describe('Lucide icon name'),

  /** Whether group is expanded by default */
  defaultExpanded: z.boolean().default(true).describe('Whether group is expanded by default'),

  /** Sort order — lower values appear first */
  order: z.number().default(0).describe('Sort order (lower = higher)'),
}));

export type FieldGroup = z.input<typeof FieldGroupSchema>;
/** Post-parse shape of {@link FieldGroup} — defaults applied, transforms run (ADR-0122). */
export type FieldGroupParsed = z.infer<typeof FieldGroupSchema>;

/**
 * Field Editor configuration — controls the visual field editing experience.
 */
export const FieldEditorConfigSchema = lazySchema(() => strictObject({
  surface: 'this field editor configuration',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Enable inline editing of field properties in the table */
  inlineEditing: z.boolean().default(true).describe('Enable inline editing of field properties'),

  /** Enable drag-and-drop field reordering */
  dragReorder: z.boolean().default(true).describe('Enable drag-and-drop field reordering'),

  /** Show field group headers for organizing fields */
  showFieldGroups: z.boolean().default(true).describe('Show field group headers'),

  /** Show the type-specific property panel on the right */
  showPropertyPanel: z.boolean().default(true).describe('Show the right-side property panel'),

  /** Default property panel sections to display */
  propertySections: z.array(FieldPropertySectionSchema).default([
    { key: 'basics', label: 'Basic Properties', defaultExpanded: true, order: 0 },
    { key: 'constraints', label: 'Constraints & Validation', defaultExpanded: true, order: 10 },
    { key: 'relationship', label: 'Relationship Config', defaultExpanded: true, order: 20 },
    { key: 'display', label: 'Display & UI', defaultExpanded: false, order: 30 },
    { key: 'security', label: 'Security & Compliance', defaultExpanded: false, order: 40 },
    { key: 'advanced', label: 'Advanced', defaultExpanded: false, order: 50 },
  ]).describe('Property panel section definitions'),

  /** Field groups for organizing fields in the editor */
  fieldGroups: z.array(FieldGroupSchema).default([]).describe('Field group definitions'),

  /** Maximum fields before pagination kicks in */
  paginationThreshold: z.number().default(50).describe('Number of fields before pagination is enabled'),

  /** Enable batch field operations (add multiple fields at once) */
  batchOperations: z.boolean().default(true).describe('Enable batch add/remove field operations'),

  /** Show field usage statistics (views, formulas, relationships referencing this field) */
  showUsageStats: z.boolean().default(false).describe('Show field usage statistics'),
}));

export type FieldEditorConfig = z.input<typeof FieldEditorConfigSchema>;
/** Post-parse shape of {@link FieldEditorConfig} — defaults applied, transforms run (ADR-0122). */
export type FieldEditorConfigParsed = z.infer<typeof FieldEditorConfigSchema>;

// ─── Relationship Mapper ─────────────────────────────────────────────

/**
 * Relationship display configuration — controls how relationships
 * are visualized in the mapper and ER diagram.
 */
export const RelationshipDisplaySchema = lazySchema(() => strictObject({
  surface: 'this relationship display',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Relationship type to configure */
  type: z.enum(['lookup', 'master_detail', 'tree']).describe('Relationship type'),

  /** Line style for this relationship type */
  lineStyle: z.enum(['solid', 'dashed', 'dotted']).default('solid').describe('Line style in diagrams'),

  /** Line color (CSS color value) */
  color: z.string().default('#94a3b8').describe('Line color (CSS value)'),

  /** Highlighted color on hover/select */
  highlightColor: z.string().default('#0891b2').describe('Highlighted color on hover/select'),

  /** Cardinality label to display */
  cardinalityLabel: z.string().default('1:N').describe('Cardinality label (e.g., "1:N", "1:1", "N:M")'),
}));

export type RelationshipDisplay = z.input<typeof RelationshipDisplaySchema>;
/** Post-parse shape of {@link RelationshipDisplay} — defaults applied, transforms run (ADR-0122). */
export type RelationshipDisplayParsed = z.infer<typeof RelationshipDisplaySchema>;

/**
 * Relationship Mapper configuration — controls the relationship
 * editing and visualization experience.
 */
export const RelationshipMapperConfigSchema = lazySchema(() => strictObject({
  surface: 'this relationship mapp configuration',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Enable visual relationship creation (drag from source to target) */
  visualCreation: z.boolean().default(true).describe('Enable drag-to-create relationships'),

  /** Show reverse relationships (child → parent) */
  showReverseRelationships: z.boolean().default(true).describe('Show reverse/child-to-parent relationships'),

  /** Show cascade delete warnings */
  showCascadeWarnings: z.boolean().default(true).describe('Show cascade delete behavior warnings'),

  /** Relationship display configuration by type */
  displayConfig: z.array(RelationshipDisplaySchema).default([
    { type: 'lookup', lineStyle: 'dashed', color: '#0891b2', highlightColor: '#06b6d4', cardinalityLabel: '1:N' },
    { type: 'master_detail', lineStyle: 'solid', color: '#ea580c', highlightColor: '#f97316', cardinalityLabel: '1:N' },
    { type: 'tree', lineStyle: 'dotted', color: '#8b5cf6', highlightColor: '#a78bfa', cardinalityLabel: '1:N' },
  ]).describe('Visual config per relationship type'),
}));

export type RelationshipMapperConfig = z.input<typeof RelationshipMapperConfigSchema>;
/** Post-parse shape of {@link RelationshipMapperConfig} — defaults applied, transforms run (ADR-0122). */
export type RelationshipMapperConfigParsed = z.infer<typeof RelationshipMapperConfigSchema>;

// ─── ER Diagram ──────────────────────────────────────────────────────

/** Layout algorithm for ER diagram */
export const ERLayoutAlgorithmSchema = lazySchema(() => z.enum([
  'force',      // Force-directed graph (natural clustering)
  'hierarchy',  // Top-down hierarchy (master → detail)
  'grid',       // Uniform grid layout
  'circular',   // Circular arrangement
]).describe('ER diagram layout algorithm'));

export type ERLayoutAlgorithm = z.input<typeof ERLayoutAlgorithmSchema>;

/**
 * Node display options — controls what information is shown
 * on each entity node in the ER diagram.
 */
export const ERNodeDisplaySchema = lazySchema(() => strictObject({
  surface: 'this e r node display',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Show field list within the node */
  showFields: z.boolean().default(true).describe('Show field list inside entity nodes'),

  /** Maximum fields to show before collapsing (0 = no limit) */
  maxFieldsVisible: z.number().default(8).describe('Max fields visible before "N more..." collapse'),

  /** Show field types alongside field names */
  showFieldTypes: z.boolean().default(true).describe('Show field type badges'),

  /** Show required field indicators */
  showRequiredIndicator: z.boolean().default(true).describe('Show required field indicators'),

  /** Show record count on each node (requires data access) */
  showRecordCount: z.boolean().default(false).describe('Show live record count on nodes'),

  /** Show object icon */
  showIcon: z.boolean().default(true).describe('Show object icon on node header'),

  /** Show object description on hover tooltip */
  showDescription: z.boolean().default(true).describe('Show description tooltip on hover'),
}));

export type ERNodeDisplay = z.input<typeof ERNodeDisplaySchema>;
/** Post-parse shape of {@link ERNodeDisplay} — defaults applied, transforms run (ADR-0122). */
export type ERNodeDisplayParsed = z.infer<typeof ERNodeDisplaySchema>;

/**
 * ER Diagram configuration — controls the entity-relationship
 * diagram rendering, interaction, and layout.
 */
export const ERDiagramConfigSchema = lazySchema(() => strictObject({
  surface: 'this e r diagram configuration',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Enable the ER diagram panel */
  enabled: z.boolean().default(true).describe('Enable ER diagram panel'),

  /** Default layout algorithm */
  layout: ERLayoutAlgorithmSchema.default('force').describe('Default layout algorithm'),

  /** Node display options */
  nodeDisplay: ERNodeDisplaySchema.default({
    showFields: true,
    maxFieldsVisible: 8,
    showFieldTypes: true,
    showRequiredIndicator: true,
    showRecordCount: false,
    showIcon: true,
    showDescription: true,
  }).describe('Node display configuration'),

  /** Show minimap for navigation */
  showMinimap: z.boolean().default(true).describe('Show minimap for large diagrams'),

  /** Enable zoom controls */
  zoomControls: z.boolean().default(true).describe('Show zoom in/out/fit controls'),

  /** Minimum zoom level */
  minZoom: z.number().default(0.1).describe('Minimum zoom level'),

  /** Maximum zoom level */
  maxZoom: z.number().default(3).describe('Maximum zoom level'),

  /** Show relationship labels (cardinality) on edges */
  showEdgeLabels: z.boolean().default(true).describe('Show cardinality labels on relationship edges'),

  /** Highlight connected entities on hover */
  highlightOnHover: z.boolean().default(true).describe('Highlight connected entities on node hover'),

  /** Click behavior: navigate to object designer */
  clickToNavigate: z.boolean().default(true).describe('Click node to navigate to object detail'),

  /** Enable drag-and-drop to create relationships */
  dragToConnect: z.boolean().default(true).describe('Drag between nodes to create relationships'),

  /** Filter to show only objects with relationships (hide orphans) */
  hideOrphans: z.boolean().default(false).describe('Hide objects with no relationships'),

  /** Auto-fit diagram to viewport on initial load */
  autoFit: z.boolean().default(true).describe('Auto-fit diagram to viewport on load'),

  /** Export diagram options */
  exportFormats: z.array(z.enum(['png', 'svg', 'json'])).default(['png', 'svg']).describe('Available export formats for diagram'),
}));

export type ERDiagramConfig = z.input<typeof ERDiagramConfigSchema>;
/** Post-parse shape of {@link ERDiagramConfig} — defaults applied, transforms run (ADR-0122). */
export type ERDiagramConfigParsed = z.infer<typeof ERDiagramConfigSchema>;

// ─── Object Manager ──────────────────────────────────────────────────

/** Object list display mode */
export const ObjectListDisplayModeSchema = lazySchema(() => z.enum([
  'table',      // Traditional table with columns
  'cards',      // Card grid (visual overview)
  'tree',       // Hierarchical tree (grouped by package/namespace)
]).describe('Object list display mode'));

export type ObjectListDisplayMode = z.input<typeof ObjectListDisplayModeSchema>;

/** Object list sort field */
export const ObjectSortFieldSchema = lazySchema(() => z.enum([
  'name',       // Sort by API name
  'label',      // Sort by display label
  'fieldCount', // Sort by number of fields
  'updatedAt',  // Sort by last modified
]).describe('Object list sort field'));

export type ObjectSortField = z.input<typeof ObjectSortFieldSchema>;

/** Object filter criteria */
export const ObjectFilterSchema = lazySchema(() => strictObject({
  surface: 'this object filter',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Filter by package/namespace */
  package: z.string().optional().describe('Filter by owning package'),

  /** Filter by tags */
  tags: z.array(z.string()).optional().describe('Filter by object tags'),

  /** Show system objects */
  includeSystem: z.boolean().default(true).describe('Include system-level objects'),

  /** Show abstract objects */
  includeAbstract: z.boolean().default(false).describe('Include abstract base objects'),

  /** Show only objects with specific field types */
  hasFieldType: z.string().optional().describe('Filter to objects containing a specific field type'),

  /** Show only objects with relationships */
  hasRelationships: z.boolean().optional().describe('Filter to objects with lookup/master_detail fields'),

  /** Text search across name, label, description */
  searchQuery: z.string().optional().describe('Free-text search across name, label, and description'),
}));

export type ObjectFilter = z.input<typeof ObjectFilterSchema>;
/** Post-parse shape of {@link ObjectFilter} — defaults applied, transforms run (ADR-0122). */
export type ObjectFilterParsed = z.infer<typeof ObjectFilterSchema>;

/**
 * Object Manager configuration — controls the unified object list,
 * search, and management experience.
 */
export const ObjectManagerConfigSchema = lazySchema(() => strictObject({
  surface: 'this object manag configuration',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Default display mode */
  defaultDisplayMode: ObjectListDisplayModeSchema.default('table').describe('Default list display mode'),

  /** Default sort field */
  defaultSortField: ObjectSortFieldSchema.default('label').describe('Default sort field'),

  /** Default sort direction */
  defaultSortDirection: z.enum(['asc', 'desc']).default('asc').describe('Default sort direction'),

  /** Default filters */
  defaultFilter: ObjectFilterSchema.default({
    includeSystem: true,
    includeAbstract: false,
  }).describe('Default filter configuration'),

  /** Show field count badge on each object row */
  showFieldCount: z.boolean().default(true).describe('Show field count badge'),

  /** Show relationship count badge */
  showRelationshipCount: z.boolean().default(true).describe('Show relationship count badge'),

  /** Show quick-preview tooltip with field list on hover */
  showQuickPreview: z.boolean().default(true).describe('Show quick field preview tooltip on hover'),

  /** Enable object comparison (diff two objects side-by-side) */
  enableComparison: z.boolean().default(false).describe('Enable side-by-side object comparison'),

  /** Show ER diagram toggle button in the toolbar */
  showERDiagramToggle: z.boolean().default(true).describe('Show ER diagram toggle in toolbar'),

  /** Show "Create Object" quick action */
  showCreateAction: z.boolean().default(true).describe('Show create object action'),

  /** Show object statistics summary bar (total objects, fields, relationships) */
  showStatsSummary: z.boolean().default(true).describe('Show statistics summary bar'),
}));

export type ObjectManagerConfig = z.input<typeof ObjectManagerConfigSchema>;
/** Post-parse shape of {@link ObjectManagerConfig} — defaults applied, transforms run (ADR-0122). */
export type ObjectManagerConfigParsed = z.infer<typeof ObjectManagerConfigSchema>;

// ─── Object Preview ──────────────────────────────────────────────────

/**
 * Preview tab configuration — defines the tabs available
 * when viewing a single object.
 */
export const ObjectPreviewTabSchema = lazySchema(() => strictObject({
  surface: 'this object preview tab',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Tab key */
  key: z.string().describe('Tab key'),

  /** Tab display label */
  label: z.string().describe('Tab display label'),

  /** Lucide icon name */
  icon: z.string().optional().describe('Lucide icon name'),

  /** Whether this tab is enabled */
  enabled: z.boolean().default(true).describe('Whether this tab is available'),

  /** Sort order */
  order: z.number().default(0).describe('Sort order (lower = higher)'),
}));

export type ObjectPreviewTab = z.input<typeof ObjectPreviewTabSchema>;
/** Post-parse shape of {@link ObjectPreviewTab} — defaults applied, transforms run (ADR-0122). */
export type ObjectPreviewTabParsed = z.infer<typeof ObjectPreviewTabSchema>;

/**
 * Object Preview configuration — defines the tabs and layout
 * when viewing/editing a single object's metadata.
 */
export const ObjectPreviewConfigSchema = lazySchema(() => strictObject({
  surface: 'this object preview configuration',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Tabs to show in the object detail view */
  tabs: z.array(ObjectPreviewTabSchema).default([
    { key: 'fields', label: 'Fields', icon: 'list', enabled: true, order: 0 },
    { key: 'relationships', label: 'Relationships', icon: 'link', enabled: true, order: 10 },
    { key: 'indexes', label: 'Indexes', icon: 'zap', enabled: true, order: 20 },
    { key: 'validations', label: 'Validations', icon: 'shield-check', enabled: true, order: 30 },
    { key: 'capabilities', label: 'Capabilities', icon: 'settings', enabled: true, order: 40 },
    { key: 'data', label: 'Data', icon: 'table-2', enabled: true, order: 50 },
    { key: 'api', label: 'API', icon: 'globe', enabled: true, order: 60 },
    { key: 'code', label: 'Code', icon: 'code-2', enabled: true, order: 70 },
  ]).describe('Object detail preview tabs'),

  /** Default active tab */
  defaultTab: z.string().default('fields').describe('Default active tab key'),

  /** Show object header with summary info */
  showHeader: z.boolean().default(true).describe('Show object summary header'),

  /** Show breadcrumbs */
  showBreadcrumbs: z.boolean().default(true).describe('Show navigation breadcrumbs'),
}));

export type ObjectPreviewConfig = z.input<typeof ObjectPreviewConfigSchema>;
/** Post-parse shape of {@link ObjectPreviewConfig} — defaults applied, transforms run (ADR-0122). */
export type ObjectPreviewConfigParsed = z.infer<typeof ObjectPreviewConfigSchema>;

// ─── Top-Level Object Designer Config ────────────────────────────────

/** Default view when entering the Object Designer */
export const ObjectDesignerDefaultViewSchema = lazySchema(() => z.enum([
  'field-editor',       // Field table editor (default)
  'relationship-mapper', // Visual relationship view
  'er-diagram',         // Full ER diagram
  'object-manager',     // Object list/manager
]).describe('Default view when entering the Object Designer'));

export type ObjectDesignerDefaultView = z.input<typeof ObjectDesignerDefaultViewSchema>;

/**
 * Object Designer configuration — top-level config that composes
 * all sub-configurations for the visual object design experience.
 *
 * @example
 * ```typescript
 * const config = ObjectDesignerConfigSchema.parse({
 *   defaultView: 'field-editor',
 *   fieldEditor: {
 *     inlineEditing: true,
 *     dragReorder: true,
 *     showFieldGroups: true,
 *   },
 *   erDiagram: {
 *     enabled: true,
 *     layout: 'force',
 *   },
 *   objectManager: {
 *     defaultDisplayMode: 'table',
 *     showERDiagramToggle: true,
 *   },
 * });
 * ```
 */
export const ObjectDesignerConfigSchema = lazySchema(() => strictObject({
  surface: 'this object design configuration',
  history: OBJECT_DESIGNER_HISTORY,
}, {
  /** Default view when opening the designer */
  defaultView: ObjectDesignerDefaultViewSchema.default('field-editor').describe('Default view'),

  /** Field editor configuration */
  fieldEditor: FieldEditorConfigSchema.default({
    inlineEditing: true,
    dragReorder: true,
    showFieldGroups: true,
    showPropertyPanel: true,
    propertySections: [
      { key: 'basics', label: 'Basic Properties', defaultExpanded: true, order: 0 },
      { key: 'constraints', label: 'Constraints & Validation', defaultExpanded: true, order: 10 },
      { key: 'relationship', label: 'Relationship Config', defaultExpanded: true, order: 20 },
      { key: 'display', label: 'Display & UI', defaultExpanded: false, order: 30 },
      { key: 'security', label: 'Security & Compliance', defaultExpanded: false, order: 40 },
      { key: 'advanced', label: 'Advanced', defaultExpanded: false, order: 50 },
    ],
    fieldGroups: [],
    paginationThreshold: 50,
    batchOperations: true,
    showUsageStats: false,
  }).describe('Field editor configuration'),

  /** Relationship mapper configuration */
  relationshipMapper: RelationshipMapperConfigSchema.default({
    visualCreation: true,
    showReverseRelationships: true,
    showCascadeWarnings: true,
    displayConfig: [
      { type: 'lookup', lineStyle: 'dashed', color: '#0891b2', highlightColor: '#06b6d4', cardinalityLabel: '1:N' },
      { type: 'master_detail', lineStyle: 'solid', color: '#ea580c', highlightColor: '#f97316', cardinalityLabel: '1:N' },
      { type: 'tree', lineStyle: 'dotted', color: '#8b5cf6', highlightColor: '#a78bfa', cardinalityLabel: '1:N' },
    ],
  }).describe('Relationship mapper configuration'),

  /** ER diagram configuration */
  erDiagram: ERDiagramConfigSchema.default({
    enabled: true,
    layout: 'force',
    nodeDisplay: {
      showFields: true,
      maxFieldsVisible: 8,
      showFieldTypes: true,
      showRequiredIndicator: true,
      showRecordCount: false,
      showIcon: true,
      showDescription: true,
    },
    showMinimap: true,
    zoomControls: true,
    minZoom: 0.1,
    maxZoom: 3,
    showEdgeLabels: true,
    highlightOnHover: true,
    clickToNavigate: true,
    dragToConnect: true,
    hideOrphans: false,
    autoFit: true,
    exportFormats: ['png', 'svg'],
  }).describe('ER diagram configuration'),

  /** Object manager configuration */
  objectManager: ObjectManagerConfigSchema.default({
    defaultDisplayMode: 'table',
    defaultSortField: 'label',
    defaultSortDirection: 'asc',
    defaultFilter: {
      includeSystem: true,
      includeAbstract: false,
    },
    showFieldCount: true,
    showRelationshipCount: true,
    showQuickPreview: true,
    enableComparison: false,
    showERDiagramToggle: true,
    showCreateAction: true,
    showStatsSummary: true,
  }).describe('Object manager configuration'),

  /** Object preview configuration */
  objectPreview: ObjectPreviewConfigSchema.default({
    tabs: [
      { key: 'fields', label: 'Fields', icon: 'list', enabled: true, order: 0 },
      { key: 'relationships', label: 'Relationships', icon: 'link', enabled: true, order: 10 },
      { key: 'indexes', label: 'Indexes', icon: 'zap', enabled: true, order: 20 },
      { key: 'validations', label: 'Validations', icon: 'shield-check', enabled: true, order: 30 },
      { key: 'capabilities', label: 'Capabilities', icon: 'settings', enabled: true, order: 40 },
      { key: 'data', label: 'Data', icon: 'table-2', enabled: true, order: 50 },
      { key: 'api', label: 'API', icon: 'globe', enabled: true, order: 60 },
      { key: 'code', label: 'Code', icon: 'code-2', enabled: true, order: 70 },
    ],
    defaultTab: 'fields',
    showHeader: true,
    showBreadcrumbs: true,
  }).describe('Object preview configuration'),
}));

export type ObjectDesignerConfig = z.input<typeof ObjectDesignerConfigSchema>;
/** Post-parse shape of {@link ObjectDesignerConfig} — defaults applied, transforms run (ADR-0122). */
export type ObjectDesignerConfigParsed = z.infer<typeof ObjectDesignerConfigSchema>;

// ─── Helper: defineObjectDesignerConfig ──────────────────────────────

/**
 * Type-safe helper for defining Object Designer configuration.
 *
 * @example
 * ```typescript
 * const config = defineObjectDesignerConfig({
 *   defaultView: 'er-diagram',
 *   erDiagram: {
 *     layout: 'hierarchy',
 *     showMinimap: true,
 *   },
 *   objectManager: {
 *     defaultDisplayMode: 'cards',
 *   },
 * });
 * ```
 */
export function defineObjectDesignerConfig(
  input: z.input<typeof ObjectDesignerConfigSchema>,
): ObjectDesignerConfigParsed {
  return ObjectDesignerConfigSchema.parse(input);
}
