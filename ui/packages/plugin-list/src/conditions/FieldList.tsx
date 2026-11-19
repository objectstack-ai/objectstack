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
 * Keyboard: the search box keeps focus; ArrowUp / ArrowDown move the active
 * row and Enter picks it.
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
  Globe,
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
  onPick: (field: FieldListItem) => void;
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

/** The fields in display order: shown ones in column order, then the rest in their given order. */
export function orderFieldList(
  fields: ReadonlyArray<FieldListItem>,
  shownFields: ReadonlyArray<string> | undefined,
): { shown: FieldListItem[]; hidden: FieldListItem[] } {
  const rank = new Map<string, number>();
  for (const name of shownFields ?? []) if (!rank.has(name)) rank.set(name, rank.size);
  const shown = fields.filter((f) => rank.has(f.value)).sort((a, b) => rank.get(a.value)! - rank.get(b.value)!);
  const hidden = fields.filter((f) => !rank.has(f.value));
  return { shown, hidden };
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
  header,
  footer,
  testId = 'field-list',
  className,
  autoFocus = true,
}: FieldListProps) {
  const { t } = useListConditionTranslation();
  const [query, setQuery] = React.useState('');
  const { shown, hidden } = React.useMemo(() => orderFieldList(fields, shownFields), [fields, shownFields]);
  const shownMatches = shown.filter((f) => matches(f, query.trim()));
  const hiddenMatches = hidden.filter((f) => matches(f, query.trim()));
  const pickable = [...shownMatches, ...hiddenMatches].filter((f) => !f.disabled);
  const [active, setActive] = React.useState(0);
  React.useEffect(() => setActive(0), [query]);
  const activeName = pickable[Math.min(active, pickable.length - 1)]?.value;
  // Two headed sections only when both have rows; one section needs no heading.
  const headed = shown.length > 0 && hidden.length > 0;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(pickable.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      const field = pickable.find((f) => f.value === activeName);
      if (field) {
        event.preventDefault();
        onPick(field);
      }
    }
  };

  const renderRow = (field: FieldListItem) => {
    const Icon = fieldTypeIcon(field.type);
    const isActive = field.value === activeName;
    return (
      <li key={field.value} role="presentation">
        <button
          type="button"
          role="option"
          aria-selected={isActive}
          aria-disabled={field.disabled || undefined}
          disabled={field.disabled}
          data-testid={`${testId}-item-${field.value}`}
          data-field={field.value}
          data-field-type={field.type ?? 'text'}
          onMouseEnter={() => {
            const at = pickable.findIndex((f) => f.value === field.value);
            if (at !== -1) setActive(at);
          }}
          onClick={() => onPick(field)}
          className={cn(
            'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-[13px] text-foreground',
            'disabled:cursor-not-allowed disabled:opacity-50',
            isActive && 'bg-accent text-accent-foreground',
          )}
        >
          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" data-testid={`${testId}-icon`} />
          <span className="truncate">{field.label}</span>
        </button>
      </li>
    );
  };

  const section = (rows: FieldListItem[], heading: string, key: 'shown' | 'hidden') =>
    rows.length === 0 ? null : (
      <div key={key} data-testid={`${testId}-${key}`}>
        {headed && (
          <div className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {heading}
          </div>
        )}
        <ul role="presentation">{rows.map(renderRow)}</ul>
      </div>
    );

  const empty = shownMatches.length === 0 && hiddenMatches.length === 0;

  return (
    <div className={cn('flex w-72 max-w-full flex-col', className)} data-testid={testId}>
      {header}
      <div className="relative border-b p-1.5">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('listConditions.fieldList.search')}
          aria-label={t('listConditions.fieldList.search')}
          aria-controls={`${testId}-options`}
          className="h-8 border-0 pl-7 text-[13px] shadow-none focus-visible:ring-0"
          data-testid={`${testId}-search`}
        />
      </div>
      <div id={`${testId}-options`} role="listbox" className="max-h-72 overflow-y-auto p-1">
        {section(shownMatches, t('listConditions.fieldList.shown'), 'shown')}
        {section(hiddenMatches, t('listConditions.fieldList.hidden'), 'hidden')}
        {empty && (
          <p className="px-2 py-3 text-center text-[13px] text-muted-foreground" data-testid={`${testId}-empty`}>
            {t('listConditions.fieldList.empty')}
          </p>
        )}
      </div>
      {footer && <div className="border-t p-1">{footer}</div>}
    </div>
  );
}
