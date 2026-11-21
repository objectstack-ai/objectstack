/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The phone's list toolbar and its panels (objectstack#35883, objectstack#35884).
 *
 * The phone is the same console at a narrow width, not a second app: every
 * panel here draws the desktop's own content in a different container.
 *
 * - `PhonePanelSheet`: the container. A sheet that rises from the bottom and
 *   covers nearly the whole screen; a round 「×」 at the top left, the title in
 *   the middle, a round 「✓」 at the top right. A swipe down, the overlay or
 *   Escape close it as 「×」 does.
 * - `PhoneSortSheet`: `SortBuilder`'s `stacked` layout (the desktop's every-level
 *   sort panel, objectstack#35876) for the levels, `SortPanel` (the desktop's
 *   field list with the direction on top) to add one and `FieldList` to change
 *   a level's field.
 * - `PhoneFilterSheet`: one item per filter, then `FilterPanel` (the desktop's
 *   field list → values steps) to add or change one.
 * - `PhoneViewSettingsSheet`: `ViewSettingsContent`, the desktop's 视图设置.
 *
 * The one behaviour the phone adds is 「✓ to apply」 on sort and filter: the
 * sheet edits a copy of the list's sort or filter (the staging layer) and hands
 * it to the list's own write (`onApply`, the same `applySort` /
 * `applyPanelFilters` the desktop chips call) only on 「✓」. 「×」 drops the copy.
 * Nothing here stores anything.
 */

import * as React from 'react';
import {
  cn,
  Button,
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  SortBuilder,
  type FilterBuilderRowGroup,
  type SortItem,
} from '@object-ui/components';
import type { DataSource } from '@object-ui/types';
import { ArrowUpDown, Check, ChevronLeft, Info, ListFilter, MoreHorizontal, Plus, X } from 'lucide-react';
import { FieldList } from '../conditions/FieldList';
import { isQuickRowApplied } from '../conditions/FilterValuePanel';
import { FilterPanel, SortPanel, describeConditionValue, useLookupValueNames } from '../conditions/ListConditionControls';
import { chipsAreIndependent, removeCondition, type ConditionField } from '../conditions/conditionModel';
import { useListConditionTranslation } from '../conditions/conditionTranslations';

// ---------------------------------------------------------------------------
// The toolbar's chips
// ---------------------------------------------------------------------------

/** A chip of the phone toolbar: a pill, 44 px tall (the phone's touch size, WCAG 2.5.5), 13 px text. */
export const PHONE_CHIP =
  'inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-full border bg-background px-3 text-[13px] font-medium leading-none transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

/** A chip whose condition is in force: highlighted, as the desktop's sort chip is. */
export const PHONE_CHIP_ACTIVE = 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15';

/**
 * What the list hands a view switcher drawn in its phone toolbar (the host's
 * `toolbarLeading`). Present ⇒ the switcher is in the phone toolbar: it draws
 * as a pill and opens its views in a `PhonePanelSheet`. `openViewSettings`
 * opens 视图设置, which on a phone is a row of the view panel rather than a
 * toolbar button (objectstack#35883); absent where the list offers no
 * settings. The context is `null` outside a phone toolbar.
 */
export interface ListPhonePanels {
  openViewSettings?: () => void;
}

export const ListPhonePanelsContext = React.createContext<ListPhonePanels | null>(null);

/** The phone panels the list on screen offers to its view switcher; `null` off a phone toolbar. */
export function useListPhonePanels(): ListPhonePanels | null {
  return React.useContext(ListPhonePanelsContext);
}

function CountBadge({ count, testId }: { count: number; testId: string }) {
  return (
    <span
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold tabular-nums text-primary-foreground"
      data-testid={testId}
    >
      {count}
    </span>
  );
}

export interface PhoneListToolbarProps {
  /** The host's view switcher (the list's `toolbarLeading`), first in the row. */
  lead?: React.ReactNode;
  /** The sort levels in force; `null` ⇒ no Sort chip (`userActions.sort: false`). */
  sortCount: number | null;
  /** The reader's filters in force; `null` ⇒ no Filter chip. */
  filterCount: number | null;
  onOpenSort: () => void;
  onOpenFilter: () => void;
  /** The list's search, already drawn by its host's right end (`toolbarTrailing`). */
  trailing?: React.ReactNode;
  /** The host's end of the row: the condition row's end on desktop (its Save, objectstack#35955). */
  end?: React.ReactNode;
}

/**
 * objectstack#35883 — the phone's one toolbar row: the view (its name and
 * count), Sort, Filter and Search, all pills; the host's end (Save, once there
 * is something to save) at the right. No condition row: the counts on the
 * chips say what is in force. One line; what does not fit scrolls inside it.
 */
export function PhoneListToolbar({
  lead,
  sortCount,
  filterCount,
  onOpenSort,
  onOpenFilter,
  trailing,
  end,
}: PhoneListToolbarProps) {
  const { t } = useListConditionTranslation();
  return (
    <div
      className="flex min-w-0 shrink-0 flex-nowrap items-center gap-1.5 overflow-x-auto border-b bg-background px-3 py-1.5 [scrollbar-width:none]"
      role="toolbar"
      aria-label={t('listConditions.phone.toolbar')}
      data-testid="phone-list-toolbar"
    >
      {lead != null && (
        <div className="flex min-w-0 max-w-[55%] shrink items-center" data-testid="phone-list-toolbar-view">
          {lead}
        </div>
      )}
      {sortCount !== null && (
        <button
          type="button"
          className={cn(PHONE_CHIP, sortCount > 0 ? PHONE_CHIP_ACTIVE : 'text-muted-foreground')}
          onClick={onOpenSort}
          aria-label={sortCount > 0
            ? t('listConditions.phone.sortCount', { count: sortCount })
            : t('listConditions.chips.sort')}
          data-testid="phone-sort-chip"
          data-count={sortCount}
        >
          <ArrowUpDown className="h-4 w-4" aria-hidden="true" />
          {sortCount > 0 && <CountBadge count={sortCount} testId="phone-sort-chip-count" />}
        </button>
      )}
      {filterCount !== null && (
        <button
          type="button"
          className={cn(PHONE_CHIP, filterCount > 0 ? PHONE_CHIP_ACTIVE : 'text-muted-foreground')}
          onClick={onOpenFilter}
          aria-label={filterCount > 0
            ? t('listConditions.phone.filterCount', { count: filterCount })
            : t('listConditions.chips.filter')}
          data-testid="phone-filter-chip"
          data-count={filterCount}
        >
          <ListFilter className="h-4 w-4" aria-hidden="true" />
          {filterCount > 0 && <CountBadge count={filterCount} testId="phone-filter-chip-count" />}
        </button>
      )}
      {trailing}
      {end ? (
        <div className="ml-auto flex shrink-0 items-center gap-1 pl-1" data-testid="phone-list-toolbar-end">{end}</div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

/** The field list and value steps take the sheet's width and height, not a popover's. */
const STEP_FILL = '[&>*]:w-full [&>*]:max-w-none [&_[role=listbox]]:max-h-none';

const ROUND_BUTTON =
  'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';

export interface PhonePanelSheetProps {
  open: boolean;
  /** `false` from 「×」, a swipe down, the overlay or Escape: the host drops its copy. */
  onOpenChange: (open: boolean) => void;
  title: string;
  /** 「✓」: absent ⇒ the sheet draws none (a panel that applies each choice at once). */
  onApply?: () => void;
  /** A step inside the panel: the left button goes back to the panel's first step instead of closing. */
  onBack?: () => void;
  children: React.ReactNode;
  testId?: string;
}

export function PhonePanelSheet({ open, onOpenChange, title, onApply, onBack, children, testId = 'phone-panel' }: PhonePanelSheetProps) {
  const { t } = useListConditionTranslation();
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent
        // Nearly the whole screen: a strip of the page stays in view above it.
        className="mt-0 h-[calc(100dvh-2.5rem)] max-h-[calc(100dvh-2.5rem)] outline-none"
        data-testid={testId}
      >
        <div className="grid shrink-0 grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 px-3 pb-2 pt-2">
          {onBack ? (
            <button type="button" className={ROUND_BUTTON} onClick={onBack} aria-label={t('listConditions.phone.back')} data-testid={`${testId}-back`}>
              <ChevronLeft className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className={ROUND_BUTTON}
              onClick={() => onOpenChange(false)}
              aria-label={onApply ? t('listConditions.phone.discard') : t('listConditions.phone.close')}
              data-testid={`${testId}-close`}
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          )}
          <DrawerTitle className="truncate text-center text-base font-semibold" data-testid={`${testId}-title`}>
            {title}
          </DrawerTitle>
          {onApply ? (
            <button
              type="button"
              className={cn(ROUND_BUTTON, 'bg-primary text-primary-foreground hover:bg-primary/90')}
              onClick={onApply}
              aria-label={t('listConditions.phone.apply')}
              data-testid={`${testId}-apply`}
            >
              <Check className="h-5 w-5" aria-hidden="true" />
            </button>
          ) : (
            <span aria-hidden="true" />
          )}
        </div>
        <DrawerDescription className="sr-only">{title}</DrawerDescription>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-[max(1rem,env(safe-area-inset-bottom))]" data-testid={`${testId}-body`}>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

/**
 * The staging layer: a copy of `value` taken each time the sheet opens, and the
 * panel's first step again. Reset while rendering (React's "adjust state when a
 * prop changes" pattern), so the first frame of an opening sheet already shows
 * the list's current value.
 */
function useStaged<T, S>(open: boolean, value: T, firstStep: S): [T, React.Dispatch<React.SetStateAction<T>>, S, React.Dispatch<React.SetStateAction<S>>] {
  const [staged, setStaged] = React.useState<T>(value);
  const [step, setStep] = React.useState<S>(firstStep);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStaged(value);
      setStep(firstStep);
    }
  }
  return [staged, setStaged, step, setStep];
}

// ---------------------------------------------------------------------------
// Sort
// ---------------------------------------------------------------------------

export interface PhoneSortSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: ReadonlyArray<ConditionField>;
  shownFields?: ReadonlyArray<string>;
  /** The sort in force. */
  value: ReadonlyArray<SortItem>;
  /** 「✓」: the list's own sort write (`applySort`). */
  onApply: (next: SortItem[]) => void;
  /** The host's note under the field list (fields it cannot sort by). */
  note?: React.ReactNode;
}

type SortBuilderFields = React.ComponentProps<typeof SortBuilder>['fields'];

type SortStep = { kind: 'levels' } | { kind: 'add' } | { kind: 'field'; id: string };

export function PhoneSortSheet({ open, onOpenChange, fields, shownFields, value, onApply, note }: PhoneSortSheetProps) {
  const { t } = useListConditionTranslation();
  const levels: SortStep = { kind: 'levels' };
  const [staged, setStaged, step, setStep] = useStaged<SortItem[], SortStep>(open, value as SortItem[], levels);

  let body: React.ReactNode;
  if (step.kind === 'add') {
    body = (
      <div className={STEP_FILL}>
        <SortPanel
          fields={fields}
          shownFields={shownFields}
          value={staged}
          onChange={setStaged}
          onDone={() => setStep(levels)}
          footer={note}
          testId="phone-sort-add"
        />
      </div>
    );
  } else if (step.kind === 'field') {
    const held = new Set(staged.filter((level) => level.id !== step.id).map((level) => level.field));
    body = (
      <div className={STEP_FILL}>
        <FieldList
          fields={fields.filter((field) => !field.disabled && !held.has(field.value))}
          shownFields={shownFields}
          onPick={(item) => {
            setStaged((current) => current.map((level) => (level.id === step.id ? { ...level, field: item.value } : level)));
            setStep(levels);
          }}
          testId="phone-sort-field"
        />
      </div>
    );
  } else {
    body = (
      <SortBuilder
        layout="stacked"
        fields={fields as SortBuilderFields}
        value={staged}
        onChange={setStaged}
        onAddLevel={() => setStep({ kind: 'add' })}
        onChangeLevelField={(id) => setStep({ kind: 'field', id })}
      />
    );
  }

  return (
    <PhonePanelSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('listConditions.chips.sort')}
      onApply={() => {
        onApply(staged.filter((level) => level.field));
        onOpenChange(false);
      }}
      onBack={step.kind === 'levels' ? undefined : () => setStep(levels)}
      testId="phone-sort-panel"
    >
      {body}
    </PhonePanelSheet>
  );
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

export interface PhoneFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: ReadonlyArray<ConditionField>;
  shownFields?: ReadonlyArray<string>;
  /** The reader's filter in force (the panel's group, unfinished rows included). */
  value: FilterBuilderRowGroup;
  /** 「✓」: the list's own filter write (`applyPanelFilters`). */
  onApply: (next: FilterBuilderRowGroup) => void;
  dataSource?: Pick<DataSource, 'find' | 'getObjectSchema'> | null;
}

type FilterStep = { kind: 'list' } | { kind: 'add' } | { kind: 'edit'; id: string };

export function PhoneFilterSheet({ open, onOpenChange, fields, shownFields, value, onApply, dataSource }: PhoneFilterSheetProps) {
  const { t } = useListConditionTranslation();
  const [staged, setStaged, step, setStep] = useStaged<FilterBuilderRowGroup, FilterStep>(open, value, { kind: 'list' });
  const applied = (staged.conditions ?? []).filter(isQuickRowApplied);
  const nameOf = useLookupValueNames(dataSource, fields, applied);
  const independent = chipsAreIndependent(staged);
  const toList = () => setStep({ kind: 'list' });

  let body: React.ReactNode;
  if (!independent) {
    // An advanced filter (groups, 「or」) is not edited on a phone: it says so
    // and keeps filtering.
    body = (
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground" role="status" data-testid="phone-filter-advanced-notice">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>{t('listConditions.phone.advancedNotice')}</p>
      </div>
    );
  } else if (step.kind !== 'list') {
    body = (
      <div className={STEP_FILL}>
        <FilterPanel
          // A new key per step, so each opens on its own first step.
          key={step.kind === 'edit' ? step.id : 'add'}
          fields={fields}
          shownFields={shownFields}
          value={staged}
          onChange={setStaged}
          renderAdvanced={() => null}
          advancedOffered={false}
          conditionId={step.kind === 'edit' ? step.id : undefined}
          testId="phone-filter-step"
        />
      </div>
    );
  } else if (applied.length === 0) {
    body = (
      <div className="flex flex-col items-center gap-4 px-4 py-10 text-center" data-testid="phone-filter-empty">
        <p className="text-sm text-muted-foreground">{t('listConditions.phone.filterEmpty')}</p>
        <Button type="button" className="h-11 gap-2 px-5" onClick={() => setStep({ kind: 'add' })} data-testid="phone-filter-add">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('listConditions.chips.addFilter')}
        </Button>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <div className="divide-y rounded-lg border" data-testid="phone-filter-items">
          {applied.map((row) => {
            const field = fields.find((f) => f.value === row.field);
            const label = field?.label ?? row.field;
            return (
              <div key={row.id} className="flex min-h-14 items-center gap-2 py-1.5 pl-3 pr-1" data-testid="phone-filter-item" data-field={row.field}>
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setStep({ kind: 'edit', id: row.id })} data-testid="phone-filter-item-open">
                  <div className="truncate text-sm font-medium">{label}</div>
                  <div className="truncate text-xs text-muted-foreground" data-testid="phone-filter-item-condition">
                    {describeConditionValue(field, row.operator, row.value, t, nameOf)}
                  </div>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-11 w-11 shrink-0"
                      aria-label={t('listConditions.phone.itemOptions', { label })}
                      data-testid="phone-filter-item-menu"
                    >
                      <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-44">
                    <DropdownMenuItem onSelect={() => setStep({ kind: 'edit', id: row.id })} data-testid="phone-filter-item-edit">
                      {t('listConditions.phone.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => setStaged((current) => removeCondition(current, row.id))}
                      data-testid="phone-filter-item-remove"
                    >
                      {t('listConditions.phone.remove')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => setStep({ kind: 'add' })}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          data-testid="phone-filter-add"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t('listConditions.chips.addFilter')}
        </button>
      </div>
    );
  }

  return (
    <PhonePanelSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('listConditions.chips.filter')}
      onApply={() => {
        onApply(staged);
        onOpenChange(false);
      }}
      onBack={step.kind === 'list' || !independent ? undefined : toList}
      testId="phone-filter-panel"
    >
      {body}
    </PhonePanelSheet>
  );
}
