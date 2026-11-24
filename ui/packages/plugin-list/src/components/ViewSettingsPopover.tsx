/**
 * ViewSettingsPopover — the list's 视图设置 panel (objectstack#35878).
 *
 * Opened from the trigger beside the view's name on the view bar. Its first
 * level is the content itself, not a menu of entries: the view's name
 * (renamed in place where the host allows it), the columns the view shows
 * (drag to reorder, the eye to hide) and 「+ Add column」 (the hidden fields
 * and the object's other fields, one step away), then, each only when the
 * host offers it, Layout, Group, Row height and Row color, each opening a
 * second level. The footer keeps Save, Restore defaults and the export
 * entries. Sort and Filter are not here: the condition row under the bar
 * carries them.
 *
 * The content is `ViewSettingsContent`, apart from its container: a phone's
 * bottom sheet can hold the same content.
 *
 * Every setting here is the reader's own: this component writes nothing
 * itself, each control hands its change to the host, which keeps it as the
 * reader's preference. The wide toolbar form (`compactToolbar: false`) keeps
 * one button per control in ListView.tsx; content is duplicated between the
 * two forms, so change one, change both.
 *
 * @module
 */

import * as React from 'react';
import {
  cn,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
  GroupingEditor,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from '@object-ui/components';
import {
  SlidersHorizontal,
  Rows4,
  Rows3,
  Rows2,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Download,
  Loader2,
  Undo2,
  Save,
} from 'lucide-react';
import { TOOLBAR_TEXT_TRIGGER } from '../listToolbarRow';
import { ViewSwitcherFaceContext } from '../ViewSwitcher';
import { FieldList, type FieldListItem } from '../conditions/FieldList';

/**
 * A bar or panel control's touch size below `sm`: 44 px on both sides (WCAG
 * 2.5.5), so a phone's finger lands on it. At `sm` and up the compact sizes
 * stay as they are.
 */
export const PHONE_TOUCH_TARGET = 'max-sm:h-11 max-sm:min-w-11';

const BELOW_SM_QUERY = '(max-width: 639.98px)';

/**
 * Whether the viewport is below `sm`, for the one thing a class cannot carry:
 * a popover's collision padding, which keeps a phone-width panel 16 px from
 * both screen edges. `false` where `matchMedia` is missing (server, tests).
 */
export function useBelowSm(): boolean {
  return React.useSyncExternalStore(
    (onChange) => {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(BELOW_SM_QUERY);
      mql.addEventListener?.('change', onChange);
      return () => mql.removeEventListener?.('change', onChange);
    },
    () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(BELOW_SM_QUERY).matches,
    () => false,
  );
}

/** The 16 px a phone-width popover keeps from each screen edge (`w-[calc(100vw-2rem)]`). */
export const PHONE_POPOVER_GUTTER = 16;

export interface ViewSettingsField {
  name: string;
  label?: string;
  /**
   * `false` when the server refuses the field as a group key: the object
   * declares it virtual (a `formula`, computed on read with no stored column),
   * which the aggregate door refuses with `400 INVALID_FIELD`. The host judges
   * it with the spec's `isVirtualSearchField`, the predicate that door calls.
   * Absent means groupable.
   */
  groupable?: boolean;
  /**
   * The field's type in the object's declaration, and whether it holds many
   * values (`multiple: true`). The Group editors offer a field by them
   * (objectstack#36204); absent ⇒ not offered there while types are known.
   */
  type?: string;
  multiple?: boolean;
}

/**
 * objectstack#36204 — the types a list can be grouped by, as the maintainer
 * set them: single select and radio (a status is a `select`), a tick
 * (`boolean`, `toggle`), a person (`user`) and a linked record (`lookup`,
 * `master_detail`, `tree`), each holding one value. Text, numbers, dates and
 * many-valued fields are not offered.
 */
const GROUPABLE_TYPES = new Set([
  'select', 'radio',
  'boolean', 'toggle',
  'user', 'lookup', 'master_detail', 'tree',
]);

/** Whether the Group editors offer a field of this declaration (`GROUPABLE_TYPES`, one value). */
export function isGroupableField(f: Pick<ViewSettingsField, 'type' | 'multiple'>): boolean {
  return !!f.type && GROUPABLE_TYPES.has(f.type) && f.multiple !== true;
}

/**
 * The fields a Group editor offers: every field but those the server refuses
 * as a group key (`groupable: false`). Both Group editors, this panel's and the
 * wide toolbar's, read it, so the two forms offer the same fields. A level that
 * already names a withheld field still shows: `GroupingEditor` mounts a value
 * its options do not carry, so the level can be removed.
 *
 * objectstack#36204 — and, while the fields' types are known (`typesKnown`,
 * the default), only those of a groupable type (`isGroupableField`), in the
 * reader's column order (`order`, as `orderFields` reads it). With no type
 * known at all (the host has no object definition) every field is offered,
 * as before: nothing tells them apart.
 */
export function groupFieldOptions(
  fields: readonly ViewSettingsField[],
  order?: readonly string[],
  typesKnown = true,
): Array<{ value: string; label: string }> {
  return orderFields(fields, order)
    .filter((f) => f.groupable !== false && (!typesKnown || isGroupableField(f)))
    .map((f) => ({ value: f.name, label: f.label || f.name }));
}

export type ViewSettingsDensityMode = 'compact' | 'comfortable' | 'spacious';

export interface ViewSettingsDensity {
  mode: ViewSettingsDensityMode;
  cycle: () => void;
  /**
   * Choose one height. Wired ⇒ Row height is a second level listing the three
   * heights; absent ⇒ the row steps to the next height on each click.
   */
  setMode?: (mode: ViewSettingsDensityMode) => void;
}

/**
 * The view's name at the top of the menu. `onRename` is passed only to a
 * reader who may rename this view (the owner of one of their own views, or a
 * reader who may edit the shared view); without it the name is shown, not
 * edited. Resolves `false` when the rename was refused (the host has said
 * why), and the field then shows the name it had.
 */
export interface ViewSettingsViewName {
  label: string;
  onRename?: (next: string) => boolean | Promise<boolean>;
}

/** One on/off setting of the panel: its value, and the writer of a change. */
export interface ViewSettingsToggle {
  value: boolean;
  onChange: (next: boolean) => void;
}

/**
 * objectstack#36370 — a lane statistic as the board's `kanban.summary` holds
 * it: one of the list footer's calculations (`ColumnSummary`), over `field`
 * where the calculation reads one. `null` = none.
 */
export interface ViewSettingsKanbanSummaryValue {
  type: string;
  field?: string;
}

/**
 * objectstack#36370 — the board's own settings, which the panel shows IN
 * PLACE OF the table's columns, grouping, row height and row colour while the
 * view is a kanban. Every part is the view's (the host holds a change in the
 * list's draft); the panel writes nothing itself. A part whose writer is
 * absent is shown and not changed; a part that is absent is not shown.
 */
export interface ViewSettingsKanban {
  /** The field the lanes come from, and the fields that may be it (objectstack#36204's range). */
  laneField?: string;
  laneFieldOptions: ReadonlyArray<{ value: string; label: string }>;
  onLaneFieldChange?: (field: string) => void;
  /** Every lane the lane field offers, in its own order. */
  lanes: ReadonlyArray<{ value: string; label: string }>;
  /** The lanes the board draws, in board order. */
  shownLanes: readonly string[];
  onShownLanesChange?: (lanes: string[]) => void;
  /** The fields each card shows, in order, and the fields that may be added. */
  cardFields: readonly string[];
  cardFieldCandidates: readonly ViewSettingsField[];
  onCardFieldsChange?: (fields: string[]) => void;
  /** Whether a card names each field beside its value. */
  showFieldLabels?: ViewSettingsToggle;
  /** Whether a card leaves out a field that holds nothing. */
  hideEmptyFields?: ViewSettingsToggle;
  /** The statistic each lane shows at its foot: none, a count, or a number field's sum or average. */
  summary?: {
    value: ViewSettingsKanbanSummaryValue | null;
    numberFields: ReadonlyArray<{ value: string; label: string }>;
    onChange: (next: ViewSettingsKanbanSummaryValue | null) => void;
  };
}

export interface ViewSettingsPopoverProps {
  t: (key: string, opts?: any) => string;
  allFields: ViewSettingsField[];

  /**
   * objectstack#36370 — the board's own settings. Present ⇒ the panel shows
   * them instead of the table's 「Shown columns」, Group, Row height and Row
   * colour; Layout, the name and the footer stay.
   */
  kanban?: ViewSettingsKanban;

  /** The view's name, at the top of the menu. Absent ⇒ no name row. */
  viewName?: ViewSettingsViewName;

  /**
   * The order the reader's columns are drawn in: the same list the grid's
   * header drag keeps (its column state's `order`, by column key). Names it
   * does not list keep the `allFields` order after the listed ones.
   */
  fieldOrder?: readonly string[];
  /** A field's type (the object's declaration), for the icon the Fields level draws beside it. */
  fieldType?: (name: string) => string | undefined;
  /**
   * Store a new column order: the whole list, every field of `allFields`
   * (hidden ones in place) and any other key `fieldOrder` held, kept as it
   * was. Wired ⇒ the shown fields can be dragged; the host writes it where the
   * header drag writes, so the two are one state.
   */
  onFieldOrderChange?: (order: string[]) => void;

  /**
   * The Layout row: the visualization switcher. The host passes it only when
   * the list offers more than one visualization, as a function of `closeMenu`:
   * choosing a layout completes the choice, so the host's switcher calls
   * `closeMenu` when a layout is picked (objectui#12621). The panel's toggles
   * (row numbers, inline edit, density, hidden fields) never close it.
   *
   * The menu draws the element twice through `ViewSwitcherFaceContext`: as
   * the current layout's name on the Layout row (`value`) and as the list of
   * layouts on the second level (`list`), the faces `ViewSwitcherDropdown`
   * draws.
   */
  layout?: (closeMenu: () => void) => React.ReactNode;

  showGroup?: boolean;
  groupingConfig?: any;
  setGroupingConfig?: (next: any) => void;
  /**
   * objectstack#36204 — the fields the Group level offers, as the host works
   * them out for both Group editors, and whether it is still reading their
   * types. Absent ⇒ `groupFieldOptions(allFields, fieldOrder)`.
   */
  groupOptions?: Array<{ value: string; label: string }>;
  groupOptionsLoading?: boolean;
  /**
   * objectstack#36204 — the label of a field a grouping level holds, as the
   * host knows it: `groupOptions` reach past the columns, so a level can hold
   * a field `allFields` does not carry. Absent, or answering `undefined`,
   * the column's label, else the field's name.
   */
  groupFieldLabel?: (field: string) => string | undefined;

  showColor?: boolean;
  rowColorConfig?: { field: string; colors?: Record<string, string> } | undefined;
  setRowColorConfig?: (next: { field: string; colors: Record<string, string> } | undefined) => void;

  showDensity?: boolean;
  density?: ViewSettingsDensity;

  showHideFields?: boolean;
  hiddenFields?: Set<string>;
  updateHiddenFields?: (next: Set<string>) => void;
  /**
   * objectstack#30077 — the object's fields that are not columns of the list,
   * drawn unticked after `allFields` in the Hide Fields section; ticking one
   * calls `onAddField`, which adds it to the reader's own list. The host
   * passes only fields the caller may read. Absent or empty ⇒ the section
   * lists `allFields` alone, as before.
   */
  addableFields?: ViewSettingsField[];
  onAddField?: (name: string) => void;

  /**
   * How many of the settings above differ from the view's own. Drawn as the
   * trigger's count; zero draws none. The host computes it — only it knows
   * what the view declared.
   */
  changedCount?: number;
  /** Hand every changed setting back to the view's own. Drawn when wired. */
  onReset?: () => void;
  /**
   * Whether 恢复默认 is disabled. Defaults to "nothing counted"
   * (`changedCount === 0`); a host that owns the reset and wires it only
   * while the list differs from the view passes `false`.
   */
  resetDisabled?: boolean;
  /**
   * 保存: the list on screen becomes the open view's stored body. A host
   * wires it only for a view the reader owns and may update, and only while
   * the list differs from it (objectstack#30073). Drawn beside 恢复默认.
   */
  onSave?: () => void;

  /** Footer: one export entry per format. Drawn when there is a format. */
  exportFormats?: string[];
  onExport?: (format: string) => void;
  exportBusy?: boolean;
  exportError?: string | null;
}

/** The second levels of the menu; `root` is the menu itself. */
type MenuPage =
  | 'root' | 'layout' | 'fields' | 'group' | 'color' | 'rowHeight'
  // objectstack#36370 — a board's second levels.
  | 'laneField' | 'lanes' | 'cardFields' | 'laneSummary';

/**
 * One row of the menu: the setting's name on the left, its current value on
 * the right, and a chevron, for a row that opens a second level.
 */
function MenuRow({
  label,
  value,
  onOpen,
  testId,
}: {
  label: string;
  value?: React.ReactNode;
  onOpen: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid={testId}
      className={cn(
        'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted max-sm:min-h-11',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <span className="shrink-0 text-foreground">{label}</span>
      <span className="ml-auto flex min-w-0 items-center gap-1 text-muted-foreground" data-testid={`${testId}-value`}>
        {value != null && <span className="min-w-0 truncate">{value}</span>}
        <ChevronRight className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </span>
    </button>
  );
}

/**
 * A second level: a back control, worded with the level's title, over the
 * level's content. `action` is drawn at the right of the title row.
 */
function SubPage({
  title,
  onBack,
  action,
  children,
  testId,
}: {
  title: string;
  onBack: () => void;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="flex items-center gap-1 border-b px-1 py-1">
        <button
          type="button"
          onClick={onBack}
          data-testid="options-back"
          className={cn(
            'flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-sm font-medium hover:bg-muted max-sm:min-h-11',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <ChevronLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </button>
        {action && <div className="ml-auto pr-1">{action}</div>}
      </div>
      {children}
    </div>
  );
}

/** The item a colour field none of the options carries is shown by. */
const OUTSIDE_OPTIONS = 'outside';

/**
 * objectui#11865 — the "Color by field" picker, drawn with the shared `Select`,
 * the control the rest of the console picks with. It used to be a
 * browser-native `<select>`. What a pick writes is unchanged: `onPick` receives
 * the picked option's own value, the string the native control's `change`
 * carried, and the caller turns it into the same row-colour config as before.
 * Re-picking the current option writes nothing, as it did there.
 *
 * - Items carry their option's INDEX, not its value: "None" is the option whose
 *   value is `''`, which `SelectItem` refuses.
 * - A colour field none of the options carries gets an item of its own,
 *   labelled with the field, so the trigger shows what the view holds. The
 *   native control showed "None" there. Picking that item writes nothing.
 */
function ColorFieldPicker({
  value,
  options,
  onPick,
}: {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onPick: (value: string) => void;
}) {
  const at = options.findIndex((o) => o.value === value);
  return (
    <Select
      value={at !== -1 ? String(at) : OUTSIDE_OPTIONS}
      onValueChange={(token) => {
        // `undefined` for the outside item: it is the view's own field, so there is nothing to write.
        const picked = options[Number(token)];
        if (picked) onPick(picked.value);
      }}
    >
      <SelectTrigger className="h-8 rounded px-2 text-xs max-sm:h-11" data-testid="color-field-select">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {at === -1 && <SelectItem value={OUTSIDE_OPTIONS}>{value}</SelectItem>}
        {options.map((o, i) => (
          <SelectItem key={`${i}:${o.value}`} value={String(i)}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/**
 * The fields of `allFields`, in the order the reader's columns are drawn:
 * the names `order` lists first, in its order, then the rest in their own.
 */
export function orderFields(
  fields: readonly ViewSettingsField[],
  order: readonly string[] | undefined,
): ViewSettingsField[] {
  if (!order || order.length === 0) return [...fields];
  const rank = new Map(order.map((name, i) => [name, i]));
  const rankOf = (fieldName: string): number => rank.get(fieldName) ?? Number.MAX_SAFE_INTEGER;
  return fields
    .map((entry, i) => ({ entry, i }))
    .sort((a, b) => rankOf(a.entry.name) - rankOf(b.entry.name) || a.i - b.i)
    .map(({ entry }) => entry);
}

/** The words a density mode is shown by, on the Row height row and its level. */
function rowHeightLabel(t: ViewSettingsPopoverProps['t'], mode: ViewSettingsDensityMode): string {
  return mode === 'compact'
    ? t('list.optionsMenu.rowHeightCompact', { defaultValue: 'Compact' })
    : mode === 'comfortable'
      ? t('list.optionsMenu.rowHeightStandard', { defaultValue: 'Standard' })
      : t('list.optionsMenu.rowHeightSpacious', { defaultValue: 'Spacious' });
}

const ROW_HEIGHT_MODES: readonly ViewSettingsDensityMode[] = ['compact', 'comfortable', 'spacious'];

/**
 * The view's name at the top of the menu, renamed in place: Enter or leaving
 * the field keeps a changed, non-blank name; Escape puts the name back. A
 * rename the host refuses shows the name it had.
 */
function ViewNameField({ t, viewName }: { t: ViewSettingsPopoverProps['t']; viewName: ViewSettingsViewName }) {
  const { label, onRename } = viewName;
  const [draft, setDraft] = React.useState(label);
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => setDraft(label), [label]);
  const title = t('list.optionsMenu.viewName', { defaultValue: 'View name' });
  if (!onRename) {
    return (
      <div className="border-b px-3 py-2 text-sm font-medium break-words" data-testid="options-view-name">
        {label}
      </div>
    );
  }
  const commit = async () => {
    const next = draft.trim();
    if (!next || next === label) {
      setDraft(label);
      return;
    }
    setBusy(true);
    try {
      const ok = await onRename(next);
      if (!ok) setDraft(label);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="border-b p-2">
      <Input
        value={draft}
        disabled={busy}
        aria-label={title}
        title={title}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { void commit(); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            // Escape reverts the name; the menu stays open.
            e.stopPropagation();
            setDraft(label);
          }
        }}
        className="h-8 text-sm font-medium max-sm:h-11"
        data-testid="options-view-name-input"
      />
    </div>
  );
}

/**
 * The Fields level: the list's shared field list (`../conditions/FieldList`,
 * the one the Filter and Sort controls open) as the view's field manager. A
 * search box; the shown fields in column order, reordered by drag or by a grip
 * handle and the arrow keys, each hidden by its eye; then the view's columns
 * the reader hid and the object's fields they may add, each shown or added
 * with one click. Every change applies at once. `allFields` holds only the
 * fields the reader may read: the host withholds the rest.
 */
function FieldsPage({
  allFields,
  hiddenFields,
  updateHiddenFields,
  addableFields,
  onAddField,
  fieldOrder,
  onFieldOrderChange,
  fieldType,
}: {
  allFields: readonly ViewSettingsField[];
  hiddenFields: Set<string>;
  updateHiddenFields: (next: Set<string>) => void;
  addableFields?: readonly ViewSettingsField[];
  onAddField?: (name: string) => void;
  fieldOrder?: readonly string[];
  onFieldOrderChange?: (order: string[]) => void;
  fieldType?: (name: string) => string | undefined;
}) {
  const addable = onAddField ? addableFields ?? [] : [];
  const columns = new Set(allFields.map((f) => f.name));
  const items: FieldListItem[] = [
    ...allFields,
    ...addable.filter((f) => !columns.has(f.name)),
  ].map((f) => ({ value: f.name, label: f.label || f.name, type: fieldType?.(f.name) }));
  const shown = orderFields(allFields, fieldOrder).filter((f) => !hiddenFields.has(f.name)).map((f) => f.name);
  return (
    <FieldList
      fields={items}
      shownFields={shown}
      order={fieldOrder}
      onOrderChange={onFieldOrderChange}
      onHide={(name) => updateHiddenFields(new Set([...hiddenFields, name]))}
      onShow={(name) => updateHiddenFields(new Set([...hiddenFields].filter((n) => n !== name)))}
      addable={addable.map((f) => f.name)}
      onAdd={onAddField}
      testId="options-fields"
      className="w-full"
    />
  );
}

/**
 * The 视图设置 panel's content (objectstack#35878), apart from what holds it:
 * the desktop popover below is one container, and a phone's bottom sheet can
 * be another. It reads every value from its props and hands every change back
 * through them; it writes nothing itself.
 */
export function ViewSettingsContent(props: ViewSettingsPopoverProps & { closeMenu: () => void }) {
  const {
    t,
    closeMenu,
    allFields,
    viewName,
    fieldOrder,
    onFieldOrderChange,
    fieldType,
    layout,
    showGroup,
    groupingConfig,
    setGroupingConfig,
    groupOptions,
    groupOptionsLoading,
    groupFieldLabel,
    showColor,
    rowColorConfig,
    setRowColorConfig,
    showDensity,
    density,
    showHideFields,
    hiddenFields,
    updateHiddenFields,
    addableFields,
    onAddField,
    changedCount = 0,
    onReset,
    resetDisabled,
    onSave,
    exportFormats,
    onExport,
    exportBusy,
    exportError,
    kanban,
  } = props;

  // The panel opens on its first level every time: the content unmounts
  // with the panel that holds it.
  const [page, setPage] = React.useState<MenuPage>('root');
  const back = () => setPage('root');

  const hasExport = !!onExport && !!exportFormats && exportFormats.length > 0;
  const hasFooter = !!onSave || !!onReset || hasExport;

  const fieldLabel = (name: string) => allFields.find((f) => f.name === name)?.label || name;
  const groupLevelLabel = (name: string) => groupFieldLabel?.(name) || fieldLabel(name);
  const none = t('list.none', { defaultValue: 'None' });
  const groupFields: string[] = Array.isArray(groupingConfig?.fields)
    ? groupingConfig.fields.map((f: { field?: string }) => f?.field).filter((f: unknown): f is string => typeof f === 'string' && !!f)
    : [];
  const fieldsOffered = !!showHideFields && !!hiddenFields && !!updateHiddenFields;
  const DensityIcon =
    density?.mode === 'compact' ? Rows4 : density?.mode === 'comfortable' ? Rows3 : Rows2;

  const titles: Record<'layout' | 'fields' | 'group' | 'color' | 'rowHeight', string> = {
    layout: t('list.layout', { defaultValue: 'Layout' }),
    fields: t('list.optionsMenu.addColumn', { defaultValue: 'Add column' }),
    group: t('list.group', { defaultValue: 'Group' }),
    color: t('list.rowColor', { defaultValue: 'Row Color' }),
    rowHeight: t('list.optionsMenu.rowHeight', { defaultValue: 'Row height' }),
  };
  const clearAction = (onClear: () => void, testId: string) => (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs max-sm:h-11" onClick={onClear} data-testid={testId}>
      {t('list.clear', { defaultValue: 'Clear' })}
    </Button>
  );

  // The columns the view shows, in place on the first level: drag to reorder,
  // the eye to hide (objectstack#35878). The hidden ones and the fields that
  // are not columns yet are one step away, behind 「+ Add column」.
  const shownColumns = fieldsOffered
    ? orderFields(allFields, fieldOrder).filter((f) => !hiddenFields!.has(f.name))
    : [];

  // objectstack#36370 — a board's first level: its lane field, the lanes it
  // shows, the card fields in place (drag to reorder, the eye to hide) with
  // 「+ Add field」 one step away, the card toggles and the lane statistic.
  // The table's columns, Group, Row height and Row colour are not offered.
  const kanbanTitles = {
    laneField: t('list.optionsMenu.kanbanLaneField', { defaultValue: 'Columns by' }),
    lanes: t('list.optionsMenu.kanbanLanes', { defaultValue: 'Visible columns' }),
    cardFields: t('list.optionsMenu.kanbanCardFields', { defaultValue: 'Card fields' }),
    addCardField: t('list.optionsMenu.kanbanAddCardField', { defaultValue: 'Add field' }),
    showFieldLabels: t('list.optionsMenu.kanbanShowFieldLabels', { defaultValue: 'Show field names' }),
    hideEmptyFields: t('list.optionsMenu.kanbanHideEmptyFields', { defaultValue: 'Hide empty fields' }),
    summary: t('list.optionsMenu.kanbanSummary', { defaultValue: 'Column summary' }),
  };
  const kanbanFieldLabel = (name: string) =>
    kanban?.cardFieldCandidates.find((f) => f.name === name)?.label || fieldLabel(name);
  const summaryWord = (type: string) =>
    type === 'count'
      ? t('grid.summary.count', { defaultValue: 'Count' })
      : type === 'sum'
        ? t('grid.summary.sum', { defaultValue: 'Sum' })
        : type;
  const summaryText = (value: ViewSettingsKanbanSummaryValue | null): string => {
    if (!value || value.type === 'none') return none;
    if (!value.field || value.type === 'count') return summaryWord(value.type);
    const label = kanban?.summary?.numberFields.find((f) => f.value === value.field)?.label || kanbanFieldLabel(value.field);
    return `${summaryWord(value.type)} · ${label}`;
  };
  const toggleRow = (label: string, toggle: ViewSettingsToggle, testId: string) => (
    <label
      className="flex w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-muted max-sm:min-h-11"
      data-testid={testId}
    >
      <span className="shrink-0 text-foreground">{label}</span>
      <Switch
        className="ml-auto h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&>span[data-state=checked]]:translate-x-4"
        checked={toggle.value}
        onCheckedChange={(next) => toggle.onChange(next === true)}
        aria-label={label}
        data-testid={`${testId}-switch`}
      />
    </label>
  );
  const kanbanRootMenu = kanban ? (
    <div data-testid="options-menu">
      {viewName && <ViewNameField t={t} viewName={viewName} />}
      <div className="border-b p-1" data-testid="options-kanban-lanes">
        <MenuRow
          label={kanbanTitles.laneField}
          value={kanban.laneField
            ? kanban.laneFieldOptions.find((o) => o.value === kanban.laneField)?.label || fieldLabel(kanban.laneField)
            : none}
          onOpen={() => setPage('laneField')}
          testId="options-row-lane-field"
        />
        {kanban.lanes.length > 0 && (
          <MenuRow
            label={kanbanTitles.lanes}
            value={`${kanban.shownLanes.length} / ${kanban.lanes.length}`}
            onOpen={() => setPage('lanes')}
            testId="options-row-lanes"
          />
        )}
      </div>
      <div className="border-b p-1" data-testid="options-card-fields">
        <p className="px-2 pb-0.5 pt-1 text-xs text-muted-foreground">{kanbanTitles.cardFields}</p>
        <FieldList
          fields={kanban.cardFields.map((name) => ({ value: name, label: kanbanFieldLabel(name), type: fieldType?.(name) }))}
          shownFields={kanban.cardFields}
          order={kanban.cardFields}
          onOrderChange={kanban.onCardFieldsChange
            ? (order) => kanban.onCardFieldsChange!(order.filter((name) => kanban.cardFields.includes(name)))
            : undefined}
          onHide={kanban.onCardFieldsChange
            ? (name) => kanban.onCardFieldsChange!(kanban.cardFields.filter((n) => n !== name))
            : undefined}
          searchable={false}
          testId="options-card-fields-list"
          className="w-full"
        />
        {kanban.onCardFieldsChange && (
          <button
            type="button"
            onClick={() => setPage('cardFields')}
            data-testid="options-add-card-field"
            className={cn(
              'flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground max-sm:min-h-11',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {kanbanTitles.addCardField}
          </button>
        )}
      </div>
      {(kanban.showFieldLabels || kanban.hideEmptyFields) && (
        <div className="border-b p-1" data-testid="options-card-toggles">
          {kanban.showFieldLabels && toggleRow(kanbanTitles.showFieldLabels, kanban.showFieldLabels, 'options-toggle-field-labels')}
          {kanban.hideEmptyFields && toggleRow(kanbanTitles.hideEmptyFields, kanban.hideEmptyFields, 'options-toggle-hide-empty')}
        </div>
      )}
      <div className="p-1">
        {layout && (
          <MenuRow
            label={titles.layout}
            value={<ViewSwitcherFaceContext.Provider value="value">{layout(closeMenu)}</ViewSwitcherFaceContext.Provider>}
            onOpen={() => setPage('layout')}
            testId="options-row-layout"
          />
        )}
        {kanban.summary && (
          <MenuRow
            label={kanbanTitles.summary}
            value={summaryText(kanban.summary.value)}
            onOpen={() => setPage('laneSummary')}
            testId="options-row-lane-summary"
          />
        )}
      </div>
    </div>
  ) : null;

  /** A one-of-many level: each option a radio row, the current one ticked. */
  const radioLevel = (
    label: string,
    options: ReadonlyArray<{ value: string; label: string }>,
    current: string | undefined,
    onPick: (value: string) => void,
    testId: string,
  ) => (
    <div role="radiogroup" aria-label={label} className="p-1">
      {options.map((option) => {
        const active = option.value === current;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onPick(option.value)}
            data-testid={`${testId}-${option.value}`}
            className={cn(
              'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted max-sm:min-h-11',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'font-medium text-foreground' : 'text-foreground/90',
            )}
          >
            <span className="flex-1 truncate">{option.label}</span>
            {active && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );

  const rootMenu = kanbanRootMenu ?? (
    <div data-testid="options-menu">
      {viewName && <ViewNameField t={t} viewName={viewName} />}
      {fieldsOffered && (
        <div className="border-b p-1" data-testid="options-columns">
          <p className="px-2 pb-0.5 pt-1 text-xs text-muted-foreground">
            {t('list.optionsMenu.shownColumns', { defaultValue: 'Shown columns' })}
          </p>
          <FieldList
            fields={shownColumns.map((f) => ({ value: f.name, label: f.label || f.name, type: fieldType?.(f.name) }))}
            shownFields={shownColumns.map((f) => f.name)}
            order={fieldOrder}
            onOrderChange={onFieldOrderChange}
            onHide={(name) => updateHiddenFields!(new Set([...hiddenFields!, name]))}
            searchable={false}
            testId="options-columns-list"
            className="w-full"
          />
          <button
            type="button"
            onClick={() => setPage('fields')}
            data-testid="options-add-column"
            className={cn(
              'flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground max-sm:min-h-11',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {titles.fields}
          </button>
        </div>
      )}
      <div className="p-1">
        {layout && (
          <MenuRow
            label={titles.layout}
            value={<ViewSwitcherFaceContext.Provider value="value">{layout(closeMenu)}</ViewSwitcherFaceContext.Provider>}
            onOpen={() => setPage('layout')}
            testId="options-row-layout"
          />
        )}
        {showGroup && setGroupingConfig && (
          <MenuRow
            label={titles.group}
            value={groupFields.length > 0 ? groupFields.map(groupLevelLabel).join(' › ') : none}
            onOpen={() => setPage('group')}
            testId="options-row-group"
          />
        )}
        {showDensity && density && (density.setMode ? (
          <MenuRow
            label={titles.rowHeight}
            value={rowHeightLabel(t, density.mode)}
            onOpen={() => setPage('rowHeight')}
            testId="options-row-row-height"
          />
        ) : (
          // A host that can only step through the heights gets a row that steps.
          <button
            type="button"
            onClick={density.cycle}
            title={t('grid.toolbar.densityCycleShortHint', { defaultValue: 'Click to cycle' })}
            data-testid="view-settings-density-cycle"
            className={cn(
              'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted max-sm:min-h-11',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            <span className="shrink-0">{titles.rowHeight}</span>
            <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              <DensityIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {rowHeightLabel(t, density.mode)}
            </span>
          </button>
        ))}
        {showColor && setRowColorConfig && (
          <MenuRow
            label={titles.color}
            value={rowColorConfig ? fieldLabel(rowColorConfig.field) : none}
            onOpen={() => setPage('color')}
            testId="options-row-color"
          />
        )}
      </div>
    </div>
  );

  let body: React.ReactNode = rootMenu;
  if (kanban && page === 'laneField') {
    body = (
      <SubPage title={kanbanTitles.laneField} onBack={back} testId="options-page-lane-field">
        {kanban.laneFieldOptions.length > 0
          ? radioLevel(kanbanTitles.laneField, kanban.laneFieldOptions, kanban.laneField, (field) => {
              if (field !== kanban.laneField) kanban.onLaneFieldChange?.(field);
              back();
            }, 'options-lane-field')
          : (
            <p className="px-3 py-2 text-xs text-muted-foreground" data-testid="options-lane-field-none">
              {t('list.noGroupableFields', { defaultValue: 'No field here can group the list' })}
            </p>
          )}
      </SubPage>
    );
  } else if (kanban && page === 'lanes') {
    const shown = kanban.shownLanes;
    const write = kanban.onShownLanesChange;
    body = (
      <SubPage
        title={kanbanTitles.lanes}
        onBack={back}
        testId="options-page-lanes"
        action={write && shown.length < kanban.lanes.length
          ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs max-sm:h-11"
              onClick={() => write([...shown, ...kanban.lanes.map((l) => l.value).filter((v) => !shown.includes(v))])}
              data-testid="options-lanes-show-all"
            >
              {t('list.showAll', { defaultValue: 'Show all' })}
            </Button>
          )
          : undefined}
      >
        <FieldList
          fields={kanban.lanes.map((lane) => ({ value: lane.value, label: lane.label }))}
          shownFields={shown}
          order={shown}
          onOrderChange={write ? (order) => write(order.filter((v) => shown.includes(v))) : undefined}
          // The board keeps at least one lane: the last one shown has no eye.
          onHide={write && shown.length > 1 ? (value) => write(shown.filter((v) => v !== value)) : undefined}
          onShow={write ? (value) => write([...shown.filter((v) => v !== value), value]) : undefined}
          searchable={kanban.lanes.length > 8}
          hiddenTitle={t('list.optionsMenu.kanbanHiddenLanes', { defaultValue: 'Hidden columns' })}
          // The view's lanes pick lanes, not records (#28211): say where a
          // hidden lane's cards go.
          footer={(
            <p className="px-3 pb-2 text-xs text-muted-foreground" data-testid="options-lanes-hidden-hint">
              {t('list.optionsMenu.kanbanHiddenLanesHint', { defaultValue: 'Cards of a hidden column show under Uncategorized.' })}
            </p>
          )}
          typeIcons={false}
          testId="options-lanes"
          className="w-full"
        />
      </SubPage>
    );
  } else if (kanban && page === 'cardFields' && kanban.onCardFieldsChange) {
    const write = kanban.onCardFieldsChange;
    const shown = kanban.cardFields;
    body = (
      <SubPage title={kanbanTitles.addCardField} onBack={back} testId="options-page-card-fields">
        <FieldList
          fields={kanban.cardFieldCandidates.map((f) => ({ value: f.name, label: f.label || f.name, type: fieldType?.(f.name) }))}
          shownFields={shown}
          order={shown}
          onOrderChange={(order) => write(order.filter((name) => shown.includes(name)))}
          onHide={(name) => write(shown.filter((n) => n !== name))}
          onShow={(name) => write([...shown.filter((n) => n !== name), name])}
          testId="options-card-field-candidates"
          className="w-full"
        />
      </SubPage>
    );
  } else if (kanban?.summary && page === 'laneSummary') {
    const summary = kanban.summary;
    const options: Array<{ value: string; label: string; pick: ViewSettingsKanbanSummaryValue | null }> = [
      { value: 'none', label: none, pick: null },
      { value: 'count', label: summaryWord('count'), pick: { type: 'count' } },
      // objectstack#36370 — what the board computes (`KanbanLaneSummarySchema`):
      // a count, or a number field's sum.
      ...summary.numberFields.map((f) => ({
        value: `sum:${f.value}`,
        label: `${summaryWord('sum')} · ${f.label}`,
        pick: { type: 'sum', field: f.value },
      })),
    ];
    const current = !summary.value || summary.value.type === 'none'
      ? 'none'
      : summary.value.type === 'count' ? 'count' : `${summary.value.type}:${summary.value.field ?? ''}`;
    body = (
      <SubPage title={kanbanTitles.summary} onBack={back} testId="options-page-lane-summary">
        {radioLevel(kanbanTitles.summary, options, current, (value) => {
          const picked = options.find((o) => o.value === value);
          if (picked && value !== current) summary.onChange(picked.pick);
          back();
        }, 'options-lane-summary')}
      </SubPage>
    );
  } else if (page === 'layout' && layout) {
    body = (
      <SubPage title={titles.layout} onBack={back} testId="options-page-layout">
        <ViewSwitcherFaceContext.Provider value="list">{layout(closeMenu)}</ViewSwitcherFaceContext.Provider>
      </SubPage>
    );
  } else if (page === 'fields' && fieldsOffered) {
    body = (
      <SubPage
        title={titles.fields}
        onBack={back}
        testId="options-page-fields"
        action={hiddenFields!.size > 0
          ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs max-sm:h-11"
              onClick={() => updateHiddenFields!(new Set())}
              data-testid="options-fields-show-all"
            >
              {t('list.showAll', { defaultValue: 'Show all' })}
            </Button>
          )
          : undefined}
      >
        <FieldsPage
          allFields={allFields}
          hiddenFields={hiddenFields!}
          updateHiddenFields={updateHiddenFields!}
          addableFields={addableFields}
          onAddField={onAddField}
          fieldOrder={fieldOrder}
          fieldType={fieldType}
          onFieldOrderChange={onFieldOrderChange}
        />
      </SubPage>
    );
  } else if (page === 'group' && showGroup && setGroupingConfig) {
    body = (
      <SubPage
        title={titles.group}
        onBack={back}
        testId="options-page-group"
        action={groupingConfig ? clearAction(() => setGroupingConfig(undefined), 'options-group-clear') : undefined}
      >
        <div className="p-3">
          <GroupingEditor
            value={groupingConfig as any}
            fieldOptions={groupOptions ?? groupFieldOptions(allFields, fieldOrder)}
            askFieldOnAdd
            fieldOptionsLoading={groupOptionsLoading}
            fieldLabel={groupLevelLabel}
            maxLevels={3}
            labels={{
              addGroup: t('list.addGroup', 'Add group field'),
              collapseTitle: t('list.collapsedByDefault', 'Collapsed by default'),
              removeTitle: t('list.removeGroup', 'Remove'),
              noFields: t('list.noGroupableFields', { defaultValue: 'No field here can group the list' }),
            }}
            onChange={(next) => setGroupingConfig(next as any)}
          />
        </div>
      </SubPage>
    );
  } else if (page === 'color' && showColor && setRowColorConfig) {
    // `list.rowColor` names this level: it is the counterpart of the wide
    // toolbar's Row color panel, which takes the same key (objectui#4118).
    body = (
      <SubPage
        title={titles.color}
        onBack={back}
        testId="options-page-color"
        action={rowColorConfig ? clearAction(() => setRowColorConfig(undefined), 'options-color-clear') : undefined}
      >
        <div className="p-3">
          <label className="mb-1 block text-xs text-muted-foreground">
            {t('list.colorByField', { defaultValue: 'Color by field' })}
          </label>
          <ColorFieldPicker
            value={rowColorConfig?.field || ''}
            options={[
              { value: '', label: none },
              ...allFields.map((field) => ({ value: field.name, label: field.label || field.name })),
            ]}
            onPick={(field) => {
              if (!field) {
                setRowColorConfig(undefined);
              } else {
                setRowColorConfig({ field, colors: rowColorConfig?.colors || {} });
              }
            }}
          />
        </div>
      </SubPage>
    );
  } else if (page === 'rowHeight' && density?.setMode) {
    const setMode = density.setMode;
    body = (
      <SubPage title={titles.rowHeight} onBack={back} testId="options-page-row-height">
        <div role="radiogroup" aria-label={titles.rowHeight} className="p-1">
          {ROW_HEIGHT_MODES.map((mode) => {
            const active = density.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMode(mode)}
                data-testid={`options-row-height-${mode}`}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-muted max-sm:min-h-11',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  active ? 'font-medium text-foreground' : 'text-foreground/90',
                )}
              >
                <span className="flex-1">{rowHeightLabel(t, mode)}</span>
                {active && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
              </button>
            );
          })}
        </div>
      </SubPage>
    );
  }

  return (
    <>
      <div className="max-h-[min(70vh,560px)] overflow-y-auto" data-page={page}>{body}</div>

    {page === 'root' && hasFooter && (
        <div className="flex flex-wrap items-center gap-1 border-t px-1 py-1" data-testid="display-footer">
          {onSave && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs max-sm:h-11"
              onClick={() => {
                closeMenu();
                onSave();
              }}
              data-testid="display-save-button"
            >
              <Save className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('common.save', { defaultValue: 'Save' })}
            </Button>
          )}
          {onReset && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs max-sm:h-11"
              disabled={resetDisabled ?? changedCount === 0}
              onClick={onReset}
              data-testid="display-reset-button"
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
              {t('list.optionsMenu.restoreDefaults', { defaultValue: 'Restore defaults' })}
            </Button>
          )}
          {/* The export entries take a full row and wrap within it: the menu
              is a fixed width, and one entry per format can outgrow it. */}
          {hasExport && (
            <div
              className="flex basis-full flex-wrap items-center justify-end gap-1"
              data-testid="display-export-group"
            >
              {exportFormats!.map((format) => (
                <Button
                  key={format}
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs max-sm:h-11"
                  disabled={exportBusy}
                  onClick={() => onExport!(format)}
                  data-testid={`display-export-${format}`}
                >
                  {exportBusy
                    ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    : <Download className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />}
                  {t('list.exportAs', { format: format.toUpperCase(), defaultValue: `Export as ${format.toUpperCase()}` })}
                </Button>
              ))}
            </div>
          )}
          {exportError && (
            <div className="basis-full px-1 pt-1 text-xs text-destructive" role="alert">
              {exportError}
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function ViewSettingsPopover(props: ViewSettingsPopoverProps) {
  const { t, changedCount = 0 } = props;
  const [open, setOpen] = React.useState(false);
  const belowSm = useBelowSm();
  // Closing through the controlled state lets Radix return focus to the
  // trigger, as Escape and an outside click do.
  const closeMenu = React.useCallback(() => setOpen(false), []);
  // 「视图设置」, beside the view's name (objectstack#35878).
  const triggerLabel = t('list.viewSettings', { defaultValue: 'View settings' });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={triggerLabel}
          title={triggerLabel}
          className={cn(
            TOOLBAR_TEXT_TRIGGER,
            PHONE_TOUCH_TARGET,
            'shrink-0 gap-1',
            changedCount > 0 && 'text-foreground font-medium',
          )}
          data-testid="toolbar-display-trigger"
        >
          {/* Its words while the list is wide enough; an icon alone once it
              is not (objectstack#35878: the first thing the bar folds). */}
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
          <span className="hidden @[56rem]/list:inline" data-testid="toolbar-display-label">{triggerLabel}</span>
          <ChevronDown className="hidden h-3 w-3 opacity-60 @[56rem]/list:inline" aria-hidden="true" />
          {changedCount > 0 && (
            <span
              className="flex h-4 min-w-[16px] items-center justify-center text-xs font-medium text-muted-foreground tabular-nums"
              data-testid="toolbar-display-count"
            >
              {changedCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* Below `sm` the panel takes the phone's width, as Filter and Sort do. */}
      <PopoverContent
        align="start"
        collisionPadding={belowSm ? PHONE_POPOVER_GUTTER : undefined}
        className="w-[calc(100vw-2rem)] sm:w-72 p-0"
        data-testid="view-settings-content"
        // The panel opens on itself, not in the view name's field: a key
        // pressed after opening must not start renaming the view.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.focus?.();
        }}
      >
        <ViewSettingsContent {...props} closeMenu={closeMenu} />
      </PopoverContent>
    </Popover>
  );
}
