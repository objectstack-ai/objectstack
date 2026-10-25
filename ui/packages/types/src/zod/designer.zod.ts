/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/types/zod - Visual Designer Zod Validators
 *
 * Zod mirrors of the six designer node declarations in `../designer.ts` —
 * `PageDesignerSchema`, `DataModelDesignerSchema`, `ProcessDesignerSchema`,
 * `ReportDesignerSchema`, `ObjectManagerSchema` and `FieldDesignerSchema` —
 * which `@object-ui/plugin-designer` registers as `page-designer`,
 * `data-model-designer`, `process-designer`, `report-designer`,
 * `object-manager` and `field-designer`, and of the record types those six
 * declare as their members' values.
 *
 * ## Why this module exists (objectui#10859)
 *
 * The six keys were REGISTERED and DECLARED on the published TypeScript face,
 * while `AnyComponentSchema` carried no arm for them — so `safeValidateSchema`
 * and `objectui validate` refused every document naming one with
 * `invalid_union` at `type`. The arms below restate the declarations member for
 * member; `DesignerUnionSchema` is the category union `AnyComponentSchema`
 * lists.
 *
 * ## What is NOT mirrored, and why (ruling on objectui#10859)
 *
 * The card's ruling: "A zod arm does not mirror an unread declared member onto
 * a second face." The registered components take the node's keys as React
 * props (`SchemaRenderer` spreads them; none of the six components spreads a
 * rest prop onward), so a node member is READ exactly when its component
 * destructures it and uses the binding. Measured that way, and with a runtime
 * probe through the real registry that varied only the one key, six declared
 * node members had no reader:
 *
 *   - `ProcessDesignerSchema.variables` and `ReportDesignerSchema.parameters`
 *     — no reader and no producer, so both were REMOVED from the TypeScript
 *     face in the same change (see the notes where they stood in
 *     `../designer.ts`); neither face declares them now.
 *   - `DataModelDesignerSchema.autoLayout` and `ReportDesignerSchema
 *     .previewMode` — RETIRED on both faces by objectui#11434: a `?: never`
 *     tombstone on the TypeScript face and a `retirementTombstone` refused by
 *     name here (see the next section).
 *   - `ProcessDesignerSchema.version` and `.lanes` — born unmirrored here, and
 *     MIRRORED since objectui#11434 gave each a reader (`ProcessDesigner` draws
 *     the version in its toolbar and each lane as a band around its nodes),
 *     with a `BPMNLaneSchema` record mirror for the lanes.
 *
 * Every node member is mirrored now. The record types under the nodes
 * (`BPMNNode`, `BPMNLane`, `DataModelRelationship`, …) are mirrored member for
 * member as declared.
 *
 * ## Retired members (objectui#11434)
 *
 * The seat's ruling on objectui#11434 settled every unread member of this
 * family by the maintainer's criterion ("does the mainstream have it? Yes ⇒
 * give it a reader. No ⇒ retire it on both faces"). The retired ones are
 * refused by name below, each with the reason and what to write instead, and
 * are `?: never` on the TypeScript face:
 *
 *   - `DataModelDesignerSchema.autoLayout`, `ReportDesignerSchema.previewMode`;
 *   - `DesignerComponent.parentId`, `DataModelRelationship.onUpdate`,
 *     `BPMNNode.serviceEndpoint`;
 *   - `ObjectDefinition.relationships` and `DesignerFieldDefinition
 *     .validationRules`, whose element types (`ObjectDefinitionRelationship`,
 *     `DesignerValidationRule`) left both faces and the exports with them.
 *
 * The members ruled READ stay declared and mirrored, and every one is drawn
 * now: the data-model and process designers' since the card's second change,
 * which also RESPELLED `DataModelRelationship.onDelete` as `deleteBehavior`,
 * in the spec's vocabulary (`onDelete` is refused by name with the migration);
 * the page designer's, the shared canvas's `backgroundColor` and the report
 * designer's since its third. That change also moved a report field element
 * onto its declared `dataBinding`: the undeclared `properties.field` it used
 * to read is refused by name, with the migration, by the check on the element's
 * `properties` record. No member of this family is declared and unread.
 *
 * ## Content channels
 *
 * None of the six components reads `body` or `children` (objectui#9256, family
 * D), so both are refused by name here, as the TypeScript twins refuse them
 * with `?: never` — one {@link neitherContentChannelGuidance} string per node,
 * fed to both members.
 *
 * ⛔ No `.default()` anywhere in this module — see the "authors no default"
 * note in `index.zod.ts`. Each component has its own fallbacks; this face
 * validates and writes nothing into a document.
 *
 * @module zod/designer
 * @packageDocumentation
 */

import { z } from 'zod';
import { BaseSchema } from './base.zod.js';
import { aliasKeyRefusal, neitherContentChannelGuidance, retirementTombstone } from './tombstone.zod.js';
import { DESIGNER_FIELD_TYPES, type DesignerComponent } from '../designer.js';

/**
 * The route every designer node takes to its component, for the objectui#9256
 * guidance: the registration hands the node to the component as props, and
 * the component reads no `children` prop of its own.
 */
/**
 * The objectui#11434 retirement guidance: the refusal names the key and the
 * record or node type it sat on, says why nothing honoured it, and prescribes
 * what to write instead. The TypeScript face carries the same members as
 * `?: never` tombstones with the same prescription.
 */
const retiredDesignerMember = (owner: string, key: string, why: string, instead: string) =>
  retirementTombstone(
    `RETIRED (objectui#11434, ADR-0049) — \`${key}\` on \`${owner}\` had no reader: ${why} Instead: ${instead}`,
  );

const propsRoute = (component: string) =>
  'its registration (`@object-ui/plugin-designer`) takes no `schema` prop: `SchemaRenderer` spreads the '
  + `node's other keys into \`${component}\` as props, and \`${component}\` reads no \`children\` prop of its own`;

const PAGE_DESIGNER_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'page-designer',
  propsRoute('PageDesigner'),
  'the designer UI `PageDesigner` draws from `canvas`, `components`, `palette`, `propertyEditor`, '
    + '`showComponentTree`, `undoRedo` and `readOnly`',
);
const DATA_MODEL_DESIGNER_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'data-model-designer',
  propsRoute('DataModelDesigner'),
  'the designer UI `DataModelDesigner` draws from `entities`, `relationships`, `canvas`, '
    + '`showRelationshipLabels` and `readOnly`',
);
const PROCESS_DESIGNER_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'process-designer',
  propsRoute('ProcessDesigner'),
  'the designer UI `ProcessDesigner` draws from `processName`, `version`, `nodes`, `edges`, `lanes`, `canvas`, '
    + '`showMinimap`, `showToolbar` and `readOnly`',
);
const REPORT_DESIGNER_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'report-designer',
  propsRoute('ReportDesigner'),
  'the designer UI `ReportDesigner` draws from `reportName`, `objectName`, `pageSize`, `orientation`, '
    + '`margins`, `sections`, `showToolbar`, `showPropertyPanel` and `readOnly`',
);
const OBJECT_MANAGER_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'object-manager',
  propsRoute('ObjectManager'),
  'the designer UI `ObjectManager` draws from `objects`, `showSystemObjects` and `readOnly`',
);
const FIELD_DESIGNER_NEITHER_CHANNEL = neitherContentChannelGuidance(
  'field-designer',
  propsRoute('FieldDesigner'),
  'the designer UI `FieldDesigner` draws from `objectName`, `fields` and `readOnly`',
);

/** A canvas length: pixels, grid units, or a CSS length string (`number | string` on the TS face). */
const CanvasLength = z.union([z.number(), z.string()]);

// ============================================================================
// Page Designer
// ============================================================================

/**
 * Designer Position — mirrors `DesignerPosition` (`../designer.ts`).
 */
export const DesignerPositionSchema = z.object({
  x: z.number().describe('X coordinate (pixels or grid units)'),
  y: z.number().describe('Y coordinate (pixels or grid units)'),
  width: CanvasLength.describe('Width'),
  height: CanvasLength.describe('Height'),
});

/**
 * Designer Canvas Config — mirrors `DesignerCanvasConfig` (`../designer.ts`).
 */
export const DesignerCanvasConfigSchema = z.object({
  width: z.number().describe('Canvas width'),
  height: z.number().describe('Canvas height'),
  gridSize: z.number().optional().describe('Grid snap size'),
  showGrid: z.boolean().optional().describe('Whether to show grid'),
  snapToGrid: z.boolean().optional().describe('Whether to enable snap-to-grid'),
  zoom: z.number().optional().describe('Zoom level (1.0 = 100%)'),
  backgroundColor: z.string().optional().describe('Background color'),
});

/**
 * Designer Component — mirrors `DesignerComponent` (`../designer.ts`), a
 * component placed on the page designer's canvas.
 *
 * INPUT FACE: both type arguments carry the TypeScript declaration, the
 * `TreeNodeSchema` construct (objectui#7760): the annotation breaks the
 * recursion through `children` in the initializer below, and `tsc` compares the
 * mirror against the declaration as a whole type at the annotation itself.
 */
export const DesignerComponentSchema: z.ZodType<DesignerComponent, DesignerComponent> = z.lazy(() =>
  z.object({
    id: z.string().describe('Unique component ID'),
    type: z.string().describe('Component type'),
    label: z.string().optional().describe('Display label'),
    position: DesignerPositionSchema.describe('Position on canvas'),
    props: z.record(z.string(), z.unknown()).describe('Component properties'),
    children: z.array(DesignerComponentSchema).optional().describe('Child components'),
    parentId: retiredDesignerMember(
      'DesignerComponent',
      'parentId',
      'it was a second spelling of the component tree, which `children` already carries, and `PageDesigner` never read it.',
      "nest the child in its parent's `children` array, and delete the key.",
    ),
    locked: z.boolean().optional().describe('Lock state'),
    visible: z.boolean().optional().describe('Visibility'),
    zIndex: z.number().optional().describe('Z-index for layering'),
  }),
);

/**
 * Designer Palette Item — mirrors `DesignerPaletteItem` (`../designer.ts`).
 */
export const DesignerPaletteItemSchema = z.object({
  type: z.string().describe('Component type'),
  label: z.string().describe('Display label'),
  icon: z.string().optional().describe('Icon'),
  defaultProps: z.record(z.string(), z.unknown()).optional().describe('Default properties'),
  defaultSize: z
    .object({ width: CanvasLength, height: CanvasLength })
    .optional()
    .describe('Default size'),
  preview: z.string().optional().describe('Preview image URL'),
});

/**
 * Designer Palette Category — mirrors `DesignerPaletteCategory` (`../designer.ts`).
 */
export const DesignerPaletteCategorySchema = z.object({
  name: z.string().describe('Category name'),
  label: z.string().describe('Category label'),
  icon: z.string().optional().describe('Category icon'),
  items: z.array(DesignerPaletteItemSchema).describe('Available components'),
});

/**
 * Page Designer Schema — mirrors `PageDesignerSchema` (`../designer.ts`).
 */
export const PageDesignerSchema = BaseSchema.extend({
  type: z.literal('page-designer'),
  canvas: DesignerCanvasConfigSchema.describe('Canvas configuration'),
  components: z.array(DesignerComponentSchema).describe('Components on the canvas'),
  palette: z.array(DesignerPaletteCategorySchema).optional().describe('Available component palette'),
  propertyEditor: z.boolean().optional().describe('Property editor configuration'),
  showComponentTree: z.boolean().optional().describe('Component tree visibility'),
  undoRedo: z.boolean().optional().describe('Undo/redo support'),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  body: retirementTombstone(PAGE_DESIGNER_NEITHER_CHANNEL),
  children: retirementTombstone(PAGE_DESIGNER_NEITHER_CHANNEL),
});

// ============================================================================
// Data Model Designer
// ============================================================================

/**
 * Data Model Field — mirrors `DataModelField` (`../designer.ts`).
 */
export const DataModelFieldSchema = z.object({
  name: z.string().describe('Field name'),
  label: z.string().optional().describe('Display label'),
  type: z.string().describe('Field data type'),
  primaryKey: z.boolean().optional().describe('Whether this is a primary key'),
  required: z.boolean().optional().describe('Whether this field is required'),
  unique: z.boolean().optional().describe('Whether this field is unique'),
  defaultValue: z.unknown().optional().describe('Default value'),
  description: z.string().optional().describe('Field description'),
});

/**
 * Data Model Entity — mirrors `DataModelEntity` (`../designer.ts`).
 */
export const DataModelEntitySchema = z.object({
  id: z.string().describe('Entity identifier'),
  name: z.string().describe('Entity name'),
  label: z.string().describe('Display label'),
  fields: z.array(DataModelFieldSchema).describe('Entity fields'),
  position: z.object({ x: z.number(), y: z.number() }).describe('Position on canvas'),
  color: z.string().optional().describe('Entity color'),
  description: z.string().optional().describe('Entity description'),
});

/**
 * The referential action on delete, in `@objectstack/spec`'s vocabulary
 * (`FieldSchema.deleteBehavior`). The TypeScript face reads its type off the
 * spec; `zod-mirror-parity.test.ts` compares this enum with it, so a value the
 * spec adds or drops reddens the pair rather than drifting.
 */
const DeleteBehavior = z.enum(['set_null', 'cascade', 'restrict']);

/**
 * Data Model Relationship — mirrors `DataModelRelationship` (`../designer.ts`).
 *
 * `deleteBehavior` is the platform's spelling of the referential action, and
 * `onDelete` — the designer's own spelling, with its own four-literal
 * vocabulary — is refused by name with the migration (objectui#11434, the
 * respelling). `onUpdate` is RETIRED on both faces (objectui#11434): the
 * platform's relationship contract has no update behaviour.
 */
export const DataModelRelationshipSchema = z.object({
  id: z.string().describe('Relationship identifier'),
  sourceEntity: z.string().describe('Source entity ID'),
  sourceField: z.string().describe('Source field'),
  targetEntity: z.string().describe('Target entity ID'),
  targetField: z.string().describe('Target field'),
  type: z.enum(['one-to-one', 'one-to-many', 'many-to-many']).describe('Relationship type'),
  label: z.string().optional().describe('Relationship label'),
  deleteBehavior: DeleteBehavior.optional().describe('What happens to the referencing records when the referenced one is deleted'),
  onDelete: aliasKeyRefusal(
    'onDelete',
    'deleteBehavior',
    'this relationship',
    "objectui#11434 (ADR-0049) respelled it in the platform's vocabulary, `@objectstack/spec`'s `FieldSchema.deleteBehavior`, which `DataModelDesigner` draws. Migration: rename the key; `cascade` and `restrict` keep their values, `set-null` becomes `set_null`, and `no-action` becomes `restrict` (the platform has no separate no-action; both refuse the delete while a reference remains).",
  ),
  onUpdate: retiredDesignerMember(
    'DataModelRelationship',
    'onUpdate',
    "the platform's relationship contract has no update behaviour (`@objectstack/spec` gives a relationship field `deleteBehavior` alone), so a designer that drew it would declare a capability no runtime delivers.",
    'delete the key; there is nothing to configure in its place.',
  ),
});

/**
 * Data Model Designer Schema — mirrors `DataModelDesignerSchema`
 * (`../designer.ts`). `autoLayout` is RETIRED on both faces (objectui#11434):
 * `DataModelDesigner` never read it, because the toolbar's "Auto Layout" button
 * runs on demand.
 */
export const DataModelDesignerSchema = BaseSchema.extend({
  type: z.literal('data-model-designer'),
  entities: z.array(DataModelEntitySchema).describe('Entities in the model'),
  relationships: z.array(DataModelRelationshipSchema).describe('Relationships between entities'),
  canvas: DesignerCanvasConfigSchema.optional().describe('Canvas configuration'),
  showRelationshipLabels: z.boolean().optional().describe('Show relationship labels'),
  autoLayout: retiredDesignerMember(
    'data-model-designer',
    'autoLayout',
    "auto-layout is an action, not authored state: the toolbar's Auto Layout button arranges the entities on demand whatever the node says.",
    'use that button, and delete the key.',
  ),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  body: retirementTombstone(DATA_MODEL_DESIGNER_NEITHER_CHANNEL),
  children: retirementTombstone(DATA_MODEL_DESIGNER_NEITHER_CHANNEL),
});

// ============================================================================
// Process Designer (BPMN 2.0)
// ============================================================================

/** The BPMN node vocabulary — mirrors `BPMNNodeType` (`../designer.ts`). */
const BPMNNodeTypeSchema = z.enum([
  'start-event',
  'end-event',
  'task',
  'user-task',
  'service-task',
  'script-task',
  'send-task',
  'receive-task',
  'manual-task',
  'business-rule-task',
  'sub-process',
  'call-activity',
  'exclusive-gateway',
  'parallel-gateway',
  'inclusive-gateway',
  'event-based-gateway',
  'intermediate-catch-event',
  'intermediate-throw-event',
  'boundary-event',
  'timer-event',
  'message-event',
  'signal-event',
  'error-event',
  'compensation-event',
]);

/**
 * BPMN Node — mirrors `BPMNNode` (`../designer.ts`).
 */
export const BPMNNodeSchema = z.object({
  id: z.string().describe('Node identifier'),
  type: BPMNNodeTypeSchema.describe('Node type'),
  label: z.string().describe('Display label'),
  position: z.object({ x: z.number(), y: z.number() }).describe('Position on canvas'),
  properties: z.record(z.string(), z.unknown()).optional().describe('Node properties'),
  assignee: z.string().optional().describe('Assigned user/role (for user tasks)'),
  dueDate: z.string().optional().describe('Due date expression'),
  script: z.string().optional().describe('Script content (for script tasks)'),
  serviceEndpoint: retiredDesignerMember(
    'BPMNNode',
    'serviceEndpoint',
    'a service task references an implementation, not an endpoint URL, and `ProcessDesigner` never read it.',
    'delete the key; there is nothing to configure in its place.',
  ),
  description: z.string().optional().describe('Description'),
});

/**
 * BPMN Edge — mirrors `BPMNEdge` (`../designer.ts`).
 */
export const BPMNEdgeSchema = z.object({
  id: z.string().describe('Edge identifier'),
  source: z.string().describe('Source node ID'),
  target: z.string().describe('Target node ID'),
  condition: z.string().optional().describe('Condition expression (for conditional flows)'),
  label: z.string().optional().describe('Edge label'),
  isDefault: z.boolean().optional().describe('Whether this is the default flow'),
});

/**
 * BPMN Lane — mirrors `BPMNLane` (`../designer.ts`), a swim lane
 * `ProcessDesigner` draws as a band around the nodes `nodeIds` names
 * (objectui#11434).
 */
export const BPMNLaneSchema = z.object({
  id: z.string().describe('Lane identifier'),
  label: z.string().describe('Lane label'),
  role: z.string().optional().describe('Associated role or department'),
  nodeIds: z.array(z.string()).describe('Nodes in this lane'),
});

/**
 * Process Designer Schema — mirrors `ProcessDesignerSchema`
 * (`../designer.ts`) member for member. `version` and `lanes` were born
 * unmirrored (objectui#10859 batch 7: `ProcessDesigner` read neither) and are
 * mirrored since objectui#11434 gave each a reader — the toolbar draws the
 * version beside the process name, and each lane is a band around its nodes.
 * `variables` left BOTH faces with objectui#10859 (no reader, no producer).
 */
export const ProcessDesignerSchema = BaseSchema.extend({
  type: z.literal('process-designer'),
  processName: z.string().describe('Process name'),
  version: z.string().optional().describe('Process version'),
  nodes: z.array(BPMNNodeSchema).describe('BPMN nodes'),
  edges: z.array(BPMNEdgeSchema).describe('BPMN edges/flows'),
  lanes: z.array(BPMNLaneSchema).optional().describe('Swim lanes'),
  canvas: DesignerCanvasConfigSchema.optional().describe('Canvas configuration'),
  showMinimap: z.boolean().optional().describe('Show minimap'),
  showToolbar: z.boolean().optional().describe('Show toolbar'),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  body: retirementTombstone(PROCESS_DESIGNER_NEITHER_CHANNEL),
  children: retirementTombstone(PROCESS_DESIGNER_NEITHER_CHANNEL),
});

// ============================================================================
// Report Designer
// ============================================================================

/** The report section vocabulary — mirrors `ReportSectionType` (`../designer.ts`). */
const ReportSectionTypeSchema = z.enum([
  'header',
  'detail',
  'footer',
  'group-header',
  'group-footer',
  'page-header',
  'page-footer',
]);

/**
 * The refusal `properties.field` meets on a report element (objectui#11434):
 * the binding is the element's declared `dataBinding`, which `ReportDesigner`
 * reads alone. The TypeScript face documents the same migration on
 * `properties`.
 */
const REPORT_ELEMENT_FIELD_RESPELLED =
  'RESPELLED (objectui#11434, ADR-0049) — `properties.field` on a report element is the element\'s own `dataBinding` now: '
  + 'a declared member replaces the undeclared bag key, and `ReportDesigner` reads `dataBinding` alone. '
  + 'Migration: move the value to the element\'s `dataBinding`, and delete `properties.field`.';

/**
 * The open `properties` bag of a report element, refusing ONE key by name.
 *
 * A RECORD with a check, not an object with a catchall: the strict authoring
 * face closes every object it reaches (`catchall: z.never()`) but keeps a
 * record's keys open, so only a record leaves a text element's `text` — and
 * every other type's own settings — authorable there. The check reports
 * `field` at its own path with the migration.
 */
const ReportElementPropertiesSchema = z.record(z.string(), z.unknown()).superRefine((bag, ctx) => {
  if (Object.prototype.hasOwnProperty.call(bag, 'field')) {
    ctx.addIssue({ code: 'custom', path: ['field'], message: REPORT_ELEMENT_FIELD_RESPELLED });
  }
});

/**
 * Report Designer Element — mirrors `ReportDesignerElement` (`../designer.ts`).
 *
 * `properties` stays an open bag (a text element keeps its `text` there), with
 * ONE key refused by name: `field`, respelled as the element's `dataBinding`.
 */
export const ReportDesignerElementSchema = z.object({
  id: z.string().describe('Element identifier'),
  type: z
    .enum(['text', 'field', 'image', 'chart', 'table', 'barcode', 'line', 'rectangle', 'expression'])
    .describe('Element type'),
  position: DesignerPositionSchema.describe('Position within section'),
  properties: ReportElementPropertiesSchema.describe('Element properties'),
  dataBinding: z.string().optional().describe('Data binding expression'),
  format: z
    .object({
      fontFamily: z.string().optional(),
      fontSize: z.number().optional(),
      fontWeight: z.enum(['normal', 'bold']).optional(),
      fontStyle: z.enum(['normal', 'italic']).optional(),
      color: z.string().optional(),
      backgroundColor: z.string().optional(),
      alignment: z.enum(['left', 'center', 'right']).optional(),
      verticalAlignment: z.enum(['top', 'middle', 'bottom']).optional(),
      border: z.string().optional(),
      padding: z.string().optional(),
      numberFormat: z.string().optional(),
      dateFormat: z.string().optional(),
    })
    .optional()
    .describe('Formatting options'),
});

/**
 * Report Designer Section — mirrors `ReportDesignerSection` (`../designer.ts`).
 */
export const ReportDesignerSectionSchema = z.object({
  type: ReportSectionTypeSchema.describe('Section type'),
  height: z.number().describe('Section height'),
  elements: z.array(ReportDesignerElementSchema).describe('Elements in this section'),
  groupField: z.string().optional().describe('Group field (for group headers/footers)'),
  repeat: z.boolean().optional().describe('Whether section repeats'),
  pageBreakBefore: z.boolean().optional().describe('Page break before'),
});

/**
 * Report Designer Schema — mirrors `ReportDesignerSchema` (`../designer.ts`).
 * `previewMode` is RETIRED on both faces (objectui#11434): `ReportDesigner`
 * declared it on its props and never read it. `parameters` left BOTH faces
 * with objectui#10859 (no reader, no producer).
 */
export const ReportDesignerSchema = BaseSchema.extend({
  type: z.literal('report-designer'),
  reportName: z.string().describe('Report name'),
  objectName: z.string().describe('Data source object'),
  pageSize: z.enum(['A4', 'A3', 'Letter', 'Legal', 'Tabloid']).optional().describe('Page size'),
  orientation: z.enum(['portrait', 'landscape']).optional().describe('Page orientation'),
  margins: z
    .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
    .optional()
    .describe('Page margins'),
  sections: z.array(ReportDesignerSectionSchema).describe('Report sections'),
  showToolbar: z.boolean().optional().describe('Show designer toolbar'),
  showPropertyPanel: z.boolean().optional().describe('Show property panel'),
  previewMode: retiredDesignerMember(
    'report-designer',
    'previewMode',
    'preview is a mode of the tool, not state a report document carries, and `ReportDesigner` never read it.',
    'for a chrome-free, non-editable layout author `readOnly: true`, `showToolbar: false` and `showPropertyPanel: false`, and delete the key.',
  ),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  body: retirementTombstone(REPORT_DESIGNER_NEITHER_CHANNEL),
  children: retirementTombstone(REPORT_DESIGNER_NEITHER_CHANNEL),
});

// ============================================================================
// Object Manager
// ============================================================================

/**
 * Object Definition — mirrors `ObjectDefinition` (`../designer.ts`).
 */
export const ObjectDefinitionSchema = z.object({
  id: z.string().describe('Unique object identifier'),
  name: z.string().describe('API name (snake_case)'),
  label: z.string().describe('Display label'),
  pluralLabel: z.string().optional().describe('Plural display label'),
  description: z.string().optional().describe('Object description'),
  icon: z.string().optional().describe('Icon name (Lucide icon)'),
  group: z.string().optional().describe('Grouping/category'),
  sortOrder: z.number().optional().describe('Sort order within group'),
  isSystem: z.boolean().optional().describe('Whether this is a system object (non-deletable)'),
  fieldCount: z.number().optional().describe('Field count (read-only, for display)'),
  relationships: retiredDesignerMember(
    'ObjectDefinition',
    'relationships',
    "a relationship is a field, not an object-level list — `@objectstack/spec`'s `ObjectSchema` refuses this array as an unrecognized key — and nothing read it.",
    'declare the relationship on the referencing field (in this designer, a `lookup` field whose `referenceTo` names the related object; in `@objectstack/spec` metadata, a `lookup` / `master_detail` field whose `reference` names it), and delete the key.',
  ),
});

/**
 * Object Manager Schema — mirrors `ObjectManagerSchema` (`../designer.ts`).
 */
export const ObjectManagerSchema = BaseSchema.extend({
  type: z.literal('object-manager'),
  objects: z.array(ObjectDefinitionSchema).describe('List of object definitions'),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  showSystemObjects: z.boolean().optional().describe('Show system objects'),
  body: retirementTombstone(OBJECT_MANAGER_NEITHER_CHANNEL),
  children: retirementTombstone(OBJECT_MANAGER_NEITHER_CHANNEL),
});

// ============================================================================
// Field Designer
// ============================================================================

/**
 * Designer Field Option — mirrors `DesignerFieldOption` (`../designer.ts`).
 */
export const DesignerFieldOptionSchema = z.object({
  label: z.string().describe('Option label'),
  value: z.string().describe('Option value'),
  color: z.string().optional().describe('Option color (for badge display)'),
});

/**
 * Designer Field Definition — mirrors `DesignerFieldDefinition`
 * (`../designer.ts`). `type` is the designer's own vocabulary,
 * `DESIGNER_FIELD_TYPES`, read from the declaration module rather than
 * restated, so the two cannot drift.
 */
export const DesignerFieldDefinitionSchema = z.object({
  id: z.string().describe('Unique field identifier'),
  name: z.string().describe('API name (snake_case)'),
  label: z.string().describe('Display label'),
  type: z.enum(DESIGNER_FIELD_TYPES).describe('Field type'),
  group: z.string().optional().describe('Field group/section'),
  description: z.string().optional().describe('Field description / help text'),
  required: z.boolean().optional().describe('Whether field is required'),
  unique: z.boolean().optional().describe('Whether field is unique'),
  readonly: z.boolean().optional().describe('Whether field is read-only'),
  hidden: z.boolean().optional().describe('Whether field is hidden'),
  defaultValue: z.unknown().optional().describe('Default value'),
  placeholder: z.string().optional().describe('Placeholder text'),
  options: z.array(DesignerFieldOptionSchema).optional().describe('Select options (for select type)'),
  validationRules: retiredDesignerMember(
    'DesignerFieldDefinition',
    'validationRules',
    "`@objectstack/spec`'s `FieldSchema` refuses this spelling as an unrecognized key, no editor offered it and no converter carried it.",
    "put bounds on the field as `min` / `max` / `minLength` / `maxLength` in the field metadata and any other rule in the object's `validations`, and delete the key.",
  ),
  isSystem: z.boolean().optional().describe('Whether this is a system field'),
  externalId: z.boolean().optional().describe('External ID flag'),
  trackHistory: z.boolean().optional().describe('Track field history'),
  referenceTo: z.string().optional().describe('Lookup reference object (for lookup type)'),
});

/**
 * Field Designer Schema — mirrors `FieldDesignerSchema` (`../designer.ts`).
 */
export const FieldDesignerSchema = BaseSchema.extend({
  type: z.literal('field-designer'),
  objectName: z.string().describe('Object name this field designer belongs to'),
  fields: z.array(DesignerFieldDefinitionSchema).describe('List of field definitions'),
  readOnly: z.boolean().optional().describe('Read-only mode'),
  body: retirementTombstone(FIELD_DESIGNER_NEITHER_CHANNEL),
  children: retirementTombstone(FIELD_DESIGNER_NEITHER_CHANNEL),
});

/**
 * Union of the six designer node arms — the category member
 * `AnyComponentSchema` lists (objectui#10859). Named `DesignerUnionSchema`
 * because `DesignerComponentSchema` is the canvas component's mirror above
 * (the `ReportUnionSchema` precedent in `reports.zod.ts`).
 */
const DesignerUnionSchemaInferred = z.discriminatedUnion('type', [
  PageDesignerSchema,
  DataModelDesignerSchema,
  ProcessDesignerSchema,
  ReportDesignerSchema,
  ObjectManagerSchema,
  FieldDesignerSchema,
]);

/**
 * The TYPE of {@link DesignerUnionSchema}, NAMED so declaration emit prints it by
 * reference (objectui#11573): see "Why every category union's TYPE is named"
 * on `AnyComponentSchema` (`index.zod.ts`). It adds no member.
 */
export interface DesignerUnionZodType extends DesignerUnionSchemaInferredType {
  options: DesignerUnionSchemaInferredType['options'];
}
type DesignerUnionSchemaInferredType = typeof DesignerUnionSchemaInferred;

/** The union above, typed by its named {@link DesignerUnionZodType}. */
export const DesignerUnionSchema: DesignerUnionZodType = DesignerUnionSchemaInferred;
