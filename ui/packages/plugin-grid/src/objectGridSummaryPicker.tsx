/**
 * One cell of the list's resident footer row (objectstack#35702): the
 * column's calculation, drawn as its name in the secondary text colour and its
 * figure in the normal one (「Sum ¥1,234,500」). For a reader who may change
 * the view it is also the control: a click opens one menu of the calculations
 * the column's field type allows, the current one ticked and 「None」 last; an
 * empty cell always shows a faint 「+ Add calculation」, so a reader who has
 * never hovered the footer still sees the control (objectstack#36048). Without
 * `onPick` it only draws, and an empty cell draws nothing.
 */

import React from 'react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@object-ui/components';
import { Check, Plus } from 'lucide-react';
import type { ColumnSummaryType, SummaryTranslate } from './useColumnSummary';
import { summaryMenuLabel } from './useColumnSummary';

export interface SummaryCellFigure {
  name: string;
  text: string;
  label: string;
}

export interface SummaryCellPickerProps {
  field: string;
  /** The figure drawn, when the column has one. */
  figure?: SummaryCellFigure;
  /** The column's calculation in force (`'none'` / absent ⇒ none). */
  current?: ColumnSummaryType;
  /** The calculations the menu lists, in order. */
  offered: ReadonlyArray<ColumnSummaryType>;
  /** The column's field is a date or time (its min / max read Earliest / Latest). */
  temporal: boolean;
  /**
   * The column's alignment, as its cells take it. The trigger is a flex box,
   * which the cell's `text-align` does not move, so the figure is justified
   * from this (a right-aligned amount's sum ends under the amounts).
   */
  align?: 'left' | 'center' | 'right';
  /** Wired only for a reader who may change the view. `null` = None. */
  onPick?: (field: string, summary: ColumnSummaryType | null) => void;
  t: SummaryTranslate;
}

function Figure({ figure }: { figure: SummaryCellFigure }) {
  return (
    <span className="truncate" title={figure.label}>
      <span className="text-muted-foreground">{figure.name}</span>{' '}
      <span className="text-foreground">{figure.text}</span>
    </span>
  );
}

export function SummaryCellPicker({ field, figure, current, offered, temporal, align, onPick, t }: SummaryCellPickerProps) {
  if (!onPick) return figure ? <Figure figure={figure} /> : null;
  const active = current && current !== 'none' ? current : undefined;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`summary-picker-${field}`}
          aria-label={figure ? figure.label : t('grid.summary.calculate')}
          className={cn(
            'group/summary flex h-8 w-full min-w-0 items-center gap-1 rounded-sm [text-align:inherit]',
            align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start',
            'hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          {figure ? (
            <Figure figure={figure} />
          ) : (
            <span
              data-testid={`summary-picker-hint-${field}`}
              className="inline-flex min-w-0 items-center gap-1 truncate font-normal text-muted-foreground/70 transition-colors group-hover/summary:text-foreground group-focus-visible/summary:text-foreground"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('grid.summary.calculate')}</span>
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align === 'right' ? 'end' : align === 'center' ? 'center' : 'start'} className="min-w-[10rem]" data-testid={`summary-menu-${field}`}>
        {offered.map((summary) => (
          <DropdownMenuItem
            key={summary}
            data-testid={`summary-option-${summary}`}
            onSelect={() => onPick(field, summary)}
          >
            <Check className={cn('mr-2 h-3.5 w-3.5', summary === active ? 'opacity-100' : 'opacity-0')} />
            {summaryMenuLabel(summary, temporal, t)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid="summary-option-none" onSelect={() => onPick(field, null)}>
          <Check className={cn('mr-2 h-3.5 w-3.5', active ? 'opacity-0' : 'opacity-100')} />
          {t('grid.summary.none')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
