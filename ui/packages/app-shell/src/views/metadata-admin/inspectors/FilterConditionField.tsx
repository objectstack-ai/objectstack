// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * FilterConditionField — the visual editor for a spec `FilterCondition`
 * (the Query-DSL object a query `where` speaks), shared by every inspector that
 * authors one: the dataset designer's scope and measure filters, and the field
 * inspector's `relatedListFilter`. It is the list toolbar's {@link FilterBuilder}
 * behind the `datasetFilterCondition` bridge, so there is one builder and one
 * conversion, never a second copy per inspector.
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, FilterBuilder, Label, Popover, PopoverContent, PopoverTrigger } from '@object-ui/components';
import { conditionToGroup, groupToCondition, isClearedGroup, type BuilderGroup, type FilterCondition } from './datasetFilterCondition.js';
import { t, tFormat, type SupportedLocale } from '../i18n.js';

/** `{token}` slots in a translated template filled with nodes (see the dataset inspector's twin). */
function withSlots(template: string, slots: Record<string, React.ReactNode>): React.ReactNode {
  return template.split(/\{(\w+)\}/).map((part, i) =>
    i % 2 === 1 ? <React.Fragment key={i}>{part in slots ? slots[part] : `{${part}}`}</React.Fragment> : part,
  );
}

/**
 * Visual filter editor for a dataset/measure `FilterCondition`. Wraps the shared
 * {@link FilterBuilder} (a flat AND of `field op value` rows) and converts to/from
 * the spec's Mongo-style `FilterCondition`. Filters it can't faithfully edit
 * (nested / `$or` / multi-op) degrade to a "edit in Source" note rather than being
 * silently rewritten. See {@link conditionToGroup} / {@link groupToCondition}.
 */
export function FilterConditionField({ label, help, value, onCommit, fields, disabled, locale, advancedNote, noFieldsNote, testId }: {
  label: string;
  help?: string;
  value: FilterCondition | undefined;
  onCommit: (fc: FilterCondition | undefined) => void;
  fields: Array<{ value: string; label?: string; type?: string }>;
  disabled?: boolean;
  locale: SupportedLocale;
  /**
   * What the field says in place of the builder when the stored filter is one
   * the flat builder cannot hold. Defaults to the dataset designer's sentence,
   * which points at its Source tab; a host without that tab says its own.
   */
  advancedNote?: React.ReactNode;
  /** What the popover says when there are no fields to filter on. */
  noFieldsNote?: string;
  /** `data-testid` on the field's wrapper. */
  testId?: string;
}) {
  // `fields` is handed to the READ half as well as to the builder: it is what
  // lets a stored `$gt` on a date column read back as `after` — the operator
  // that column's dropdown offers — instead of a `greaterThan` it does not
  // list, which drew a blank operator trigger (objectui#9382).
  const { group, representable } = conditionToGroup(value, fields);
  const count = group.conditions.length;
  /**
   * Commit an edit — unless nothing survived serialization while rows are
   * still on screen (objectui#9372).
   *
   * `groupToCondition` answers `undefined` both when the author CLEARED the
   * filter and when every row was dropped, and this commit is what turns the
   * second one into data loss: `onCommit` lands as `onPatch({ filter })`, the
   * host applies it as `{ ...draft, ...patch }`, so `filter` is SET to
   * `undefined` — the very patch shape `objectChangePatch` uses to erase it.
   * An unmapped operator (`between`) or a blanked value on the only row would
   * therefore destroy a working stored filter, silently.
   *
   * Holding the patch leaves the stored value alone, which is the whole
   * requirement. ⛔ It is deliberately not "emit something anyway": a filter in
   * a spelling that means something else is worse than one that was dropped.
   * ⚠️ Known and accepted: the builder re-seeds its own state from `value`
   * whenever the two differ, so an unexpressible row is lost from the panel on
   * the next render the inspector happens to do. Losing an edit the bridge
   * could never have stored is not in the same class as destroying one it had.
   */
  const commitFilterGroup = (g: BuilderGroup) => {
    const next = groupToCondition(g);
    if (next === undefined && !isClearedGroup(g)) return;
    onCommit(next);
  };
  return (
    <div className="space-y-1" data-testid={testId}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {!representable ? (
        <p className="rounded-md border border-dashed bg-muted/30 px-2.5 py-1.5 text-[11px] text-muted-foreground">
          {advancedNote ?? withSlots(t('engine.inspector.dataset.filterAdvanced', locale), {
            source: <span className="font-medium">{t('engine.inspector.dataset.sourceTab', locale)}</span>,
          })}
        </p>
      ) : (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" disabled={disabled} className="h-8 w-full justify-between text-xs font-normal">
              <span className="truncate text-left">
                {count
                  ? tFormat(count === 1 ? 'engine.inspector.dataset.filterConditionsOne' : 'engine.inspector.dataset.filterConditionsOther', locale, { count })
                  : <span className="text-muted-foreground">{t('engine.inspector.dataset.addFilter', locale)}</span>}
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60 shrink-0" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[440px] max-w-[90vw] p-3">
            {fields.length === 0 ? (
              <p className="text-xs text-muted-foreground">{noFieldsNote ?? t('engine.inspector.dataset.filterNeedsObject', locale)}</p>
            ) : (
              <FilterBuilder fields={fields as any} value={group as any} onChange={commitFilterGroup} />
            )}
          </PopoverContent>
        </Popover>
      )}
      {help && <p className="text-[10px] text-muted-foreground">{help}</p>}
    </div>
  );
}
