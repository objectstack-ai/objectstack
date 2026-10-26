/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * ObjectTree Component (tree-grid)
 *
 * Renders a self-referencing object as an indented, expand/collapse tree-grid.
 * Flat records are nested via a single-parent pointer field (`parentField`).
 * The label column is indented per depth with a chevron toggle; any additional
 * `fields` render as flat columns alongside it.
 *
 * Unlike Airtable (whose many-to-many links make a tree ambiguous), ObjectStack's
 * `tree` field is a single-parent pointer, so the nesting is unambiguous and the
 * parent field can be auto-detected from the object schema.
 */

import React, { useEffect, useMemo, useState } from 'react';
/**
 * The `object-tree` NODE this renderer draws, imported BY NAME from the
 * published barrel (objectui#8655 step ①; objectui#9550 is what put the name
 * on that barrel, which is what makes a named import possible at all).
 *
 * ⛔ Not a second declaration of the node's shape. `ObjectTreeSchema` in
 * `@object-ui/types` is the one declaration — the interface whose own docblock
 * calls itself the "Object Tree (tree-grid) Component Schema", and which
 * `views.ts` names as "the node an author writes". Every key and every key TYPE
 * arrives from there, so a key added, renamed or retyped on it reaches this
 * renderer without an edit here: the property a hand-copied interface cannot
 * have, and the same derivation `ResolvedTreeConfig` below already uses against
 * `TreeViewConfig`.
 *
 * ⛔ Never re-declared LOCALLY under this name, and not aliased on the way in:
 * a module-local type under a published type's name is the two-layers-one-word
 * trap objectui#8651 recorded when a local `CalendarSchema` shadowed the
 * published one. That is what makes the line below a plain named import, and
 * the warning is MORE load-bearing now that the published name is importable,
 * not less.
 */
import type { DataSource, ObjectTreeSchema, TreeViewConfig } from '@object-ui/types';
import {
  useNavigationOverlay,
  useSafeFieldLabel,
  useSettledSchema,
  NonGridRowCeilingNote,
  useFilterScope,
  useResolvedFilter,
  useDataInvalidation,
  usePredicateScope,
} from '@object-ui/react';
import {
  NavigationOverlay,
  RefreshIndicator,
  cn,
  legacyRecordDrawerWidthKey,
  recordOverlayWidthStorageKey,
  useOverlayAnchor,
} from '@object-ui/components';
import {
  RECORD_OVERLAY_DEFAULT_WIDTH,
  RecordDetailPanel,
} from '@object-ui/plugin-detail';
import { createSafeTranslation } from '@object-ui/i18n';
import {
  getCellRenderer,
  resolveCellRendererType,
  type CellRendererProps,
} from '@object-ui/fields';
import { usePermissions } from '@object-ui/permissions';
import {
  buildExpandFields,
  columnIdentity,
  isExpandableFieldType,
  getRecordDisplayName,
  humanizeLabel,
  resolveRecordSourceConfig,
  resolveRecordSourceObjectName,
  ValueDataSource,
  applyNonGridRowCeiling,
  nonGridRowCeilingQuery,
  isDeadlineSettled,
  type NonGridCeilingResult,
} from '@object-ui/core';
import { ChevronRight, ChevronDown } from 'lucide-react';

/**
 * English fallback for the record-detail overlay heading this tree opens on row
 * click (objectui#3459, following #3426's shape).
 *
 * Borrowed from the `detail.*` namespace rather than minted as
 * `tree.recordDetail`: `NavigationOverlay` already resolves
 * `detail.recordDetail` for hosts that pass no title, and one heading on one
 * control should not get two translations that can drift apart. The entry must
 * exist HERE too — a provider-less host (a standalone tree, this package's own
 * tests) never reaches the locale packs.
 *
 * It doubles as the `createSafeTranslation` probe key: with a provider mounted
 * it resolves to a real pack value, without one it comes back as the key and
 * the map below supplies the English.
 */
const TREE_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'detail.recordDetail': 'Record Detail',
  // The refresh bar's accessible name (objectui#10816). Borrowed on the same
  // reasoning as the heading above: no pack carries a `tree.*` namespace, and
  // minting one for a single label would be a new i18n surface across every
  // pack. This control is a tree-GRID — a table of rows re-read in place — so
  // it takes the name `ObjectGrid` gives the very same bar.
  'grid.refreshing': 'Refreshing…',
};

const useTreeTranslation = createSafeTranslation(
  TREE_DEFAULT_TRANSLATIONS,
  'detail.recordDetail',
);

export interface ObjectTreeProps {
  /**
   * The `object-tree` node this renderer draws.
   *
   * Both of this package's registrations (`object-tree` and `tree`, in this
   * package's `index.tsx`) publish one `treeInputs` list and one renderer, so one
   * props type covers both tags — the shape `plugin-map` already has under two
   * tags, and the shape objectui#8651 gave `ObjectCalendar`.
   *
   * ## What typing this BUYS, stated rather than assumed (objectui#8655)
   *
   * It was `any`, and an `any` is not a weaker answer than a type — it is NO
   * answer. `checker.getPropertyOfType` through `any` returns `undefined` for
   * `objectName`, which this schema certainly declares, exactly as it does for a
   * nonsense token; so every "is this key declared?" asked of this prop came back
   * "unknown" while LOOKING like "undeclared". That ordering is the card's — type
   * FIRST, classify second — and it is objectui#8410's standing ruling that an
   * absence returned by an instrument structurally unable to see a declaration is
   * not a reading at all.
   *
   * ## ⚠️ The CEILING, so nobody reads this as more than it is
   *
   * `BaseSchema` ended in `[key: string]: any` when this was written, so an
   * UNDECLARED key read off this type still compiled and typed `any`. What the
   * annotation bought was that the question became ANSWERABLE by the checker, ⛔ not
   * that an undeclared read was refused — the same ceiling objectui#5155 /
   * objectui#7927 recorded for the mirror. objectui#8347 removed the signature, so
   * an undeclared read off this type no longer compiles.
   */
  schema: ObjectTreeSchema;
  dataSource?: DataSource;
  className?: string;
  /**
   * TWO parameters since objectui#9357, and the second is not decoration: this
   * prop reaches `useNavigationOverlay` as its `onRowClick`, and `handleClick`
   * invokes it as `onRowClick(record, event)` — the modifier payload a host
   * needs to implement Cmd/Ctrl/middle-click for itself. Declaring one
   * parameter hid the second on the ONE line a host reads. Spelled `any` and
   * not `HandleClickModifiers` for the reason objectui#9341 measured on
   * `ObjectKanbanSchema.onCardClick`: that interface lives in
   * `@object-ui/react`, the published twins in `@object-ui/types` may not name
   * it, and a host that discovered the payload from the implementation
   * annotated it `React.MouseEvent` — which a narrower declaration refuses
   * contravariantly. `BaseSchema`'s own `onClick` / `onChange` / `onSubmit`
   * already use this spelling for exactly this situation.
   */
  onRowClick?: (record: any, event?: any) => void;
  /** Inline data (passed by ListView/ObjectView for non-grid views). */
  data?: any[];
  loading?: boolean;
}

/**
 * The RESOLVED form of the host's `tree` block — what `getTreeConfig` hands the
 * renderer after flooring, ⛔ not a second declaration of the config's shape.
 *
 * The shape itself is `TreeViewConfig` in `@object-ui/types`, exported for this
 * card (objectui#8253, ruling batch #78, option (a)): the module-local
 * `interface TreeConfig` that used to stand here was the ONLY description of a
 * block a real host stores and re-writes. Every key name and every key TYPE
 * below is `Pick`ed off that one declaration, so a key added, renamed or
 * retyped there arrives here without an edit — which is the property a
 * hand-copied interface cannot have, and the reason #7646's private copy is the
 * shape to avoid.
 *
 * The only thing this adds is REQUIREDNESS, and only for the two keys the
 * resolver floors: `labelField` falls back to `'name'` and `fields` to `[]`, so
 * the renderer below indexes both without a guard.
 */
type ResolvedTreeConfig =
  Required<Pick<TreeViewConfig, 'labelField' | 'fields'>>
  & Pick<TreeViewConfig, 'parentField' | 'defaultExpandedDepth'>;

interface TreeNode {
  id: string;
  record: any;
  depth: number;
  children: TreeNode[];
}

/**
 * The rows this tree last read, held TOGETHER with the source they were read
 * for (objectui#10816).
 *
 * One value, not rows plus a second "whose rows are these" state, for the
 * reason `useSettledSchema` gives below: two independent values can disagree,
 * and "rows, but for a DIFFERENT object" is exactly the disagreement that
 * would draw one object's records under another's header. With the source
 * stored beside the rows, the render derives whether they answer the source it
 * is bound to NOW, and a mismatch is simply "no rows yet".
 *
 * The source is the pair the record effect's arms are chosen by: the data
 * provider (`dataConfig.provider`) and, for the `object` provider only, its
 * object. A new filter, a permissions answer, a settled schema, rows a host
 * hands down or a data-invalidation event re-read the SAME source.
 */
interface HeldRows {
  provider: string | undefined;
  object: string | undefined;
  rows: any[];
}

/** What the forest is built from while no rows answer the current source. */
const NO_ROWS: any[] = [];

/**
 * Normalize a field entry to its string key. Hosts like ListView pass columns
 * as field *objects* (`{ name | fieldName | field, label, … }`), not bare
 * strings — feeding those straight into `.replace()`/record indexing throws
 * ("e.replace is not a function"). Accept both shapes here so the tree is
 * resilient regardless of caller.
 */
function fieldKey(f: any): string | undefined {
  // `key` stays a tail fallback — it is a generic entry key, not ObjectStack
  // metadata identity, so it is not part of `columnIdentity` (#3104).
  return columnIdentity(f) || (f && typeof f === 'object' ? f.key : undefined) || undefined;
}

/**
 * Resolve the host's `tree` block (and the flattened node it may arrive on)
 * into the form the renderer indexes.
 *
 * ## The `schema.titleField` rung is GONE (objectui#8841)
 *
 * ⛔ This comment sits ABOVE the function on purpose: the reader census in
 * `types/src/__tests__/tree-view-config-readers-8253.test.ts` slices this
 * function's BODY and asserts the key's absence from it, and prose about a
 * deleted read inside that slice would read as the read itself — the same trap
 * that file already documents for `interface TreeConfig`.
 *
 * A third rung used to stand in the `labelField` chain below,
 * `?? schema.titleField`. Three measurements retired it:
 *
 *   - it read the FLATTENED NODE (`schema`), never the block — `nested.titleField`
 *     was never spelled in this file — so it was not a `ListView.tree` read at all;
 *   - `titleField` is declared on NEITHER face: not on `ObjectTreeSchema`
 *     (`@object-ui/types`, the TS interface and the zod mirror alike), and not on
 *     the spec's `ListView.tree`, which refuses it by name since
 *     `@objectstack/spec@17.4.0` closed `TreeConfigSchema`. It survived only on
 *     `schema` being `any`;
 *   - it was unreachable from both in-repo producers of an `object-tree` node
 *     (`plugin-view`'s and `plugin-list`'s `'tree'` branches): each floors
 *     `labelField` to `'name'` before the node is built, so the `??` chain never
 *     fell through.
 *
 * ## Why the PARAMETER is typed, and not left `any` (objectui#8655)
 *
 * The sole call site hands this function the `schema` PROP. Typing the prop and
 * leaving this parameter `any` would move the card's own defect one hop down
 * rather than close it: the six reads below would still be asked of `any`, and
 * `checker.getPropertyOfType` cannot say declared-or-not through `any` — it
 * answers `undefined` for a key this node certainly declares exactly as it does
 * for a nonsense token. The annotation is what makes those six ANSWERABLE; it
 * refused nothing while `BaseSchema` ended in `[key: string]: any` (since
 * objectui#8347 it refuses an undeclared read too).
 *
 * objectui#8253's ruling said to declare the key only if the console writes it —
 * measured, it does not (`CreateViewDialog.tsx`'s `tree` slot collects
 * `parentField` alone) — else delete the read. This is that deletion, executed
 * on objectui#8841.
 *
 * ## The `filter`-as-block-holder arm is GONE (objectui#9549)
 *
 * The block used to be looked up on the node's `tree` key OR on a `tree`
 * member of the node's `filter`. `filter` is declared as the query filter
 * (`QueryParams['$filter']`, forwarded as `$filter` by the fetch below), so
 * that second arm read the same key in a second dialect. Measured before the
 * removal: no example, fixture, test or doc in this repo or in `../objectstack`
 * authors a `tree` under `filter`, and the arm dates from the renderer's first
 * commit with no stated reason. The block's one home is `tree`.
 */
function getTreeConfig(schema: ObjectTreeSchema): ResolvedTreeConfig {
  const nested = (schema.tree || {}) as TreeViewConfig;
  const rawFields = Array.isArray(schema.fields)
    ? schema.fields
    : Array.isArray(nested.fields)
      ? nested.fields
      : [];
  return {
    parentField: fieldKey(schema.parentField ?? nested.parentField),
    labelField: fieldKey(schema.labelField ?? nested.labelField) ?? 'name',
    fields: rawFields.map(fieldKey).filter((f: unknown): f is string => !!f),
    defaultExpandedDepth: schema.defaultExpandedDepth ?? nested.defaultExpandedDepth,
  };
}

/**
 * Auto-detect the single-parent pointer field from the object schema:
 * a field declared `tree` whose `reference` is absent or names THIS object, or
 * a lookup/master_detail whose reference points back at this same object.
 *
 * ## The `tree` arm mirrors the parse door, it does not out-guess it
 *
 * A hierarchy is parent/child WITHIN one object, so `@objectstack/spec` refuses
 * a `tree` field whose `reference` names any other object
 * (`refuseForeignTreeReference` in `packages/spec/src/data/object.zod.ts`,
 * applied at both doors that carry a field map — `ObjectSchema` with `name` as
 * the own name and `ObjectExtensionSchema` with `extend`). `reference` stays
 * OPTIONAL on a `tree` — under that rule it is a redundant self-annotation — so
 * ABSENCE is accepted and only a FOREIGN value is refused. The spec's own
 * kernel predicate reads the identical rule (`hasDetectableParentField` in
 * `packages/spec/src/kernel/functional-completeness.ts`), and its docblock
 * named this reader as the one place still out of step; objectui#7839 closes
 * that gap. Mirrored here term for term, including the `objectName` guard: an
 * object whose own name we do not know cannot be self-referenced, so a `tree`
 * that DOES name a target is not matchable against a name that is not there.
 *
 * ⛔ Not `??`-style tolerance in either direction. A foreign-referencing `tree`
 * is skipped rather than returned, so it can no longer mask a self-referencing
 * lookup declared after it — before this it won by position, and the tree view
 * then grouped records under a pointer into a table it does not point at.
 * Unreachable from parsed metadata (the parse door refuses the shape) and
 * reachable from a hand-built schema, which a third-party `DataSource` may
 * hand straight to `useSettledSchema`. Pinned in
 * `ObjectTree.treeArmOwnReference-7839.test.tsx`.
 */
function detectParentField(objectSchema: any, objectName?: string): string | undefined {
  const fields = objectSchema?.fields;
  if (!fields || typeof fields !== 'object') return undefined;
  let firstSelfRef: string | undefined;
  for (const [key, def] of Object.entries<any>(fields)) {
    // ONE arm: `reference`, the only target spelling the protocol declares.
    // `FieldSchema` refuses `reference_to` / `referenceTo` / `target` by name.
    // `referenceTo` went in objectui#6837 slice 2, `reference_to` in half 2
    // (maintainer 2026-08-31: protocol normalization belongs on the server;
    // objectstack#13847 does it on the serve path). A legacy-only def is
    // canonicalised once at the ingestion choke point, never here. Pinned in
    // `ObjectTree.referenceArms-6837.test.tsx`.
    const ref = def?.reference;
    // A `tree` still wins over a lookup found earlier — the precedence is
    // unchanged; what changed is that it must first BE a self-reference.
    if (def?.type === 'tree' && (ref === undefined || (!!objectName && ref === objectName))) {
      return key;
    }
    if (
      !firstSelfRef &&
      (def?.type === 'lookup' || def?.type === 'master_detail') &&
      ref &&
      objectName &&
      ref === objectName
    ) {
      firstSelfRef = key;
    }
  }
  return firstSelfRef;
}

/** Resolve a record's id (records may use `id` or `_id`). */
function recordId(record: any): string | undefined {
  const id = record?.id ?? record?._id;
  return id == null ? undefined : String(id);
}

/** Resolve the parent id from a record's parent-pointer value. */
function parentIdOf(record: any, parentField?: string): string | undefined {
  if (!parentField) return undefined;
  const raw = record?.[parentField];
  if (raw == null) return undefined;
  // Expanded lookup → object with id/_id; otherwise the raw scalar is the id.
  if (typeof raw === 'object') {
    const id = raw.id ?? raw._id;
    return id == null ? undefined : String(id);
  }
  return String(raw);
}

/**
 * Build a nested forest from flat records. Records whose parent is missing
 * (or points outside the result set) become roots, so nothing is dropped.
 */
function buildForest(records: any[], parentField?: string): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const order: string[] = [];

  for (const record of records) {
    const id = recordId(record);
    if (id == null) continue;
    byId.set(id, { id, record, depth: 0, children: [] });
    order.push(id);
  }

  const roots: TreeNode[] = [];
  for (const id of order) {
    const node = byId.get(id)!;
    const pid = parentIdOf(node.record, parentField);
    const parent = pid != null ? byId.get(pid) : undefined;
    if (parent && parent !== node) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Assign depth top-down.
  const assignDepth = (nodes: TreeNode[], depth: number) => {
    for (const n of nodes) {
      n.depth = depth;
      assignDepth(n.children, depth + 1);
    }
  };
  assignDepth(roots, 0);
  return roots;
}

/** Flatten the forest into the rows currently visible given expansion state. */
function flattenVisible(roots: TreeNode[], expanded: Set<string>): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      out.push(n);
      if (n.children.length > 0 && expanded.has(n.id)) {
        walk(n.children);
      }
    }
  };
  walk(roots);
  return out;
}

/** Collect ids that should start expanded, honoring an optional depth cap. */
function seedExpanded(roots: TreeNode[], depth?: number): Set<string> {
  const set = new Set<string>();
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      if (n.children.length === 0) continue;
      if (depth == null || n.depth < depth) {
        set.add(n.id);
        walk(n.children);
      }
    }
  };
  walk(roots);
  return set;
}

/**
 * What the USER said about one node's expansion, keyed by record id. Sparse on
 * purpose: an id is present only if the user clicked that node's chevron, and
 * the value is the answer they gave (`true` = open, `false` = closed). It is
 * NOT an expansion set — a missing id means "the user never said", which is a
 * third state that a `Set<string>` of open ids cannot represent.
 */
type ExpansionOverrides = ReadonlyMap<string, boolean>;

/**
 * The expanded-id set for ONE render: the seed the forest asks for, with the
 * user's answers laid over it.
 *
 * ## The composition rule (objectui#8666)
 *
 * > A new forest may re-seed, but a node the user deliberately opened or closed
 * > — and which is still in the forest — keeps the user's answer. Every other
 * > node, including a genuinely NEW one, takes the seed.
 *
 * The override walk descends the WHOLE forest, not only the seeded-open part:
 * the user can open a node that sits below `defaultExpandedDepth`, and its own
 * children are then reachable and overridable in turn.
 *
 * ⭐ WHY THE USER'S EDITS ARE STORED, AND NOT THE EXPANSION SET ITSELF. The
 * shape this replaces kept the resolved set in state and re-seeded it from an
 * effect. That set cannot tell "the user closed this node" apart from "the seed
 * never opened it", so re-seeding a new forest has only two outcomes and both
 * are wrong: overwrite, and the user's collapse is lost on every identity
 * change of `roots`; or union/skip, and a genuinely new subtree never opens.
 * Recording the user's EDITS separately is what makes both halves derivable at
 * once — it is the reason for the map, not an implementation detail of it.
 *
 * An override for an id that is no longer in the forest is never read, because
 * this walk only visits nodes that ARE in it. It is also not discarded: if that
 * record comes back (a filter widened, a refetch), it is the same record and it
 * keeps the same answer.
 */
function resolveExpanded(
  roots: TreeNode[],
  depth: number | undefined,
  overrides: ExpansionOverrides,
): Set<string> {
  const expanded = seedExpanded(roots, depth);
  if (overrides.size === 0) return expanded;
  const walk = (nodes: TreeNode[]) => {
    for (const n of nodes) {
      const answer = overrides.get(n.id);
      if (answer === true) expanded.add(n.id);
      else if (answer === false) expanded.delete(n.id);
      walk(n.children);
    }
  };
  walk(roots);
  return expanded;
}

/**
 * One entry of a field's `options`. The index signature is not incidental — it
 * is what `useSafeFieldLabel().translateOptions` declares, and this alias exists
 * to be assignable to that signature rather than to re-describe it.
 */
interface FieldOption {
  value: string;
  label: string;
  [key: string]: unknown;
}

/** Translates one field's `options` for the session locale. */
type TranslateOptions = (
  objectName: string,
  fieldName: string,
  options: FieldOption[],
) => FieldOption[];

/**
 * What {@link renderTreeCell} (and its untyped fallback {@link formatCellValue})
 * needs to draw one cell of one column.
 */
interface CellFormatContext {
  /** The object schema's definition for this column, when one was fetched. */
  fieldDef: any;
  /** The column's field key — the i18n option keys are scoped by it. */
  fieldName: string;
  /**
   * The column's label exactly as this tree's header prints it (the
   * `{ns}.fields.{object}.{field}` key, then the authored label, then the
   * humanized key). A face that names its own column — `BooleanCellRenderer`'s
   * checkbox, by its accessible name — reads it from `field.label`, so the
   * cell and the header it sits under say the same word in the session's
   * language.
   */
  columnLabel: string;
  /** The object the tree is rendering; absent for a schema-less inline mount. */
  objectName?: string;
  /** `useSafeFieldLabel().translateOptions` — identity without a provider. */
  translateOptions: TranslateOptions;
  /** The host's `isDeadlineSettled` verdict for this cell's row (objectui#11815). */
  deadlineSettled?: boolean;
}

/**
 * Draw one tree cell through the SAME per-field-type face every list surface
 * draws — objectui#11686.
 *
 * The face is resolved by `@object-ui/fields`'s published two-step,
 * `getCellRenderer(resolveCellRendererType(field))` — the resolution the grid
 * (through its `resolveGridCellRendering`), the kanban card, the gallery card
 * and the report viewer all spell. So a `boolean` column draws the checkbox
 * face, a `date` column the locale-aware date face, a `select` column the
 * option badge, a `lookup` column the referenced record's name, a `currency`
 * column the formatted amount — and a type the tree has never heard of draws
 * whatever the registry draws for it, with no list copied here to fall behind.
 * Before this, every type outside "has options" and "is a reference" reached
 * `String(value)`: the Org Chart's `active` column printed `true`.
 *
 * The `field` handed to the face is the column's definition with the four
 * things this tree knows better than the raw definition:
 *
 *  - `name` — the column key. Faces read it (`BooleanCellRenderer`'s
 *    completion / status names, the date faces' due-like name test), and a
 *    served `fields` map is keyed by name rather than carrying it.
 *  - `type` — the RENDERER key, the declared type promoted by its `format`
 *    hint, as the grid's `fieldMeta.type` carries it.
 *  - `options` — translated through `translateOptions`, the exact call the
 *    grid makes when it builds a column's `fieldMeta`, so both views read one
 *    `fieldOptions.*` i18n key (objectui#6014's half, kept).
 *  - `label` — {@link CellFormatContext.columnLabel}.
 *
 * ⚠️ Only a column with a DECLARED type has a face to resolve. A column the
 * object schema does not define, or a mount that never fetched one, keeps
 * {@link formatCellValue}'s conservative string — the face for "no type at
 * all" is not a guess this renderer gets to make.
 *
 * `empty` is the text a STRING answer falls back to when it comes out empty;
 * a face draws its own empty affordance (`EmptyValue`) and never reads it.
 */
function renderTreeCell(value: unknown, ctx: CellFormatContext, empty = ''): React.ReactNode {
  const def = ctx.fieldDef;
  const declaredType: string = typeof def?.type === 'string' ? def.type : '';
  if (!declaredType) return formatCellValue(value, ctx) || empty;

  const rendererType = resolveCellRendererType({ type: declaredType, format: def.format });
  const Face = getCellRenderer(rendererType);
  const options: FieldOption[] | undefined = Array.isArray(def.options)
    ? ctx.objectName
      ? ctx.translateOptions(ctx.objectName, ctx.fieldName, def.options as FieldOption[])
      : (def.options as FieldOption[])
    : undefined;
  const field: CellRendererProps['field'] = {
    ...def,
    name: ctx.fieldName,
    type: rendererType,
    label: ctx.columnLabel,
    ...(options ? { options } : {}),
  };
  return <Face value={value} field={field} deadlineSettled={ctx.deadlineSettled} />;
}

/**
 * The UNTYPED fallback of {@link renderTreeCell}, and the plain reading the
 * record overlay prints when it has nothing declared to render against.
 *
 * Format one cell the way the flat table formats the same field — objectui#6014.
 *
 * Both branches DELEGATE the decision rather than re-deciding it, so the tree
 * cannot drift from the surfaces it is supposed to agree with:
 *
 *  - **select-family** (any field carrying `options`): the stored value is
 *    resolved to its option label through `translateOptions`, which is the
 *    exact call `ObjectGrid` makes when it builds a column's `fieldMeta`
 *    (`packages/plugin-grid/src/ObjectGrid.tsx`, the `fieldMeta.options =
 *    translateOptions(...)` line), so both tabs read one `fieldOptions.*` i18n
 *    key. Matching is exact-then-case-insensitive and falls back to
 *    `humanizeLabel`, mirroring `SelectCellRenderer` in `@object-ui/fields`
 *    (seed data stores `Referral` against a declared `referral`). Keying the
 *    branch on "has options" rather than on a list of select spellings is
 *    deliberate: `select` / `status` / `multiselect` / `radio` / `checkboxes` /
 *    `tags` all resolve identically, and a copied type list is one more thing
 *    that can fall behind the registry.
 *
 *  - **reference-family**: an expanded record resolves through
 *    `getRecordDisplayName`, THE unified display-name resolver (ADR-0079), and
 *    the family is judged by `isExpandableFieldType` — the SAME predicate that
 *    decided what to put in `$expand` a few lines up, so "what we expanded" and
 *    "what we unwrap as a reference" cannot disagree.
 *
 * A value with no field definition (an untyped column, or a mount that never
 * fetched a schema) keeps the previous conservative unwrap.
 */
function formatCellValue(value: any, ctx?: CellFormatContext): string {
  if (value == null) return '';

  const options: FieldOption[] | null = Array.isArray(ctx?.fieldDef?.options)
    ? (ctx!.fieldDef.options as FieldOption[])
    : null;
  if (options && options.length > 0) {
    const translated = ctx!.objectName
      ? ctx!.translateOptions(ctx!.objectName, ctx!.fieldName, options)
      : options;
    const labelFor = (raw: unknown): string => {
      const exact = translated.find((opt) => opt?.value === raw);
      if (exact) return String(exact.label ?? raw);
      const normalized = String(raw).toLowerCase();
      const insensitive = translated.find(
        (opt) => String(opt?.value).toLowerCase() === normalized,
      );
      if (insensitive) return String(insensitive.label ?? raw);
      return humanizeLabel(String(raw));
    };
    return Array.isArray(value)
      ? value.filter((v) => v != null).map(labelFor).join(', ')
      : labelFor(value);
  }

  if (typeof value === 'object' && isExpandableFieldType(ctx?.fieldDef)) {
    // No schema for the REFERENCED object here, so this lands on ADR-0079's
    // record-key derivation (`name` / `full_name` / `*_name` / …) and, for an
    // expanded record that came back without any name-ish field, its
    // `Record #<id>` floor — the same string every other surface shows.
    return getRecordDisplayName(undefined, value);
  }

  if (typeof value === 'object') {
    return String(value.name ?? value.label ?? value.id ?? value._id ?? '');
  }
  return String(value);
}

export const ObjectTree: React.FC<ObjectTreeProps> = ({
  schema,
  dataSource,
  className,
  onRowClick,
  ...rest
}) => {
  const [held, setHeld] = useState<HeldRows | null>(null);
  /**
   * Did the platform row ceiling bite, and how large was the whole filtered
   * result set (objectui#7210)? Carried from the response that knew it —
   * `records.length === NON_GRID_ROW_CEILING` cannot tell a capped result set
   * apart from one that is exactly that size.
   */
  const [rowCeiling, setRowCeiling] = useState<NonGridCeilingResult | null>(null);
  /**
   * A read is in flight — and ONLY that (objectui#10816). It no longer decides
   * the placeholder on its own: the render draws "Loading…" only while there
   * are no rows for the current source, and a re-read of that source keeps its
   * rows on screen with `RefreshIndicator` over them.
   */
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  // `'view-data'` — the arm `object-tree`'s published `data` row declares
  // (objectui#8348). Decision batch #83 rules by the block's own row — 「8348
  // 以协议为准」 — and ruling batch #136 item 3 (Q1-C) had the protocol gain
  // that row: `ComponentPropsMap['object-tree']` declares `data` as the
  // `ViewData` union and `staticData` as an array. ⛔ The verdict is not
  // restated here as a fact about a version; it is derived from the INSTALLED
  // row at test time by `ObjectTree.dataArmSpecRow-8348.test.tsx`, so a spec
  // release that moves the row turns that pin red.
  //
  // So `{ provider, … }` under `data` is rung 1, and a bare array under `data`
  // is not a record source: the ladder falls through to `staticData`, then
  // `objectName`. This used to pass `'undeclared'`, which honoured ANY truthy
  // `data` — right only while no published face declared a row for this block.
  const dataConfig = useMemo(() => resolveRecordSourceConfig(schema, 'view-data'), [schema]);

  /**
   * The object THIS render is bound to, as a plain string — so the resolution
   * below re-keys on the OBJECT rather than on `dataConfig`, a `useMemo` over
   * the `schema` PROP object whose identity a host that rebuilds its schema
   * each render changes without changing which object is bound.
   */
  const schemaKey = resolveRecordSourceObjectName(schema, dataConfig) ?? '';

  /**
   * The object schema, and whether it has settled FOR `schemaKey` — a single
   * piece of state, from the shared hook ruled in objectui#6482.
   *
   * It feeds FOUR things: parent-field auto-detection, column labels, the
   * `$expand` list built below, and (objectui#6014) the per-field definitions
   * the cell formatter reads to resolve select options and reference values.
   *
   * ## Why the hook, and not the two `useState`s that were here
   *
   * This component used to carry the definition (`objectSchema`) and "has it
   * settled" (`schemaSettled`) as two SEPARATE pieces of state, the second a
   * one-way latch that nothing ever reset. Two independent values cannot
   * express "settled, but for a DIFFERENT object" — so on an object switch the
   * gate below read `schemaSettled === true` left over from the PREVIOUS
   * object's settle, while `objectSchema` still held the previous object's
   * fields, and the query went out as
   * `find(newObject, { $expand: [ …previous object's relation fields… ] })`:
   * rejected or silently ignored depending on the adapter, plus the transient
   * it painted, before a correct second query followed (objectui#6481).
   *
   * `useSettledSchema` holds ONE value, `{ key, def } | null`, and derives
   * readiness during render by comparing the settled key against `schemaKey`.
   * The gate therefore closes in the SAME commit that changes the object
   * rather than one commit later — and "ready for the wrong object" is not
   * merely fixed but unwritable, because there is no second piece of state
   * left to disagree with the first.
   *
   * ## The settle-on-every-exit guarantee, preserved
   *
   * The `finally` that used to live here existed so the two early `return`s
   * (no `dataSource` / no `getObjectSchema`; no object name) and a rejected
   * read all settled too — otherwise the gated record query below waits
   * forever, and a tree whose adapter serves no schema never renders a row.
   * The hook makes that structural rather than incidental: each of those exits
   * settles explicitly with `def: null`, which is a DISTINCT outcome from "not
   * ready yet". Both halves are pinned in
   * `ObjectTree.settledSchemaKeying-6481.test.tsx`.
   *
   * Gate PLACEMENT stays this component's own, per that same ruling: it sits
   * INSIDE the object-provider branch of the record effect, not at the top of
   * it, because the inline/static branches issue no metadata read and must not
   * be made to wait on one.
   */
  const { ready: schemaSettled, def: objectSchema } = useSettledSchema<any>(
    schemaKey,
    dataSource,
  );

  /**
   * The record-fetch effect below used to key on `dataConfig` itself — the
   * whole memoised object identity. `useMemo` carries no semantic guarantee:
   * React is permitted to discard its cache and recompute, and
   * `resolveRecordSourceConfig(schema)` builds a fresh `{ provider, object }` /
   * `{ provider, items }` wrapper object on every call even when `schema`
   * hasn't changed. So a discard (not just a `schema` change) was enough to
   * re-run the effect and refetch, with nothing about the bound object
   * actually different. These are every primitive field the effect actually
   * reads off `dataConfig`; keying on them instead of the container object
   * makes a cache discard a no-op for it, and returns the `useMemo` above to
   * being a pure optimisation rather than a correctness dependency —
   * mirroring `ObjectMap`/`ObjectCalendar`/`ObjectGantt` (objectui#6592).
   *
   * This is the record effect #6592's branch left untouched (objectui#6700):
   * the OTHER dataConfig-identity dependence in this component — the schema
   * resolution effect — was already retired by #6696 in favor of
   * `useSettledSchema`'s own primitive `schemaKey` above, so this closes out
   * the component rather than one effect of two.
   */
  const dataProvider = dataConfig?.provider;
  // NOT a delegation site for `resolveRecordSourceObjectName` (`b041b9c0c`):
  // this is the data config's OWN object, deliberately `undefined` for every
  // other provider so a `value` tree's `objectName` changing cannot move
  // this dependency. The shared reader's second rung would put `objectName`
  // here and re-run the record fetch on a value it does not read.
  const dataObjectName = dataConfig?.provider === 'object' ? dataConfig.object : undefined;
  const dataItems = dataConfig?.provider === 'value' ? dataConfig.items : undefined;

  // Permissions context, read here rather than inside the fetch effect below:
  // an effect's DEPENDENCY ARRAY is evaluated during render, so `perms` has to
  // be a binding that already exists by the time this component's render
  // reaches that effect (objectui#7429, same structural note PR #7229 /
  // PR #7428 recorded for `ListView`'s memo and `ObjectCalendar`'s effect).
  const perms = usePermissions();

  // objectui#10666 — the node's own `filter`, with every context token
  // (`{current_user_id}`, `{current_org_id}`, the date macros) resolved ONCE
  // through `@object-ui/core`'s shared `resolveFilterPlaceholders`, against the
  // session scope the host provides, and HELD by structure (`useResolvedFilter`
  // in `@object-ui/react`). A directly authored tree sent the literal token on
  // `$filter` before. Both query paths below (the `object` fetch and the inline
  // `ValueDataSource`) and the effect's dependency list read THIS, never the
  // raw `schema.filter`, so a re-render that rebuilds an equal filter does not
  // re-query.
  const filterScope = useFilterScope();
  const queryFilter = useResolvedFilter(schema.filter, filterScope);

  // objectui#10778 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10623 way: the nonce moves when a
  // write to the object this tree QUERIES is declared, and the record effect
  // below names it, so the rows are re-read in place. Without it a page action
  // over raw HTTP left the tree stale unless the page was remounted.
  //
  // The object is `dataObjectName` — the `object` provider's own object,
  // whether the node spelled it `objectName` or `data: { provider: 'object' }`
  // — and it is subscribed exactly when the `object` arm below queries: inline
  // rows (`staticData`, or the `value` provider under `data`) name no object
  // and query no adapter, so they do not subscribe.
  //
  // ⚠️ Rows a HOST hands down as the `data` prop (ListView's tree) do NOT
  // exempt the tree: the `object` arm runs its own full query ahead of them,
  // so its freshness must not rest on the host's rows moving. The host fetches
  // only its display columns (usually not the parent pointer), and a host that
  // hands an equal re-read down as the SAME array — what AGENTS.md #10 asks of
  // a provider — would never move the `data` dependency below for a write its
  // projection does not show, such as a re-parented record. Today's ListView
  // hands down a fresh array on every re-read, so a list-view tree runs its
  // query twice after such an event: once on this nonce, once on those rows.
  const invalidationNonce = useDataInvalidation(dataSource ? dataObjectName : undefined);

  // Fetch records.
  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        setLoading(true);
        setError(null);

        // A live object dataSource takes precedence over any `data` the host
        // passed down: the tree needs the FULL record (esp. the parent-pointer
        // field), but a host like ListView pre-fetches only the view's display
        // columns — which usually omit the parent field and would flatten the
        // tree. Fetching our own records (no column projection) guarantees the
        // parent field is present so the hierarchy resolves.
        if (dataProvider === 'object' && dataSource && typeof dataSource.find === 'function') {
          // Wait for the schema before querying. `$expand` is DERIVED from it,
          // so firing early guaranteed one query whose lookup columns came back
          // as bare ids — the user saw those raw ids painted, then replaced a
          // moment later once the real query landed. `loading` stays true here
          // so a tree with no rows for this object shows its placeholder
          // instead of a wrong first answer (one re-reading the same object
          // keeps its rows under the refresh bar, objectui#10816), and this
          // effect re-runs the moment the latch flips.
          if (!schemaSettled) return;
          // [objectui#7429] FIELD-LEVEL SECURITY ON `$expand` — the same gate
          // objectui#7215 / PR #7229 put on the two projection sites in its
          // scope, and objectui#7230 / PR #7428 applied unchanged at four more.
          // `$select` on a denied lookup asks the server for a bare foreign
          // key; `$expand` asks it to RESOLVE the relation and return the
          // related record, the larger of the two requests.
          //
          // THIS SITE PASSES NO COLUMN LIST, which makes it the sharp one:
          // `buildExpandFields` reads an absent column list as "no column
          // restriction" and falls back to EVERY declared relation on the
          // object, denied ones included. A standalone tree therefore asks for
          // the maximum possible set by default, not by configuration.
          //
          // Graded as objectui#7215 graded it, by measurement rather than
          // assumption: against ObjectStack this is defence-in-depth, because
          // `plugin-security`'s `FieldMasker.maskRecord` does
          // `delete result[field]` on every unreadable key and objectql's
          // expand path writes the resolved record back under THAT SAME KEY, so
          // one statement removes the expanded object and the bare id alike;
          // the expansion sub-read itself takes the referenced object's full
          // CRUD + RLS + FLS treatment (objectstack#7626). It is load-bearing
          // for a backend that does not strip.
          //
          // THE GATE IS ON THE HELPER'S OUTPUT, and on this site the
          // alternative is not merely unsound but unreachable: the call passes
          // `undefined`, so there is no input to gate. Gating the output also
          // gives the required ordering structurally: `buildExpandFields`
          // returns a subset of the object's DECLARED reference-bearing fields,
          // so every name judged here is declared by construction and the
          // "`checkField` answers false for an undeclared key" trap cannot be
          // reached. Pinned in `ObjectTree.expandFls-7429.test.tsx`.
          //
          // Deferral matches every other gate on this path: an unanswered
          // policy filters nothing, and `perms` is in this effect's dependency
          // list, so the expansion is rebuilt the moment the answer arrives.
          const expandable = buildExpandFields(objectSchema?.fields);
          const expand = !perms?.isLoaded
            ? expandable
            : expandable.filter((f) => perms.checkField(dataObjectName as string, f, 'read'));
          // `dataObjectName` is required on the 'object' variant of the
          // discriminated union — same narrowing the pre-refactor
          // `dataConfig.object` read carried.
          const result = await dataSource.find(dataObjectName as string, {
            $filter: queryFilter,
            // The platform ceiling (objectui#7210, ruling a′). A tree still
            // fetches the whole FILTERED set — a hierarchy assembled from a
            // page loses every child whose parent fell outside it, which is
            // why paging this was rejected — but the fetch now stops at a
            // number. This is also the view the ceiling's VALUE was measured
            // on: it materialises ~5.2 DOM elements per record with no
            // virtualisation, so it is the binding one of the four.
            // ⛔ Not authorable: no view key reaches this `$top`.
            ...nonGridRowCeilingQuery(),
            ...(expand.length > 0 ? { $expand: expand } : {}),
          });
          const capped = applyNonGridRowCeiling(result);
          if (!cancelled) {
            setHeld({ provider: dataProvider, object: dataObjectName, rows: capped.rows });
            setRowCeiling(capped);
            setLoading(false);
          }
          return;
        }

        // Otherwise: rows a HOST handed down as the `data` React prop
        // (`ListView`'s tree seat), then the inline `value` provider below.
        //
        // ⛔ The AUTHORED `schema.data` is NOT read here any more
        // (objectui#8348). This line used to be `rest.data ?? schema.data`
        // with an `Array.isArray` test — a second reader of the authored key
        // that bypassed the shared ladder, so a bare array under `data` drew
        // its rows whatever arm the ladder was told. The authored key has ONE
        // reader now, `dataConfig` above, which judges it against this block's
        // published row. Through `SchemaRenderer` the authored key does not
        // arrive as the prop either: the arm table stops that spread for
        // object-arm blocks (objectui#9571), so `rest.data` is the host's
        // carrier only — which option B of that ruling refused to gate.
        const passed = (rest as any).data;
        if (Array.isArray(passed)) {
          if (!cancelled) {
            setHeld({ provider: dataProvider, object: dataObjectName, rows: passed });
            setRowCeiling(null);
            setLoading(false);
          }
          return;
        }

        if (dataProvider === 'value') {
          // THE INLINE PROVIDER NO LONGER EXITS BEFORE THE QUERY
          // (objectui#9136, the fourth surface of objectui#8769's repair after
          // objectui#9061 ported it to `ObjectCalendar` and `ObjectMap`).
          //
          // This branch used to be `setRecords(dataItems); return;` — so it
          // never reached the `find` in the `object` arm above, which is the
          // ONE site in this file that lowers `schema.filter` onto `$filter`
          // and the objectui#7210 ceiling onto `$top`. An authored `filter`
          // therefore reached nothing and the tree drew EVERY authored row:
          // the fail-OPEN direction, because the key that was dropped is the
          // key that NARROWS. Accepting a declared key one cannot honour is the
          // defect, and `ValueDataSource` honours both over its own array, so
          // they are honoured here.
          //
          // TWO keys, not the twins' three: this component reads `schema.sort`
          // on NO provider, so there is no `$orderby` to lower on either arm.
          //
          // ⚠️ `ObjectCalendar`'s shape, not `ObjectGantt`'s. The gantt resolves
          // ONE `effectiveDataSource` for every provider, so its repair was to
          // delete the branch and fall through to the shared query. Here the
          // `find` sits INSIDE the `dataProvider === 'object' && dataSource`
          // arm, behind an `$expand` projection an inline set has no metadata
          // to build and behind the `schemaSettled` gate deliberately scoped to
          // that same arm. So the adapter is resolved for the inline provider
          // ONLY and the same keys are lowered onto the same query shape.
          //
          // Built here rather than memoised at render scope so this effect goes
          // on reading only the primitive fields objectui#6592 named
          // (`dataProvider`, `dataObjectName`, `dataItems`): no dependency is
          // added or removed — `schema.filter` was already listed — so nothing
          // about WHEN this effect re-runs changes with this repair.
          //
          // The adapter's constructor clone is `structuredClone` (objectui#9175,
          // ruling A on objectui#9061), so a back-referencing record graph
          // still renders: an inline value never has to be serializable.
          //
          // `ValueDataSource` ignores the resource name — it queries its own
          // array — so this branch needs no object name.
          const inlineSource = new ValueDataSource<any>({ items: (dataItems as any[]) ?? [] });
          const result = await inlineSource.find('', {
            $filter: queryFilter,
            // The same platform ceiling the `object` arm sends, on the same
            // probe-row convention (objectui#7210, ruling a′). This is the view
            // the ceiling's VALUE was measured on — ~5.2 DOM elements per
            // record with no virtualisation — and an inline node costs the
            // browser exactly what a fetched one costs.
            // ⛔ Still not authorable: no view key reaches this `$top`.
            ...nonGridRowCeilingQuery(),
          });
          // Filter first, ceiling second — `ValueDataSource` applies `$filter`
          // before `$top`, which is what the fetching path gets for free from
          // every backend. A large inline array that an authored `filter` cuts
          // below the ceiling therefore draws every matching row and stays
          // quiet.
          const capped = applyNonGridRowCeiling(result);
          if (!cancelled) {
            setHeld({ provider: dataProvider, object: dataObjectName, rows: capped.rows });
            setRowCeiling(capped);
            setLoading(false);
          }
          return;
        }

        if (!cancelled) {
          setHeld({ provider: dataProvider, object: dataObjectName, rows: [] });
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err as Error);
          setLoading(false);
        }
      }
    };
    fetchData();
    return () => {
      cancelled = true;
    };
  }, [dataProvider, dataObjectName, dataItems, dataSource, queryFilter, objectSchema, schemaSettled, (rest as any).data, perms, invalidationNonce]);

  const config = useMemo(() => getTreeConfig(schema), [schema]);
  const parentField = useMemo(
    () => config.parentField ?? detectParentField(objectSchema, schema.objectName),
    [config.parentField, objectSchema, schema.objectName],
  );

  /**
   * The rows this render may draw: the held rows when they were read for the
   * source this render is bound to, else `null` — "nothing to show yet"
   * (objectui#10816, see {@link HeldRows}). Derived during render, so the
   * commit that switches the object or the provider already refuses the old
   * rows, rather than painting them once before the effect runs.
   */
  const records: any[] | null =
    held && held.provider === dataProvider && held.object === dataObjectName ? held.rows : null;

  const roots = useMemo(
    () => buildForest(records ?? NO_ROWS, parentField),
    [records, parentField],
  );

  /**
   * Expansion is DERIVED, not mirrored (objectui#8666).
   *
   * State holds only the user's own answers; the seed is computed from the
   * forest during render. What this fixes: the seed used to live in a
   * `useState` set that a passive `useEffect` re-seeded, so the commit that
   * FIRST painted the table still carried the previous (empty) mirror — the
   * root drew, its children did not, and a second commit drew the seeded-open
   * forest. Probed in the DOM, the sequence was
   * `loading → table with 1 row → table with 2 rows`; it is now
   * `loading → table with 2 rows`. See {@link resolveExpanded} for the rule
   * that lets a re-seed and a user's override coexist, which is the half a
   * naive "just seed during render" conversion destroys.
   *
   * Pinned by `ObjectTree.expandedDerived-8666.test.tsx` — both halves.
   */
  const [overrides, setOverrides] = useState<ExpansionOverrides>(() => new Map());

  const expanded = useMemo(
    () => resolveExpanded(roots, config.defaultExpandedDepth, overrides),
    [roots, config.defaultExpandedDepth, overrides],
  );

  /**
   * Record the user's answer for one node. `isOpen` is the state the row was
   * PAINTED with, read from the resolved set at the call site: the updater
   * below sees only the override map, which does not know the seed, so the
   * node's current answer has to come from the render that the user clicked.
   */
  const toggle = (id: string, isOpen: boolean) =>
    setOverrides((prev) => {
      const next = new Map(prev);
      next.set(id, !isOpen);
      return next;
    });

  const visibleRows = useMemo(
    () => flattenVisible(roots, expanded),
    [roots, expanded],
  );

  // Column labels: i18n convention key (`objects.{obj}.fields.{field}.label`)
  // first, then the object schema's authored label, then a humanized field key.
  const i18n = useSafeFieldLabel();
  // The host predicate scope a row's declared deadline is judged in (objectui#11815).
  const predicateScope = usePredicateScope();
  // The `?? schema.objectName` tail is NOT the shared rung repeated: it is this
  // site's own coercion of the OFF-CONTRACT `data: { provider: 'object' }` that
  // carries no `object` (`ViewDataSchema` declares it required), kept so the
  // collapse changes nothing this label resolves today.
  const headerObjectName: string | undefined =
    resolveRecordSourceObjectName(schema, dataConfig) ?? schema.objectName;
  const fieldLabel = (field: string): string => {
    const def = objectSchema?.fields?.[field];
    const fallback =
      def?.label || field.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase());
    return headerObjectName ? i18n.fieldLabel(headerObjectName, field, fallback) : fallback;
  };

  /**
   * Everything {@link formatCellValue} needs for one column. Built per cell
   * from the SAME `objectSchema.fields` map the header labels read, so a column
   * cannot be labelled from the schema and then formatted without it.
   */
  const cellContext = (field: string, row?: Record<string, unknown>): CellFormatContext => ({
    fieldDef: objectSchema?.fields?.[field],
    fieldName: field,
    columnLabel: fieldLabel(field),
    objectName: headerObjectName,
    translateOptions: i18n.translateOptions,
    deadlineSettled: isDeadlineSettled(objectSchema?.fields?.[field], row, { scope: predicateScope, fields: objectSchema?.fields }),
  });

  const navigation = useNavigationOverlay({
    // A DECLARED read since objectui#11168 slice 3. objectui#8655 kept a cast
    // here on purpose: the key was undeclared on the node and survived only on
    // `BaseSchema`'s `[key: string]: any`, and objectui#8652's family ruling
    // (option B — the platform element schemas first, then the mirror) was
    // waiting on a released spec. `@objectstack/spec` 17.5.0 declares
    // `navigation` on the `object-tree` row, and `ObjectTreeSchema` now mirrors
    // it as the spec's `NavigationConfig`, so the read is typed.
    navigation: schema.navigation,
    // The record-page URL names the object the ROWS came from, not the block's
    // bare top-level key (`2ce2612df`). `77cb489b4` published `objectName`
    // as the THIRD RUNG of ONE record-source ladder (`data`, then `staticData`,
    // then `objectName`) rather than as a parallel "page object" concept, so a
    // block has exactly one record source. A row fetched through
    // `data.object` whose click built `/{schema.objectName}/record/{id}` named
    // a record that the URL's own object does not contain.
    //
    // The `?? schema.objectName` tail is NOT the shared rung repeated: it is
    // this site's own coercion of the OFF-CONTRACT `data: { provider: 'object' }`
    // that carries no `object` (`ViewDataSchema` declares it required), kept for
    // exactly the reason `headerObjectName` above keeps it — so this conversion
    // changes nothing this site resolves today EXCEPT the divergence it closes.
    objectName: resolveRecordSourceObjectName(schema, dataConfig) ?? schema.objectName,
    onRowClick,
  });

  // objectui#9299 item 3 — `popover` anchors to the NODE the user clicked. The
  // row's own click handler carries the DOM event, so the anchor is recorded
  // there rather than through a container-level listener.
  const { anchorRef, captureAnchor } = useOverlayAnchor();

  // Heading of the record-detail overlay rendered at the bottom of this file.
  // Must stay above the conditional returns below — rules-of-hooks.
  const { t } = useTreeTranslation();

  if (error) {
    return (
      <div className={cn('flex items-center justify-center h-40 text-destructive', className)}>
        <p>Failed to load tree: {error.message}</p>
      </div>
    );
  }

  // objectui#10816 — the placeholder is for a tree with NOTHING to show for the
  // source it is bound to: the first load, a switch to another object or
  // provider (whose old rows are not the answer and are never drawn under the
  // new one), and an empty result being re-read. A re-read of the same source
  // keeps its rows, its scroll container and the user's expansion on screen,
  // with the refresh bar over them — `ObjectDataTable`'s rule, keyed to the
  // source. Before this every read took the table off the screen: each
  // data-invalidation event (objectui#10809) flashed "Loading…" and reset the
  // scroll.
  if (records === null || (loading && records.length === 0)) {
    return (
      <div className={cn('flex items-center justify-center h-40 text-muted-foreground', className)}>
        <p>Loading…</p>
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className={cn('flex items-center justify-center h-40 text-muted-foreground', className)}>
        <p>No records</p>
      </div>
    );
  }

  /**
   * The record overlay — the ONE shared payload, in whichever shell the author
   * declared.
   *
   * ⭐ objectui#9299. `ObjectTree` already honoured all four modes through
   * `NavigationOverlay`, but it rendered its OWN key/value dump inside them
   * while the three drawer-only renderers rendered the rich
   * `InlineEditProvider` -> `DetailView` -> `InlineEditSaveBar` payload. The
   * card measured that as "nobody gets both": the renderers that honoured the
   * mode drew the poorer body. The ruling closes it in one direction — one
   * payload everywhere — so this site now mounts {@link RecordDetailPanel}.
   *
   * ⚠️ It is a READ-ONLY panel here, and deliberately so: capability is handler
   * presence, and `ObjectTree` has no write path to hand it. That is a strict
   * gain over the dump it replaces (typed widgets, declared labels, honoured
   * `hidden`), not a new edit surface.
   *
   * `mainContent` is what `split` needs — and its absence is exactly what
   * objectui#9299 measured as the `ObjectTree` blank: the split branch of the
   * shell is `if (!isOpen || !mainContent) return null`, and nothing here ever
   * passed one, so an authored `split` rendered NOTHING on this renderer
   * (item 2). `popoverAnchorRef` is what `popover` needs (item 3).
   */
  const renderRecordOverlay = (mainContent?: React.ReactNode): React.ReactNode => {
    if (!navigation.isOverlay) return null;
    const overlayObjectName =
      resolveRecordSourceObjectName(schema, dataConfig) ?? schema.objectName;
    return (
      <NavigationOverlay
        {...navigation}
        /* Keyed, not a bare literal (objectui#3459). This value is handed to
           `NavigationOverlay`'s `title` prop, so the overlay's own
           `detail.recordDetail` default never applies here — whatever this
           resolves to IS the visible heading of the drawer/modal/split/popover.
           Reusing that very key rather than minting a twin keeps one control on
           one translation. */
        title={t('detail.recordDetail')}
        mainContent={mainContent}
        popoverAnchorRef={anchorRef}
        // One drag-resize implementation, one key per object across every view
        // type, and a width persisted under the retired
        // `objectui.drawerWidth.OBJECT` carries over (item 4).
        storageKey={overlayObjectName ? recordOverlayWidthStorageKey(overlayObjectName) : undefined}
        legacyStorageKey={overlayObjectName ? legacyRecordDrawerWidthKey(overlayObjectName) : undefined}
        width={navigation.width ?? RECORD_OVERLAY_DEFAULT_WIDTH}
      >
        {(record) => {
          const rec = record as Record<string, any>;
          const recordId = rec.id ?? rec._id;
          // ⚠️ DECLARED-FIELDS GATE — the same reading `ObjectGrid` carries, for
          // the same measured reason: the shared payload renders the object's
          // DECLARED fields, so a tree with no object schema has nothing for it
          // to render typed and the plain reading of the row is the better
          // answer.
          const hasDeclaredFields = !!objectSchema?.fields
            && Object.keys(objectSchema.fields as Record<string, unknown>).length > 0;
          if (!overlayObjectName || recordId == null || !hasDeclaredFields) {
            // No addressable record, or nothing declared to render against —
            // the plain reading of what the row carries is the honest answer.
            return (
              <div className="space-y-3 p-4">
                {Object.entries(rec).map(([key, value]) => (
                  <div key={key} className="flex flex-col">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {key.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm">{formatCellValue(value, cellContext(key)) || '—'}</span>
                  </div>
                ))}
              </div>
            );
          }
          return (
            <div className="px-6 pt-6 pb-6">
              <RecordDetailPanel
                record={rec}
                objectName={overlayObjectName}
                recordId={recordId}
                dataSource={dataSource}
                objectSchema={objectSchema as any}
                onClose={navigation.close}
              />
            </div>
          );
        }}
      </NavigationOverlay>
    );
  };

  const treeView = (
    <div className={cn('w-full overflow-auto', className)} data-testid="object-tree">
      {/* objectui#10816 — the re-read bar, over the rows it is re-reading.
          `sticky`, not the component's default `absolute`, because this div
          is itself the scroll container (`ListView` hands it `h-full`): an
          absolute bar inside it scrolls away with the rows, and a positioned
          wrapper around it would take the host's `className` off the element
          that scrolls. `-mb-0.5` hands back the bar's 2px of flow, so the table
          does not move when it appears. Measured once in Chromium, not
          re-derived by any test: the sticky bar stayed at the scrollport's top
          after a 300px scroll, the absolute one moved with it, and the table's
          offset was the same with and without the bar. */}
      <RefreshIndicator
        active={loading && records.length > 0}
        ariaLabel={t('grid.refreshing')}
        className="sticky -mb-0.5"
      />
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left text-muted-foreground">
            <th className="px-3 py-2 font-medium">{fieldLabel(config.labelField)}</th>
            {config.fields
              .filter((f) => f !== config.labelField)
              .map((f) => (
                <th key={f} className="px-3 py-2 font-medium">
                  {fieldLabel(f)}
                </th>
              ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((node) => {
            const hasChildren = node.children.length > 0;
            const isOpen = expanded.has(node.id);
            return (
              <tr
                key={node.id}
                className="border-b hover:bg-accent/50 cursor-pointer"
                data-testid="object-tree-row"
                data-depth={node.depth}
                onClick={(e) => {
                  // Record the clicked row BEFORE opening, so `popover` mode
                  // has an anchor by the time it renders (objectui#9299).
                  captureAnchor(e);
                  navigation.handleClick(node.record, e);
                }}
              >
                <td className="px-3 py-2">
                  <div
                    className="flex items-center gap-1"
                    style={{ paddingLeft: `${node.depth * 20}px` }}
                  >
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={isOpen ? 'Collapse' : 'Expand'}
                        className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(node.id, isOpen);
                        }}
                      >
                        {isOpen ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>
                    ) : (
                      <span className="inline-block h-5 w-5" />
                    )}
                    <span className="truncate">
                      {renderTreeCell(node.record[config.labelField], cellContext(config.labelField, node.record), '—')}
                    </span>
                  </div>
                </td>
                {config.fields
                  .filter((f) => f !== config.labelField)
                  .map((f) => (
                    <td key={f} className="px-3 py-2 text-muted-foreground">
                      {renderTreeCell(node.record[f], cellContext(f, node.record))}
                    </td>
                  ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* objectui#7210 — a hierarchy drawn from the first N rows of a larger
          result set is not a subtree of the real one: every node whose parent
          fell past the cut is reparented to a root. Nothing in the rendering
          says so, which is why the note does. Placement follows
          objectui#7148's chart footnote. */}
      {rowCeiling && <NonGridRowCeilingNote result={rowCeiling} />}

    </div>
  );

  // `split` (item 2): the tree IS the main content — it moves into the
  // overlay's left panel with the record panel beside it. Before objectui#9299
  // this renderer passed no `mainContent` at all, so the shell's split branch
  // (`if (!isOpen || !mainContent) return null`) rendered NOTHING for an
  // authored `split` — the measured blank.
  if (
    navigation.isOverlay
    && navigation.mode === 'split'
    && navigation.isOpen
    && navigation.selectedRecord
  ) {
    const splitOverlay = renderRecordOverlay(treeView);
    if (splitOverlay) return <>{splitOverlay}</>;
  }

  return (
    <>
      {treeView}
      {renderRecordOverlay()}
    </>
  );
};

export default ObjectTree;
