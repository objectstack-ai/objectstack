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
import { useAiSurfaceEnabled } from './useAiSurface.js';
import { isAiStudioEnabled, isMarketplaceEnabled } from '../runtime-config.js';
import { STUDIO_NEW_PACKAGE_PATH } from '../views/studio-design/studioNewPackage.js';
import { studioLandingPath } from '../views/studio-design/studioAddress.js';

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
 * The 「Add app」 choices: building with AI where the deployment offers AI
 * authoring and its agent catalog serves the build agent (objectstack#36969:
 * not merely any agent: where in-app building is closed the catalog keeps
 * `ask` and drops `build`), else a new package in Studio; templates and
 * the marketplace where a marketplace is mounted. Read only for a viewer
 * {@link useMayAddApp} lets in, so no one else pays the agent-catalog read.
 */
export function useAddAppEntries(): AddAppEntry[] {
  const { t } = useObjectTranslation();
  const { buildServed } = useAiSurfaceEnabled();
  const entries: AddAppEntry[] = [];
  if (isAiStudioEnabled()) {
    entries.push(
      buildServed
        ? { key: 'build-with-ai', to: studioLandingPath(), label: t('home.buildWithAI', { defaultValue: 'Build with AI' }), icon: Hammer }
        : { key: 'new-in-studio', to: STUDIO_NEW_PACKAGE_PATH, label: t('home.build.inStudio', { defaultValue: 'New in Studio' }), icon: Hammer },
    );
  }
  if (isMarketplaceEnabled()) {
    entries.push(
      { key: 'template', to: MARKETPLACE_PATH, label: t('home.template.title', { defaultValue: 'Start with a template' }), icon: LayoutGrid },
      { key: 'marketplace', to: MARKETPLACE_PATH, label: t('layout.systemNav.appMarketplace', { defaultValue: 'App Marketplace' }), icon: Store },
    );
  }
  return entries;
}
