// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What 「Configure tabs」 reads and writes through, loaded only once its edit
 * state opens (objectstack#36499): the console's metadata client (the one
 * every app-shell write takes, `useMetadataClient`), the object's stored
 * `relatedLists` (on an installed object whose tabs the paired `.custom`
 * package arranges, its extension's entries first), the listed packages'
 * names (a tab's source, card item 7), and whether the reader's language is
 * the app's source language: the `sourceLocale` the deployment serves on
 * `GET /i18n/locales`, its default locale where it serves none
 * (`fetchDeploymentLocales`, `labelLanguageOf`, objectstack#36875), the same
 * reading the menu's rename gate takes (objectstack#36504).
 *
 * It sits behind `React.lazy` so the record page's own module graph does not
 * gain the metadata client's module (it mints its authenticated fetch when it
 * loads): the record page loads on every record open, this only when an
 * administrator opens the edit state.
 *
 * @module
 */

import * as React from 'react';
import { fetchDeploymentLocales, labelLanguageOf, type DeploymentLocales } from '../layout/designModeMenuSave.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { fetchListedPackageManifests } from './studio-design/packages-io.js';
import { readStoredTabEntries, type RecordTabsSaveDoors } from './recordTabsConfigSave.js';

export interface RecordTabsIo {
  readonly client: RecordTabsSaveDoors['client'];
  /** The object's stored `relatedLists`, once read for `objectName` (`null` when the read failed). */
  readonly stored: { readonly objectName: string; readonly lists: unknown[] | null } | null;
  /** The reader's language is the app's source language (`sourceLocale`, else the default locale). */
  readonly sourceLanguage: boolean;
  /** The listed packages' names, by id (empty until read, or when the read failed). */
  readonly packageNames: ReadonlyMap<string, string>;
}

export interface RecordTabsConfigIoProps {
  readonly objectName: string;
  readonly packageId: string;
  /** The `.custom` package that arranges the object's tabs now (`_relatedListsArrangement`), else `null`. */
  readonly pairId: string | null;
  readonly language: string;
  readonly onIo: (io: RecordTabsIo) => void;
}

const NO_NAMES: ReadonlyMap<string, string> = new Map();

export default function RecordTabsConfigIo({ objectName, packageId, pairId, language, onIo }: RecordTabsConfigIoProps) {
  const client = useMetadataClient() as unknown as RecordTabsSaveDoors['client'];
  const [stored, setStored] = React.useState<RecordTabsIo['stored']>(null);
  const [locales, setLocales] = React.useState<DeploymentLocales | null>(null);
  const [packageNames, setPackageNames] = React.useState<ReadonlyMap<string, string>>(NO_NAMES);

  React.useEffect(() => {
    let cancelled = false;
    void readStoredTabEntries(objectName, packageId, pairId, client).then((lists) => {
      if (!cancelled) setStored({ objectName, lists });
    });
    void fetchListedPackageManifests().then(
      (listed) => {
        if (!cancelled) setPackageNames(new Map([...listed].map(([id, entry]) => [id, entry.name || id] as const)));
      },
      () => undefined,
    );
    void fetchDeploymentLocales().then((read) => {
      if (!cancelled) setLocales(read);
    });
    return () => {
      cancelled = true;
    };
  }, [objectName, packageId, pairId, client]);

  const sourceLanguage = labelLanguageOf(language, locales).source;
  React.useEffect(() => {
    onIo({ client, stored, sourceLanguage, packageNames });
  }, [onIo, client, stored, sourceLanguage, packageNames]);
  return null;
}
