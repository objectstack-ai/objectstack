// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ObjectFormDesigner — the WYSIWYG form-layout designer for the Studio Data
 * pillar's Form view. An admin arranges the form the app opens for the object:
 * fields grouped into **sections**, drag-reordered within a section and
 * dragged **across** sections, with per-field selection opening the same
 * protocol field inspector the grid uses.
 *
 * Which layout that is (objectstack#30057) is the host's to say, from the form
 * view the app's create and edit dialogs select (`selectRecordFormView`):
 *
 *  - **No such form view** — the dialogs lay out the object's own fields, so
 *    the sections are the object's `fieldGroups`: membership and in-group
 *    order persist to the object draft (`fields[].group` + `fieldGroups`) via
 *    the pillar's draft → publish, through the tested `object-fields-io`
 *    helpers (readFields/writeFields · readGroups/addGroup/renameGroup/
 *    removeGroup/moveGroup · clearFieldGroup).
 *  - **A form view** (`formView`) — the dialogs render that view's
 *    `sections`, so the designer reads and writes them (`formViewSections`):
 *    a section's `fields` in order, its heading, its own `columns`. A field
 *    the view lists in no section is not on the form, and the canvas says so
 *    in the bucket it keeps those fields in. The host saves the view's draft.
 *
 * Build boundary: this component is only the drag/section CHROME. No new
 * metadata shape.
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
import { resolveBooleanControl } from '@object-ui/fields';
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
import { injectedSystemColumnDefs, isInjectedColumnDefinition } from '@objectstack/spec/data';
import { formDndAccessibility, type FormDndLookups, type FormDndSlot } from './formDndAnnouncements.js';
import { AddFieldPopover } from './AddFieldPopover.js';
import type { FieldTypeId } from '../metadata-admin/previews/field-types.js';
import { fieldTypeName } from '../metadata-admin/previews/fieldTypeName.js';
import { ContributionMark, contributedItemTitle } from './StudioRailCustomizations.js';
import type { ContributedOnObject } from './contributionRows.js';
import {
  addFormSection,
  formSectionMembers,
  formSectionSlots,
  moveFormSection,
  removeFormSection,
  renameFormSection,
  writeFormSectionLayout,
} from './formViewSections.js';

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
 * The container map a drop of `activeId` on `overId` leaves, before the
 * platform's pins are applied ({@link settlePinned}). `null` where the drop
 * moves nothing because either id is in no container; `layout` itself where
 * the field stays in place, which `onDragEnd` still commits (an earlier
 * `onDragOver` may have carried it across groups).
 */
function dropLayout(
  layout: Record<string, string[]>,
  activeId: string,
  overId: string,
): Record<string, string[]> | null {
  const inContainer = (id: string): string | undefined =>
    id.startsWith('g:') && id in layout ? id : Object.keys(layout).find((k) => layout[k].includes(id));
  const from = inContainer(activeId);
  const to = inContainer(overId);
  if (!from || !to) return null;
  if (from === to) {
    const list = layout[from];
    const oldIndex = list.indexOf(activeId);
    const newIndex = overId.startsWith('g:') ? list.length - 1 : list.indexOf(overId);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return layout;
    return { ...layout, [from]: arrayMove(list, oldIndex, newIndex) };
  }
  const toItems = layout[to];
  const overIndex = overId.startsWith('g:') ? toItems.length : toItems.indexOf(overId);
  const insertAt = overIndex < 0 ? toItems.length : overIndex;
  return {
    ...layout,
    [from]: layout[from].filter((i) => i !== activeId),
    [to]: [...toItems.slice(0, insertAt), activeId, ...toItems.slice(insertAt)],
  };
}

/**
 * objectstack#27516 — the ungrouped bucket with the platform's pinned fields
 * first. A field whose definition, once the commit drops its `group`, is
 * byte-for-byte the column the platform injects (`isInjectedColumnDefinition`
 * over `injectedSystemColumnDefs`, `@objectstack/spec/data`) is not the
 * author's: the draft write strips it (`stripInjectedSystemColumns`) and every
 * `/meta` read puts it back AHEAD of the declared fields
 * (`applyInjectedSystemColumns`, `@objectstack/metadata-core`). So a card left
 * above it — `owner_id` is the one the canvas shows — sat there until a reload
 * moved it back under Owner. The canvas places those fields where the read
 * will: first in the bucket, in the order `pinRank` gives them. A pinned field
 * dragged into a declared group carries a `group` and is the author's from
 * then on, so only the ungrouped bucket is settled. Returns `layout` itself
 * when nothing moves.
 */
function settlePinned(
  layout: Record<string, string[]>,
  pinRank: ReadonlyMap<string, number>,
): Record<string, string[]> {
  const bucket = layout[cid(UNGROUPED)];
  if (!bucket || pinRank.size === 0) return layout;
  const pinned = bucket.filter((id) => pinRank.has(id)).sort((a, b) => pinRank.get(a)! - pinRank.get(b)!);
  const settled = [...pinned, ...bucket.filter((id) => !pinRank.has(id))];
  return settled.every((id, i) => id === bucket[i]) ? layout : { ...layout, [cid(UNGROUPED)]: settled };
}

/**
 * Where a drop of `activeId` on `overId` lands: {@link dropLayout}, settled the
 * way `onDragEnd` settles it, so the place the live region announces is the
 * place the drop commits (objectui#11802), a field the platform moves back
 * included. `null` where `onDragEnd` returns without moving anything. The pins
 * in `ObjectFormDesigner.dndAnnouncements-11802.test.tsx` compare the two on
 * every drop they make.
 */
function dropPlaceIn(
  layout: Record<string, string[]>,
  activeId: string,
  overId: string,
  pinRank: ReadonlyMap<string, number>,
): LayoutPlace | null {
  const next = dropLayout(layout, activeId, overId);
  return next && placeIn(settlePinned(next, pinRank), activeId);
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
  /**
   * objectstack#29786 — the object's fields another package contributes, by
   * name (`contributedFieldsOf`): their cards are greyed, name the package, and
   * are never dragged. A click still selects (the inspector shows them
   * read-only).
   */
  contributedFields?: ReadonlyMap<string, ContributedOnObject>;
  /**
   * objectstack#30057 — the form view the app opens for this object
   * (`selectRecordFormView`): its `sections` are the canvas, and every layout
   * edit is handed to `onSectionsChange`, never to `onChange`. `null` / absent:
   * the object has none, and the canvas is its `fieldGroups`.
   */
  formView?: FormViewLayout | null;
}

/** The form view layout the designer edits in place of the object's `fieldGroups`. */
export interface FormViewLayout {
  /** The view's sections, as its buffer holds them. */
  sections: readonly Record<string, unknown>[];
  /** Persist the sections a layout edit leaves. */
  onSectionsChange: (sections: Record<string, unknown>[]) => void;
}

/** One section on the canvas: a field group, or a form view's section (objectstack#30057). */
interface DesignerSection {
  key: string;
  label: string;
  /** The key translations address (`objects.<object>._sections.<name>`); none for an unnamed section. */
  name?: string;
  /** A form view section's own `columns`. */
  columns?: number;
  /** objectstack#27069 — a field group standing for a related list's table. */
  relatedList?: string;
}

const NO_CONTRIBUTED_FIELDS: ReadonlyMap<string, ContributedOnObject> = new Map();
const ContributedFieldsContext = React.createContext<ReadonlyMap<string, ContributedOnObject>>(NO_CONTRIBUTED_FIELDS);

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
    // objectstack#27519 — the runtime form's own answer, not a canvas copy:
    // `boolean` previews a checkbox and `toggle` a switch, as the type picker
    // promises. `toggle` used to fall to the text box below, and `boolean`
    // drew the switch pill.
    case 'boolean':
    case 'toggle':
    case 'checkbox':
    case 'switch': {
      const control = resolveBooleanControl({ type });
      return (
        <div className="flex h-8 items-center" data-boolean-control={control}>
          {control === 'checkbox'
            ? <span className="h-4 w-4 rounded-sm border border-muted-foreground/40" />
            : <span className="h-4 w-7 rounded-full bg-muted" />}
        </div>
      );
    }
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
  // objectstack#29786 — a field another package contributes reads as a
  // read-only card on any surface, and names its package.
  const contributed = React.useContext(ContributedFieldsContext).get(entry.name) ?? null;
  const locked = readOnly || contributed !== null;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: fid(entry.name),
    // objectui#11872 — the role a screen reader announces for the card, in the
    // author's locale; left unset, dnd-kit writes its English `sortable`. A
    // read-only card is not draggable, so it gets none: ARIA does not expose a
    // blank `aria-roledescription`, and the card reads as the button it is.
    attributes: { roleDescription: locked ? '' : t('engine.studio.designer.fieldRole', locale) },
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
      // objectstack#29786 — a contributed card takes no drag listener: it is
      // never a drag source. Not `useSortable`'s `disabled`, which would mark
      // it `aria-disabled` while a click still selects it.
      {...(contributed ? {} : listeners)}
      // objectui#11924 — dnd-kit points every card's `aria-describedby` at the
      // canvas's drag instructions, and `useSortable` cannot take it away
      // (`disabled` keeps it and adds `aria-disabled`, though a click still
      // selects). A read-only card cannot be dragged, so it names none.
      aria-describedby={locked ? undefined : attributes['aria-describedby']}
      aria-label={
        locked
          ? tFormat('engine.studio.designer.fieldAriaReadOnly', locale, { label })
          : tFormat('engine.studio.designer.fieldAria', locale, { label })
      }
      // objectui#12453 — what a click still does on a read-only package, the
      // half of the retired toolbar hint that was not "read-only".
      title={
        contributed
          ? contributedItemTitle(contributed, locale)
          : readOnly
            ? t('engine.studio.designer.fieldTitleReadOnly', locale)
            : undefined
      }
      data-contributed={contributed ? 'field' : undefined}
      data-package={contributed?.packageId}
      // objectui#12451 — a field card: a transparent border that turns muted on
      // hover; selected, a primary border with a soft primary ring, and the
      // type tag turns primary.
      className={cn(
        'flex touch-none select-none flex-col gap-2 rounded-md border px-3 py-2.5',
        locked ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
        spanFull && 'col-span-full',
        contributed && 'text-muted-foreground opacity-70',
        selected ? 'border-primary bg-background ring-[3px] ring-primary/10' : 'border-transparent hover:border-border',
        isDragging && 'opacity-40',
      )}
    >
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="flex min-w-0 items-baseline gap-1 text-[13px] font-medium">
          <span className="truncate">{label}</span>
          {required && <span className="text-destructive">*</span>}
        </span>
        {contributed && (
          <ContributionMark packageName={contributed.packageName} packageId={contributed.packageId} locale={locale} />
        )}
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
  relatedTable,
  deleteTitleKey = 'engine.studio.designer.groupDeleteTitle',
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
  /**
   * objectstack#27069 — the group's `relatedList`: it stands for that related
   * list's table, holds no fields (the object parse refuses a field whose
   * group is such a group), and so is no drop target.
   */
  relatedTable?: string;
  /** objectstack#30057 — what the delete button's title says becomes of the section's fields. */
  deleteTitleKey?: string;
}): React.ReactElement {
  const locale = useMetadataLocale();
  const { setNodeRef, isOver } = useDroppable({ id: containerId, disabled: !!relatedTable });
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
            // No visible label sits beside the inline title: the input names
            // itself with the group inspector's own name-field label.
            aria-label={t('engine.studio.designer.group.nameLabel', locale)}
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
          {tFormat(fieldIds.length === 1 ? 'engine.studio.data.fieldCountOne' : 'engine.studio.data.fieldCount', locale, {
            count: fieldIds.length,
          })}
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
                title={t(deleteTitleKey, locale)}
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
      {relatedTable ? (
        <div
          data-testid={`form-designer-related-table-${unCid(containerId)}`}
          className="m-3 flex items-center justify-center rounded-md border border-dashed bg-muted/30 py-3 text-[11px] text-muted-foreground"
        >
          {tFormat('engine.studio.designer.relatedTable', locale, { name: relatedTable })}
        </div>
      ) : (
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
      )}
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
  contributedFields = NO_CONTRIBUTED_FIELDS,
  formView = null,
}: ObjectFormDesignerProps): React.ReactElement {
  const locale = useMetadataLocale();
  const view = React.useMemo(() => readFields(draft.fields), [draft.fields]);
  const fieldGroups = React.useMemo(() => readGroups(draft.fieldGroups), [draft.fieldGroups]);
  // objectstack#30057 — the sections the canvas draws: the form view's when
  // the app opens one, else the object's field groups.
  const formSections = formView?.sections ?? null;
  const onSectionsChange = formView?.onSectionsChange;
  const groups = React.useMemo<DesignerSection[]>(
    () =>
      formSections
        ? formSectionSlots(formSections, fieldGroups)
        : fieldGroups.map((g) => ({
            key: g.key,
            label: typeof g.label === 'string' ? g.label : '',
            name: g.key,
            relatedList: typeof g.relatedList === 'string' ? g.relatedList : undefined,
          })),
    [formSections, fieldGroups],
  );
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

  // objectstack#27069 — a group carrying `relatedList` stands for a related
  // table: it is drawn in its place, but it is no field container (it holds no
  // fields), so drags, keyboard steps and the commit never reach it.
  const tableOf = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) if (g.relatedList) m.set(cid(g.key), g.relatedList);
    return m;
  }, [groups]);
  // objectstack#30057 — on a form view, a field no section lists is not on
  // the form, and its bucket says so.
  const ungroupedKey = formSections ? 'engine.studio.designer.offForm' : 'engine.studio.designer.ungrouped';
  // Section order: declared groups (in order) then the ungrouped bucket.
  const sectionOrder = React.useMemo(() => [...groups.map((g) => cid(g.key)), cid(UNGROUPED)], [groups]);
  // Container order: the same, without the related-table groups.
  const containerOrder = React.useMemo(() => sectionOrder.filter((c) => !tableOf.has(c)), [sectionOrder, tableOf]);
  const labelOf = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const g of groups) {
      const fallback = g.label || g.name || g.key;
      m.set(cid(g.key), objectName && g.name ? sectionLabel(objectName, g.name, fallback) : fallback);
    }
    m.set(cid(UNGROUPED), t(ungroupedKey, locale));
    return m;
  }, [groups, locale, objectName, sectionLabel, ungroupedKey]);

  // objectstack#27516 — the shown fields the platform pins first in the
  // ungrouped bucket (see `settlePinned`), each by its place in the injection.
  // A form view's sections are written as they are, so nothing moves back there.
  const pinRank = React.useMemo(() => {
    if (formSections) return new Map<string, number>();
    const injected = injectedSystemColumnDefs(draft);
    const order = Object.keys(injected);
    const rank = new Map<string, number>();
    for (const e of view.entries) {
      if (isKeptOffLayout(e, systemFieldNames) || !Object.prototype.hasOwnProperty.call(injected, e.name)) continue;
      const ungrouped = { ...e.def };
      delete ungrouped.group;
      if (isInjectedColumnDefinition(ungrouped, injected[e.name])) rank.set(fid(e.name), order.indexOf(e.name));
    }
    return rank;
  }, [draft, view.entries, systemFieldNames, formSections]);

  // Derive container → ordered field ids from the draft (editable fields only;
  // system/audit fields are preserved on write but never shown in the layout).
  // The fields the canvas draws, in object order.
  const shownFields = React.useMemo(
    () => view.entries.filter((e) => !isKeptOffLayout(e, systemFieldNames)).map((e) => e.name),
    [view.entries, systemFieldNames],
  );
  const groupOf = React.useCallback(
    (name: string) => {
      const g = entryByName.get(name)?.def.group;
      return typeof g === 'string' ? g : undefined;
    },
    [entryByName],
  );
  const derived = React.useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const c of containerOrder) map[c] = [];
    if (formSections) {
      // objectstack#30057 — each section's listed fields; the rest are off the form.
      const members = formSectionMembers(formSections, shownFields, groupOf);
      const placed = new Set<string>();
      for (const [key, names] of members) {
        map[cid(key)] = names.map(fid);
        for (const n of names) placed.add(n);
      }
      map[cid(UNGROUPED)] = shownFields.filter((n) => !placed.has(n)).map(fid);
      return map;
    }
    for (const e of view.entries) {
      if (isKeptOffLayout(e, systemFieldNames)) continue;
      const g = typeof e.def.group === 'string' ? e.def.group : '';
      const target = g && map[cid(g)] ? cid(g) : cid(UNGROUPED);
      map[target].push(fid(e.name));
    }
    return settlePinned(map, pinRank);
  }, [view.entries, containerOrder, systemFieldNames, pinRank, formSections, shownFields, groupOf]);

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
        group: labelOf.get(place.container) ?? t(ungroupedKey, locale),
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
      dropSlot: (id, overId) => slot(dropPlaceIn(items, id, overId, pinRank)),
      committedSlotOf: (id) => slot(placeIn(derived, id)),
    };
    return formDndAccessibility(locale, lookups);
  }, [locale, items, derived, labelOf, entryByName, fieldLabelOf, pinRank, ungroupedKey]);

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
      if (formSections && onSectionsChange) {
        // objectstack#30057 — the layout is the form view's: the object's
        // fields are not touched.
        const layout = new Map<string, string[]>();
        for (const g of groups) layout.set(g.key, (next[cid(g.key)] ?? []).map(unFid));
        onSectionsChange(writeFormSectionLayout(formSections, layout, shownFields, fieldGroups, groupOf));
        return;
      }
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
    [
      containerOrder,
      entryByName,
      view,
      systemFieldNames,
      onChange,
      formSections,
      onSectionsChange,
      groups,
      shownFields,
      fieldGroups,
      groupOf,
    ],
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
    const dropped = dropLayout(itemsRef.current, activeIdStr, overId);
    if (!dropped) return;
    // objectstack#27516 — never above a field the next read puts back first.
    const next = settlePinned(dropped, pinRank);
    setItems(next);
    commit(next);
  };

  const newLabel = t('engine.studio.designer.newGroup', locale);
  const addSection = () =>
    formSections && onSectionsChange
      ? onSectionsChange(addFormSection(formSections, newLabel))
      : onChange({ fieldGroups: addGroup(fieldGroups, newLabel) });
  const renameSection = (key: string, label: string) =>
    formSections && onSectionsChange
      ? onSectionsChange(renameFormSection(formSections, key, label))
      : onChange({ fieldGroups: renameGroup(fieldGroups, key, label) });
  const moveSection = (key: string, dir: -1 | 1) =>
    formSections && onSectionsChange
      ? onSectionsChange(moveFormSection(formSections, key, dir))
      : onChange({ fieldGroups: moveGroup(fieldGroups, key, dir) });
  const deleteSection = (key: string) =>
    formSections && onSectionsChange
      ? onSectionsChange(removeFormSection(formSections, key))
      : onChange({ fieldGroups: removeGroup(fieldGroups, key), fields: writeFields(clearFieldGroup(view, key)) });

  const activeEntry = activeId && !activeId.startsWith('g:') ? entryByName.get(unFid(activeId)) : null;

  return (
    <ContributedFieldsContext.Provider value={contributedFields}>
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
            {sectionOrder.map((c) => {
              const isUngrouped = c === cid(UNGROUPED);
              // Hide the ungrouped bucket only when it is empty AND groups exist.
              if (isUngrouped && (items[c]?.length ?? 0) === 0 && groups.length > 0) return null;
              const declaredIdx = groups.findIndex((g) => cid(g.key) === c);
              return (
                <Section
                  key={c}
                  containerId={c}
                  title={labelOf.get(c) ?? t(ungroupedKey, locale)}
                  fieldIds={items[c] ?? []}
                  columns={(declaredIdx >= 0 ? groups[declaredIdx].columns : undefined) ?? formColumns}
                  isDeclared={!isUngrouped}
                  canMoveUp={declaredIdx > 0}
                  canMoveDown={declaredIdx >= 0 && declaredIdx < groups.length - 1}
                  entryByName={entryByName}
                  fieldLabelOf={fieldLabelOf}
                  selectedField={selectedField}
                  onSelectField={onSelectField}
                  selected={!isUngrouped && selectedGroup === unCid(c)}
                  // The group inspector edits a field group; a form view's
                  // section is not one (objectstack#30057).
                  onSelect={!isUngrouped && onSelectGroup && !formSections ? () => onSelectGroup(unCid(c)) : undefined}
                  onRename={(label) => renameSection(unCid(c), label)}
                  onDelete={() => deleteSection(unCid(c))}
                  onMove={(dir) => moveSection(unCid(c), dir)}
                  readOnly={readOnly}
                  relatedTable={tableOf.get(c)}
                  deleteTitleKey={formSections ? 'engine.studio.designer.sectionDeleteTitle' : undefined}
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
    </ContributedFieldsContext.Provider>
  );
}
