/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The one registry catalog the `position-ref` / `permission-ref` faces read:
 * `DataSource.listMetadataItems(type)`, `GET /api/v1/meta/:type` (objectui#7611).
 * The edit widget (`./RegistryRefField.tsx`) lists it to offer the items; the
 * read cell (`./RegistryRefCell.tsx`) reads it to draw a stored name's label.
 *
 * The read cell's copy is SHARED: one request per data source and registry
 * type, whatever number of cells draw a name from it, kept for the data
 * source's lifetime (the page session). A label is a display string, not a
 * decision input, so an item authored mid-session drawing its name until
 * reload is the right trade. A failed read is not kept: the next cell that
 * mounts asks again.
 */

import type { DataSource } from '@object-ui/types';
import { holderPackageOf, type PermissionSetHolder } from './permissionSetHolders.js';

/**
 * One listed item of a registry: the name stored, the label shown beside it,
 * and the package the registry served it under (`_packageId`, verbatim), when
 * the data source reports one (objectstack#32770). A registry serves one item
 * per `(package, name)`, so two items of one name are two holders of it.
 */
export interface RegistryItemHeader {
  name: string;
  label?: string;
  packageId?: string;
}

export type RegistryLister = Required<Pick<DataSource, 'listMetadataItems'>>;

/**
 * The data source's registry list, when it has one. The widget contract keeps
 * `dataSource` structural (`unknown`, see `FieldWidgetComponentProps`), so the
 * member is narrowed here, by the name the `DataSource` contract declares.
 */
export function registryLister(dataSource: unknown): RegistryLister | null {
  const candidate = dataSource as Partial<RegistryLister> | null | undefined;
  return candidate && typeof candidate.listMetadataItems === 'function'
    ? (candidate as RegistryLister)
    : null;
}

/** A registry type's labels by item name; an item with no label is absent. */
export type RegistryLabels = ReadonlyMap<string, string>;

/**
 * Every holder of each name the registry served, with the label it serves the
 * name under (`undefined` for none), keyed by the holder as the server reads
 * it (`holderPackageOf`): a package id, or `null` for the environment's own set
 * (objectstack#32795). A name with one entry has one holder.
 */
export type RegistryHolderLabels = ReadonlyMap<string, ReadonlyMap<PermissionSetHolder, string | undefined>>;

/** What one read of a registry type settles to. */
export interface SettledRegistryCatalog {
  /** The label by name alone — the last label served for it, as before. */
  labels: RegistryLabels;
  /** The label by `(holder, name)`. */
  holders: RegistryHolderLabels;
}

interface CatalogEntry {
  promise: Promise<SettledRegistryCatalog>;
  settled?: SettledRegistryCatalog;
}

const catalogs = new WeakMap<RegistryLister, Map<string, CatalogEntry>>();

function entriesOf(source: RegistryLister): Map<string, CatalogEntry> {
  let byType = catalogs.get(source);
  if (!byType) {
    byType = new Map();
    catalogs.set(source, byType);
  }
  return byType;
}

/** The labels already read for `type`, or `undefined` while none has settled. */
export function settledRegistryLabels(source: RegistryLister, type: string): SettledRegistryCatalog | undefined {
  return catalogs.get(source)?.get(type)?.settled;
}

/** Read `type`'s labels, sharing the request with every other caller. */
export function loadRegistryLabels(source: RegistryLister, type: string): Promise<SettledRegistryCatalog> {
  const byType = entriesOf(source);
  const existing = byType.get(type);
  if (existing) return existing.promise;
  const entry: CatalogEntry = {
    promise: source.listMetadataItems(type).then(
      (items) => {
        const labels = new Map<string, string>();
        const holders = new Map<string, Map<PermissionSetHolder, string | undefined>>();
        for (const item of items) {
          const label = item.label && item.label !== item.name ? item.label : undefined;
          if (label) labels.set(item.name, label);
          let byHolder = holders.get(item.name);
          if (!byHolder) {
            byHolder = new Map();
            holders.set(item.name, byHolder);
          }
          const holder = holderPackageOf(item.packageId);
          if (!byHolder.has(holder)) byHolder.set(holder, label);
        }
        const settled: SettledRegistryCatalog = { labels, holders };
        entry.settled = settled;
        return settled;
      },
      (err: unknown) => {
        if (byType.get(type) === entry) byType.delete(type);
        throw err;
      },
    ),
  };
  byType.set(type, entry);
  return entry.promise;
}
