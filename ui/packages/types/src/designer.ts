/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types - Visual Designer Types
 * 
 * Type definitions for the visual designer system including page designer,
 * data model designer, process designer, report designer,
 * and multi-user collaborative editing.
 * 
 * @module designer
 * @packageDocumentation
 */

import type { BaseSchema } from './base.js';
import type { VisualizationType } from '@objectstack/spec/ui';
import type { Field as SpecField } from '@objectstack/spec/data';

// ============================================================================
// Page Designer (Drag-and-Drop)
// ============================================================================

/** Drag-and-drop item position */
export interface DesignerPosition {
  /** X coordinate (pixels or grid units) */
  x: number;
  /** Y coordinate (pixels or grid units) */
  y: number;
  /** Width */
  width: number | string;
  /** Height */
  height: number | string;
}

/** Designer canvas configuration */
export interface DesignerCanvasConfig {
  /** Canvas width */
  width: number;
  /** Canvas height */
  height: number;
  /** Grid snap size */
  gridSize?: number;
  /** Whether to show grid */
  showGrid?: boolean;
  /** Whether to enable snap-to-grid */
  snapToGrid?: boolean;
  /** Zoom level (1.0 = 100%) */
  zoom?: number;
  /**
   * Background color — drawn on the canvas of the page, data-model and process
   * designers alike, through a CSS custom property a static utility paints
   * (objectui#11434), so a theme can still override it.
   */
  backgroundColor?: string;
}

/** Page designer component on canvas */
export interface DesignerComponent {
  /** Unique component ID */
  id: string;
  /** Component type */
  type: string;
  /** Display label */
  label?: string;
  /** Position on canvas */
  position: DesignerPosition;
  /** Component properties */
  props: Record<string, unknown>;
  /**
   * Child components — drawn inside this component on the canvas, positioned
   * within it, and indented under it in the component tree (objectui#11434).
   */
  children?: DesignerComponent[];
  /**
   * RETIRED (objectui#11434, ADR-0049) — a second spelling of the component
   * tree. `children` is the canonical one (it is what the zod mirror recurses
   * through), and a parent pointer beside it could only disagree with it.
   * `PageDesigner` never read it: a runtime probe through the real registry drew
   * the same markup with and without it, and nothing in this repository or in
   * ObjectStack authored it.
   *
   * **Instead:** nest the child in its parent's `children` array, and delete the
   * key.
   *
   * A tombstone rather than a deletion so the compile-time refusal names the
   * key; the zod mirror refuses it by name with the same prescription
   * (`retirementTombstone`), so the two faces agree.
   * @deprecated Not part of this contract — the value was inert.
   */
  parentId?: never;
  /**
   * Lock state — a locked component cannot be dragged or deleted on the
   * canvas, and shows a lock. No delete path removes it: not its own delete
   * button (withheld), not Delete / Backspace, not the toolbar's "Delete
   * selected", which delete only the unlocked rest of a selection. A parent
   * that holds a locked component anywhere inside it is kept as well, because
   * deleting it would take the locked one with it.
   */
  locked?: boolean;
  /** Visibility — `false` draws the component faded, with a dashed edge and a hidden marker */
  visible?: boolean;
  /** Z-index for layering — the stacking order of overlapping components on the canvas */
  zIndex?: number;
}

/** Page designer schema */
export interface PageDesignerSchema extends BaseSchema {
  type: 'page-designer';
  /** Canvas configuration */
  canvas: DesignerCanvasConfig;
  /** Components on the canvas */
  components: DesignerComponent[];
  /** Available component palette */
  palette?: DesignerPaletteCategory[];
  /** Property editor configuration */
  propertyEditor?: boolean;
  /** Component tree visibility */
  showComponentTree?: boolean;
  /** Undo/redo support */
  undoRedo?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `page-designer` reads NEITHER
   * content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `page-designer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `page-designer` reads NEITHER
   * content channel, so an authored child list here rendered NOTHING: no
   * render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `page-designer` registration (`@object-ui/plugin-designer`) takes no
   * `schema` prop: `SchemaRenderer` spreads the node's other keys into
   * `PageDesigner` as props, and `PageDesigner` reads no `children` prop of
   * its own. `SchemaRenderer` strips `body` and `children` out of the props
   * bag it spreads, so neither reaches the component by another route, and
   * the registration declares no `children` slot (objectui#9910).
   *
   * The zod arm (`zod/designer.zod.ts`, objectui#10859) refuses both
   * channels by name with the same measurement, so both faces gate it.
   *
   * What it renders instead: the designer UI `PageDesigner` draws from its
   * props; the registration declares `canvas`, `components`, `palette`,
   * `propertyEditor`, `showComponentTree`, `undoRedo` and `readOnly` as its
   * inputs.
   *
   * @deprecated Not a channel `page-designer` reads — nothing renders it.
   */
  children?: never;
}

/** Component palette category */
export interface DesignerPaletteCategory {
  /** Category name */
  name: string;
  /** Category label */
  label: string;
  /** Category icon — a Lucide icon name, drawn beside the category label in the palette */
  icon?: string;
  /** Available components */
  items: DesignerPaletteItem[];
}

/** Palette item for drag-and-drop */
export interface DesignerPaletteItem {
  /** Component type */
  type: string;
  /** Display label */
  label: string;
  /** Icon — a Lucide icon name, drawn on the item's palette button in place of the generic "add" glyph */
  icon?: string;
  /** Default properties */
  defaultProps?: Record<string, unknown>;
  /** Default size */
  defaultSize?: { width: number | string; height: number | string };
  /** Preview image URL — drawn as a thumbnail on the item's palette button */
  preview?: string;
}

// ============================================================================
// Data Model Designer (ER Diagrams)
// ============================================================================

/** Data model entity (table/object) */
export interface DataModelEntity {
  /** Entity identifier */
  id: string;
  /** Entity name */
  name: string;
  /** Display label */
  label: string;
  /** Entity fields */
  fields: DataModelField[];
  /** Position on canvas */
  position: { x: number; y: number };
  /** Entity color */
  color?: string;
  /** Entity description */
  description?: string;
}

/**
 * Data model field definition.
 *
 * Every member is drawn on the field's row of its entity card by
 * `DataModelDesigner` (objectui#11434): `label` beside the name, `unique` as a
 * `UQ` badge beside the `PK` one, `defaultValue` after the type, and
 * `description` (with the default) as the row's tooltip.
 */
export interface DataModelField {
  /** Field name — the key a relationship's `sourceField` / `targetField` names */
  name: string;
  /** Display label, drawn beside the name */
  label?: string;
  /** Field data type */
  type: string;
  /** Whether this is a primary key */
  primaryKey?: boolean;
  /** Whether this field is required */
  required?: boolean;
  /** Whether this field is unique — drawn as a `UQ` badge */
  unique?: boolean;
  /** Default value — drawn after the type, as JSON */
  defaultValue?: unknown;
  /** Field description — the row's tooltip */
  description?: string;
}

/** Relationship between entities */
export interface DataModelRelationship {
  /** Relationship identifier */
  id: string;
  /** Source entity ID */
  sourceEntity: string;
  /**
   * Source field — the `name` of a field on the source entity.
   * `DataModelDesigner` anchors the relationship line at that field's row; a
   * name the entity does not declare anchors at the entity header, and the
   * line's tooltip says so.
   */
  sourceField: string;
  /** Target entity ID */
  targetEntity: string;
  /** Target field — the `name` of a field on the target entity, anchored like `sourceField` */
  targetField: string;
  /** Relationship type */
  type: 'one-to-one' | 'one-to-many' | 'many-to-many';
  /** Relationship label */
  label?: string;
  /**
   * What happens to the referencing records when the referenced one is
   * deleted — `@objectstack/spec`'s vocabulary for a relationship field
   * (`FieldSchema.deleteBehavior`): `'set_null'`, `'cascade'` or `'restrict'`.
   * The type is read off the spec, so the two cannot drift. `DataModelDesigner`
   * draws it beside the relationship label and in the line's tooltip.
   */
  deleteBehavior?: NonNullable<SpecField['deleteBehavior']>;
  /**
   * RESPELLED (objectui#11434, ADR-0049) — this was the designer's own
   * spelling of the referential action, with its own vocabulary
   * (`'cascade' | 'set-null' | 'restrict' | 'no-action'`), while the platform
   * spells it `deleteBehavior` with `'set_null' | 'cascade' | 'restrict'`.
   * `DataModelDesigner` never read it (a runtime probe drew the same markup with
   * and without it), and nothing outside a test fixture authored it.
   *
   * **Migration:** rename the key to `deleteBehavior`: `'cascade'` and
   * `'restrict'` keep their values, `'set-null'` becomes `'set_null'`, and
   * `'no-action'` becomes `'restrict'` (the platform has no separate no-action;
   * both refuse the delete while a reference remains).
   *
   * A tombstone rather than a deletion so the compile-time refusal names the
   * key; the zod mirror refuses it by name with the same migration
   * (`aliasKeyRefusal`, the spec's own "Did you mean" sentence).
   * @deprecated Renamed to `deleteBehavior`.
   */
  onDelete?: never;
  /**
   * RETIRED (objectui#11434, ADR-0049) — the platform's relationship contract
   * has no update behaviour: `@objectstack/spec` models a relationship as a
   * `lookup` / `master_detail` field whose referential action is
   * `deleteBehavior` alone. A designer that drew this key would declare a
   * capability no runtime delivers. `DataModelDesigner` never read it (a
   * runtime probe drew the same markup with and without it), and nothing in
   * this repository or in ObjectStack authored it.
   *
   * **Instead:** delete the key; there is nothing to configure in its place.
   *
   * A tombstone rather than a deletion so the compile-time refusal names the
   * key; the zod mirror refuses it by name (`retirementTombstone`).
   * @deprecated Not part of this contract — the value was inert.
   */
  onUpdate?: never;
}

/** Data model designer schema */
export interface DataModelDesignerSchema extends BaseSchema {
  type: 'data-model-designer';
  /** Entities in the model */
  entities: DataModelEntity[];
  /** Relationships between entities */
  relationships: DataModelRelationship[];
  /** Canvas configuration */
  canvas?: DesignerCanvasConfig;
  /** Show relationship labels */
  showRelationshipLabels?: boolean;
  /**
   * RETIRED (objectui#11434, ADR-0049) — auto-layout is an ACTION, not authored
   * state. `DataModelDesigner` never read this key: its toolbar's Auto Layout
   * button arranges the entities on demand whatever the node says, and a
   * runtime probe through the real registry drew the same markup with the key
   * `true`, `false` and absent. Entity positions are required, so there is no
   * unplaced entity for a flag to lay out. Nothing in this repository or in
   * ObjectStack authored it.
   *
   * **Instead:** delete the key, and use the toolbar's Auto Layout button.
   *
   * A tombstone rather than a deletion on the grounds the AI declarations'
   * retired members record: {@link BaseSchema} carried `[key: string]: any`, so a
   * DELETED member was absorbed silently at any value (since objectui#8347,
   * through a widened value only), and the tombstone is what makes the
   * compile-time refusal exist, by name. The zod mirror refuses the
   * key by name with the same prescription (`retirementTombstone`).
   * @deprecated Not part of this contract — the value was inert.
   */
  autoLayout?: never;
  /** Read-only mode */
  readOnly?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `data-model-designer` reads
   * NEITHER content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `data-model-designer` reads — nothing renders
   * it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `data-model-designer` reads
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `data-model-designer` registration (`@object-ui/plugin-designer`) takes
   * no `schema` prop: `SchemaRenderer` spreads the node's other keys into
   * `DataModelDesigner` as props, and `DataModelDesigner` reads no `children`
   * prop of its own. `SchemaRenderer` strips `body` and `children` out of the
   * props bag it spreads, so neither reaches the component by another route,
   * and the registration declares no `children` slot (objectui#9910).
   *
   * The zod arm (`zod/designer.zod.ts`, objectui#10859) refuses both
   * channels by name with the same measurement, so both faces gate it.
   *
   * What it renders instead: the designer UI `DataModelDesigner` draws from
   * its props; the registration declares `entities`, `relationships`,
   * `canvas`, `showRelationshipLabels` and `readOnly` as its inputs.
   *
   * @deprecated Not a channel `data-model-designer` reads — nothing renders
   * it.
   */
  children?: never;
}

// ============================================================================
// Process Designer (BPMN 2.0)
// ============================================================================

/** BPMN node types */
export type BPMNNodeType =
  | 'start-event'
  | 'end-event'
  | 'task'
  | 'user-task'
  | 'service-task'
  | 'script-task'
  | 'send-task'
  | 'receive-task'
  | 'manual-task'
  | 'business-rule-task'
  | 'sub-process'
  | 'call-activity'
  | 'exclusive-gateway'
  | 'parallel-gateway'
  | 'inclusive-gateway'
  | 'event-based-gateway'
  | 'intermediate-catch-event'
  | 'intermediate-throw-event'
  | 'boundary-event'
  | 'timer-event'
  | 'message-event'
  | 'signal-event'
  | 'error-event'
  | 'compensation-event';

/** BPMN process node */
export interface BPMNNode {
  /** Node identifier */
  id: string;
  /** Node type */
  type: BPMNNodeType;
  /** Display label */
  label: string;
  /** Position on canvas */
  position: { x: number; y: number };
  /**
   * Node properties — free-form engine settings. `ProcessDesigner`'s property
   * panel lists each one under its key, with a control for its value's type.
   */
  properties?: Record<string, unknown>;
  /** Assigned user/role (for user tasks) — a property-panel field on a user task */
  assignee?: string;
  /** Due date expression — a property-panel field on a user task */
  dueDate?: string;
  /** Script content (for script tasks) — a property-panel field on a script task */
  script?: string;
  /**
   * RETIRED (objectui#11434, ADR-0049) — the mainstream service task references
   * an IMPLEMENTATION (a job type, a connector, a registered action), not an
   * endpoint URL, so a URL here taught a model no BPMN engine uses.
   * `ProcessDesigner` never read it (a runtime probe drew the same markup with
   * and without it), and nothing in this repository or in ObjectStack authored
   * it.
   *
   * **Instead:** delete the key; there is nothing to configure in its place.
   *
   * A tombstone rather than a deletion so the compile-time refusal names the
   * key; the zod mirror refuses it by name (`retirementTombstone`).
   * @deprecated Not part of this contract — the value was inert.
   */
  serviceEndpoint?: never;
  /** Description */
  description?: string;
}

/** BPMN sequence flow (edge) */
export interface BPMNEdge {
  /** Edge identifier */
  id: string;
  /** Source node ID */
  source: string;
  /** Target node ID */
  target: string;
  /** Condition expression (for conditional flows) — drawn on the flow, in brackets */
  condition?: string;
  /** Edge label */
  label?: string;
  /** Whether this is the default flow — drawn as BPMN's slash marker at the flow's source */
  isDefault?: boolean;
}

/** BPMN lane — `ProcessDesigner` draws it as a band around the nodes `nodeIds` names */
export interface BPMNLane {
  /** Lane identifier */
  id: string;
  /** Lane label */
  label: string;
  /** Associated role or department */
  role?: string;
  /** Nodes in this lane */
  nodeIds: string[];
}

/** Process designer schema */
export interface ProcessDesignerSchema extends BaseSchema {
  type: 'process-designer';
  /** Process name */
  processName: string;
  /** Process version — drawn beside the process name in the toolbar */
  version?: string;
  /** BPMN nodes */
  nodes: BPMNNode[];
  /** BPMN edges/flows */
  edges: BPMNEdge[];
  /** Swim lanes — each drawn as a band around its nodes, labelled with its label and role */
  lanes?: BPMNLane[];
  /** Canvas configuration */
  canvas?: DesignerCanvasConfig;
  /*
   * There is deliberately no `variables` here (objectui#10859, ruling on that
   * card: the two zero-read designer members are settled before their zod
   * arms mirror them). It was declared as "Process variables", an array of
   * `{ name, type, defaultValue? }`, and nothing read it: `ProcessDesigner`'s
   * props do not declare the key and its body never names it, and no other
   * package's source reads it off a `process-designer` node. Nothing produced
   * it either — no doc, example, catalog document, generator or fixture
   * authored it. A runtime probe through the real registry drew the same
   * markup with and without an authored `variables` array.
   *
   * Removed outright rather than kept as a `?: never` tombstone: neither prong
   * of the retire-vs-remove discriminator `./complex.ts` states holds — there
   * is no live replacement key, and nothing taught the key as working. The zod
   * arm (`zod/designer.zod.ts`) does not declare it either. The index
   * signature `BaseSchema` carried admitted the key at any value until
   * objectui#8347, which refuses it on a fresh literal now; the strict
   * authoring face refuses it as an unrecognized key.
   */
  /** Show minimap */
  showMinimap?: boolean;
  /** Show toolbar */
  showToolbar?: boolean;
  /** Read-only mode */
  readOnly?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `process-designer` reads
   * NEITHER content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `process-designer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `process-designer` reads
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `process-designer` registration (`@object-ui/plugin-designer`) takes no
   * `schema` prop: `SchemaRenderer` spreads the node's other keys into
   * `ProcessDesigner` as props, and `ProcessDesigner` reads no `children`
   * prop of its own. `SchemaRenderer` strips `body` and `children` out of the
   * props bag it spreads, so neither reaches the component by another route,
   * and the registration declares no `children` slot (objectui#9910).
   *
   * The zod arm (`zod/designer.zod.ts`, objectui#10859) refuses both
   * channels by name with the same measurement, so both faces gate it.
   *
   * What it renders instead: the designer UI `ProcessDesigner` draws from its
   * props; the registration declares `processName`, `version`, `nodes`,
   * `edges`, `lanes`, `canvas`, `showMinimap`, `showToolbar` and `readOnly` as
   * its inputs.
   *
   * @deprecated Not a channel `process-designer` reads — nothing renders it.
   */
  children?: never;
}

// ============================================================================
// Report Designer
// ============================================================================

/** Report designer section type */
export type ReportSectionType = 'header' | 'detail' | 'footer' | 'group-header' | 'group-footer' | 'page-header' | 'page-footer';

/** Report designer element */
export interface ReportDesignerElement {
  /** Element identifier */
  id: string;
  /** Element type */
  type: 'text' | 'field' | 'image' | 'chart' | 'table' | 'barcode' | 'line' | 'rectangle' | 'expression';
  /** Position within section */
  position: DesignerPosition;
  /**
   * Element properties — the type's own settings (a text element's `text`).
   *
   * One key is REFUSED here by the zod face, by name: `field` (objectui#11434,
   * ADR-0049). A field element's binding is the element's own declared
   * `dataBinding`, and `ReportDesigner` reads that alone; it used to draw this
   * undeclared bag key instead (and wrote it when a field element was added),
   * so a declared member and a bag key both claimed the binding, and the
   * declared member wins. **Migration:** move the value to the element's
   * `dataBinding`, and delete `properties.field`.
   *
   * The refusal lives on the zod face alone (`safeValidateSchema`, the strict
   * authoring face, `objectui validate`): an open bag cannot refuse one key in
   * its TypeScript type without parting from the zod mirror, whose record is
   * what keeps every other key open on the strict face.
   */
  properties: Record<string, unknown>;
  /**
   * Data binding expression — what a field element shows (drawn as
   * `{BINDING}`), and what any other element is bound to. The property panel
   * edits it for every element type.
   */
  dataBinding?: string;
  /**
   * Formatting options — drawn on the element's content: weight, style,
   * alignment, colours, font, border and padding as its look, and
   * `numberFormat` / `dateFormat` beside its binding.
   */
  format?: {
    fontFamily?: string;
    fontSize?: number;
    fontWeight?: 'normal' | 'bold';
    fontStyle?: 'normal' | 'italic';
    color?: string;
    backgroundColor?: string;
    alignment?: 'left' | 'center' | 'right';
    verticalAlignment?: 'top' | 'middle' | 'bottom';
    border?: string;
    padding?: string;
    numberFormat?: string;
    dateFormat?: string;
  };
}

/** Report designer section */
export interface ReportDesignerSection {
  /** Section type */
  type: ReportSectionType;
  /** Section height */
  height: number;
  /** Elements in this section */
  elements: ReportDesignerElement[];
  /** Group field (for group headers/footers) — drawn in the section label, as `by FIELD` */
  groupField?: string;
  /** Whether section repeats */
  repeat?: boolean;
  /** Page break before — drawn as a page-break rule across the top of the section */
  pageBreakBefore?: boolean;
}

/** Report designer schema */
export interface ReportDesignerSchema extends BaseSchema {
  type: 'report-designer';
  /** Report name */
  reportName: string;
  /** Data source object */
  objectName: string;
  /** Page size */
  pageSize?: 'A4' | 'A3' | 'Letter' | 'Legal' | 'Tabloid';
  /** Page orientation */
  orientation?: 'portrait' | 'landscape';
  /**
   * Page margins — all four drawn as a dashed guide on the page; `left` also
   * places a newly added element.
   */
  margins?: { top: number; right: number; bottom: number; left: number };
  /** Report sections */
  sections: ReportDesignerSection[];
  /*
   * There is deliberately no `parameters` here (objectui#10859, ruling on that
   * card: the two zero-read designer members are settled before their zod
   * arms mirror them). It was declared as "Report parameters", an array of
   * `{ name, type, label, defaultValue? }`, and nothing read it:
   * `ReportDesigner`'s props do not declare the key and its body never names
   * it, and no other package's source reads it off a `report-designer` node.
   * Nothing produced it either — no doc, example, catalog document, generator
   * or fixture authored it. A runtime probe through the real registry drew the
   * same markup with and without an authored `parameters` array.
   *
   * Removed outright rather than kept as a `?: never` tombstone, for the
   * reasons the `variables` note on `ProcessDesignerSchema` above gives; the
   * zod arm does not declare it either.
   */
  /** Show designer toolbar */
  showToolbar?: boolean;
  /** Show property panel */
  showPropertyPanel?: boolean;
  /**
   * RETIRED (objectui#11434, ADR-0049) — preview is a MODE of the tool (Report
   * Builder's Run / Design toggle), not state a report document carries.
   * `ReportDesigner` declared it on its props and never read it: a runtime probe
   * through the real registry drew the same markup with and without it.
   * Nothing in this repository or in ObjectStack authored it.
   *
   * **Instead:** delete the key. For a chrome-free, non-editable layout, author
   * `readOnly: true`, `showToolbar: false` and `showPropertyPanel: false`.
   *
   * A tombstone rather than a deletion on the grounds {@link
   * DataModelDesignerSchema.autoLayout} records; the zod mirror refuses the key
   * by name with the same prescription (`retirementTombstone`).
   * @deprecated Not part of this contract — the value was inert.
   */
  previewMode?: never;
  /** Read-only mode */
  readOnly?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `report-designer` reads
   * NEITHER content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `report-designer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `report-designer` reads
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `report-designer` registration (`@object-ui/plugin-designer`) takes no
   * `schema` prop: `SchemaRenderer` spreads the node's other keys into
   * `ReportDesigner` as props, and `ReportDesigner` reads no `children` prop
   * of its own. `SchemaRenderer` strips `body` and `children` out of the
   * props bag it spreads, so neither reaches the component by another route,
   * and the registration declares no `children` slot (objectui#9910).
   *
   * The zod arm (`zod/designer.zod.ts`, objectui#10859) refuses both
   * channels by name with the same measurement, so both faces gate it.
   *
   * What it renders instead: the designer UI `ReportDesigner` draws from its
   * props; the registration declares `reportName`, `objectName`, `pageSize`,
   * `orientation`, `margins`, `sections`, `showToolbar`, `showPropertyPanel`
   * and `readOnly` as its inputs.
   *
   * @deprecated Not a channel `report-designer` reads — nothing renders it.
   */
  children?: never;
}

// ============================================================================
// Unified View Configuration
// ============================================================================

/** Column configuration for rich view columns */
export interface ViewColumnConfig {
  /** Field name */
  field: string;
  /** Display label */
  label?: string;
  /** Column width */
  width?: number | string;
  /** Whether column is visible */
  visible?: boolean;
  /** Sort direction */
  sortDirection?: 'asc' | 'desc';
  /** Column order index */
  order?: number;
}

/**
 * View type union for the designer's view-configuration panel.
 *
 * DERIVED from `@objectstack/spec/ui` `VisualizationType` (`ca3942729`) — the
 * spec's own union of the visualizations a user can switch between, and the one
 * `AppearanceConfig.allowedVisualizations` is typed on. The hand-written
 * eight-arm union this replaces had already drifted: it was missing `tree`,
 * which every other view-kind structure in this repo has carried for releases.
 *
 * ⚠️ Deliberately NOT `ViewType` (`./views.ts`). That union additionally carries
 * `list` / `detail` (view categories, not visualizations) and the spec's
 * `page` — a `type: 'page'` list view mounts a published page through `pageName`
 * instead of drawing records, so it is not something this panel configures and
 * not something a user switches into. Deriving from the visualization union is
 * what keeps `page` correctly absent HERE while `ViewType` correctly gains it.
 */
export type UnifiedViewType = VisualizationType;

/**
 * Unified data model for view configuration.
 *
 * Used by ViewConfigPanel (create/edit).
 * Columns may be simple field-name strings or rich ViewColumnConfig objects;
 * consumers should handle both.
 */
export interface UnifiedViewConfig {
  /** View identifier */
  id?: string;
  /** Display label */
  label?: string;
  /** View type */
  type?: UnifiedViewType;
  /** Column configuration — simple field names or rich ViewColumnConfig objects */
  columns?: Array<string | ViewColumnConfig>;
  /** Filter conditions in @objectstack/spec JSON-rules array format */
  filter?: any[];
  /** Sort configuration */
  sort?: Array<{ field: string; order?: string; direction?: string; id?: string }>;
  /** Description */
  description?: string;
  /** Enable search bar */
  showSearch?: boolean;
  /** Enable user filter controls */
  showFilters?: boolean;
  /** Enable user sort controls */
  showSort?: boolean;
  /** Allow data export */
  allowExport?: boolean;
  /** Show view description */
  showDescription?: boolean;
  /** Enable "add record via form" action */
  addRecordViaForm?: boolean;
  /** Export options */
  exportOptions?: any;

  // -- Type-specific options (nested per @objectstack/spec protocol) ----------

  /** Kanban-specific options */
  kanban?: {
    groupByField?: string;
    groupField?: string;
    titleField?: string;
    columns?: string[];
  };
  /** Calendar-specific options */
  calendar?: {
    startDateField?: string;
    endDateField?: string;
    titleField?: string;
    colorField?: string;
    allDayField?: string;
    defaultView?: string;
  };
  /** Map-specific options */
  map?: {
    locationField?: string;
    titleField?: string;
    latitudeField?: string;
    longitudeField?: string;
    zoom?: number;
    center?: { lat: number; lng: number };
  };
  /** Gallery-specific options */
  gallery?: {
    imageField?: string;
    titleField?: string;
  };
  /** Timeline-specific options */
  timeline?: {
    dateField?: string;
    titleField?: string;
    descriptionField?: string;
  };
  /** Gantt-specific options */
  gantt?: {
    startDateField?: string;
    endDateField?: string;
    titleField?: string;
    progressField?: string;
    dependenciesField?: string;
    colorField?: string;
  };
  /**
   * RETIRED (objectui#12063, ADR-0049) — this block declared the list-view
   * chart's pre-ADR-0021 inline query: `chartType` beside `xAxisField`,
   * `yAxisFields`, `aggregation`, `series`, `config` and `filter`. No route
   * reads those axes since objectui#6152 round 15: every list-view door refuses
   * them by name, and a chart list view binds only an ADR-0021 dataset. Nothing
   * read or wrote `UnifiedViewConfig.chart` either, in this repository or in
   * ObjectStack (a one-time census on objectui#12063; nothing re-derives it).
   *
   * **Instead:** write the spec's list chart block, `ListChartConfig` from
   * `@objectstack/spec/ui` (the `chart` member of its `ListView`): `chartType`,
   * `dataset`, `dimensions` and `values`, which bind the chart to an ADR-0021
   * dataset by name, e.g.
   * `{ chartType: 'bar', dataset: 'task_stats', dimensions: ['status'], values: ['total_estimate'] }`.
   *
   * A tombstone rather than a deletion: this interface keeps a
   * `[key: string]: any` index signature, so a deleted member would admit
   * `chart` at any value, on a fresh literal too. The interface has no zod
   * mirror. Pinned in `__tests__/unified-view-config-chart-retired-12063.test.ts`.
   * @deprecated Not part of this contract — write the spec's list chart block
   * (`dataset`, `values`, `dimensions`, `chartType`).
   */
  chart?: never;

  /** Catch-all for additional properties */
  [key: string]: any;
}

// ============================================================================
// Dashboard Configuration
// ============================================================================

/** All supported color variants for dashboard widgets */
export const DASHBOARD_COLOR_VARIANTS = [
  'default', 'blue', 'teal', 'orange', 'purple', 'success', 'warning', 'danger',
] as const;

/** Color variant for dashboard widgets */
export type DashboardColorVariant = (typeof DASHBOARD_COLOR_VARIANTS)[number];

/** All supported widget visualization types */
export const DASHBOARD_WIDGET_TYPES = [
  'metric', 'bar', 'horizontal-bar', 'line', 'pie', 'donut', 'area', 'scatter', 'funnel', 'table', 'pivot', 'list', 'custom',
] as const;

/** Widget visualization type */
export type DashboardWidgetType = (typeof DASHBOARD_WIDGET_TYPES)[number];

/** Layout position for a single dashboard widget */
export interface DashboardWidgetConfig {
  /** Widget identifier */
  id: string;
  /** Widget title */
  title?: string;
  /** Widget description */
  description?: string;
  /** Visualization type */
  type?: DashboardWidgetType;
  /** Data source object name */
  object?: string;
  /** Filter conditions applied to widget data */
  filter?: any[];
  /** Category / x-axis field */
  categoryField?: string;
  /** Value / y-axis field */
  valueField?: string;
  /** Aggregation function (count, sum, avg, min, max) */
  aggregate?: string;
  /** Chart-specific configuration */
  chartConfig?: any;
  /** Color variant */
  colorVariant?: DashboardColorVariant;
  /** Grid layout position */
  layout?: { x: number; y: number; w: number; h: number };
  /** Clickable action URL */
  actionUrl?: string;
}

/**
 * Unified data model for dashboard configuration.
 *
 * Used by the DashboardConfigPanel for create/edit workflows.
 * Mirrors the pattern of UnifiedViewConfig for view configuration.
 */
export interface DashboardConfig {
  /** Dashboard identifier */
  id?: string;
  /** Display title */
  title?: string;
  /** Dashboard description */
  description?: string;
  /** Number of grid columns (default: 12) */
  columns?: number;
  /** Grid gap in pixels */
  gap?: number;
  /** Auto-refresh interval in seconds (renamed from `refreshInterval`, objectui#7783) */
  refreshIntervalSeconds?: number;
  /** Dashboard widgets */
  widgets?: DashboardWidgetConfig[];

  // -- Global filters --------------------------------------------------------

  /** Global filter conditions applied across all widgets */
  globalFilters?: any[];
  /** Date range filter configuration */
  dateRange?: {
    enabled?: boolean;
    field?: string;
    presets?: string[];
  };
  /** User-selectable filter fields */
  userFilters?: Array<{
    field: string;
    label?: string;
    type?: string;
  }>;

  // -- Appearance ------------------------------------------------------------

  /** Show dashboard header with title/description */
  showHeader?: boolean;
  /** Show global filter bar */
  showFilters?: boolean;
  /** Show date range picker */
  showDateRange?: boolean;
  /** Action buttons in dashboard header */
  headerActions?: Array<{
    label: string;
    action?: string;
    icon?: string;
    variant?: string;
  }>;

  // -- Accessibility ---------------------------------------------------------
  //
  // `aria?: { label?, description? }` was DECLARED here until `e7957ab87`.
  // It was never a contract: the spellings (`label`/`description`) match
  // neither `@objectstack/spec`'s `AriaProps` (`ariaLabel` / `ariaDescribedBy`
  // / `role`) nor anything a renderer maps, so no read point could have
  // consumed it even in principle. Measured on `origin/main` at the retirement:
  // zero `.aria` reads in `packages/plugin-designer/src`,
  // `packages/plugin-dashboard/src` and `apps/console/src` (the same grep
  // family finds the live `schema.aria` reads in `plugin-detail`'s
  // `record-quick-actions.tsx` and `plugin-list`'s `ListView.tsx`), and zero
  // occurrences of either name in the `objectstack` repo.
  //
  // `DashboardConfigPanel.tsx` — the panel this interface's own doc comment
  // says it serves — imports `ConfigPanelSchema` from `@object-ui/components`
  // and neither `DashboardConfig` nor `DashboardConfigSchema`, so the key
  // documented an integration that does not exist.
  //
  // Note the `[key: string]: any` catch-all below still types an authored
  // `aria` as `any`: this deletion removes the type-level SUGGESTION, not a
  // key that ever rendered (same shape as objectui#5830 on
  // `DashboardComponentSchema.aria`). The Zod twin does carry teeth — see the
  // `z.never()` tombstone in `zod/complex.zod.ts`. Pinned by
  // `__tests__/dashboard-config.test.ts`.

  /** Catch-all for additional properties */
  [key: string]: any;
}

// ============================================================================
// Object Manager (Enterprise Metadata Management)
// ============================================================================

/** Object definition for the Object Manager */
export interface ObjectDefinition {
  /** Unique object identifier */
  id: string;
  /** API name (snake_case) */
  name: string;
  /** Display label */
  label: string;
  /** Plural display label */
  pluralLabel?: string;
  /** Object description */
  description?: string;
  /** Icon name (Lucide icon) */
  icon?: string;
  /** Grouping/category */
  group?: string;
  /** Sort order within group */
  sortOrder?: number;
  /** Whether this is a system object (non-deletable) */
  isSystem?: boolean;
  /** Field count (read-only, for display) */
  fieldCount?: number;
  /**
   * RETIRED (objectui#11434, ADR-0049) — a relationship is a FIELD, not an
   * object-level list. `@objectstack/spec`'s `ObjectSchema` refuses an
   * object-level `relationships` array as an unrecognized key (objectui#6223
   * already kept it off the wire), the spec models a relationship as a
   * `lookup` / `master_detail` field with a `reference`, and this designer's
   * field model carries that as {@link DesignerFieldDefinition.referenceTo}. Nothing read
   * this list — not `ObjectManager`, not `MetadataObjectsPage` (whose
   * `toObjectDefinition` never set it), not `MetadataService` — and only test
   * fixtures authored it.
   *
   * Its element type `ObjectDefinitionRelationship` (`relatedObject`, `type`,
   * `label`, `foreignKey`) left the package with it.
   *
   * **Instead:** declare the relationship on the referencing field — in this
   * designer, a `lookup` field whose `referenceTo` names the related object (in
   * `@objectstack/spec` metadata, a `lookup` / `master_detail` field whose
   * `reference` names it) — and delete the key.
   *
   * A tombstone rather than a deletion so the compile-time refusal names the
   * key; the zod mirror refuses it by name with the same prescription
   * (`retirementTombstone`).
   * @deprecated Not part of this contract — the value was inert.
   */
  relationships?: never;
}

/*
 * There is deliberately no `ObjectDefinitionRelationship` here any more
 * (objectui#11434): it typed only `ObjectDefinition.relationships`, retired
 * above. Its zod mirror left `zod/designer.zod.ts` in the same change.
 */

/** Object Manager component schema */
export interface ObjectManagerSchema extends BaseSchema {
  type: 'object-manager';
  /** List of object definitions */
  objects: ObjectDefinition[];
  /** Read-only mode */
  readOnly?: boolean;
  /** Show system objects */
  showSystemObjects?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-manager` reads
   * NEITHER content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `object-manager` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `object-manager` reads
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `object-manager` registration (`@object-ui/plugin-designer`) takes no
   * `schema` prop: `SchemaRenderer` spreads the node's other keys into
   * `ObjectManager` as props, and `ObjectManager` reads no `children` prop of
   * its own. `SchemaRenderer` strips `body` and `children` out of the props
   * bag it spreads, so neither reaches the component by another route, and
   * the registration declares no `children` slot (objectui#9910).
   *
   * The zod arm (`zod/designer.zod.ts`, objectui#10859) refuses both
   * channels by name with the same measurement, so both faces gate it.
   *
   * What it renders instead: the designer UI `ObjectManager` draws from its
   * props; the registration declares `objects`, `showSystemObjects` and
   * `readOnly` as its inputs.
   *
   * @deprecated Not a channel `object-manager` reads — nothing renders it.
   */
  children?: never;
}

// ============================================================================
// Field Designer (Field Configuration Wizard)
// ============================================================================

/**
 * Canonical, ordered list of field types the Field Designer supports.
 *
 * Single runtime source for every surface that enumerates the designer's
 * vocabulary: `FieldDesigner` renders its palette in exactly this order (its
 * `FIELD_TYPE_META` is a `Record<DesignerFieldType, …>`, so adding a member
 * here without presentation is a compile error), and `MetadataFieldsPage`
 * derives its editable-subset check from it instead of restating the list
 * (objectui#3017).
 */
export const DESIGNER_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'boolean',
  'date',
  'datetime',
  'time',
  'select',
  'email',
  'phone',
  'url',
  'password',
  'currency',
  'percent',
  'lookup',
  'formula',
  'autonumber',
  'file',
  'image',
  'markdown',
  'html',
  'color',
  'code',
  'location',
  'address',
  'rating',
  'slider',
] as const;

/** Supported field types in the Field Designer */
export type DesignerFieldType = (typeof DESIGNER_FIELD_TYPES)[number];

/** Select option for field designer */
export interface DesignerFieldOption {
  /** Option label */
  label: string;
  /** Option value */
  value: string;
  /** Option color (for badge display) */
  color?: string;
}

/*
 * There is deliberately no `DesignerValidationRule` here any more
 * (objectui#11434): it typed only `DesignerFieldDefinition.validationRules`,
 * retired below. Its zod mirror left `zod/designer.zod.ts` in the same change.
 */

/** Field definition for the Field Designer */
export interface DesignerFieldDefinition {
  /** Unique field identifier */
  id: string;
  /** API name (snake_case) */
  name: string;
  /** Display label */
  label: string;
  /** Field type */
  type: DesignerFieldType;
  /** Field group/section */
  group?: string;
  /*
   * There is deliberately no `sortOrder` here (objectui#6045). `FieldSchema`
   * rejects the key by name and the spec has NO field-level ordering key at
   * all — field order is DECLARATION ORDER in the object's `fields` record, so
   * a designer that wants explicit ordering reorders that record rather than
   * carrying an index. The near-spelling `sortable` is not a rename target: it
   * is a boolean ("whether field is sortable in list views"), a different
   * concept entirely.
   *
   * Nothing ever populated it. `MetadataService.toFieldPayload` copied it onto
   * the wire shape, so the key was one reorder feature away from the hard 422
   * `INVALID_METADATA` that blocks every later save of an object; it stayed
   * latent only because `JSON.stringify` drops the `undefined`. That is
   * objectui#4687's shape — a declaration with zero readers and zero writers —
   * and the resolution is the same one: delete it, rather than leave a key
   * declared here that no writer fills and no schema accepts.
   *
   * The object-level `sortOrder` on `ObjectDefinition` above is a DIFFERENT
   * key on a different schema (objectui#6223 removed it from the object wire
   * shape and deliberately kept it on that UI model, where it is the Object
   * Manager's display order). So is the saved-view `sortOrder` in
   * `app-shell`'s `ObjectView`. Neither is this one.
   */
  /** Field description / help text */
  description?: string;
  /** Whether field is required */
  required?: boolean;
  /** Whether field is unique */
  unique?: boolean;
  /** Whether field is read-only */
  readonly?: boolean;
  /** Whether field is hidden */
  hidden?: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Placeholder text */
  placeholder?: string;
  /** Select options (for select type) */
  options?: DesignerFieldOption[];
  /**
   * RETIRED (objectui#11434, ADR-0049) — a spelling the platform refuses, with
   * no reader and no producer. `@objectstack/spec`'s `FieldSchema` refuses
   * `validationRules` as an unrecognized key; the spec carries numeric and
   * length bounds as the field's own `min` / `max` / `minLength` /
   * `maxLength` keys and every other rule as an entry of the OBJECT's `validations` list, which is also
   * where mainstream platforms keep validation rules. `FieldDesigner` never
   * offered an editor for it, and no converter carried it: `toDesignerField`
   * never set it, and neither `fromDesignerField` nor
   * `MetadataService.toFieldPayload` copied it to the wire.
   *
   * Its element type `DesignerValidationRule` (`type`, `value`, `message`) left
   * the package with it.
   *
   * **Instead:** put bounds on the field as `min` / `max` / `minLength` /
   * `maxLength` in the field metadata, and any other rule in the object's
   * `validations`; delete the key here.
   *
   * A tombstone rather than a deletion so the compile-time refusal names the
   * key; the zod mirror refuses it by name with the same prescription
   * (`retirementTombstone`).
   * @deprecated Not part of this contract — the value was inert.
   */
  validationRules?: never;
  /** Whether this is a system field */
  isSystem?: boolean;
  /** External ID flag */
  externalId?: boolean;
  /** Track field history */
  trackHistory?: boolean;
  /*
   * There is deliberately no `indexed` here (objectui#4644). The ObjectStack
   * spec has no field-level index flag: it built no index (objectstack#2377
   * removed it) and `FieldSchema.safeParse` now rejects the key by name, so
   * any designer that authored it produced a save-blocking 422. Declare the
   * index on the object instead — `indexes: [{ name, fields, unique }]`.
   */
  /** Lookup reference object (for lookup type) */
  referenceTo?: string;
  /*
   * There is deliberately no `formula` here (objectui#6043). The spec spells a
   * formula field's expression `expression` and it is CEL — `record.amount *
   * 0.1`, rooted at `record`. `FieldSchema.safeParse` rejects `formula` by
   * name, so authoring it produced a save-blocking 422.
   *
   * The key was NOT renamed to `expression`, and that is the whole finding of
   * the card rather than a shortcut. `FieldSchema` does not parse CEL at the
   * key level: measured on `@objectstack/spec` 17.2.0 it accepts
   * `expression: 'price * quantity'` AND `expression: '!!!not cel at all!!!'`
   * — only the empty string is refused. A rename therefore buys a green parse
   * for arbitrary garbage. Worse, the control's own placeholder was
   * `price * quantity`, whose BARE field refs `celAuthoring.ts` records as
   * silently evaluating to null at runtime under the `record` scope formulas
   * bind. Renaming alone converts a loud, immediate 422 into a silent wrong
   * answer, which is strictly worse than the bug.
   *
   * Formula expressions are authored where they can be CHECKED: metadata-admin's
   * `ObjectFieldInspector` edits `expression` through `CelPredicateField`,
   * which lints against the real `@objectstack/formula` engine and stamps
   * `returnType` from the inferred CEL type. The field TYPE `formula` remains a
   * valid spec `FieldType` and stays in the designer's palette — only the
   * unvalidatable expression textarea is gone.
   */
}

/** Field Designer component schema */
export interface FieldDesignerSchema extends BaseSchema {
  type: 'field-designer';
  /** Object name this field designer belongs to */
  objectName: string;
  /** List of field definitions */
  fields: DesignerFieldDefinition[];
  /** Read-only mode */
  readOnly?: boolean;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `field-designer` reads
   * NEITHER content channel; see `children` below for the measurement.
   *
   * {@link BaseSchema} already refuses `body` (objectui#6771), but its
   * refusal names `children` as the remedy, which this node does not read
   * either. The member is restated here so the refusal points at what the
   * node renders instead.
   *
   * @deprecated Not a channel `field-designer` reads — nothing renders it.
   */
  body?: never;
  /**
   * REFUSED BY NAME (objectui#9256, ADR-0049) — `field-designer` reads
   * NEITHER content channel, so an authored child list here rendered NOTHING:
   * no render-time error or warning and no element; only the parser tier's
   * `not-a-container` warning (objectui#9910) noticed it.
   *
   * Measured with the TypeScript type checker, not grep, over one program per
   * workspace package on a built tree (the family-D re-measure). The
   * `field-designer` registration (`@object-ui/plugin-designer`) takes no
   * `schema` prop: `SchemaRenderer` spreads the node's other keys into
   * `FieldDesigner` as props, and `FieldDesigner` reads no `children` prop of
   * its own. `SchemaRenderer` strips `body` and `children` out of the props
   * bag it spreads, so neither reaches the component by another route, and
   * the registration declares no `children` slot (objectui#9910).
   *
   * The zod arm (`zod/designer.zod.ts`, objectui#10859) refuses both
   * channels by name with the same measurement, so both faces gate it.
   *
   * What it renders instead: the designer UI `FieldDesigner` draws from its
   * props; the registration declares `objectName`, `fields` and `readOnly` as
   * its inputs.
   *
   * @deprecated Not a channel `field-designer` reads — nothing renders it.
   */
  children?: never;
}

// ============================================================================
// Multi-User Collaborative Editing
// ============================================================================

/** Collaboration user presence */
export interface CollaborationPresence {
  /** User identifier */
  userId: string;
  /** User display name */
  userName: string;
  /** User avatar URL */
  avatar?: string;
  /** User cursor color */
  color: string;
  /** Current selection/cursor position */
  cursor?: {
    elementId?: string;
    position?: { x: number; y: number };
  };
  /** User status */
  status: 'active' | 'idle' | 'away';
  /** Last activity timestamp */
  lastActivity: string;
}

/** Collaboration operation for conflict resolution */
export interface CollaborationOperation {
  /** Operation ID */
  id: string;
  /** User who performed the operation */
  userId: string;
  /** Operation type */
  type: 'insert' | 'update' | 'delete' | 'move' | 'resize';
  /** Target element ID */
  elementId: string;
  /** Operation data */
  data: Record<string, unknown>;
  /** Timestamp */
  timestamp: string;
  /** Operation version for OT */
  version: number;
}

/** Collaborative editing configuration */
export interface CollaborationConfig {
  /** Enable real-time collaboration */
  enabled: boolean;
  /** WebSocket server URL */
  serverUrl?: string;
  /** Room/document identifier */
  roomId?: string;
  /** Maximum concurrent users */
  maxUsers?: number;
  /** Show user cursors */
  showCursors?: boolean;
  /** Show user presence list */
  showPresence?: boolean;
  /** Conflict resolution strategy */
  conflictResolution?: 'last-write-wins' | 'operational-transform' | 'crdt';
  /** Auto-save interval in milliseconds */
  autoSaveInterval?: number;
  /** Version history enabled */
  versionHistory?: boolean;
}
