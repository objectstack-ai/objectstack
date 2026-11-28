// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The names a detail's ‹ › step through (objectstack#36896, epic
 * objectstack#36890 decision 10): the type's list under the filter and sort
 * the detail address carries, read the way the list page reads it.
 *
 * The list page puts its state in its address (`metadataListState.ts`) and
 * every row link carries it, so the detail reads the same params from its own
 * address and runs the same {@link applyListState}: the order ‹ › walk is the
 * order the list drew. A detail opened with no list context — a refresh of a
 * bare item address, a shared link, ⌘K — gets every item of the scope by API
 * name, A to Z.
 *
 * The scope is the list's: the Studio area's package (with its `.custom`
 * pair), the environment scope (`?scope=environment`), the address's
 * `?package=`, or — an address naming none, or the area's cross-package leg —
 * every package's items.
 *
 * Feed `names` with the current item's name to `StudioDetailHeader`'s
 * `sequence`; its `detailSequence` places the item and finds the neighbours.
 */

import * as React from 'react';
import { useSearchParams } from 'react-router-dom';
import { customizationPackageId } from '@objectstack/spec/kernel';
import { matchesQuery, useMetadataClient, useMetadataTypes } from './useMetadata.js';
import { bundleMemberOf, resolveResourceConfig } from './registry.js';
import { isEnvironmentScope } from './catalog-scope.js';
import { useMetadataLocale } from './i18n.js';
import { useMetadataAreaHost } from './metadataAreaHost.js';
import { hasCatalogActivation, isCatalogHolderActive, readCatalogLedger, type CatalogLedgerRead } from './catalog-activation.js';
import { holdersOfName, servedHolderOf } from './permission-set-holder.js';
import { usePackageCustomizations } from '../studio-design/CustomizationMark.js';
import { customizationMarkOf, customizationTotal } from '../studio-design/customizationMarks.js';
import { classifyProvenance } from './ResourceListPage.js';
import { useListChangedAt } from './listChangedAt.js';
import { useInSetupApp } from '../../console/setupApp.js';
import { studioListSource, studioSourceKind } from './studioListSource.js';
import {
  decodeListState,
  hasListContext,
  orderedListNames,
  scopeListRows,
  DEFAULT_LIST_STATE,
  type ListRowReader,
} from './metadataListState.js';

export interface ListOrderedNames {
  /**
   * `loading` until the list — and any read its filters need (the
   * customization read, the activation ledger) — has answered; `error` when
   * the list read failed.
   */
  status: 'loading' | 'ready' | 'error';
  /** The names in list order; empty until `ready`. */
  names: readonly string[];
  /** The address carried a list context; without one the order is by API name. */
  fromList: boolean;
}

interface Row {
  item: Record<string, unknown>;
  source: 'artifact' | 'runtime';
}

const EMPTY: readonly string[] = [];
const DEFAULT_SEARCHABLE = ['name', 'label', 'description'];

/** The ordered names of `type`'s list, for the detail open at the current address. */
export function useListOrderedNames(type: string): ListOrderedNames {
  const [searchParams] = useSearchParams();
  const search = searchParams.toString();
  const { state, fromList, envScope, urlPackage } = React.useMemo(() => {
    const params = new URLSearchParams(search);
    const context = hasListContext(params);
    return {
      state: context ? decodeListState(params) : DEFAULT_LIST_STATE,
      fromList: context,
      envScope: isEnvironmentScope(params),
      urlPackage: params.get('package'),
    };
  }, [search]);

  const client = useMetadataClient();
  const { entries } = useMetadataTypes(client);
  const config = resolveResourceConfig(type, entries.find((e) => e.type === type));
  const listInclude = config.listInclude;
  const primaryKey = config.primaryKey ?? 'name';
  const searchableFields = config.searchableFields ?? DEFAULT_SEARCHABLE;
  const searchKey = searchableFields.join('\n');
  const listFilter = config.listFilter;
  const bundleMemberField = config.bundleMemberField;

  const host = useMetadataAreaHost();
  // objectstack#37918 — the Studio list reads a row's source from its mark
  // first (`studioListSource.ts`); ‹ › read it the same way.
  const inSetup = useInSetupApp();
  const studioList = !!host && !inSetup;
  // The list compares in the display locale; the same one here keeps the order equal.
  const locale = useMetadataLocale();
  const activePackage = envScope ? null : host ? host.packageId : urlPackage;
  const unscoped = envScope || activePackage === null;
  const pairId = React.useMemo(() => {
    if (!host?.packageId || envScope) return null;
    const pair = customizationPackageId(host.packageId);
    return pair.ok ? pair.value : null;
  }, [host?.packageId, envScope]);
  const customizations = usePackageCustomizations(host?.packageId ?? null);

  const [rows, setRows] = React.useState<{ type: string; rows: Row[] } | 'error' | null>(null);
  React.useEffect(() => {
    let cancelled = false;
    client
      .list<any>(type, listInclude ? { include: listInclude } : undefined)
      .then((list) => {
        if (cancelled) return;
        setRows({
          type,
          rows: (list ?? []).map((raw) => {
            const item = (raw && typeof raw === 'object' && 'item' in raw ? raw.item : raw) ?? {};
            return { item, source: classifyProvenance(item, raw?.source) };
          }),
        });
      })
      .catch(() => {
        if (!cancelled) setRows('error');
      });
    return () => {
      cancelled = true;
    };
  }, [client, type, listInclude]);

  // objectstack#36898 — the change times the `changed` sort reads.
  const changedAt = useListChangedAt(client, type, listInclude ? { include: listInclude } : undefined, null);

  // The activation ledger, read only when the status filter needs it.
  const needsLedger = state.status !== 'all' && envScope && hasCatalogActivation(type);
  const [ledgerRead, setLedgerRead] = React.useState<{ type: string; read: CatalogLedgerRead | 'error' } | null>(null);
  React.useEffect(() => {
    if (!needsLedger) return;
    const controller = new AbortController();
    readCatalogLedger(type, controller.signal).then(
      (read) => {
        if (!controller.signal.aborted) setLedgerRead({ type, read });
      },
      () => {
        if (!controller.signal.aborted) setLedgerRead({ type, read: 'error' });
      },
    );
    return () => controller.abort();
  }, [needsLedger, type]);
  const ledger = needsLedger && ledgerRead?.type === type ? ledgerRead.read : null;

  return React.useMemo((): ListOrderedNames => {
    if (rows === 'error') return { status: 'error', names: EMPTY, fromList };
    if (rows === null || rows.type !== type) return { status: 'loading', names: EMPTY, fromList };
    if ((state.customizedOnly || (studioList && state.source !== 'all')) && customizations.status === 'loading') {
      return { status: 'loading', names: EMPTY, fromList };
    }
    if (needsLedger && ledger === null) return { status: 'loading', names: EMPTY, fromList };
    if (state.sort.key === 'changed' && changedAt === null) return { status: 'loading', names: EMPTY, fromList };

    const scoped = scopeListRows(rows.rows, { listFilter, unscoped, activePackage, pairId });
    const markOf = (row: Row) =>
      customizations.status === 'read'
        ? customizationMarkOf(
            {
              type,
              name: String(row.item[primaryKey] ?? ''),
              member: bundleMemberOf(row.item, bundleMemberField),
              packageId: (row.item as { _packageId?: string })._packageId,
            },
            customizations.index,
          )
        : null;
    // The list offers "only customizations" once the read answered and the
    // base has one to show (`ResourceListPage`'s `showCustomizedFilter`).
    const customizedOffered =
      customizations.status === 'read' &&
      (scoped.some((row) => markOf(row) !== null) || customizationTotal(customizations.read) > 0);
    const listed = rows.rows.map((row) => row.item);
    const read: ListRowReader<Row> = {
      name: (row) => String(row.item[primaryKey] ?? ''),
      label: (row) => (typeof row.item.label === 'string' ? row.item.label : undefined),
      matches: (row, query) => matchesQuery(row.item, query, searchKey.split('\n')),
      source: (row) => (studioList ? studioListSource(studioSourceKind(row.source, markOf(row))) : row.source),
      changedAt: (row) => changedAt?.[String(row.item[primaryKey] ?? '')],
      ...(customizedOffered && !studioList ? { customized: (row: Row) => markOf(row) !== null } : {}),
      ...(envScope && hasCatalogActivation(type)
        ? {
            active: (row: Row) => {
              if (!ledger || ledger === 'error') return null;
              const name = String(row.item.name ?? '');
              const holders = type === 'permission' ? holdersOfName(listed, name) : [];
              const holding = holders.length > 1 ? { packageId: servedHolderOf(row.item), holders } : undefined;
              return isCatalogHolderActive(ledger, name, holding);
            },
          }
        : {}),
    };
    return { status: 'ready', names: orderedListNames(scoped, state, read, locale), fromList };
    // Keyed on the config members read, never on `config`, rebuilt every render.
  }, [rows, changedAt, type, locale, state, fromList, customizations, needsLedger, ledger, envScope, unscoped, activePackage, pairId, primaryKey, listFilter, bundleMemberField, searchKey, studioList]);
}
