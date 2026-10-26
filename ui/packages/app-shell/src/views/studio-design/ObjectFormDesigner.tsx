// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectFormDesigner — the WYSIWYG form-layout designer for the Studio Data
 * pillar's Form view. An admin arranges the object's default form exactly as
 * end users will see it: fields grouped into **sections** (the object's
 * `fieldGroups`), drag-reordered within a section and dragged **across**
 * sections, with per-field selection opening the same protocol field inspector
 * the grid uses.
 *
 * Build boundary: this component is only the drag/section CHROME. The data
 * model + all mutations are the existing, tested `object-fields-io` helpers
 * (readFields/writeFields · readGroups/addGroup/renameGroup/removeGroup/
 * moveGroup · clearFieldGroup · groupEntries), and section membership +
 * in-group order persist to the object draft (`fields[].group` + `fieldGroups`)
 * via the pillar's existing draft → publish. No new metadata shape.
 */

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Plus, Trash2, ChevronUp, ChevronDown, ChevronsUpDown, PanelTop, Settings2 } from 'lucide-react';
import { cn } from '@object-ui/components';
import { inferColumns, containerGridColsFor, isWideFieldType } from '@object-ui/plugin-form';
import { toFormFieldType } from './formFieldType.js';
import {
  readFields,
  writeFields,
  readGroups,
  addGroup,
  renameGroup,
  removeGroup,
  moveGroup,
  clearFieldGroup,
  type FieldEntry,
  type FieldsView,
} from '../metadata-admin/previews/object-fields-io.js';
import { useSafeFieldLabel } from '@object-ui/i18n';
import { t, tFormat, useMetadataLocale } from '../metadata-admin/i18n.js';
import { isStudioHiddenSystemField } from './studioHiddenSystemField.js';
import { formDndAccessibility, type FormDndLookups, type FormDndSlot } from './formDndAnnouncements.js';
import { AddFieldPopover } from './AddFieldPopover.js';
import type { FieldTypeId } from '../metadata-admin/previews/field-types.js';
import { fieldTypeName } from '../metadata-admin/previews/fieldTypeName.js';

const UNGROUPED = '__ungrouped__';

/**
 * Kept off the layout canvas, and written back untouched on every commit: a
 * field the host names in `systemFieldNames`, or one the platform injects AND
 * hides (`system: true` + `hidden: true` — `__search`,
 * `owning_business_unit_id`; objectui#11780). One test for all three readers
 * below — the density count, the containers, and the write-back — so a field
 * can never be hidden from the canvas and then dropped by the commit.
 */
function isKeptOffLayout(entry: FieldEntry, systemFieldNames: ReadonlySet<string>): boolean {
  return systemFieldNames.has(entry.name) || isStudioHiddenSystemField(entry.def);
}
const cid = (key: string) => `g:${key}`; // container (section) droppable id
const fid = (name: string) => `f:${name}`; // sortable field id
const unCid = (id: string) => id.slice(2);
const unFid = (id: string) => id.slice(2);

/**
 * Which droppable a drag is over (objectui#11871, objectui#11898). A pointer
 * drag keeps `pointerWithin`: the droppable under the pointer, or none. A
 * keyboard drag has no pointer: dnd-kit reads pointer coordinates off the
 * activator event, and a `KeyboardEvent` has none, so `pointerWithin` answered
 * nothing and every keyboard drop missed (objectui#11871). A keyboard drag is
 * over the droppable `keyboardOver` names for it: the place its arrow keys
 * chose, read off the layout (see {@link keyboardOverAt}). Not a rect test:
 * moving the field into another group re-lays the canvas under the chip, and a
 * rect test then lands on a neighbour of the place just announced
 * (objectui#11898).
 */
function formCollision(keyboardOver: (activeId: string) => string): CollisionDetection {
  return (args) => (args.pointerCoordinates ? pointerWithin(args) : [{ id: keyboardOver(String(args.active.id)) }]);
}

/**
 * Where a keyboard drag would put the dragged field (objectui#11898): a
 * container, and the field's 0-based index in it once dropped there, the field
 * itself counted.
 */
interface KeyboardSlot {
  container: string;
  index: number;
}

/**
 * The droppable a keyboard drag at `slot` is over: the one a drop on which
 * lands `activeId` at `slot` by `onDragEnd`'s arithmetic (`dropPlaceIn` reads
 * the same). In the field's own group, the field at that index, which is the
 * field itself once `onDragOver` has carried it there; in another group, the
 * field it goes before, or the group's section when it goes last. `null` slot:
 * the drag has not stepped, so it is over its own card.
 */
function keyboardOverAt(layout: Record<string, string[]>, activeId: string, slot: KeyboardSlot | null): string {
  const list = slot ? layout[slot.container] : undefined;
  if (!slot || !list) return activeId;
  return list[slot.index] ?? (list.includes(activeId) ? activeId : slot.container);
}

/**
 * One arrow-key step of a keyboard drag, in the layout's reading order
 * (objectui#11898): ArrowDown and ArrowRight take the field one place later,
 * ArrowUp and ArrowLeft one place earlier, whatever the canvas's column count.
 * Past either end of a group the step enters the next group shown, first
 * place going down and last place going up, so an empty group is one step
 * like any other. `null`: the field is already at that end of the canvas.
 * `shown` says whether a group's section is on the canvas; the layout's keys
 * are in canvas order, the order `derived` builds them in.
 */
function stepSlot(
  layout: Record<string, string[]>,
  activeId: string,
  from: KeyboardSlot,
  step: 1 | -1,
  shown: (container: string) => boolean,
): KeyboardSlot | null {
  const places = (c: string) => layout[c].length + (layout[c].includes(activeId) ? 0 : 1);
  const index = from.index + step;
  if (index >= 0 && index < places(from.container)) return { container: from.container, index };
  const order = Object.keys(layout).filter((c) => c === from.container || shown(c));
  const next = order[order.indexOf(from.container) + step];
  return next ? { container: next, index: step > 0 ? 0 : places(next) - 1 } : null;
}

const STEP_BY_KEY: Readonly<Record<string, 1 | -1>> = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };

/**
 * One arrow key of a keyboard drag, for the keyboard sensor's coordinate
 * getter (objectui#11898). dnd-kit's `sortableKeyboardCoordinates` picked each
 * step's target by corner distance among the droppables in the arrow's
 * direction. A section's droppable spans its whole grid, so on a multi-column
 * canvas the nearest card won and an empty group was never reached; upward, a
 * field's own section was the nearest, so the first ArrowUp from a group's
 * first field went nowhere, and a full-row field's chip, as wide as the
 * section, matched its own section's corners. This steps from `from` (`null`:
 * the field's own place) through `layout` with `stepSlot`, hands the new place
 * to `moveTo` for {@link formCollision}, and moves the chip onto the droppable
 * the drag is now over: the card, an empty group's section, or the foot of a
 * group the field joins last. `undefined`: not an arrow key, or nowhere to go.
 */
function keyboardStep(
  event: KeyboardEvent,
  { active, context }: Parameters<KeyboardCoordinateGetter>[1],
  layout: Record<string, string[]>,
  from: KeyboardSlot | null,
  moveTo: (slot: KeyboardSlot) => void,
): ReturnType<KeyboardCoordinateGetter> {
  const step = STEP_BY_KEY[event.code];
  if (!step) return undefined;
  event.preventDefault();
  const { collisionRect, droppableRects } = context;
  const activeId = String(active);
  const at = from ?? placeIn(layout, activeId);
  const to = at && stepSlot(layout, activeId, at, step, (c) => droppableRects.has(c));
  const overId = to && keyboardOverAt(layout, activeId, to);
  const rect = overId ? droppableRects.get(overId) : undefined;
  if (!collisionRect || !to || !rect) return undefined;
  moveTo(to);
  const atFoot = overId === to.container && layout[to.container].length > 0;
  return { x: rect.left, y: atFoot ? rect.bottom - collisionRect.height : rect.top };
}

/** A field's place in a container map: the container id, a 0-based index and the container's size. */
interface LayoutPlace {
  container: string;
  index: number;
  total: number;
}

/** Where a field sits in a container map, or `null` when no container holds it. */
function placeIn(layout: Record<string, string[]>, id: string): LayoutPlace | null {
  const container = Object.keys(layout).find((k) => layout[k].includes(id));
  return container ? { container, index: layout[container].indexOf(id), total: layout[container].length } : null;
}

/**
 * Where a drop of `activeId` on `overId` lands, read off the same container
 * map `onDragEnd` reads and with the same arithmetic, so the place the live
 * region announces is the place the drop commits (objectui#11802). `null`
 * where `onDragEnd` returns without moving anything. The handler is the rule;
 * this restates it for the announcements, and the pins in
 * `ObjectFormDesigner.dndAnnouncements-11802.test.tsx` compare the two on
 * every drop they make.
 */
function dropPlaceIn(layout: Record<string, string[]>, activeId: string, overId: string): LayoutPlace | null {
  const inContainer = (id: string): string | undefined =>
    id.startsWith('g:') && id in layout ? id : Object.keys(layout).find((k) => layout[k].includes(id));
  const from = inContainer(activeId);
  const to = inContainer(overId);
  if (!from || !to) return null;
  if (from === to) {
    const list = layout[from];
    const oldIndex = list.indexOf(activeId);
    const newIndex = overId.startsWith('g:') ? list.length - 1 : list.indexOf(overId);
    // `onDragEnd` keeps the field where it is when either index is missing.
    return { container: from, index: newIndex < 0 ? oldIndex : newIndex, total: list.length };
  }
  const toItems = layout[to];
  const overIndex = overId.startsWith('g:') ? toItems.length : toItems.indexOf(overId);
  return { container: to, index: overIndex < 0 ? toItems.length : overIndex, total: toItems.length + 1 };
}

export interface ObjectFormDesignerProps {
  /** Object metadata draft (reads `fields` + `fieldGroups`). */
  draft: Record<string, unknown>;
  /**
   * API name of the object being designed — the lookup root for the field /
   * section translations the canvas renders. Falls back to `draft.name`, which
   * the object metadata body carries; pass it explicitly when the caller has a
   * more reliable handle (a freshly created draft may not have been named yet).
   */
  objectName?: string;
  /**
   * Field names to hide from the layout (system/audit) but preserve on write.
   * A field marked `system: true` + `hidden: true` is hidden and preserved the
   * same way without being named here (objectui#11780).
   */
  systemFieldNames: Set<string>;
  /** Persist a partial object-draft patch (fields / fieldGroups) + mark dirty. */
  onChange: (patch: Record<string, unknown>) => void;
  /** Currently selected field name (highlighted). */
  selectedField?: string | null;
  /** Select a field → opens the shared field inspector. */
  onSelectField: (name: string) => void;
  /**
   * Add a field with the label and type the toolbar's Add field popover asked
   * for (objectui#12516; reuses the pillar's add-field). Omit to hide the
   * button — e.g. a read-only package.
   */
  onAddField?: (label: string, type: FieldTypeId, name?: string) => void;
  /** Currently selected group key (its section is highlighted). */
  selectedGroup?: string | null;
  /** Select a group (section) → opens the group property inspector. Omit to hide the affordance. */
  onSelectGroup?: (key: string) => void;
  /** Courtesy gate: layout stays viewable, but add/rename/reorder/delete are off. */
  readOnly?: boolean;
  /**
   * The host's Layout / Preview control, drawn at the left of the designer's
   * toolbar so the Form tab keeps one toolbar row (objectui#12451).
   */
  modeControl?: React.ReactNode;
}

/**
 * The Form tab's one toolbar row (objectui#12451): the host's mode control and
 * a hint at the left, the actions at the right. The designer draws it in Layout;
 * the host draws it in Preview, so both modes keep the same row.
 */
export function FormToolbar({
  leading,
  hint,
  children,
}: {
  leading?: React.ReactNode;
  hint?: React.ReactNode;
  children?: React.ReactNode;
}): React.ReactElement {
  return (
    <div data-testid="form-toolbar" className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-6 py-3">
      {leading}
      {hint}
      {children ? <div className="ml-auto flex items-center gap-1.5">{children}</div> : null}
    </div>
  );
}

/**
 * A skeleton of a field's control (by type): a 32 px box, 56 px for the
 * multi-line widgets, and a select box with a chevron for the pickers
 * (objectui#12451).
 */
function FieldControlPreview({ type }: { type: string }): React.ReactElement {
  const locale = useMetadataLocale();
  const box = 'flex items-center rounded-md border bg-sidebar px-2.5 text-xs text-muted-foreground';
  switch (type) {
    case 'select':
    case 'radio':
    case 'lookup':
    case 'reference':
    case 'user':
    case 'multiselect':
      return (
        <div className={`${box} h-8 justify-between`}>
          <span>{type === 'lookup' || type === 'reference' || type === 'user' ? t('engine.studio.designer.search', locale) : t('engine.studio.designer.select', locale)}</span>
          <ChevronsUpDown className="h-3 w-3" aria-hidden="true" />
        </div>
      );
    case 'textarea':
    case 'html':
    case 'markdown':
    case 'json':
    case 'code':
      return <div className={`${box} h-14`} />;
    case 'boolean':
    case 'checkbox':
    case 'switch':
      return (
        <div className="flex h-8 items-center">
          <span className="h-4 w-7 rounded-full bg-muted" />
        </div>
      );
    case 'number':
    case 'currency':
    case 'percent':
      return <div className={`${box} h-8`}>0.00</div>;
    case 'date':
    case 'datetime':
    case 'time':
      return <div className={`${box} h-8`}>{t('engine.studio.designer.pickDate', locale)}</div>;
    default:
      return <div className={`${box} h-8`} />;
  }
}

/** One draggable field card inside a section. */
function SortableField({
  entry,
  label,
  columns,
  selected,
  onSelect,
  readOnly = false,
}: {
  entry: FieldEntry;
  /** Already resolved through the project's field translations. */
  label: string;
  columns: number;
  selected: boolean;
  onSelect: () => void;
  /**
   * objectui#11781 — a read-only package's card only opens the (greyed)
   * inspector: it neither says nor looks draggable.
   */
  readOnly?: boolean;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fid(entry.name),
    // objectui#11872 — the role a screen reader announces for the card, in the
    // author's locale; left unset, dnd-kit writes its English `sortable`. A
    // read-only card is not draggable, so it gets none: ARIA does not expose a
    // blank `aria-roledescription`, and the card reads as the button it is.
    attributes: { roleDescription: readOnly ? '' : t('engine.studio.designer.fieldRole', locale) },
  });
  const type = String(entry.def.type ?? 'text');
  const required = !!entry.def.required;
  // Mirror the real form: wide widgets (textarea/markdown/html/…) take the whole
  // row. `col-span-full` (grid-column: 1/-1) spans every column at ANY container
  // width, so it stays correct as the responsive grid collapses to one column.
  // `isWideFieldType` reads FORM vocabulary, so the raw object type is
  // normalized to its widget id first (see `toFormFieldType`). `type` itself
  // stays the spec spelling — that is what `FieldControlPreview` switches on.
  const spanFull = columns > 1 && isWideFieldType(toFormFieldType(type));
  // objectui#13148 — the type tag names the type the way the type picker and
  // the inspector do (`select` reads "Picklist"), never by its spec id.
  const typeName = fieldTypeName(type, locale);
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onSelect}
      {...attributes}
      {...listeners}
      // objectui#11924 — dnd-kit points every card's `aria-describedby` at the
      // canvas's drag instructions, and `useSortable` cannot take it away
      // (`disabled` keeps it and adds `aria-disabled`, though a click still
      // selects). A read-only card cannot be dragged, so it names none.
      aria-describedby={readOnly ? undefined : attributes['aria-describedby']}
      aria-label={
        readOnly
          ? tFormat('engine.studio.designer.fieldAriaReadOnly', locale, { label })
          : tFormat('engine.studio.designer.fieldAria', locale, { label })
      }
      // objectui#12453 — what a click still does on a read-only package, the
      // half of the retired toolbar hint that was not "read-only".
      title={readOnly ? t('engine.studio.designer.fieldTitleReadOnly', locale) : undefined}
      // objectui#12451 — a field card: a transparent border that turns muted on
      // hover; selected, a primary border with a soft primary ring, and the
      // type tag turns primary.
      className={cn(
        'flex touch-none select-none flex-col gap-2 rounded-md border px-3 py-2.5',
        readOnly ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        spanFull && 'col-span-full',
        selected ? 'border-primary bg-background ring-[3px] ring-primary/10' : 'border-transparent hover:border-border',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="flex min-w-0 items-baseline gap-1 text-[13px] font-medium">
          <span className="truncate">{label}</span>
          {required && <span className="text-destructive">*</span>}
        </span>
        <span
          className={cn(
            'shrink-0 text-[10px] font-semibold uppercase tracking-wider',
            selected ? 'text-primary' : 'text-muted-foreground',
          )}
        >
          {typeName}
        </span>
      </div>
      <FieldControlPreview type={type} />
    </div>
  );
}

/** A section (declared group or the implicit ungrouped bucket) = a drop zone. */
function Section({
  containerId,
  title,
  fieldIds,
  columns,
  isDeclared,
  canMoveUp,
  canMoveDown,
  entryByName,
  fieldLabelOf,
  selectedField,
  onSelectField,
  selected = false,
  onSelect,
  onRename,
  onDelete,
  onMove,
  readOnly = false,
}: {
  containerId: string;
  title: string;
  fieldIds: string[];
  columns: number;
  isDeclared: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  entryByName: Map<string, FieldEntry>;
  /** Resolves a field entry to its translated display label. */
  fieldLabelOf: (entry: FieldEntry) => string;
  selectedField?: string | null;
  onSelectField: (name: string) => void;
  selected?: boolean;
  onSelect?: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
  readOnly?: boolean;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const { setNodeRef, isOver } = useDroppable({ id: containerId });
  // `@container` scopes the field grid's container queries to THIS section's
  // width, so a wide screen spreads fields to the same column count the real
  // form uses — while a narrow panel collapses to one column.
  // objectui#12451 — a section card: white, 1 px border, 8 px radius, a 44 px
  // header (title, field count, then the group's controls with its settings
  // at the right).
  const stateCls = isOver
    ? 'border-primary ring-[3px] ring-primary/10'
    : selected
      ? 'border-primary ring-[3px] ring-primary/10'
      : '';
  const iconBtn = 'inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted';
  return (
    <div className={cn('@container rounded-lg border bg-background', stateCls)}>
      <div className="flex h-11 items-center gap-2 border-b px-4">
        {isDeclared && !readOnly ? (
          <input
            defaultValue={title}
            onBlur={(e) => e.target.value.trim() && e.target.value !== title && onRename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
            className="field-sizing-content min-w-0 max-w-full rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:bg-muted focus:bg-background focus:ring-1 focus:ring-primary"
          />
        ) : (
          <span className={cn('px-1 text-sm font-semibold', !isDeclared && 'text-muted-foreground')}>{title}</span>
        )}
        <span className="shrink-0 text-xs text-muted-foreground">
          {tFormat('engine.studio.data.fieldCount', locale, { count: fieldIds.length })}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {isDeclared && !readOnly && (
            <>
              <button
                type="button"
                disabled={!canMoveUp}
                onClick={() => onMove(-1)}
                aria-label={t('engine.studio.designer.groupUp', locale)}
                className={cn(iconBtn, 'disabled:opacity-30')}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                disabled={!canMoveDown}
                onClick={() => onMove(1)}
                aria-label={t('engine.studio.designer.groupDown', locale)}
                className={cn(iconBtn, 'disabled:opacity-30')}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                aria-label={t('engine.studio.designer.groupDelete', locale)}
                title={t('engine.studio.designer.groupDeleteTitle', locale)}
                className={cn(iconBtn, 'hover:bg-destructive/10 hover:text-destructive')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
          {isDeclared && onSelect && (
            // The section settings trigger: opens ObjectGroupInspector.
            <button
              type="button"
              onClick={onSelect}
              aria-label={t('engine.studio.designer.group.settings', locale)}
              title={t('engine.studio.designer.group.settings', locale)}
              className={cn(iconBtn, selected ? 'text-primary' : 'hover:text-foreground')}
            >
              <Settings2 className="h-[15px] w-[15px]" />
            </button>
          )}
        </div>
      </div>
      <SortableContext items={fieldIds} strategy={verticalListSortingStrategy}>
        {/* Field grid mirrors the real form's density: container-query columns
            (1 → up to `columns`) via {@link containerGridColsFor}, so the layout
            designer matches what end users actually see. */}
        <div
          ref={setNodeRef}
          // The column steps are the runtime form's; only the gap is the
          // card's 8 px (objectui#12451).
          className={cn('min-h-[52px] p-3', containerGridColsFor(columns) ?? 'grid grid-cols-1', 'gap-2')}
        >
          {fieldIds.length === 0 && (
            <div className="col-span-full flex items-center justify-center rounded-md border border-dashed py-3 text-[11px] text-muted-foreground">
              {t('engine.studio.designer.dropHere', locale)}
            </div>
          )}
          {fieldIds.map((id) => {
            const name = unFid(id);
            const entry = entryByName.get(name);
            if (!entry) return null;
            return (
              <SortableField
                key={id}
                entry={entry}
                label={fieldLabelOf(entry)}
                columns={columns}
                selected={selectedField === name}
                onSelect={() => onSelectField(name)}
                readOnly={readOnly}
              />
            );
          })}
        </div>
      </SortableContext>
    </div>
  );
}

export function ObjectFormDesigner({
  draft,
  objectName: objectNameProp,
  systemFieldNames,
  onChange,
  selectedField,
  onSelectField,
  onAddField,
  selectedGroup,
  onSelectGroup,
  readOnly = false,
  modeControl,
}: ObjectFormDesignerProps): React.ReactElement {
  const locale = useMetadataLocale();
  const view = React.useMemo(() => readFields(draft.fields), [draft.fields]);
  const groups = React.useMemo(() => readGroups(draft.fieldGroups), [draft.fieldGroups]);
  const entryByName = React.useMemo(() => new Map(view.entries.map((e) => [e.name, e] as const)), [view]);

  // The canvas is a preview of the END-USER form, so it must speak the same
  // language that form does (objectui#3134). `ObjectForm` / `RecordDetailView`
  // resolve every field and section through the project's object translations
  // (`objects.<object>.fields.<field>.label` /
  // `objects.<object>._sections.<key>.label`); the designer read the raw draft
  // metadata instead, so a fully translated object still rendered its English
  // source labels here while every other surface showed the translation.
  // `useSafeFieldLabel` is the provider-safe wrapper — the designer is also
  // mounted in tests/previews with no I18nProvider, where it degrades to the
  // identity fallback.
  const { fieldLabel, sectionLabel } = useSafeFieldLabel();
  const objectName = objectNameProp || (typeof draft.name === 'string' ? draft.name : '');
  const fieldLabelOf = React.useCallback(
    (entry: FieldEntry) => {
      const fallback = String(entry.def.label ?? entry.name);
      return objectName ? fieldLabel(objectName, entry.name, fallback) : fallback;
    },
    [objectName, fieldLabel],
  );

  // Column count mirrors the real form (objectui#2578): derived ONCE from the
  // object's editable field count and applied to every section, so the layout
  // designer reads at the same density end users see. Each section's container
  // queries then clamp this cap to the actually-rendered width.
  const formColumns = React.useMemo(
    () => inferColumns(view.entries.filter((e) => !isKeptOffLayout(e, systemFieldNames)).length),
    [view.entries, systemFieldNames],
  );

  // Container order: declared groups (in order) then the ungrouped bucket.
  const containerOrder = React.useMemo(() => [...groups.map((g) => cid(g.key)), cid(UNGROUPED)], [groups]);
  const labelOf = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      const fallback = g.label || g.key;
      m.set(cid(g.key), objectName ? sectionLabel(objectName, g.key, fallback) : fallback);
    }
    m.set(cid(UNGROUPED), t('engine.studio.designer.ungrouped', locale));
    return m;
  }, [groups, locale, objectName, sectionLabel]);

  // Derive container → ordered field ids from the draft (editable fields only;
  // system/audit fields are preserved on write but never shown in the layout).
  const derived = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of containerOrder) map[c] = [];
    for (const e of view.entries) {
      if (isKeptOffLayout(e, systemFieldNames)) continue;
      const g = typeof e.def.group === 'string' ? e.def.group : '';
      const target = g && map[cid(g)] ? cid(g) : cid(UNGROUPED);
      map[target].push(fid(e.name));
    }
    return map;
  }, [view.entries, containerOrder, systemFieldNames]);

  const [items, setItems] = React.useState<Record<string, string[]>>(derived);
  const [activeId, setActiveId] = React.useState<string | null>(null);
  // Re-sync from the draft whenever it changes and we are not mid-drag.
  React.useEffect(() => {
    if (!activeId) setItems(derived);
  }, [derived, activeId]);
  // Latest items snapshot for drag-end math — robust whether or not onDragOver
  // fired (e.g. synthetic/automated drags that skip intermediate move events).
  const itemsRef = React.useRef(items);
  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // What the drag live region speaks (objectui#11802): the labels the cards and
  // section headers render, never the `f:` / `g:` ids, and places read off the
  // container map `onDragEnd` reads (`itemsRef` holds this render's `items`).
  // dnd-kit subscribes the newest object each time a render commits, so a
  // sentence always reads the committed layout and labels. A rebuild, here or
  // on React's own account, changes no sentence.
  const dndAccessibility = React.useMemo(() => {
    const slot = (place: LayoutPlace | null): FormDndSlot | null =>
      place && {
        container: place.container,
        group: labelOf.get(place.container) ?? t('engine.studio.designer.ungrouped', locale),
        position: place.index + 1,
        total: place.total,
      };
    const lookups: FormDndLookups = {
      fieldLabel: (id) => {
        const entry = entryByName.get(unFid(id));
        // A drag starts only on a rendered card, which has an entry.
        return entry ? fieldLabelOf(entry) : unFid(id);
      },
      slotOf: (id) => slot(placeIn(items, id)),
      dropSlot: (id, overId) => slot(dropPlaceIn(items, id, overId)),
      committedSlotOf: (id) => slot(placeIn(derived, id)),
    };
    return formDndAccessibility(locale, lookups);
  }, [locale, items, derived, labelOf, entryByName, fieldLabelOf]);

  // Where a keyboard drag's arrow keys have taken the field (objectui#11898),
  // `null` from each keyboard pick-up until its first step. Held twice: the
  // collision reads the state while it renders, and the coordinate getter,
  // which the sensor keeps from the pick-up on, reads the ref when a key comes.
  const [keyboardSlot, setKeyboardSlot] = React.useState<KeyboardSlot | null>(null);
  const keyboardSlotRef = React.useRef<KeyboardSlot | null>(null);
  const placeKeyboardDrag = (slot: KeyboardSlot | null) => {
    keyboardSlotRef.current = slot;
    setKeyboardSlot(slot);
  };
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: (event, args) =>
        keyboardStep(event, args, itemsRef.current, keyboardSlotRef.current, placeKeyboardDrag),
      onActivation: () => placeKeyboardDrag(null),
    }),
  );

  const findContainer = React.useCallback(
    (id: string): string | undefined => {
      if (id.startsWith('g:')) return id;
      return Object.keys(items).find((k) => items[k].includes(id));
    },
    [items],
  );

  /** Flatten the container map back to `fields` (stamping group + order) and persist. */
  const commit = React.useCallback(
    (next: Record<string, string[]>) => {
      const editable: FieldEntry[] = [];
      for (const c of containerOrder) {
        const groupKey = unCid(c);
        for (const id of next[c] ?? []) {
          const e = entryByName.get(unFid(id));
          if (!e) continue;
          const def = { ...e.def };
          if (groupKey === UNGROUPED) delete def.group;
          else def.group = groupKey;
          editable.push({ name: e.name, def });
        }
      }
      // Every field the canvas does not show rides back unchanged — the same
      // test that kept it off the containers (objectui#11780).
      const system = view.entries.filter((e) => isKeptOffLayout(e, systemFieldNames));
      const finalView: FieldsView = { shape: view.shape, entries: [...system, ...editable] };
      onChange({ fields: writeFields(finalView) });
    },
    [containerOrder, entryByName, view, systemFieldNames, onChange],
  );

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  const onDragOver = (e: DragOverEvent) => {
    const activeIdStr = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const from = findContainer(activeIdStr);
    const to = findContainer(overId);
    if (!from || !to || from === to) return;
    setItems((prev) => {
      const fromItems = prev[from] ?? [];
      const toItems = prev[to] ?? [];
      const overIndex = overId.startsWith('g:') ? toItems.length : toItems.indexOf(overId);
      const insertAt = overIndex < 0 ? toItems.length : overIndex;
      return {
        ...prev,
        [from]: fromItems.filter((i) => i !== activeIdStr),
        [to]: [...toItems.slice(0, insertAt), activeIdStr, ...toItems.slice(insertAt)],
      };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const activeIdStr = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId) return;
    const prev = itemsRef.current;
    const inContainer = (id: string): string | undefined =>
      id.startsWith('g:') && id in prev ? id : Object.keys(prev).find((k) => prev[k].includes(id));
    const from = inContainer(activeIdStr);
    const to = inContainer(overId);
    if (!from || !to) return;
    let next: Record<string, string[]>;
    if (from === to) {
      const list = prev[from];
      const oldIndex = list.indexOf(activeIdStr);
      const newIndex = overId.startsWith('g:') ? list.length - 1 : list.indexOf(overId);
      if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
        commit(prev);
        return;
      }
      next = { ...prev, [from]: arrayMove(list, oldIndex, newIndex) };
    } else {
      const fromItems = prev[from].filter((i) => i !== activeIdStr);
      const toItems = prev[to];
      const overIndex = overId.startsWith('g:') ? toItems.length : toItems.indexOf(overId);
      const insertAt = overIndex < 0 ? toItems.length : overIndex;
      next = {
        ...prev,
        [from]: fromItems,
        [to]: [...toItems.slice(0, insertAt), activeIdStr, ...toItems.slice(insertAt)],
      };
    }
    setItems(next);
    commit(next);
  };

  const addSection = () => onChange({ fieldGroups: addGroup(groups, t('engine.studio.designer.newGroup', locale)) });
  const renameSection = (key: string, label: string) => onChange({ fieldGroups: renameGroup(groups, key, label) });
  const moveSection = (key: string, dir: -1 | 1) => onChange({ fieldGroups: moveGroup(groups, key, dir) });
  const deleteSection = (key: string) =>
    onChange({ fieldGroups: removeGroup(groups, key), fields: writeFields(clearFieldGroup(view, key)) });

  const activeEntry = activeId && !activeId.startsWith('g:') ? entryByName.get(unFid(activeId)) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FormToolbar
        leading={modeControl}
        hint={
          // objectui#12453 — a read-only package says so in the app chip and
          // the item header's link, not here; what a click still does is each
          // field card's title.
          readOnly ? undefined : (
            <span className="text-xs text-muted-foreground">{t('engine.studio.designer.toolbarHint', locale)}</span>
          )
        }
      >
        {!readOnly && (
          <>
            <button
              type="button"
              onClick={addSection}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs text-foreground/80 hover:bg-muted hover:text-foreground"
            >
              <PanelTop className="h-3.5 w-3.5 text-muted-foreground" /> {t('engine.studio.designer.addGroup', locale)}
            </button>
            {onAddField && (
              <AddFieldPopover onCreate={onAddField} takenNames={view.entries.map((e) => e.name)}>
                <button
                  type="button"
                  className="inline-flex h-7 items-center gap-1.5 rounded-md bg-primary/10 px-2.5 text-xs font-medium text-primary hover:bg-primary/15"
                >
                  <Plus className="h-3.5 w-3.5" /> {t('engine.studio.data.addField', locale)}
                </button>
              </AddFieldPopover>
            )}
          </>
        )}
      </FormToolbar>

      <div className="min-h-0 flex-1 overflow-auto bg-sidebar p-6">
        <DndContext
          sensors={readOnly ? [] : sensors}
          collisionDetection={formCollision((id) => keyboardOverAt(items, id, keyboardSlot))}
          accessibility={dndAccessibility}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="mx-auto flex max-w-6xl flex-col gap-4">
            {containerOrder.map((c) => {
              const isUngrouped = c === cid(UNGROUPED);
              // Hide the ungrouped bucket only when it is empty AND groups exist.
              if (isUngrouped && (items[c]?.length ?? 0) === 0 && groups.length > 0) return null;
              const declaredIdx = groups.findIndex((g) => cid(g.key) === c);
              return (
                <Section
                  key={c}
                  containerId={c}
                  title={labelOf.get(c) ?? t('engine.studio.designer.ungrouped', locale)}
                  fieldIds={items[c] ?? []}
                  columns={formColumns}
                  isDeclared={!isUngrouped}
                  canMoveUp={declaredIdx > 0}
                  canMoveDown={declaredIdx >= 0 && declaredIdx < groups.length - 1}
                  entryByName={entryByName}
                  fieldLabelOf={fieldLabelOf}
                  selectedField={selectedField}
                  onSelectField={onSelectField}
                  selected={!isUngrouped && selectedGroup === unCid(c)}
                  onSelect={!isUngrouped && onSelectGroup ? () => onSelectGroup(unCid(c)) : undefined}
                  onRename={(label) => renameSection(unCid(c), label)}
                  onDelete={() => deleteSection(unCid(c))}
                  onMove={(dir) => moveSection(unCid(c), dir)}
                  readOnly={readOnly}
                />
              );
            })}
            {!readOnly && (
              <button
                type="button"
                onClick={addSection}
                data-testid="form-designer-add-section-footer"
                className="flex h-11 items-center justify-center gap-1.5 rounded-lg border border-dashed border-muted-foreground/30 text-xs text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> {t('engine.studio.designer.addGroup', locale)}
              </button>
            )}
          </div>

          <DragOverlay>
            {activeEntry ? (
              <div className="flex items-center gap-1.5 rounded-md border bg-background px-2 py-2 shadow-lg">
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium">{fieldLabelOf(activeEntry)}</span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>
    </div>
  );
}
