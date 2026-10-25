/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The six `@object-ui/plugin-designer` node types have a zod arm in
 * `AnyComponentSchema` (objectui#10859, batch 7).
 *
 * ## The defect these pin
 *
 * `page-designer`, `data-model-designer`, `process-designer`,
 * `report-designer`, `object-manager` and `field-designer` are registered by
 * `@object-ui/plugin-designer` and declared on the published TypeScript face
 * (`../designer.ts`), and `AnyComponentSchema` carried no arm for any of them,
 * so `safeValidateSchema` refused every document naming one with
 * `invalid_union` at `type`.
 *
 * ## Two instruments, and which half each one reads
 *
 * The `Expect` / `Equal` blocks below are TYPE-level: `tsc -p
 * tsconfig.test.json` (the third leg of this package's `type-check` script)
 * reads them, and vitest, which strips types, does not. The `describe` blocks
 * are RUNTIME and vitest reads them. A green run of either one alone says
 * nothing about the other.
 *
 * ## What the parity half asserts
 *
 * Every arm and record mirror declares exactly its declaration's key set, and
 * each member accepts exactly the declared type — with no exception since
 * objectui#11434 gave `ProcessDesignerSchema`'s `lanes` and `version` their
 * reader and mirrored both (with a `BPMNLaneSchema` record mirror). Until then
 * they were declared on the TypeScript face alone, the one asymmetry these
 * rows named. The two members the batch-7 ruling settled first,
 * `ProcessDesignerSchema.variables` and `ReportDesignerSchema.parameters`, are
 * absent from BOTH faces.
 *
 * The other two batch-7 exceptions, `DataModelDesignerSchema.autoLayout` and
 * `ReportDesignerSchema.previewMode`, are RETIRED on both faces since
 * objectui#11434 — a `?: never` tombstone on the TypeScript face and a
 * retirement tombstone on the arm, so the arm declares them again and the
 * key-set rows below hold without an exception. Those tombstones, and the
 * other members objectui#11434 retired, are pinned by
 * `designer-members-retired-11434.test.ts` beside this file.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  BPMNEdgeSchema,
  BPMNLaneSchema,
  BPMNNodeSchema,
  DataModelDesignerSchema,
  DataModelEntitySchema,
  DataModelFieldSchema,
  DataModelRelationshipSchema,
  DesignerCanvasConfigSchema,
  DesignerComponentSchema,
  DesignerFieldDefinitionSchema,
  DesignerFieldOptionSchema,
  DesignerPaletteCategorySchema,
  DesignerPaletteItemSchema,
  DesignerPositionSchema,
  DesignerUnionSchema,
  FieldDesignerSchema,
  ObjectDefinitionSchema,
  ObjectManagerSchema,
  PageDesignerSchema,
  ProcessDesignerSchema,
  ReportDesignerElementSchema,
  ReportDesignerSchema,
  ReportDesignerSectionSchema,
  StrictAnyComponentSchema,
  safeValidateSchema,
} from '../zod/index.zod.js';
import type {
  BPMNEdge as Ts_BPMNEdge,
  BPMNLane as Ts_BPMNLane,
  BPMNNode as Ts_BPMNNode,
  DataModelDesignerSchema as Ts_DataModelDesignerSchema,
  DataModelEntity as Ts_DataModelEntity,
  DataModelField as Ts_DataModelField,
  DataModelRelationship as Ts_DataModelRelationship,
  DesignerCanvasConfig as Ts_DesignerCanvasConfig,
  DesignerComponent as Ts_DesignerComponent,
  DesignerFieldDefinition as Ts_DesignerFieldDefinition,
  DesignerFieldOption as Ts_DesignerFieldOption,
  DesignerPaletteCategory as Ts_DesignerPaletteCategory,
  DesignerPaletteItem as Ts_DesignerPaletteItem,
  DesignerPosition as Ts_DesignerPosition,
  FieldDesignerSchema as Ts_FieldDesignerSchema,
  ObjectDefinition as Ts_ObjectDefinition,
  ObjectManagerSchema as Ts_ObjectManagerSchema,
  PageDesignerSchema as Ts_PageDesignerSchema,
  ProcessDesignerSchema as Ts_ProcessDesignerSchema,
  ReportDesignerElement as Ts_ReportDesignerElement,
  ReportDesignerSchema as Ts_ReportDesignerSchema,
  ReportDesignerSection as Ts_ReportDesignerSection,
} from '../designer';

/* ── Type-level parity: the `tsc` channel ────────────────────────────────── */

/** Invariant equality — `extends` both ways would accept a narrowing. */
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Expect<T extends true> = T;

/** The mirror's own shape. */
type ShapeOf<M> = M extends { shape: infer S } ? S : never;
/** What a shape entry ACCEPTS (input side, so `.optional()` shows). */
type InputOf<T> = T extends z.ZodType ? z.input<T> : never;
/** The declaration's DECLARED keys — any index signature dropped (`BaseSchema` carried one until objectui#8347). */
type DeclaredKeys<D> = Extract<
  keyof { [K in keyof D as string extends K ? never : number extends K ? never : K]: D[K] },
  string
>;
/** The mirror's declared keys, read from its own shape. */
type MirroredKeys<M> = Extract<keyof ShapeOf<M>, string>;

/** Declared members whose accepted type differs from the declaration's. */
type MismatchedKeys<M, D> = {
  [K in DeclaredKeys<D> & MirroredKeys<M>]: Equal<InputOf<ShapeOf<M>[K]>, D[K]> extends true ? never : K;
}[DeclaredKeys<D> & MirroredKeys<M>];

/**
 * Every record mirror declares exactly the declaration's key set, and every arm
 * declares it too. `process-designer` omitted `lanes` and `version` until
 * objectui#11434 gave them a reader; its row names no exception now.
 */
export type assertionKeySetsAgree = [
  Expect<Equal<MirroredKeys<typeof DesignerPositionSchema>, DeclaredKeys<Ts_DesignerPosition>>>,
  Expect<Equal<MirroredKeys<typeof DesignerCanvasConfigSchema>, DeclaredKeys<Ts_DesignerCanvasConfig>>>,
  Expect<Equal<MirroredKeys<typeof DesignerPaletteItemSchema>, DeclaredKeys<Ts_DesignerPaletteItem>>>,
  Expect<Equal<MirroredKeys<typeof DesignerPaletteCategorySchema>, DeclaredKeys<Ts_DesignerPaletteCategory>>>,
  Expect<Equal<MirroredKeys<typeof DataModelFieldSchema>, DeclaredKeys<Ts_DataModelField>>>,
  Expect<Equal<MirroredKeys<typeof DataModelEntitySchema>, DeclaredKeys<Ts_DataModelEntity>>>,
  Expect<Equal<MirroredKeys<typeof DataModelRelationshipSchema>, DeclaredKeys<Ts_DataModelRelationship>>>,
  Expect<Equal<MirroredKeys<typeof BPMNNodeSchema>, DeclaredKeys<Ts_BPMNNode>>>,
  Expect<Equal<MirroredKeys<typeof BPMNEdgeSchema>, DeclaredKeys<Ts_BPMNEdge>>>,
  Expect<Equal<MirroredKeys<typeof BPMNLaneSchema>, DeclaredKeys<Ts_BPMNLane>>>,
  Expect<Equal<MirroredKeys<typeof ReportDesignerElementSchema>, DeclaredKeys<Ts_ReportDesignerElement>>>,
  Expect<Equal<MirroredKeys<typeof ReportDesignerSectionSchema>, DeclaredKeys<Ts_ReportDesignerSection>>>,
  Expect<Equal<MirroredKeys<typeof ObjectDefinitionSchema>, DeclaredKeys<Ts_ObjectDefinition>>>,
  Expect<Equal<MirroredKeys<typeof DesignerFieldOptionSchema>, DeclaredKeys<Ts_DesignerFieldOption>>>,
  Expect<Equal<MirroredKeys<typeof DesignerFieldDefinitionSchema>, DeclaredKeys<Ts_DesignerFieldDefinition>>>,
  Expect<Equal<MirroredKeys<typeof PageDesignerSchema>, DeclaredKeys<Ts_PageDesignerSchema>>>,
  Expect<Equal<MirroredKeys<typeof ObjectManagerSchema>, DeclaredKeys<Ts_ObjectManagerSchema>>>,
  Expect<Equal<MirroredKeys<typeof FieldDesignerSchema>, DeclaredKeys<Ts_FieldDesignerSchema>>>,
  Expect<Equal<MirroredKeys<typeof DataModelDesignerSchema>, DeclaredKeys<Ts_DataModelDesignerSchema>>>,
  Expect<Equal<MirroredKeys<typeof ProcessDesignerSchema>, DeclaredKeys<Ts_ProcessDesignerSchema>>>,
  Expect<Equal<MirroredKeys<typeof ReportDesignerSchema>, DeclaredKeys<Ts_ReportDesignerSchema>>>,
];

/** Every mirrored member's accepted type equals the declaration's, on every arm and record mirror. */
export type assertionMemberTypesAgree = [
  Expect<Equal<MismatchedKeys<typeof DesignerPositionSchema, Ts_DesignerPosition>, never>>,
  Expect<Equal<MismatchedKeys<typeof DesignerCanvasConfigSchema, Ts_DesignerCanvasConfig>, never>>,
  Expect<Equal<MismatchedKeys<typeof DesignerPaletteItemSchema, Ts_DesignerPaletteItem>, never>>,
  Expect<Equal<MismatchedKeys<typeof DesignerPaletteCategorySchema, Ts_DesignerPaletteCategory>, never>>,
  Expect<Equal<MismatchedKeys<typeof DataModelFieldSchema, Ts_DataModelField>, never>>,
  Expect<Equal<MismatchedKeys<typeof DataModelEntitySchema, Ts_DataModelEntity>, never>>,
  Expect<Equal<MismatchedKeys<typeof DataModelRelationshipSchema, Ts_DataModelRelationship>, never>>,
  Expect<Equal<MismatchedKeys<typeof BPMNNodeSchema, Ts_BPMNNode>, never>>,
  Expect<Equal<MismatchedKeys<typeof BPMNEdgeSchema, Ts_BPMNEdge>, never>>,
  Expect<Equal<MismatchedKeys<typeof BPMNLaneSchema, Ts_BPMNLane>, never>>,
  Expect<Equal<MismatchedKeys<typeof ReportDesignerElementSchema, Ts_ReportDesignerElement>, never>>,
  Expect<Equal<MismatchedKeys<typeof ReportDesignerSectionSchema, Ts_ReportDesignerSection>, never>>,
  Expect<Equal<MismatchedKeys<typeof ObjectDefinitionSchema, Ts_ObjectDefinition>, never>>,
  Expect<Equal<MismatchedKeys<typeof DesignerFieldOptionSchema, Ts_DesignerFieldOption>, never>>,
  Expect<Equal<MismatchedKeys<typeof DesignerFieldDefinitionSchema, Ts_DesignerFieldDefinition>, never>>,
  Expect<Equal<MismatchedKeys<typeof PageDesignerSchema, Ts_PageDesignerSchema>, never>>,
  Expect<Equal<MismatchedKeys<typeof DataModelDesignerSchema, Ts_DataModelDesignerSchema>, never>>,
  Expect<Equal<MismatchedKeys<typeof ProcessDesignerSchema, Ts_ProcessDesignerSchema>, never>>,
  Expect<Equal<MismatchedKeys<typeof ReportDesignerSchema, Ts_ReportDesignerSchema>, never>>,
  Expect<Equal<MismatchedKeys<typeof ObjectManagerSchema, Ts_ObjectManagerSchema>, never>>,
  Expect<Equal<MismatchedKeys<typeof FieldDesignerSchema, Ts_FieldDesignerSchema>, never>>,
];

/**
 * The recursive canvas component exposes no `.shape` (a `z.lazy`), so it is
 * compared as a whole type, both directions of the annotation it carries.
 */
export type assertionCanvasComponentIsTheDeclaration = [
  Expect<Equal<z.input<typeof DesignerComponentSchema>, Ts_DesignerComponent>>,
  Expect<Equal<z.output<typeof DesignerComponentSchema>, Ts_DesignerComponent>>,
];

/**
 * The ruling's settlement, both faces: `variables` and `parameters` are
 * declared by NEITHER. (`autoLayout` and `previewMode`, two of the other four
 * batch-7 open members, are tombstones on both faces now — pinned beside this
 * file; `lanes` and `version` are read and mirrored, so the key-set rows above
 * hold them.)
 */
export type assertionSettlementFaces = [
  Expect<Equal<'variables' extends DeclaredKeys<Ts_ProcessDesignerSchema> ? true : false, false>>,
  Expect<Equal<'variables' extends MirroredKeys<typeof ProcessDesignerSchema> ? true : false, false>>,
  Expect<Equal<'parameters' extends DeclaredKeys<Ts_ReportDesignerSchema> ? true : false, false>>,
  Expect<Equal<'parameters' extends MirroredKeys<typeof ReportDesignerSchema> ? true : false, false>>,
];

/**
 * Non-vacuity: the comparison can fail. A member typed differently on the two
 * sides is reported by name, and an unmirrored key is caught by the key-set row.
 */
export type assertionInstrumentFires = [
  Expect<Equal<MismatchedKeys<z.ZodObject<{ a: z.ZodString }>, { a: number }>, 'a'>>,
  Expect<Equal<Equal<MirroredKeys<z.ZodObject<{ a: z.ZodString }>>, DeclaredKeys<{ a: string; b: string }>>, false>>,
];

/* ── Runtime: the documents that were refused ────────────────────────────── */

const POSITION = { x: 0, y: 0, width: 200, height: '4rem' };
const CANVAS = { width: 1200, height: 800, gridSize: 8, showGrid: true, snapToGrid: true, zoom: 1, backgroundColor: '#fff' };

/**
 * One document per armed key, every live mirrored member written. The members
 * objectui#11434 retired are absent: their tombstones accept nothing but
 * absence, and `designer-members-retired-11434.test.ts` pins the refusals.
 */
const FULL = [
  {
    type: 'page-designer',
    canvas: CANVAS,
    components: [
      {
        id: 'hero',
        type: 'card',
        label: 'Hero',
        position: POSITION,
        props: { title: 'Welcome' },
        children: [{ id: 'cta', type: 'button', position: POSITION, props: {}, locked: false, visible: true, zIndex: 2 }],
      },
    ],
    palette: [{ name: 'basic', label: 'Basic', icon: 'box', items: [{ type: 'text', label: 'Text', icon: 'type', defaultProps: { value: '' }, defaultSize: { width: 200, height: 40 }, preview: '/text.png' }] }],
    propertyEditor: true,
    showComponentTree: true,
    undoRedo: true,
    readOnly: false,
  },
  {
    type: 'data-model-designer',
    entities: [
      {
        id: 'e1', name: 'account', label: 'Account', position: { x: 10, y: 20 }, color: '#00f', description: 'Customers',
        fields: [{ name: 'id', label: 'ID', type: 'text', primaryKey: true, required: true, unique: true, defaultValue: null, description: 'key' }],
      },
    ],
    relationships: [
      { id: 'r1', sourceEntity: 'e1', sourceField: 'id', targetEntity: 'e2', targetField: 'account_id', type: 'one-to-many', label: 'has', deleteBehavior: 'cascade' },
    ],
    canvas: CANVAS,
    showRelationshipLabels: true,
    readOnly: false,
  },
  {
    type: 'process-designer',
    processName: 'Order Approval',
    version: '1.2',
    nodes: [
      { id: 'n1', type: 'start-event', label: 'Start', position: { x: 0, y: 0 } },
      { id: 'n2', type: 'user-task', label: 'Approve', position: { x: 200, y: 0 }, properties: { sla: 2 }, assignee: 'manager', dueDate: 'P2D', script: '', description: 'Manager approves' },
    ],
    edges: [{ id: 'f1', source: 'n1', target: 'n2', condition: 'amount > 0', label: 'go', isDefault: true }],
    lanes: [{ id: 'l1', label: 'Sales', role: 'Account executive', nodeIds: ['n1', 'n2'] }],
    canvas: CANVAS,
    showMinimap: true,
    showToolbar: true,
    readOnly: false,
  },
  {
    type: 'report-designer',
    reportName: 'Pipeline',
    objectName: 'opportunity',
    pageSize: 'A4',
    orientation: 'landscape',
    margins: { top: 40, right: 40, bottom: 40, left: 40 },
    sections: [
      {
        type: 'group-header', height: 80, groupField: 'stage', repeat: true, pageBreakBefore: false,
        elements: [{ id: 'el1', type: 'field', position: POSITION, properties: {}, dataBinding: 'name', format: { fontWeight: 'bold', alignment: 'right', verticalAlignment: 'middle', fontSize: 12 } }],
      },
    ],
    showToolbar: true,
    showPropertyPanel: true,
    readOnly: false,
  },
  {
    type: 'object-manager',
    objects: [
      {
        id: 'o1', name: 'account', label: 'Account', pluralLabel: 'Accounts', description: 'Customers', icon: 'Building',
        group: 'Custom Objects', sortOrder: 1, isSystem: false, fieldCount: 12,
      },
    ],
    readOnly: false,
    showSystemObjects: true,
  },
  {
    type: 'field-designer',
    objectName: 'account',
    fields: [
      {
        id: 'f1', name: 'rating', label: 'Rating', type: 'select', group: 'General', description: 'How hot',
        required: false, unique: false, readonly: false, hidden: false, defaultValue: 'warm', placeholder: 'Pick',
        options: [{ label: 'Warm', value: 'warm', color: 'orange' }],
        isSystem: false, externalId: false, trackHistory: true, referenceTo: 'account',
      },
    ],
    readOnly: false,
  },
] as const;

/** The members each declaration REQUIRES, and nothing else. */
const REQUIRED_ONLY = [
  { type: 'page-designer', canvas: { width: 800, height: 600 }, components: [] },
  { type: 'data-model-designer', entities: [], relationships: [] },
  { type: 'process-designer', processName: 'approval', nodes: [], edges: [] },
  { type: 'report-designer', reportName: 'pipeline', objectName: 'account', sections: [] },
  { type: 'object-manager', objects: [] },
  { type: 'field-designer', objectName: 'account', fields: [] },
] as const;

const TYPES = REQUIRED_ONLY.map((doc) => doc.type);

describe('the registered designer node types validate (objectui#10859 batch 7)', () => {
  it.each(FULL)('a fully populated $type document is accepted by safeValidateSchema', (doc) => {
    const result = safeValidateSchema(doc);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it.each(FULL)('a fully populated $type document is accepted by the strict authoring face', (doc) => {
    const result = StrictAnyComponentSchema.safeParse(doc);
    expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true);
  });

  it.each(REQUIRED_ONLY)('$type with its required members only is accepted on both faces', (doc) => {
    expect(safeValidateSchema(doc).success).toBe(true);
    expect(StrictAnyComponentSchema.safeParse(doc).success).toBe(true);
  });

  it.each(TYPES)('`{ type: %s }` alone is claimed at `type` — what it lacks is reported at the members', (type) => {
    // Lit control on the claim: the refusal is about the required members the
    // declaration names, never `invalid_union` at `type` (the defect).
    const result = safeValidateSchema({ type });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.length).toBeGreaterThan(0);
    for (const issue of result.error.issues) {
      expect(issue.code).not.toBe('invalid_union');
      expect(issue.path).not.toEqual(['type']);
    }
  });

  it('DesignerUnionSchema carries exactly the six registered literals', () => {
    const literals = DesignerUnionSchema.options.map((arm) => arm.shape.type.value).sort();
    expect(literals).toEqual([...TYPES].sort());
  });
});

describe('the arms are closed where the declaration is (objectui#10859 batch 7)', () => {
  it('refuses an undeclared member on the strict face, naming it — the strictness control', () => {
    const doc = { type: 'object-manager', objects: [], inventedKey10859: true };
    const strict = StrictAnyComponentSchema.safeParse(doc);
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect(issue, JSON.stringify(strict.error.issues)).toBeDefined();
    expect((issue as { keys?: string[] }).keys).toEqual(['inventedKey10859']);
    // The rendering face keeps its `.passthrough()`.
    expect(safeValidateSchema(doc).success).toBe(true);
  });

  it('judges a record member one level down: a BPMN node with an unknown `type` is refused at its path', () => {
    const doc = { type: 'process-designer', processName: 'p', nodes: [{ id: 'n', type: 'not-a-bpmn-type', label: 'x', position: { x: 0, y: 0 } }], edges: [] };
    const result = safeValidateSchema(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(['nodes', 0, 'type']);
  });

  it('judges the field designer\'s `type` against `DESIGNER_FIELD_TYPES`', () => {
    const field = { id: 'f', name: 'n', label: 'N' };
    expect(safeValidateSchema({ type: 'field-designer', objectName: 'a', fields: [{ ...field, type: 'slider' }] }).success).toBe(true);
    const refused = safeValidateSchema({ type: 'field-designer', objectName: 'a', fields: [{ ...field, type: 'master_detail' }] });
    expect(refused.success).toBe(false);
    if (refused.success) return;
    expect(refused.error.issues[0].path).toEqual(['fields', 0, 'type']);
  });

  it('judges the recursive canvas component at depth', () => {
    const child = { id: 'c', type: 'text', position: POSITION, props: {}, zIndex: 'top' };
    const doc = { type: 'page-designer', canvas: { width: 1, height: 1 }, components: [{ id: 'p', type: 'card', position: POSITION, props: {}, children: [child] }] };
    const result = safeValidateSchema(doc);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path).toEqual(['components', 0, 'children', 0, 'zIndex']);
  });

  it.each(TYPES)('%s refuses both content channels by name (objectui#9256 family D)', (type) => {
    const base = REQUIRED_ONLY.find((doc) => doc.type === type) as Record<string, unknown>;
    for (const key of ['body', 'children'] as const) {
      const result = safeValidateSchema({ ...base, [key]: [{ type: 'text', content: 'x' }] });
      expect(result.success, `${type}.${key}`).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0].code).toBe('invalid_type');
      expect(result.error.issues[0].path).toEqual([key]);
      expect(result.error.issues[0].message).toContain('objectui#9256');
      expect(result.error.issues[0].message).toContain(`\`${type}\``);
    }
  });
});

describe('the ruling\'s settlement (objectui#10859 batch 7, objectui#11434)', () => {
  it.each([
    ['process-designer', 'variables', [{ name: 'amount', type: 'number' }]],
    ['report-designer', 'parameters', [{ name: 'from', type: 'date', label: 'From' }]],
  ] as const)('%s no longer declares `%s`: the strict face refuses it as an unrecognized key', (type, key, value) => {
    const base = REQUIRED_ONLY.find((doc) => doc.type === type) as Record<string, unknown>;
    const strict = StrictAnyComponentSchema.safeParse({ ...base, [key]: value });
    expect(strict.success).toBe(false);
    if (strict.success) return;
    const issue = strict.error.issues.find((i) => i.code === 'unrecognized_keys');
    expect((issue as { keys?: string[] } | undefined)?.keys).toEqual([key]);
  });

  it('`lanes` and `version` are mirrored since objectui#11434 gave each a reader: a malformed lane is refused at its path', () => {
    const base = REQUIRED_ONLY.find((doc) => doc.type === 'process-designer') as Record<string, unknown>;
    const result = safeValidateSchema({ ...base, version: '1.2', lanes: [{ id: 'l1', label: 'Sales', nodeIds: 'n1' }] });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((i) => i.path.join('.'))).toContain('lanes.0.nodeIds');
    // Lit control: the same lane with its `nodeIds` list is accepted.
    expect(safeValidateSchema({ ...base, version: '1.2', lanes: [{ id: 'l1', label: 'Sales', nodeIds: ['n1'] }] }).success).toBe(true);
  });
});
