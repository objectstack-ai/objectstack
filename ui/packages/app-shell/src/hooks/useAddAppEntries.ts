// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The 「Add app」 choices, and who is offered them: the sidebar app menu's
 * 「Add app」 submenu (objectstack#36112) and the desktop's no-apps empty
 * state (objectstack#36732) read the one list, so both offer the same doors
 * to the same viewers.
 *
 * @module
 */

import type * as React from 'react';
import { Hammer, LayoutGrid, Store } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { useWorkspaceAdminStatus } from '@object-ui/auth';
import { useCanAuthorMetadata } from './useCanAuthorMetadata.js';
import { isAiStudioEnabled, isMarketplaceEnabled } from '../runtime-config.js';
import { SETUP_NEW_PACKAGE_PATH } from '../views/metadata-admin/packageSource.js';

/** The marketplace, where templates and packages are installed from. */
const MARKETPLACE_PATH = '/apps/setup/system/marketplace';

/** One 「Add app」 choice: where it goes, and how it is named. */
export interface AddAppEntry {
  key: string;
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Whether this viewer is offered 「Add app」 at all, by the gates Home's
 * builder chips read: a workspace admin who may author metadata, on a
 * deployment that offers AI authoring or mounts a marketplace.
 */
export function useMayAddApp(): boolean {
  const { isAdmin } = useWorkspaceAdminStatus();
  const canAuthor = useCanAuthorMetadata();
  return isAdmin && canAuthor && (isAiStudioEnabled() || isMarketplaceEnabled());
}

/**
 * The 「Add app」 choices: 「新建空白应用」 / "New blank app" (a new package,
 * opened in Studio once created) wherever the deployment offers metadata
 * authoring, whether or not its agent catalog serves the build agent; templates
 * and the marketplace where a marketplace is mounted.
 *
 * objectstack#36908 — the maintainer ruled 「Build with AI」 off this menu
 * (ruling record 7153161067) and the blank-app entry always shown, agent or no
 * agent (ruling record 7153400210). It stays inside the authoring gate: where
 * `features.aiStudio` is `false` the runtime offers no metadata authoring at
 * all, and a viewer {@link useMayAddApp} admits there is offered the
 * marketplace's two entries instead, so the list is never empty for an
 * admitted viewer. A host still draws no 「Add app」 for an empty list.
 */
export function useAddAppEntries(): AddAppEntry[] {
  const { t } = useObjectTranslation();
  const entries: AddAppEntry[] = [];
  if (isAiStudioEnabled()) {
    entries.push({
      key: 'new-in-studio',
      to: SETUP_NEW_PACKAGE_PATH,
      label: t('home.build.inStudio', { defaultValue: 'New blank app' }),
      icon: Hammer,
    });
  }
  if (isMarketplaceEnabled()) {
    entries.push(
      { key: 'template', to: MARKETPLACE_PATH, label: t('home.template.title', { defaultValue: 'Start with a template' }), icon: LayoutGrid },
      { key: 'marketplace', to: MARKETPLACE_PATH, label: t('layout.systemNav.appMarketplace', { defaultValue: 'App Marketplace' }), icon: Store },
    );
  }
  return entries;
}
