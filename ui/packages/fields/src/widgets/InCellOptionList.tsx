import React from 'react';
import { Check, Plus } from 'lucide-react';
import { cn } from '@object-ui/components';
import { isImeKey } from './imeKey.js';
import { useFieldTranslation } from './useFieldTranslation.js';

/** One row of {@link InCellOptionList}: the value it writes and the text it shows. */
export interface InCellOption {
  value: string;
  label: string;
}

/**
 * The option list a select, multi-select or tags field draws in the list
 * grid's cell editor (objectstack#35688): a search box over a listbox, open as
 * soon as the editor opens. Typing filters by label; the arrow keys move the
 * active row; Enter or a click picks it.
 *
 * - `multiple: false` — a pick calls `onPick` with that value (the grid commits
 *   it and closes the editor).
 * - `multiple: true` — a pick toggles the row's check and calls `onPick`; the
 *   editor stays open and commits when the user moves on.
 * - `onAdd` (tags) — when the typed text matches no row, an "Add" row writes it.
 *
 * Enter that picks is kept from the grid (`stopPropagation`): the grid's own
 * Enter would commit the value it held before the pick. With no active row,
 * Enter goes on to the grid, which commits and moves down. Escape always goes
 * on to the grid, which cancels.
 */
export function InCellOptionList({
  options,
  selected,
  multiple,
  onPick,
  onAdd,
  placeholder,
  testId,
  inputProps,
}: {
  options: readonly InCellOption[];
  selected: readonly string[];
  multiple: boolean;
  onPick: (value: string) => void;
  onAdd?: (text: string) => void;
  placeholder?: string;
  testId?: string;
  /** The host's DOM pass-through (id, aria-describedby, …), onto the search box. */
  inputProps?: React.InputHTMLAttributes<HTMLInputElement>;
}) {
  const { t } = useFieldTranslation();
  const listId = React.useId();
  const [query, setQuery] = React.useState('');
  const needle = query.trim().toLocaleLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLocaleLowerCase().includes(needle)) : options;
  const addText = onAdd && query.trim() !== '' && !options.some((o) => o.label === query.trim()) ? query.trim() : null;
  // The "Add" row leads, so Enter after typing a new tag adds it rather than
  // toggling a longer tag that contains the text.
  const lead = addText !== null ? 1 : 0;
  const rowCount = lead + shown.length;

  // The active row starts on the current value (a single select) and on the
  // first row once the user types; -1 is "none". It is an index into the FULL
  // list, which is the list shown again when the search box is cleared (an
  // index into the filtered list would land on another option then).
  const initialActive = multiple ? -1 : options.findIndex((o) => selected.includes(o.value));
  const [active, setActive] = React.useState(initialActive);
  const listRef = React.useRef<HTMLUListElement | null>(null);

  React.useEffect(() => {
    if (active < 0) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-row-index="${active}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const pickRow = (index: number) => {
    if (index < lead && addText !== null) {
      onAdd?.(addText);
      setQuery('');
      setActive(-1);
    } else if (index - lead < shown.length) onPick(shown[index - lead].value);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isImeKey(e)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // The arrows move inside the list, never the grid's selection.
      e.stopPropagation();
      if (rowCount === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i < 0 ? (step > 0 ? 0 : rowCount - 1) : (i + step + rowCount) % rowCount));
    } else if (e.key === 'Enter' && !e.shiftKey && active >= 0 && active < rowCount) {
      e.preventDefault();
      e.stopPropagation();
      pickRow(active);
    }
  };

  const activeId = active >= 0 && active < rowCount ? `${listId}-${active}` : undefined;

  return (
    <div className="flex w-full flex-col gap-1" data-slot="in-cell-options" data-testid={testId}>
      <input
        {...inputProps}
        type="text"
        role="combobox"
        aria-expanded="true"
        aria-controls={listId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        value={query}
        placeholder={placeholder ?? t('fields.options.search')}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(e.target.value.trim() ? 0 : initialActive);
        }}
        onKeyDown={onKeyDown}
        className={cn(
          'h-8 w-full rounded-sm border border-input bg-background px-2 text-[13px] outline-none',
          'focus-visible:ring-1 focus-visible:ring-ring',
        )}
      />
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-multiselectable={multiple || undefined}
        className="max-h-60 overflow-y-auto"
      >
        {addText !== null ? (
          <li
            id={`${listId}-0`}
            role="option"
            aria-selected={false}
            data-row-index={0}
            data-testid="in-cell-option-add"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => pickRow(0)}
            onPointerMove={() => setActive(0)}
            className={cn(
              'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[13px]',
              active === 0 && 'bg-accent text-accent-foreground',
            )}
          >
            <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('fields.tags.add', { value: addText })}</span>
          </li>
        ) : null}
        {shown.map((o, at) => {
          const i = at + lead;
          const isSelected = selected.includes(o.value);
          return (
            <li
              key={o.value}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={isSelected}
              data-row-index={i}
              data-active={i === active || undefined}
              data-testid={`in-cell-option-${o.value}`}
              // The search box keeps the focus, so typing goes on filtering.
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => {
                setActive(i);
                pickRow(i);
              }}
              onPointerMove={() => setActive(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1 text-[13px]',
                i === active && 'bg-accent text-accent-foreground',
              )}
            >
              <Check className={cn('h-3.5 w-3.5 shrink-0', isSelected ? 'opacity-100' : 'opacity-0')} aria-hidden="true" />
              <span className="truncate">{o.label}</span>
            </li>
          );
        })}
        {rowCount === 0 ? (
          <li role="presentation" className="px-2 py-1 text-[13px] text-muted-foreground">
            {t('fields.options.noMatches')}
          </li>
        ) : null}
      </ul>
    </div>
  );
}
