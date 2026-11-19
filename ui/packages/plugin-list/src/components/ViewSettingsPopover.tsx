/**
 * ViewSettingsPopover — the list's Options menu.
 *
 * Opened from the view bar's Options trigger, it is a short menu: each row
 * names one setting on the left and its current value on the right, and opens
 * a second level that changes it. At the top, the view's name (renamed in
 * place where the host allows it). Then, each only when the host offers it:
 *
 *   - Layout: the visualizations, each by icon AND words;
 *   - Fields: 「N shown」 → the shown fields (search, drag to reorder, eye to
 *     hide) above the hidden ones (one click shows a field again);
 *   - Group, Row color;
 *   - Row height: compact, standard, spacious;
 *   - Sort (below `sm` only, where the bar draws no Sort button);
 *   - More: how a record opens, row numbers, inline edit.
 *
 * The footer keeps Restore defaults, Refresh and the export entries.
 *
 * Every setting here is the reader's own: this component writes nothing
 * itself, each control hands its change to the host, which keeps it as the
 * reader's preference. The wide toolbar form (`compactToolbar: false`) keeps
 * one button per control in ListView.tsx; content is duplicated between the
 * two forms, so change one, change both. Open records is drawn here only.
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
  ToggleGroup,
  ToggleGroupItem,
} from '@object-ui/components';
import {
  SlidersHorizontal,
  Rows4,
  Rows3,
  Rows2,
  Check,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  RotateCw,
  Download,
  Loader2,
  Undo2,
  Save,
} from 'lucide-react';
import { TOOLBAR_TEXT_TRIGGER } from '../listToolbarRow';
import { ViewSwitcherFaceContext } from '../ViewSwitcher';

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
}

/**
 * The fields a Group editor offers: every field but those the server refuses
 * as a group key (`groupable: false`). Both Group editors, this panel's and the
 * wide toolbar's, read it, so the two forms offer the same fields. A level that
 * already names a withheld field still shows: `GroupingEditor` mounts a value
 * its options do not carry, so the level can be removed.
 */
export function groupFieldOptions(fields: readonly ViewSettingsField[]): Array<{ value: string; label: string }> {
  return fields
    .filter((f) => f.groupable !== false)
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

/**
 * How a reader prefers a drawer-mode record to open (objectstack#26681): the
 * drawer over the list (the default), or the full page (objectstack#27545).
 * The pane beside the list retired (objectstack#28915, maintainer ruling
 * 2026-11-02: 「默认改抽屉，分屏彻底退役，只留抽屉和整页」).
 */
export type ViewSettingsRecordOpenPreference = 'drawer' | 'page';

/**
 * The Open records section (objectstack#26681): how a row opens its record.
 *
 * The side-by-side pane is each READER's own choice, kept per browser across
 * objects; it is not metadata, and an object declares only `drawer` (the
 * default) or `page` (maintainer ruling 2026-10-27, objectstack#26677). So the
 * section answers by the mode the host resolved for this object and view:
 *
 *   - `drawer`: two segments, Drawer | Full page, writing the reader's
 *     preference through `setPreference`;
 *   - `page`: one read-only line saying records always open as a full page —
 *     the object's declaration wins, so there is nothing to choose;
 *   - `new_window` / `none`: no section. The preference changes nothing there
 *     and the ruling gives those declarations no line of their own.
 */
export interface ViewSettingsRecordOpen {
  /** The `navigation.mode` the host resolved for this object and view. */
  resolvedMode: 'drawer' | 'page' | 'new_window' | 'none';
  /**
   * The reader's current preference; read only when `resolvedMode` is
   * `drawer`. Read, never handed back: a choice is written through
   * `setPreference`.
   */
  preference: ViewSettingsRecordOpenPreference;
  /** Keep the reader's choice of Drawer or Full page. The host owns where it is kept. */
  setPreference: (next: ViewSettingsRecordOpenPreference) => void;
}

export interface ViewSettingsPopoverProps {
  t: (key: string, opts?: any) => string;
  allFields: ViewSettingsField[];

  /** The view's name, at the top of the menu. Absent ⇒ no name row. */
  viewName?: ViewSettingsViewName;

  /**
   * The order the reader's columns are drawn in: the same list the grid's
   * header drag keeps (its column state's `order`, by column key). Names it
   * does not list keep the `allFields` order after the listed ones.
   */
  fieldOrder?: readonly string[];
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

  /**
   * The Open records section (objectstack#26681), drawn after Layout. A host
   * prop: the console passes it; any other host draws no section. It is not a
   * setting of the view, so it neither counts in `changedCount` nor returns
   * under Reset.
   *
   * Drawn in this panel only: no host that passes it draws the wide toolbar
   * (`compactToolbar: false`), so the wide form has no twin of it.
   */
  recordOpen?: ViewSettingsRecordOpen;

  /**
   * The Sort block, drawn below `sm` only (objectstack#28911): there the bar
   * keeps Filter and Display, and the host's Sort button is hidden. From `sm`
   * up that button carries Sort, so the panel draws nothing for it. The host
   * passes the same panel its Sort popover draws, so both write through one
   * door; it is not a display setting and does not count in `changedCount`.
   */
  sort?: React.ReactNode;

  showGroup?: boolean;
  groupingConfig?: any;
  setGroupingConfig?: (next: any) => void;

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
   * Row numbers on the grid's leading cell — a session-only setting the host
   * holds in memory (objectui#12423). Offered only when `setRowNumbers` is.
   */
  rowNumbers?: boolean;
  setRowNumbers?: (next: boolean) => void;

  /**
   * Record editing — toggle the grid's inline-edit mode. `setInlineEdit` hands
   * the change to the host, which decides what it does with it; the console
   * keeps it session-only and writes nothing to the view (objectui#5144,
   * ruling E).
   */
  showInlineEdit?: boolean;
  inlineEdit?: boolean;
  setInlineEdit?: (next: boolean) => void;

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

  /** Footer: re-fetch the list. Drawn when wired. */
  onRefresh?: () => void;
  refreshing?: boolean;

  /** Footer: one export entry per format. Drawn when there is a format. */
  exportFormats?: string[];
  onExport?: (format: string) => void;
  exportBusy?: boolean;
  exportError?: string | null;
}

/** The second levels of the menu; `root` is the menu itself. */
type MenuPage = 'root' | 'layout' | 'fields' | 'group' | 'color' | 'rowHeight' | 'sort' | 'more';

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
        'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted max-sm:min-h-11',
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
            'flex min-w-0 items-center gap-1 rounded-sm px-1.5 py-1 text-[13px] font-medium hover:bg-muted max-sm:min-h-11',
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
 * One on/off row of the panel: the words on the left, a `role="switch"` on the
 * right. The words are the switch's `<label>`, so a click on either toggles it
 * and the switch is named by them.
 */
function SwitchRow({
  label,
  checked,
  onCheckedChange,
  testId,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (next: boolean) => void;
  testId: string;
}) {
  const id = React.useId();
  return (
    <div className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0 max-sm:py-0">
      {/* Below `sm` the words fill the row's 44 px, so the whole row is the switch's touch target. */}
      <label htmlFor={id} className="text-xs font-medium text-foreground/80 cursor-pointer max-sm:flex max-sm:min-h-11 max-sm:flex-1 max-sm:items-center">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} data-testid={testId} />
    </div>
  );
}

/**
 * The Open records section — see {@link ViewSettingsRecordOpen}. `null` for a
 * mode it draws nothing for.
 */
function RecordOpenSection({
  t,
  recordOpen,
}: {
  t: ViewSettingsPopoverProps['t'];
  recordOpen: ViewSettingsRecordOpen;
}) {
  const { resolvedMode, preference, setPreference } = recordOpen;
  if (resolvedMode !== 'drawer' && resolvedMode !== 'page') return null;
  const title = t('list.recordOpen', { defaultValue: 'Open records' });
  return (
    <div className="border-b px-3 py-2" data-testid="display-record-open">
      <div className="flex items-center justify-between gap-3">
        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-foreground/80">{title}</span>
        {resolvedMode === 'drawer' ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={preference}
            // Radix hands back '' when the pressed segment is pressed again:
            // one segment is always the choice, so that writes nothing.
            onValueChange={(next) => {
              if (next === preference) return;
              if (next === 'drawer' || next === 'page') setPreference(next);
            }}
            aria-label={title}
            className="gap-0"
            data-testid="display-record-open-choice"
          >
            <ToggleGroupItem
              value="drawer"
              className="h-7 rounded-r-none px-2.5 text-xs"
              data-testid="display-record-open-drawer"
            >
              {t('list.recordOpenDrawer', { defaultValue: 'Drawer' })}
            </ToggleGroupItem>
            <ToggleGroupItem
              value="page"
              className="-ml-px h-7 rounded-l-none px-2.5 text-xs"
              data-testid="display-record-open-page"
            >
              {t('list.recordOpenPage', { defaultValue: 'Full page' })}
            </ToggleGroupItem>
          </ToggleGroup>
        ) : (
          <span className="min-w-0 text-right text-xs text-muted-foreground" data-testid="display-record-open-declared">
            {t('list.optionsMenu.recordOpenAlwaysPage', { defaultValue: 'Records always open as a full page' })}
          </span>
        )}
      </div>
    </div>
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
  return fields
    .map((field, i) => ({ field, i }))
    .sort((a, b) => (rank.get(a.field.name) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.field.name) ?? Number.MAX_SAFE_INTEGER) || a.i - b.i)
    .map(({ field }) => field);
}

/**
 * The column order after `moved` is dropped where `target` is, among the
 * SHOWN fields: the shown fields take their new order in the slots they held,
 * so a hidden field keeps its place for when it is shown again. Every key of
 * `order` that names no field of `allFields` (a column the reader cannot read,
 * say) is kept, after them, as it was. `null` when nothing moves.
 */
export function reorderShownFields(
  allFields: readonly ViewSettingsField[],
  order: readonly string[] | undefined,
  hidden: ReadonlySet<string>,
  moved: string,
  target: string,
): string[] | null {
  if (moved === target) return null;
  const full = orderFields(allFields, order).map((f) => f.name);
  const shown = full.filter((name) => !hidden.has(name));
  const from = shown.indexOf(moved);
  const to = shown.indexOf(target);
  if (from === -1 || to === -1) return null;
  const nextShown = [...shown];
  nextShown.splice(from, 1);
  nextShown.splice(to, 0, moved);
  let at = 0;
  const next = full.map((name) => (hidden.has(name) ? name : nextShown[at++]));
  const known = new Set(full);
  return [...next, ...(order ?? []).filter((name) => !known.has(name))];
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
      <div className="border-b px-3 py-2 text-[13px] font-medium break-words" data-testid="options-view-name">
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
        className="h-8 text-[13px] font-medium max-sm:h-11"
        data-testid="options-view-name-input"
      />
    </div>
  );
}

/**
 * The Fields level: a search box, the shown fields (drag to reorder, eye to
 * hide), then the hidden ones, the view's columns the reader hid and the
 * object's fields they may add, each shown again with one click. Every change
 * applies at once.
 */
function FieldsPage({
  t,
  allFields,
  hiddenFields,
  updateHiddenFields,
  addableFields,
  onAddField,
  fieldOrder,
  onFieldOrderChange,
}: {
  t: ViewSettingsPopoverProps['t'];
  allFields: readonly ViewSettingsField[];
  hiddenFields: Set<string>;
  updateHiddenFields: (next: Set<string>) => void;
  addableFields?: readonly ViewSettingsField[];
  onAddField?: (name: string) => void;
  fieldOrder?: readonly string[];
  onFieldOrderChange?: (order: string[]) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [dragging, setDragging] = React.useState<string | null>(null);
  const needle = query.trim().toLocaleLowerCase();
  const matches = (field: ViewSettingsField) => !needle || (field.label || field.name).toLocaleLowerCase().includes(needle);
  const ordered = orderFields(allFields, fieldOrder);
  const shown = ordered.filter((f) => !hiddenFields.has(f.name));
  const hiddenColumns = ordered.filter((f) => hiddenFields.has(f.name));
  const addable = onAddField ? addableFields ?? [] : [];
  // Dragging reorders the whole shown list, so it is offered on the unfiltered list only.
  const canDrag = !!onFieldOrderChange && !needle && shown.length > 1;
  const nameOf = (field: ViewSettingsField) => field.label || field.name;

  const move = (moved: string, target: string) => {
    const next = reorderShownFields(allFields, fieldOrder, hiddenFields, moved, target);
    if (next) onFieldOrderChange?.(next);
  };
  const hide = (name: string) => updateHiddenFields(new Set([...hiddenFields, name]));
  const show = (name: string) => updateHiddenFields(new Set([...hiddenFields].filter((n) => n !== name)));

  const iconButton = cn(
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground max-sm:h-11 max-sm:w-11',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  );
  const shownMatches = shown.filter(matches);
  const hiddenMatches = [...hiddenColumns.filter(matches), ...addable.filter(matches)];

  return (
    <div>
      <div className="border-b p-2">
        <Input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('list.optionsMenu.searchFields', { defaultValue: 'Search fields' })}
          aria-label={t('list.optionsMenu.searchFields', { defaultValue: 'Search fields' })}
          className="h-8 text-[13px] max-sm:h-11"
          data-testid="options-fields-search"
        />
      </div>
      <div className="max-h-[min(50vh,360px)] overflow-y-auto p-1">
        {shownMatches.length > 0 && (
          <div role="list" aria-label={t('list.optionsMenu.shownFields', { defaultValue: 'Shown fields' })} data-testid="options-fields-shown">
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
              {t('list.optionsMenu.shownFields', { defaultValue: 'Shown fields' })}
            </div>
            {shownMatches.map((field, index) => {
              const name = nameOf(field);
              return (
                <div
                  key={field.name}
                  role="listitem"
                  draggable={canDrag}
                  onDragStart={canDrag ? (e) => {
                    setDragging(field.name);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', field.name);
                  } : undefined}
                  onDragOver={canDrag ? (e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  } : undefined}
                  onDrop={canDrag ? (e) => {
                    e.preventDefault();
                    const moved = dragging ?? e.dataTransfer.getData('text/plain');
                    setDragging(null);
                    if (moved) move(moved, field.name);
                  } : undefined}
                  onDragEnd={canDrag ? () => setDragging(null) : undefined}
                  data-testid={`options-field-${field.name}`}
                  data-dragging={dragging === field.name ? 'true' : undefined}
                  className={cn(
                    'group flex items-center gap-1 rounded-sm px-1 text-[13px] hover:bg-muted max-sm:min-h-11',
                    dragging === field.name && 'opacity-50',
                  )}
                >
                  {canDrag ? (
                    <button
                      type="button"
                      aria-label={t('list.optionsMenu.moveField', { field: name, defaultValue: `Move ${name}` })}
                      title={t('list.optionsMenu.moveFieldHint', { defaultValue: 'Drag, or use the up and down arrow keys' })}
                      onKeyDown={(e) => {
                        const neighbour = e.key === 'ArrowUp' ? shown[index - 1] : e.key === 'ArrowDown' ? shown[index + 1] : undefined;
                        if (!neighbour) return;
                        e.preventDefault();
                        move(field.name, neighbour.name);
                      }}
                      className={cn(iconButton, 'cursor-grab')}
                      data-testid={`options-field-move-${field.name}`}
                    >
                      <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ) : (
                    <span className="w-1" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1 truncate py-1.5" title={name}>{name}</span>
                  <button
                    type="button"
                    aria-label={t('list.optionsMenu.hideField', { field: name, defaultValue: `Hide ${name}` })}
                    title={t('list.optionsMenu.hideField', { field: name, defaultValue: `Hide ${name}` })}
                    onClick={() => hide(field.name)}
                    className={iconButton}
                    data-testid={`options-field-hide-${field.name}`}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {hiddenMatches.length > 0 && (
          <div
            role="list"
            aria-label={t('list.optionsMenu.hiddenFields', { defaultValue: 'Hidden fields' })}
            className={cn(shownMatches.length > 0 && 'mt-1 border-t pt-1')}
            data-testid="options-fields-hidden"
          >
            <div className="px-2 pt-1 pb-0.5 text-[11px] font-medium text-muted-foreground">
              {t('list.optionsMenu.hiddenFields', { defaultValue: 'Hidden fields' })}
            </div>
            {hiddenMatches.map((field) => {
              const name = nameOf(field);
              const isColumn = hiddenFields.has(field.name);
              return (
                <div key={field.name} role="listitem">
                  <button
                    type="button"
                    onClick={() => (isColumn ? show(field.name) : onAddField?.(field.name))}
                    aria-label={t('list.optionsMenu.showField', { field: name, defaultValue: `Show ${name}` })}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground max-sm:min-h-11',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    )}
                    data-testid={`options-field-show-${field.name}`}
                  >
                    <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
                    <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {shownMatches.length === 0 && hiddenMatches.length === 0 && (
          <p className="px-2 py-3 text-center text-[13px] text-muted-foreground" data-testid="options-fields-empty">
            {t('list.optionsMenu.noFieldsMatch', { defaultValue: 'No fields match' })}
          </p>
        )}
      </div>
    </div>
  );
}

export function ViewSettingsPopover(props: ViewSettingsPopoverProps) {
  const {
    t,
    allFields,
    viewName,
    fieldOrder,
    onFieldOrderChange,
    layout,
    recordOpen,
    sort,
    showGroup,
    groupingConfig,
    setGroupingConfig,
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
    rowNumbers,
    setRowNumbers,
    showInlineEdit,
    inlineEdit,
    setInlineEdit,
    changedCount = 0,
    onReset,
    resetDisabled,
    onSave,
    onRefresh,
    refreshing,
    exportFormats,
    onExport,
    exportBusy,
    exportError,
  } = props;

  const [open, setOpen] = React.useState(false);
  const [page, setPage] = React.useState<MenuPage>('root');
  const belowSm = useBelowSm();
  // Closing through the controlled state lets Radix return focus to the
  // Options trigger, as Escape and an outside click do.
  const closeMenu = React.useCallback(() => setOpen(false), []);
  // The menu opens on its first level every time.
  React.useEffect(() => {
    if (!open) setPage('root');
  }, [open]);
  const back = () => setPage('root');

  // The trigger is named 「Options」 on the view bar (objectstack#35548).
  const triggerLabel = t('list.options', { defaultValue: 'Options' });
  const hasExport = !!onExport && !!exportFormats && exportFormats.length > 0;
  const hasFooter = !!onSave || !!onReset || !!onRefresh || hasExport;

  const fieldLabel = (name: string) => allFields.find((f) => f.name === name)?.label || name;
  const none = t('list.none', { defaultValue: 'None' });
  const groupFields: string[] = Array.isArray(groupingConfig?.fields)
    ? groupingConfig.fields.map((f: { field?: string }) => f?.field).filter((f: unknown): f is string => typeof f === 'string' && !!f)
    : [];
  const recordOpenDrawn = !!recordOpen && (recordOpen.resolvedMode === 'drawer' || recordOpen.resolvedMode === 'page');
  const hasMore = recordOpenDrawn || !!setRowNumbers || (!!showInlineEdit && !!setInlineEdit);
  const fieldsOffered = !!showHideFields && !!hiddenFields && !!updateHiddenFields;
  const shownCount = fieldsOffered ? allFields.filter((f) => !hiddenFields!.has(f.name)).length : 0;
  const DensityIcon =
    density?.mode === 'compact' ? Rows4 : density?.mode === 'comfortable' ? Rows3 : Rows2;

  const titles: Record<Exclude<MenuPage, 'root'>, string> = {
    layout: t('list.layout', { defaultValue: 'Layout' }),
    fields: t('list.optionsMenu.fields', { defaultValue: 'Fields' }),
    group: t('list.group', { defaultValue: 'Group' }),
    color: t('list.rowColor', { defaultValue: 'Row Color' }),
    rowHeight: t('list.optionsMenu.rowHeight', { defaultValue: 'Row height' }),
    sort: t('list.sort', { defaultValue: 'Sort' }),
    more: t('list.optionsMenu.more', { defaultValue: 'More' }),
  };
  const clearAction = (onClear: () => void, testId: string) => (
    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs max-sm:h-11" onClick={onClear} data-testid={testId}>
      {t('list.clear', { defaultValue: 'Clear' })}
    </Button>
  );

  const rootMenu = (
    <div data-testid="options-menu">
      {viewName && <ViewNameField t={t} viewName={viewName} />}
      <div className="p-1">
        {layout && (
          <MenuRow
            label={titles.layout}
            value={<ViewSwitcherFaceContext.Provider value="value">{layout(closeMenu)}</ViewSwitcherFaceContext.Provider>}
            onOpen={() => setPage('layout')}
            testId="options-row-layout"
          />
        )}
        {fieldsOffered && (
          <MenuRow
            label={titles.fields}
            value={t('list.optionsMenu.fieldsShown', { count: shownCount, defaultValue: `${shownCount} shown` })}
            onOpen={() => setPage('fields')}
            testId="options-row-fields"
          />
        )}
        {showGroup && setGroupingConfig && (
          <MenuRow
            label={titles.group}
            value={groupFields.length > 0 ? groupFields.map(fieldLabel).join(' › ') : none}
            onOpen={() => setPage('group')}
            testId="options-row-group"
          />
        )}
        {showColor && setRowColorConfig && (
          <MenuRow
            label={titles.color}
            value={rowColorConfig ? fieldLabel(rowColorConfig.field) : none}
            onOpen={() => setPage('color')}
            testId="options-row-color"
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
              'flex w-full items-center gap-3 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted max-sm:min-h-11',
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
        {sort && (
          <div className="sm:hidden">
            <MenuRow label={titles.sort} onOpen={() => setPage('sort')} testId="options-row-sort" />
          </div>
        )}
        {hasMore && (
          <MenuRow label={titles.more} onOpen={() => setPage('more')} testId="options-row-more" />
        )}
      </div>
    </div>
  );

  let body: React.ReactNode = rootMenu;
  if (page === 'layout' && layout) {
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
          t={t}
          allFields={allFields}
          hiddenFields={hiddenFields!}
          updateHiddenFields={updateHiddenFields!}
          addableFields={addableFields}
          onAddField={onAddField}
          fieldOrder={fieldOrder}
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
            fieldOptions={groupFieldOptions(allFields)}
            maxLevels={3}
            labels={{
              addGroup: t('list.addGroup', 'Add group field'),
              collapseTitle: t('list.collapsedByDefault', 'Collapsed by default'),
              removeTitle: t('list.removeGroup', 'Remove'),
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
          <label className="mb-1 block text-[11px] text-muted-foreground">
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
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-muted max-sm:min-h-11',
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
  } else if (page === 'sort' && sort) {
    body = (
      <SubPage title={titles.sort} onBack={back} testId="options-page-sort">
        <div className="px-3 py-2" data-testid="display-sort">{sort}</div>
      </SubPage>
    );
  } else if (page === 'more' && hasMore) {
    body = (
      <SubPage title={titles.more} onBack={back} testId="options-page-more">
        {recordOpen && <RecordOpenSection t={t} recordOpen={recordOpen} />}
        {setRowNumbers && (
          <SwitchRow
            label={t('list.rowNumbers', { defaultValue: 'Row numbers' })}
            checked={!!rowNumbers}
            onCheckedChange={setRowNumbers}
            testId="display-row-numbers-toggle"
          />
        )}
        {showInlineEdit && setInlineEdit && (
          <SwitchRow
            label={t('list.inlineEditShort', { defaultValue: 'Edit inline' })}
            checked={!!inlineEdit}
            onCheckedChange={setInlineEdit}
            testId="toolbar-inline-edit-toggle"
          />
        )}
      </SubPage>
    );
  }

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
            changedCount > 0 && 'text-foreground font-medium',
          )}
          data-testid="toolbar-display-trigger"
        >
          {/* A named text button from `sm` up, like Filter and Sort
              (objectstack#35548); an icon below it (objectui#12695). */}
          <SlidersHorizontal className="h-3.5 w-3.5 sm:hidden" aria-hidden="true" />
          <span className="hidden sm:inline">{triggerLabel}</span>
          {changedCount > 0 && (
            <span
              className="flex h-4 min-w-[16px] items-center justify-center text-[10px] font-medium text-muted-foreground tabular-nums"
              data-testid="toolbar-display-count"
            >
              {changedCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      {/* Below `sm` the menu takes the phone's width, as Filter and Sort do. */}
      <PopoverContent
        align="end"
        collisionPadding={belowSm ? PHONE_POPOVER_GUTTER : undefined}
        className="w-[calc(100vw-2rem)] sm:w-72 p-0"
        data-testid="view-settings-content"
        data-page={page}
      >
        <div className="max-h-[min(70vh,560px)] overflow-y-auto">{body}</div>

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
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 px-2 text-xs text-muted-foreground hover:text-primary max-sm:h-11"
                onClick={onRefresh}
                disabled={refreshing}
                data-testid="refresh-button"
              >
                <RotateCw className={cn('mr-1.5 h-3.5 w-3.5', refreshing && 'animate-spin')} aria-hidden="true" />
                {t('list.refresh', { defaultValue: 'Refresh' })}
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
      </PopoverContent>
    </Popover>
  );
}
