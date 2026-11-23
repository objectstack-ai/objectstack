// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What 「Configure tabs」 reads and writes through, loaded only once its edit
 * state opens (objectstack#36499): the console's metadata client (the one
 * every app-shell write takes, `useMetadataClient`), the object's stored
 * `relatedLists`, and whether the reader's language is the deployment's
 * default (the rename gate's precedent).
 *
 * It sits behind `React.lazy` so the record page's own module graph does not
 * gain the metadata client's module (it mints its authenticated fetch when it
 * loads): the record page loads on every record open, this only when an
 * administrator opens the edit state.
 *
 * @module
 */

import * as React from 'react';
import { fetchDefaultLocale, isSameLanguage } from '../layout/designModeMenuSave.js';
import { useMetadataClient } from './metadata-admin/useMetadata.js';
import { readStoredRelatedLists, type RecordTabsSaveDoors } from './recordTabsConfigSave.js';

export interface RecordTabsIo {
  readonly client: RecordTabsSaveDoors['client'];
  /** The object's stored `relatedLists`, once read for `objectName` (`null` when the read failed). */
  readonly stored: { readonly objectName: string; readonly lists: unknown[] | null } | null;
  /** The reader's language is the deployment's default. */
  readonly sourceLanguage: boolean;
}

export interface RecordTabsConfigIoProps {
  readonly objectName: string;
  readonly packageId: string;
  readonly language: string;
  readonly onIo: (io: RecordTabsIo) => void;
}

export default function RecordTabsConfigIo({ objectName, packageId, language, onIo }: RecordTabsConfigIoProps) {
  const client = useMetadataClient() as unknown as RecordTabsSaveDoors['client'];
  const [stored, setStored] = React.useState<RecordTabsIo['stored']>(null);
  const [defaultLocale, setDefaultLocale] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void readStoredRelatedLists(objectName, packageId, client).then((lists) => {
      if (!cancelled) setStored({ objectName, lists });
    });
    void fetchDefaultLocale().then((code) => {
      if (!cancelled) setDefaultLocale(code);
    });
    return () => {
      cancelled = true;
    };
  }, [objectName, packageId, client]);

  const sourceLanguage = !!defaultLocale && isSameLanguage(language, defaultLocale);
  React.useEffect(() => {
    onIo({ client, stored, sourceLanguage });
  }, [onIo, client, stored, sourceLanguage]);
  return null;
}
