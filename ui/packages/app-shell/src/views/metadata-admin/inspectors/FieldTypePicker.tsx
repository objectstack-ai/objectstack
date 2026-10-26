// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FieldTypePicker — the field inspector's *Type* control (objectui#11793).
 *
 * It replaces one flat select of every field type ("Text · Text" …
 * "Advanced · Vector"), which offered no search, no icon and no word on what a
 * type is for. Here the trigger shows the field's type with its icon, and
 * opens a searchable list grouped by category, where each row is the type's
 * icon, its name and a one-line description.
 *
 * ## Where each part comes from
 *
 * - **The types, their categories and their icons** are the Studio catalog in
 *   `previews/field-types.ts` (`TYPES_BY_CATEGORY`, `FIELD_TYPE_META`,
 *   `CATEGORY_TONE`) — the same catalog the canvas's *Add field* palette draws.
 *   Nothing is listed here.
 * - **The names** are the designer's `engine.fieldType.*` and
 *   `engine.fieldCategory.*` rows, as the flat select used.
 * - **The descriptions** are the designer's `engine.fieldTypeDesc.*` rows.
 *   `@objectstack/spec` carries no per-type description to read instead: its
 *   `FieldType` enum has no `.describe()`, and its JSON schema lists bare names.
 *
 * ## What it composes
 *
 * The same `Popover` + `Command` (cmdk) parts from `@object-ui/components`
 * that the custom-layer `Combobox` and the sibling `InspectorComboField` are
 * built from. Neither of those two fits as it stands: `Combobox` draws one
 * ungrouped list of labels, and re-choosing its current value commits `''`;
 * `InspectorComboField` draws the raw value in monospace and has no place for
 * an icon or a description.
 *
 * ## Behaviour it keeps from the select it replaces
 *
 * - Choosing a type commits that type's id once; re-choosing the current type
 *   commits nothing.
 * - A stored type the catalog does not list is shown as itself under the
 *   designer's "(not found)" flag, never as blank and never as another type.
 * - `disabled` (a read-only field) disables the trigger.
 *
 * ## The search (objectui#12516)
 *
 * The list opens with its search input focused at the top. A query keeps the
 * types whose name, category, id or English name contains it, or whose
 * description holds it as whole words; each group keeps its heading over its
 * matches and a group with none is dropped. The arrow keys move through what
 * is left and Enter picks the highlighted type.
 *
 * Module-private: imported by `ObjectFieldInspector` and the Studio's Add field
 * popover (`studio-design/AddFieldPopover`), exported from no barrel.
 */

import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import {
  cn,
  Button,
  Label,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import {
  CATEGORY_TONE,
  FIELD_TYPE_META,
  TYPES_BY_CATEGORY,
  type FieldTypeCategory,
  type FieldTypeId,
} from '../previews/field-types.js';
import { t, useMetadataLocale, type SupportedLocale } from '../i18n.js';
import { flagUnknownValue } from './_shared.js';

export interface FieldTypePickerProps {
  /** The visible label, associated with the trigger. */
  label: string;
  /** The field's stored type. */
  value: string;
  /** Runs once per choice of a type other than the current one. */
  onCommit: (type: FieldTypeId) => void;
  disabled?: boolean;
  /** The designer locale; defaults to the one the designer context carries. */
  locale?: SupportedLocale;
}

/** One type as the picker shows and searches it. */
interface TypeRow {
  id: FieldTypeId;
  name: string;
  description: string;
}

interface TypeGroup {
  category: FieldTypeCategory;
  heading: string;
  rows: TypeRow[];
}

/** A letter or a digit in any script: what a word is made of. */
const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Scripts written without spaces between words, where a whole-word match has
 * no word edge to find: a query in one of them matches a description as a
 * substring.
 */
const UNSPACED_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

/**
 * Whether `query` (lower-cased) is in a type's description as whole words:
 * starting and ending on a word edge (objectui#12516). A description is prose,
 * so a substring match would pull in types by an inflection of the query —
 * `pick` would find Slider through "A number picked on a slider".
 */
function inDescription(description: string, query: string): boolean {
  const text = description.toLowerCase();
  if (UNSPACED_SCRIPT.test(query)) return text.includes(query);
  for (let at = text.indexOf(query); at !== -1; at = text.indexOf(query, at + 1)) {
    const before = text[at - 1];
    const after = text[at + query.length];
    if ((before === undefined || !WORD_CHAR.test(before)) && (after === undefined || !WORD_CHAR.test(after))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a type matches the search: its name as shown, its category as shown,
 * its id (`master_detail` also as `master detail`) and the catalog's English
 * name, as substrings, so an author finds a type by any of the words they know
 * it by while still typing them; and its one-line description, as whole words
 * (see {@link inDescription}).
 */
function matches(row: TypeRow, heading: string, query: string): boolean {
  if (!query) return true;
  const haystacks = [
    row.name,
    heading,
    row.id,
    row.id.replace(/_/g, ' '),
    FIELD_TYPE_META[row.id].label,
  ];
  return haystacks.some((h) => h.toLowerCase().includes(query)) || inDescription(row.description, query);
}

export function FieldTypePicker({ label, value, onCommit, disabled, locale: localeProp }: FieldTypePickerProps) {
  const contextLocale = useMetadataLocale();
  const locale = localeProp ?? contextLocale;
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const triggerId = React.useId();
  const rowIdBase = React.useId();
  const listRef = React.useRef<HTMLDivElement>(null);

  const groups = React.useMemo<TypeGroup[]>(
    () =>
      TYPES_BY_CATEGORY.map((g) => ({
        category: g.category,
        heading: t(`engine.fieldCategory.${g.category}`, locale),
        rows: g.types.map((id) => ({
          id,
          name: t(`engine.fieldType.${id}`, locale),
          description: t(`engine.fieldTypeDesc.${id}`, locale),
        })),
      })),
    [locale],
  );

  const query = search.trim().toLowerCase();
  const shown = React.useMemo(
    () =>
      groups
        .map((g) => ({ ...g, rows: g.rows.filter((r) => matches(r, g.heading, query)) }))
        .filter((g) => g.rows.length > 0),
    [groups, query],
  );

  // The current type, from the catalog; a stored type it does not list is
  // shown as itself, flagged.
  const current = value in FIELD_TYPE_META ? FIELD_TYPE_META[value as FieldTypeId] : undefined;
  const CurrentIcon = current?.Icon;
  const triggerText = current
    ? t(`engine.fieldType.${current.id}`, locale)
    : flagUnknownValue(value, t('engine.form.notFound', locale), locale);

  // Opening scrolls the current type into view, so the list starts where the
  // author already is rather than at its top.
  React.useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-current]')?.scrollIntoView?.({ block: 'nearest' });
  }, [open]);

  const choose = (id: FieldTypeId) => {
    setOpen(false);
    setSearch('');
    if (id !== value) onCommit(id);
  };

  return (
    <div className="space-y-1">
      <Label htmlFor={triggerId} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setSearch('');
        }}
      >
        <PopoverTrigger asChild>
          {/* The id goes on the trigger `Button`, never on `Popover`, which
              renders no element of its own (see `InspectorComboField`). */}
          <Button
            type="button"
            variant="outline"
            role="combobox"
            id={triggerId}
            aria-expanded={open}
            disabled={disabled}
            data-field-type={value}
            className="h-8 w-full justify-between px-2 text-sm font-normal"
          >
            <span className="flex min-w-0 items-center gap-2">
              {CurrentIcon && current && (
                <CurrentIcon aria-hidden className={cn('h-3.5 w-3.5 shrink-0', CATEGORY_TONE[current.category].icon)} />
              )}
              <span className="truncate">{triggerText}</span>
            </span>
            <ChevronsUpDown aria-hidden className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[18rem] p-0">
          {/* Filtered here rather than by cmdk, so the match is the one
              `matches` states: name, category, id, English name and
              description. */}
          {/* cmdk names its search input through the `label` it is given
              (`aria-labelledby`), so the name goes there, not on the input. */}
          <Command
            shouldFilter={false}
            defaultValue={current?.id}
            label={t('designer.canvas.searchFieldType', locale)}
          >
            <CommandInput
              value={search}
              onValueChange={setSearch}
              placeholder={t('designer.canvas.searchFieldType', locale)}
            />
            <CommandList ref={listRef} label={label} className="max-h-80">
              {shown.length === 0 && <CommandEmpty>{t('designer.canvas.noMatchingTypes', locale)}</CommandEmpty>}
              {shown.map((g) => (
                <CommandGroup key={g.category} heading={g.heading}>
                  {g.rows.map((row) => {
                    const meta = FIELD_TYPE_META[row.id];
                    const Icon = meta.Icon;
                    const isCurrent = row.id === value;
                    const nameId = `${rowIdBase}-${row.id}-name`;
                    const descId = `${rowIdBase}-${row.id}-desc`;
                    return (
                      <CommandItem
                        key={row.id}
                        value={row.id}
                        onSelect={() => choose(row.id)}
                        // The option is named by the type and described by its
                        // line, rather than read as one run of both.
                        aria-labelledby={nameId}
                        aria-describedby={descId}
                        data-field-type={row.id}
                        data-current={isCurrent ? '' : undefined}
                        className="items-start"
                      >
                        <Icon aria-hidden className={cn('mt-0.5', CATEGORY_TONE[meta.category].icon)} />
                        <span className="min-w-0 flex-1">
                          <span id={nameId} className={cn('block truncate', isCurrent && 'font-medium')}>
                            {row.name}
                          </span>
                          <span id={descId} className="block truncate text-[11px] leading-snug text-muted-foreground">
                            {row.description}
                          </span>
                        </span>
                        <Check aria-hidden className={cn('mt-0.5', isCurrent ? 'opacity-100' : 'opacity-0')} />
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
