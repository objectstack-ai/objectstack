// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#38149 — the console's create-app route (`/apps/:app/create-app`,
 * reached from the no-apps call to action and from App Management): the
 * plugin-designer wizard, whose new app is saved into a package the author
 * picks or creates first (`PackageCreateAsk.tsx`), never naming none. The app
 * is saved as Studio's new-app door saves it (`newAppDoor.ts`): a draft in
 * that package under the first-write pin, then that one item's publish, so it
 * opens at once. Cancel writes nothing and keeps the wizard open.
 */

import * as React from 'react';
import { CreateAppPage } from '@object-ui/plugin-designer';
import { usePackageCreateAsk } from '../views/metadata-admin/PackageCreateAsk.js';
import { translateMetadataType, useMetadataLocale } from '../views/metadata-admin/i18n.js';
import { useMetadataClient } from '../views/metadata-admin/useMetadata.js';
import { publishSavedItem } from '../views/studio-design/studioSaveBar.js';
import { draftReceiptVersion } from '../views/metadata-admin/DraftConflictDialog.js';

export function ConsoleCreateAppPage() {
  const client = useMetadataClient();
  const locale = useMetadataLocale();
  const { ask, dialog } = usePackageCreateAsk();
  const saveApp = React.useCallback(
    async (name: string, app: Record<string, unknown>): Promise<boolean> => {
      const packageId = await ask({ typeLabel: translateMetadataType('app', locale, 'App') });
      if (!packageId) return false;
      const receipt = await client.save('app', name, app, { mode: 'draft', packageId, ifNoneMatch: '*' });
      const live = await publishSavedItem(
        client,
        { type: 'app', name, packageId, draftVersion: draftReceiptVersion(receipt) },
        false,
      );
      if (!live.ok) throw live.error;
      return true;
    },
    [ask, client, locale],
  );
  return (
    <>
      <CreateAppPage saveApp={saveApp} />
      {dialog}
    </>
  );
}
