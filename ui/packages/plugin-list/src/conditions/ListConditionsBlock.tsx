/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The list page's condition row for a host that is not a `ListView`
 * (objectstack#35892): a record page's related tab, which draws the child
 * object's rows itself. That host sits below this package (`plugin-list`
 * depends on `plugin-detail`), so it gets this block through its own slot
 * (`RelatedListConditionsSlotContext`), which the record page fills. A host
 * element, never a registered node type: nothing about it is authored.
 *
 * It is the list page's own parts, not a copy: `ConditionChipRow` with the
 * `SortPanel`, the `FilterPanel` and their advanced steps (`SortBuilder`,
 * `FilterBuilder`); the field lists come from the rules `ListView` reads
 * (`conditionCandidatesOf`, `filterConditionFieldsOf`, `sortConditionFieldsOf`);
 * a filter reaches the host as the group the panels edit and as the query
 * node `ListView` sends (`convertFilterGroupToAST` over `appliedFilterGroup`).
 * There is no view switch, no view settings and no search.
 *
 * Controlled, like the row: the host holds the sort and the filter group and
 * says what is offered; nothing here stores anything. Every input is a React
 * prop, never a node key.
 */

import * as React from 'react';
import { FilterBuilder, SortBuilder, type FilterBuilderRowGroup, type SortItem } from '@object-ui/components';
import { readObjectSortability } from '@object-ui/core';
import { useObjectLabel, useSafeFieldLabel } from '@object-ui/i18n';
import { usePermissions } from '@object-ui/permissions';
import type { DataSource } from '@object-ui/types';
import {
  LIST_VIEW_EXTRA_OPERATORS,
  appliedFilterGroup,
  conditionCandidatesOf,
  conditionOptionsOf,
  convertFilterGroupToAST,
  filterConditionFieldsOf,
  readDraftOnlyFieldNames,
  sortConditionFieldsOf,
  useListViewTranslation,
} from '../ListView';
import { ConditionChipRow, ConditionDiscardButton, SortPanel } from './ListConditionControls';

export interface ListConditionsHostProps {
  /** The object the rows are records of. */
  objectName?: string;
  /** Its definition, as the host read it (`getObjectSchema`). */
  objectDef?: { fields?: Record<string, any> } | null;
  /** The fields the host's table shows, in column order: they lead both field lists. */
  shownFields?: ReadonlyArray<string>;
  sort: ReadonlyArray<SortItem>;
  onSortChange: (next: SortItem[]) => void;
  filters: FilterBuilderRowGroup;
  /**
   * The next filter group, with the filter it applies as the query node the
   * list page sends (`undefined` = no filter): finished rows only.
   */
  onFiltersChange: (next: FilterBuilderRowGroup, filter: unknown[] | undefined) => void;
  /** `userActions.sort` / `userActions.filter`, as the list page reads them. */
  sortOffered?: boolean;
  filterOffered?: boolean;
  /**
   * 「Discard」 at the row's end, drawn while given: the host passes it only
   * while the reader's conditions differ from the default.
   */
  onDiscard?: () => void;
  /** Anything else at the row's right end, after 「Discard」. */
  end?: React.ReactNode;
  /** Where the names of the records a lookup condition points at are read. */
  dataSource?: Pick<DataSource, 'find' | 'getObjectSchema'> | null;
  className?: string;
}

export const ListConditionsBlock: React.FC<ListConditionsHostProps> = ({
  objectName,
  objectDef,
  shownFields,
  sort,
  onSortChange,
  filters,
  onFiltersChange,
  sortOffered = true,
  filterOffered = true,
  onDiscard,
  end,
  dataSource,
  className,
}) => {
  const { t } = useListViewTranslation();
  const { fieldLabel } = useObjectLabel();
  const { translateOptions } = useSafeFieldLabel();
  const perms = usePermissions();
  const defs = objectDef?.fields;

  const candidates = React.useMemo(() => {
    if (!defs) return [];
    return conditionCandidatesOf(
      defs,
      (field, fallback) => (objectName ? fieldLabel(objectName, field, fallback) : fallback),
      (field, raw) => {
        const options = conditionOptionsOf(raw);
        if (!options) return undefined;
        return objectName ? translateOptions(objectName, field, options) : options;
      },
    );
  }, [defs, objectName, fieldLabel, translateOptions]);
  const draftOnly = React.useMemo(() => readDraftOnlyFieldNames(objectDef), [objectDef]);
  const platformSortability = React.useMemo(() => readObjectSortability(objectDef), [objectDef]);
  const shownKey = (shownFields ?? []).join('\n');
  const shown = React.useMemo(() => (shownKey ? shownKey.split('\n') : []), [shownKey]);

  const filterFields = React.useMemo(
    () => filterConditionFieldsOf(candidates, {
      defs,
      perms,
      objectName,
      held: new Set((filters.conditions ?? []).map((c) => c.field)),
      columnOrder: shown,
      draftOnly,
    }),
    [candidates, defs, perms, objectName, filters.conditions, shown, draftOnly],
  );
  const sortFields = React.useMemo(
    () => sortConditionFieldsOf(candidates, {
      defs,
      perms,
      objectName,
      inUse: new Set(sort.map((item) => item.field).filter(Boolean)),
      platformSortability,
      draftOnly,
      byIdSuffix: t('list.sortByIdSuffix'),
    }).fields,
    [candidates, defs, perms, objectName, sort, platformSortability, draftOnly, t],
  );

  const applyFilters = React.useCallback((next: FilterBuilderRowGroup) => {
    const node = convertFilterGroupToAST(appliedFilterGroup(next));
    onFiltersChange(next, node.length > 0 ? node : undefined);
  }, [onFiltersChange]);

  const advancedFilter = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h4 className="font-medium text-sm">{t('list.filterRecords')}</h4>
      </div>
      <FilterBuilder
        fields={filterFields}
        value={filters}
        extraOperators={LIST_VIEW_EXTRA_OPERATORS}
        onChange={applyFilters}
      />
    </div>
  );
  const sortLevels = (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-2">
        <h4 className="font-medium text-sm">{t('list.sortRecords')}</h4>
      </div>
      <SortBuilder fields={sortFields} value={[...sort]} onChange={onSortChange} />
    </div>
  );

  return (
    <ConditionChipRow
      sort={sort}
      sortFields={sortFields}
      filters={filters}
      filterFields={filterFields}
      onFiltersChange={applyFilters}
      dataSource={dataSource}
      shownFields={shown}
      renderAdvanced={advancedFilter}
      renderSortLevels={() => sortLevels}
      end={onDiscard || end ? (
        <>
          {onDiscard ? <ConditionDiscardButton onDiscard={onDiscard} className="max-sm:h-11" /> : null}
          {end}
        </>
      ) : undefined}
      filterOffered={filterOffered}
      collapsibleLabels
      className={className}
      renderSortPanel={sortOffered ? (close) => (
        <SortPanel
          fields={sortFields}
          shownFields={shown}
          value={sort}
          onChange={onSortChange}
          onDone={close}
          renderAdvanced={() => sortLevels}
        />
      ) : undefined}
    />
  );
};
