/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The line-item grid's cell faces that open a panel under the cell
 * (objectstack#36023): a select cell's searchable option list, a date or
 * date-time cell's calendar, and a text cell that floats right over its
 * neighbours while its text is longer than the column.
 *
 * The grid stays a typing-first grid: a text, number or date cell is a live
 * input the user types into on arrival, and a panel never takes that away.
 * Every face keeps the row's height: a panel floats over the table, and the
 * cell keeps drawing its value while it is open.
 */

import React from 'react';
import {
  cn,
  Calendar,
  Button,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@object-ui/components';
import { InCellOptionList, type InCellOption } from './InCellOptionList.js';
import { useFieldTranslation } from './useFieldTranslation.js';
import { PHONE_TOUCH_HEIGHT } from './touchTarget.js';

// The two day helpers are spelled here rather than imported from
// `./date-picker/`: that directory is its own lazy chunk, and the line-item
// grid is in the Console's eager closure.
const pad2 = (n: number) => String(n).padStart(2, '0');
/** The local calendar day of `d` as `YYYY-MM-DD`. */
const toLocalDay = (d: Date): string => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** Local midnight of a `YYYY-MM-DD` day, for the calendar to select. */
function fromLocalDay(day: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : undefined;
}

/** The flat face every line-item cell control shares (no border, radius or fill of its own). */
export const GRID_CELL_CONTROL_CLASS =
  'h-8 rounded-none border-0 bg-transparent px-2 shadow-none focus-visible:ring-1 focus-visible:ring-ring/60';

/** The panel's popper box: under the cell, at least as wide as it. */
const PANEL_CLASS = 'w-auto min-w-[var(--radix-popover-trigger-width)] p-1';

/**
 * The tabbable control after (or before) `from` in its table, so Tab pressed
 * inside a panel (which the popover portals out of the table) still moves to
 * the next cell. `null` at either end.
 */
function neighbourTabbable(from: HTMLElement, backwards: boolean): HTMLElement | null {
  const table = from.closest('table');
  if (!table) return null;
  const all = Array.from(
    table.querySelectorAll<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])'),
  ).filter((el) => !(el as HTMLInputElement).disabled && el.tabIndex >= 0);
  const at = all.indexOf(from);
  if (at < 0) return null;
  return all[at + (backwards ? -1 : 1)] ?? null;
}

/** A key that types a character: it opens a select cell's list as its search. */
function isTypedCharacter(e: React.KeyboardEvent): boolean {
  return e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey;
}

export interface GridSelectCellProps {
  options: readonly InCellOption[];
  value: unknown;
  onPick: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  label: string;
  /** The grid's own key handler: the arrows move between lines. */
  onNavKeyDown: (e: React.KeyboardEvent) => void;
  'data-cell': string;
}

/**
 * A select cell: the cell shows the option's label; a click, Enter, Space,
 * F2 or Alt+ArrowDown opens the searchable list under it, and a typed letter
 * opens it with that letter as the search. A pick writes the value and
 * closes the list; Esc closes it and writes nothing. Tab moves on to the next
 * cell, as from any other cell.
 */
export function GridSelectCell({
  options,
  value,
  onPick,
  disabled,
  invalid,
  label,
  onNavKeyDown,
  'data-cell': dataCell,
}: GridSelectCellProps) {
  const [open, setOpen] = React.useState(false);
  const [initialQuery, setInitialQuery] = React.useState<string | undefined>(undefined);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const current = value == null || value === '' ? null : String(value);
  const shown = current == null ? null : options.find((o) => o.value === current)?.label ?? current;

  const openList = (query?: string) => {
    setInitialQuery(query);
    setOpen(true);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-label={label}
          aria-invalid={invalid || undefined}
          data-cell={dataCell}
          disabled={disabled}
          onKeyDown={(e) => {
            if (open) return;
            if (e.key === 'Enter' || e.key === ' ' || e.key === 'F2' || (e.altKey && e.key === 'ArrowDown')) {
              e.preventDefault();
              openList();
            } else if (isTypedCharacter(e)) {
              e.preventDefault();
              openList(e.key);
            } else {
              onNavKeyDown(e);
            }
          }}
          onClick={(e) => {
            // The trigger's own toggle is replaced: a click always opens with no search.
            e.preventDefault();
            if (!open) openList();
          }}
          className={cn(
            GRID_CELL_CONTROL_CLASS,
            PHONE_TOUCH_HEIGHT,
            'flex w-full items-center text-left text-sm outline-none disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <span className={cn('truncate', shown == null && 'text-muted-foreground')}>{shown ?? '—'}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={2}
        className={cn(PANEL_CLASS, 'max-w-[min(24rem,calc(100vw-2rem))]')}
        data-testid="line-items-select-panel"
        onOpenAutoFocus={(e) => {
          // The search box takes the caret, after any letter it opened with.
          e.preventDefault();
          const box = (e.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>('input');
          if (!box) return;
          box.focus();
          box.setSelectionRange(box.value.length, box.value.length);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Tab') return;
          // The panel lives outside the table, so Tab is moved on by hand.
          e.preventDefault();
          setOpen(false);
          const trigger = triggerRef.current;
          if (!trigger) return;
          (neighbourTabbable(trigger, e.shiftKey) ?? trigger).focus();
        }}
      >
        <InCellOptionList
          options={options}
          selected={current == null ? [] : [current]}
          multiple={false}
          initialQuery={initialQuery}
          inputProps={{ 'aria-label': label }}
          onPick={(v) => {
            onPick(v);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface GridDateCellProps extends Omit<React.ComponentProps<typeof Input>, 'value' | 'onChange'> {
  /** `date` or `datetime`: which native control, and what a calendar day writes. */
  kind: 'date' | 'datetime';
  /** The native control's value: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm`. */
  nativeValue: string;
  /** Write a native-shaped value (`''` clears). */
  onNativeChange: (next: string) => void;
  /** A notice about the stored value, drawn at the top of the panel. */
  notice?: React.ReactNode;
}

/**
 * A date or date-time cell: the browser's own control stays in the cell, so
 * the value is typed exactly as before, and the calendar opens under the cell
 * as soon as the cell is entered, with today / tomorrow / next week / clear.
 * A day picked writes the value (a date-time keeps its time) and closes the
 * calendar; the cell keeps the focus. Leaving the cell closes it.
 */
export function GridDateCell({ kind, nativeValue, onNativeChange, notice, className, ...inputProps }: GridDateCellProps) {
  const { t } = useFieldTranslation();
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  // A focus the panel itself hands back to the cell does not reopen it.
  const quietFocus = React.useRef(false);
  // A pick in the panel hands the focus back to the cell once the panel is gone.
  const refocus = React.useRef(false);
  const disabled = !!inputProps.disabled;

  const day = nativeValue ? nativeValue.slice(0, 10) : '';
  const selected = day ? fromLocalDay(day) : undefined;

  const finish = (next: string) => {
    onNativeChange(next);
    refocus.current = true;
    setOpen(false);
  };
  const pickDay = (picked: Date | undefined) => {
    if (!picked) return;
    const nextDay = toLocalDay(picked);
    finish(kind === 'datetime' ? `${nextDay}T${nativeValue.slice(11, 16) || '00:00'}` : nextDay);
  };
  const shortcut = (offsetDays: number) => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + offsetDays);
    pickDay(d);
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          {...inputProps}
          ref={inputRef}
          type={kind === 'date' ? 'date' : 'datetime-local'}
          value={nativeValue}
          onChange={(e) => onNativeChange(e.target.value)}
          className={cn(
            // The browser's own calendar button gives way to the panel.
            '[&::-webkit-calendar-picker-indicator]:hidden',
            className,
          )}
          onFocus={(e) => {
            inputProps.onFocus?.(e);
            if (!quietFocus.current) setOpen(true);
          }}
          onClick={(e) => {
            // The trigger's own toggle is replaced: a click on the cell opens, never closes.
            e.preventDefault();
            inputProps.onClick?.(e);
            setOpen(true);
          }}
          onBlur={(e) => {
            inputProps.onBlur?.(e);
            const to = e.relatedTarget as Node | null;
            if (to && panelRef.current?.contains(to)) return;
            setOpen(false);
          }}
        />
      </PopoverTrigger>
      <PopoverContent
        ref={panelRef}
        align="start"
        side="bottom"
        sideOffset={2}
        className={cn(PANEL_CLASS, 'p-0')}
        data-testid="line-items-date-panel"
        // The cell keeps the caret: the value is still typed in the cell.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (!refocus.current) return;
          refocus.current = false;
          quietFocus.current = true;
          inputRef.current?.focus();
          quietFocus.current = false;
        }}
        onInteractOutside={(e) => {
          if (inputRef.current?.contains(e.target as Node)) e.preventDefault();
        }}
      >
        {notice ? <div className="border-b px-3 py-2 text-xs text-destructive">{notice}</div> : null}
        <Calendar
          mode="single"
          defaultMonth={selected}
          selected={selected}
          onSelect={pickDay}
          className="[--cell-size:2.75rem] sm:[--cell-size:2rem]"
        />
        <div className="flex flex-wrap items-center gap-2 border-t p-2">
          <Button type="button" variant="outline" size="sm" className={PHONE_TOUCH_HEIGHT} onClick={() => shortcut(0)}>
            {t('fields.datePicker.today')}
          </Button>
          <Button type="button" variant="outline" size="sm" className={PHONE_TOUCH_HEIGHT} onClick={() => shortcut(1)}>
            {t('fields.datePicker.tomorrow')}
          </Button>
          {/* Seven days from today (ruling of record 7057128455). */}
          <Button type="button" variant="outline" size="sm" className={PHONE_TOUCH_HEIGHT} onClick={() => shortcut(7)}>
            {t('fields.datePicker.nextWeek')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className={PHONE_TOUCH_HEIGHT}
            onClick={() => finish('')}
            data-testid="line-items-date-clear"
          >
            {t('fields.datePicker.clearPick')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * A text cell's input that, while it holds the focus and its text is longer
 * than the column, floats right over the neighbouring cells (as far as the
 * grid's own scroll box allows) instead of scrolling its text out of sight.
 * The column and the row keep their size: a spacer holds the cell's place.
 */
export const GrowingCellInput = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input>>(
  function GrowingCellInput({ className, onFocus, onBlur, onInput, ...props }, forwardedRef) {
    const ownRef = React.useRef<HTMLInputElement | null>(null);
    const [width, setWidth] = React.useState<number | null>(null);
    const setRefs = (el: HTMLInputElement | null) => {
      ownRef.current = el;
      if (typeof forwardedRef === 'function') forwardedRef(el);
      else if (forwardedRef) forwardedRef.current = el;
    };

    const measure = () => {
      const el = ownRef.current;
      const cell = el?.parentElement;
      if (!el || !cell || document.activeElement !== el) return;
      const base = cell.clientWidth;
      // The text's own width: what the input would need to show all of it.
      const needed = el.scrollWidth + 2;
      if (needed <= base) {
        setWidth(null);
        return;
      }
      const box = cell.closest('[data-line-items-scroll]') ?? cell.closest('table');
      const room = box ? box.getBoundingClientRect().right - cell.getBoundingClientRect().left - 4 : needed;
      setWidth(Math.max(base, Math.min(needed, room)));
    };
    // The value is controlled by the grid; measure after each render it changes.
    React.useLayoutEffect(measure, [props.value]);

    return (
      <div className="relative">
        {width != null ? <div aria-hidden className={cn('h-8', PHONE_TOUCH_HEIGHT)} /> : null}
        <Input
          {...props}
          ref={setRefs}
          data-cell-grown={width != null || undefined}
          className={cn(
            className,
            width != null && 'absolute left-0 top-0 z-20 bg-background shadow-md ring-1 ring-ring',
          )}
          // A measured width only: the one size utilities cannot know ahead.
          style={width != null ? { width } : undefined}
          onFocus={(e) => {
            onFocus?.(e);
            measure();
          }}
          onInput={(e) => {
            onInput?.(e);
            measure();
          }}
          onBlur={(e) => {
            onBlur?.(e);
            setWidth(null);
          }}
        />
      </div>
    );
  },
);
