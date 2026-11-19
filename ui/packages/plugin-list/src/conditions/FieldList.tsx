/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list's shared field list: a search box over the fields a control can
 * name, the fields the view shows first (in column order), then the hidden
 * ones, each with an icon for its type. The filter and sort controls open it,
 * and it takes a `header` (the sort direction) and a `footer` (the advanced
 * filter) so a control adds its own row without a second list.
 *
 * It is also the view's field manager (Options → Fields): with `onOrderChange`
 * the shown rows reorder by drag or by a grip handle and the arrow keys; with
 * `onHide` each shown row gets an eye toggle; with `onShow` one click on a
 * hidden row shows it again; with `addable` + `onAdd` the fields that are not
 * columns yet follow the hidden ones and one click adds one. Every change is
 * handed back at once, with no Apply step. Absent those props, the list only
 * picks a field, as the filter and sort panels use it.
 *
 * Keyboard: the search box keeps focus; ArrowUp / ArrowDown move the active
 * row and Enter picks it. On a grip handle, ArrowUp / ArrowDown move that
 * shown field one place. Reordering is off while a search narrows the list.
 */

import * as React from 'react';
import { cn, Input } from '@object-ui/components';
import {
  AlignLeft,
  Calendar,
  CalendarClock,
  CircleDot,
  Clock,
  Coins,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  Hash,
  Image,
  Link2,
  ListChecks,
  ListOrdered,
  Mail,
  MapPin,
  Palette,
  Paperclip,
  Percent,
  Phone,
  Plus,
  Search,
  Sigma,
  Star,
  ToggleLeft,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react';
import { useListConditionTranslation } from './conditionTranslations';

export interface FieldListItem {
  /** The field's machine name. */
  value: string;
  label: string;
  type?: string;
  /** Listed, but not choosable. */
  disabled?: boolean;
}

export interface FieldListProps {
  fields: ReadonlyArray<FieldListItem>;
  /** The fields the view shows, in column order. Listed first; every other field follows under 「hidden」. */
  shownFields?: ReadonlyArray<string>;
  /** Picks a field (the filter and sort panels). On a hidden row, `onShow` takes the click when given. */
  onPick?: (field: FieldListItem) => void;
  /**
   * The field order the shown rows follow, overriding `shownFields`' order.
   * It may name hidden fields too; their places are kept when a shown field moves.
   */
  order?: ReadonlyArray<string>;
  /** Turns on reordering of the shown rows (drag, or a grip handle and the arrow keys); gets the whole new order. */
  onOrderChange?: (order: string[]) => void;
  /** Gives each shown row an eye toggle that hides it. */
  onHide?: (name: string) => void;
  /** One click on a hidden row shows it again. */
  onShow?: (name: string) => void;
  /** Fields that are not columns yet, listed under the hidden ones (in this order). */
  addable?: ReadonlyArray<string>;
  /** One click on an addable row adds it. */
  onAdd?: (name: string) => void;
  /** Overrides the search box's placeholder and accessible name. */
  searchPlaceholder?: string;
  /** A row above the search box (the sort direction). */
  header?: React.ReactNode;
  /** A row below the list (the advanced filter). */
  footer?: React.ReactNode;
  /** Prefix for the `data-testid` of the list and its rows. */
  testId?: string;
  className?: string;
  autoFocus?: boolean;
}

const TYPE_ICONS: Readonly<Record<string, LucideIcon>> = {
  text: Type,
  textarea: AlignLeft,
  markdown: AlignLeft,
  html: AlignLeft,
  richtext: AlignLeft,
  number: Hash,
  integer: Hash,
  currency: Coins,
  percent: Percent,
  date: Calendar,
  datetime: CalendarClock,
  time: Clock,
  boolean: ToggleLeft,
  select: CircleDot,
  status: CircleDot,
  radio: CircleDot,
  multiselect: ListChecks,
  checkboxes: ListChecks,
  tags: ListChecks,
  lookup: Link2,
  master_detail: Link2,
  user: User,
  email: Mail,
  phone: Phone,
  url: Globe,
  formula: Sigma,
  summary: Sigma,
  autonumber: ListOrdered,
  rating: Star,
  color: Palette,
  file: Paperclip,
  image: Image,
  avatar: Image,
  location: MapPin,
  address: MapPin,
};

/** The icon a field type is drawn with; an unknown type reads as text. */
export function fieldTypeIcon(type: string | undefined): LucideIcon {
  return (type && TYPE_ICONS[type]) || Type;
}

type Section = 'shown' | 'hidden' | 'addable';

/**
 * The fields in display order: shown ones in column order (`order` when given,
 * else `shownFields`), then the rest, then the `addable` ones in their given order.
 */
export function orderFieldList(
  fields: ReadonlyArray<FieldListItem>,
  shownFields: ReadonlyArray<string> | undefined,
  order?: ReadonlyArray<string>,
  addable?: ReadonlyArray<string>,
): { shown: FieldListItem[]; hidden: FieldListItem[]; addable: FieldListItem[] } {
  const shownSet = new Set(shownFields ?? order ?? []);
  const rank = new Map<string, number>();
  for (const name of order ?? shownFields ?? []) if (!rank.has(name)) rank.set(name, rank.size);
  const byRank = (list: FieldListItem[]) =>
    list
      .map((f, i) => ({ f, key: rank.get(f.value) ?? rank.size + i }))
      .sort((x, y) => x.key - y.key)
      .map((x) => x.f);
  const addRank = new Map<string, number>();
  for (const name of addable ?? []) if (!shownSet.has(name) && !addRank.has(name)) addRank.set(name, addRank.size);
  const shown = byRank(fields.filter((f) => shownSet.has(f.value)));
  const hidden = byRank(fields.filter((f) => !shownSet.has(f.value) && !addRank.has(f.value)));
  const extra = fields.filter((f) => addRank.has(f.value)).sort((x, y) => addRank.get(x.value)! - addRank.get(y.value)!);
  return { shown, hidden, addable: extra };
}

/**
 * Move `name` to the place `target` holds in `order` (both must be in it);
 * every other entry, hidden fields included, keeps its relative place.
 */
export function moveFieldInOrder(order: ReadonlyArray<string>, name: string, target: string): string[] {
  const from = order.indexOf(name);
  const to = order.indexOf(target);
  if (from === -1 || to === -1 || from === to) return [...order];
  const next = [...order];
  next.splice(from, 1);
  next.splice(to, 0, name);
  return next;
}

function matches(field: FieldListItem, query: string): boolean {
  if (!query) return true;
  const q = query.toLocaleLowerCase();
  return field.label.toLocaleLowerCase().includes(q) || field.value.toLocaleLowerCase().includes(q);
}

export function FieldList({
  fields,
  shownFields,
  onPick,
  order,
  onOrderChange,
  onHide,
  onShow,
  addable,
  onAdd,
  searchPlaceholder,
  header,
  footer,
  testId = 'field-list',
  className,
  autoFocus = true,
}: FieldListProps) {
  const { t } = useListConditionTranslation();
  const [query, setQuery] = React.useState('');
  const sections = React.useMemo(
    () => orderFieldList(fields, shownFields, order, onAdd ? addable : undefined),
    [fields, shownFields, order, addable, onAdd],
  );
  const q = query.trim();
  const shownMatches = sections.shown.filter((f) => matches(f, q));
  const hiddenMatches = sections.hidden.filter((f) => matches(f, q));
  const addableMatches = sections.addable.filter((f) => matches(f, q));
  // A manager list (Options → Fields) carries buttons in its rows, so it is a
  // list of rows rather than a listbox of options.
  const managing = !!(onOrderChange || onHide || onShow || onAdd);
  const reorderable = !!onOrderChange && !q && sections.shown.length > 1;

  const actionOf = (section: Section, field: FieldListItem): (() => void) | undefined => {
    if (field.disabled) return undefined;
    if (section === 'addable') return onAdd ? () => onAdd(field.value) : undefined;
    if (section === 'hidden' && onShow) return () => onShow(field.value);
    return onPick ? () => onPick(field) : undefined;
  };
  const rows: Array<{ section: Section; field: FieldListItem }> = [
    ...shownMatches.map((field) => ({ section: 'shown' as const, field })),
    ...hiddenMatches.map((field) => ({ section: 'hidden' as const, field })),
    ...addableMatches.map((field) => ({ section: 'addable' as const, field })),
  ];
  const pickable = rows.filter((r) => actionOf(r.section, r.field));
  const [active, setActive] = React.useState(0);
  React.useEffect(() => setActive(0), [query]);
  const activeName = pickable[Math.min(active, pickable.length - 1)]?.field.value;
  // Headed sections only when more than one has rows; one section needs no heading.
  const headed =
    [sections.shown.length, sections.hidden.length, sections.addable.length].filter((n) => n > 0).length > 1;

  // Reordering: the base order is `order`, else the shown fields; a shown
  // field missing from `order` is appended so it can still move.
  const baseOrder = (): string[] => {
    const base = [...(order ?? sections.shown.map((f) => f.value))];
    for (const f of sections.shown) if (!base.includes(f.value)) base.push(f.value);
    return base;
  };
  const moveTo = (name: string, target: string) => {
    if (!onOrderChange || name === target) return;
    onOrderChange(moveFieldInOrder(baseOrder(), name, target));
  };
  const dragging = React.useRef<string | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const refocus = React.useRef<string | null>(null);
  React.useEffect(() => {
    const name = refocus.current;
    if (!name) return;
    refocus.current = null;
    const handles = root.current?.querySelectorAll<HTMLElement>('[data-move-handle]') ?? [];
    for (const handle of Array.from(handles)) if (handle.dataset.moveHandle === name) handle.focus();
  });

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(pickable.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      const row = pickable.find((r) => r.field.value === activeName);
      const act = row && actionOf(row.section, row.field);
      if (act) {
        event.preventDefault();
        act();
      }
    }
  };

  const renderRow = (field: FieldListItem, section: Section, index: number) => {
    const Icon = fieldTypeIcon(field.type);
    const isActive = field.value === activeName;
    const act = actionOf(section, field);
    const label = field.label;
    const canMove = section === 'shown' && reorderable;
    const neighbour = (step: -1 | 1) => sections.shown[sections.shown.findIndex((f) => f.value === field.value) + step];
    const body = (
      <>
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" data-testid={`${testId}-icon`} />
        <span className="truncate">{label}</span>
        {managing && section === 'hidden' && onShow && (
          <EyeOff className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        {section === 'addable' && <Plus className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
      </>
    );
    const rowClass = cn(
      'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-sm px-2 text-left text-[13px] text-foreground',
      'disabled:cursor-not-allowed disabled:opacity-50',
      isActive && 'bg-accent text-accent-foreground',
    );
    const actionLabel =
      section === 'addable'
        ? t('listConditions.fieldList.add', { label })
        : section === 'hidden' && onShow
          ? t('listConditions.fieldList.show', { label })
          : undefined;
    const main =
      act || !managing ? (
        <button
          type="button"
          role={managing ? undefined : 'option'}
          aria-selected={managing ? undefined : isActive}
          aria-disabled={field.disabled || undefined}
          aria-label={actionLabel}
          disabled={field.disabled}
          data-testid={`${testId}-item-${field.value}`}
          data-field={field.value}
          data-field-type={field.type ?? 'text'}
          onMouseEnter={() => {
            const at = pickable.findIndex((r) => r.field.value === field.value);
            if (at !== -1) setActive(at);
          }}
          onClick={act}
          className={rowClass}
        >
          {body}
        </button>
      ) : (
        <span
          data-testid={`${testId}-item-${field.value}`}
          data-field={field.value}
          data-field-type={field.type ?? 'text'}
          className={rowClass}
        >
          {body}
        </span>
      );
    if (!managing) {
      return (
        <li key={field.value} role="presentation">
          {main}
        </li>
      );
    }
    return (
      <li
        key={field.value}
        className="flex items-center gap-0.5"
        data-testid={`${testId}-row-${field.value}`}
        data-position={canMove ? index + 1 : undefined}
        draggable={canMove || undefined}
        onDragStart={
          canMove
            ? (event) => {
                dragging.current = field.value;
                event.dataTransfer?.setData('text/plain', field.value);
                if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
              }
            : undefined
        }
        onDragOver={
          canMove
            ? (event) => {
                if (dragging.current !== null) event.preventDefault();
              }
            : undefined
        }
        onDrop={
          canMove
            ? (event) => {
                event.preventDefault();
                if (dragging.current !== null) moveTo(dragging.current, field.value);
                dragging.current = null;
              }
            : undefined
        }
        onDragEnd={() => {
          dragging.current = null;
        }}
      >
        {canMove && (
          <button
            type="button"
            className="flex h-8 w-5 shrink-0 cursor-grab items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('listConditions.fieldList.move', { label })}
            aria-describedby={`${testId}-move-hint`}
            title={t('listConditions.fieldList.moveHint')}
            data-move-handle={field.value}
            data-testid={`${testId}-move-${field.value}`}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
              if (!step) return;
              event.preventDefault();
              const target = neighbour(step);
              if (!target) return;
              refocus.current = field.value;
              moveTo(field.value, target.value);
            }}
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
        {main}
        {section === 'shown' && onHide && (
          <button
            type="button"
            className="flex h-8 w-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t('listConditions.fieldList.hide', { label })}
            title={t('listConditions.fieldList.hide', { label })}
            data-testid={`${testId}-hide-${field.value}`}
            onClick={() => onHide(field.value)}
          >
            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </li>
    );
  };

  const section = (list: FieldListItem[], heading: string, key: Section) =>
    list.length === 0 ? null : (
      <div key={key} data-testid={`${testId}-${key}`}>
        {headed && (
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {heading}
          </div>
        )}
        <ul role={managing ? 'list' : 'presentation'}>{list.map((f, i) => renderRow(f, key, i))}</ul>
      </div>
    );

  const empty = rows.length === 0;
  const placeholder = searchPlaceholder ?? t('listConditions.fieldList.search');

  return (
    <div ref={root} className={cn('flex w-72 max-w-full flex-col', className)} data-testid={testId}>
      {header}
      <div className="relative border-b p-1.5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label={placeholder}
          aria-controls={`${testId}-options`}
          className="h-8 border-0 pl-7 text-[13px] shadow-none focus-visible:ring-0"
          data-testid={`${testId}-search`}
        />
      </div>
      <div id={`${testId}-options`} role={managing ? undefined : 'listbox'} className="max-h-72 overflow-y-auto p-1">
        {section(shownMatches, t('listConditions.fieldList.shown'), 'shown')}
        {section(hiddenMatches, t('listConditions.fieldList.hidden'), 'hidden')}
        {section(addableMatches, t('listConditions.fieldList.addable'), 'addable')}
        {empty && (
          <p className="px-2 py-3 text-center text-[13px] text-muted-foreground" data-testid={`${testId}-empty`}>
            {t('listConditions.fieldList.empty')}
          </p>
        )}
      </div>
      {reorderable && (
        <p id={`${testId}-move-hint`} className="sr-only">
          {t('listConditions.fieldList.moveHint')}
        </p>
      )}
      {footer && <div className="border-t p-1">{footer}</div>}
    </div>
  );
}
