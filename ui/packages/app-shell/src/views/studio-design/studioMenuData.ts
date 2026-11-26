// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's left menu, its served data and its drawing vocabulary, shared by
 * the menu (`StudioMenu.tsx`) and the command palette's Studio groups
 * (`StudioPaletteGroups.tsx`, objectstack#36900), so the two draw the same
 * types, icons and names and the page reads the data once.
 */

import * as React from 'react';
import { Database, Layers, Settings, ShieldCheck, Sparkles, Workflow, type LucideIcon } from 'lucide-react';
import {
  useGlobalDiagnostics,
  useMetadataClient,
  useMetadataTypes,
  type RichMetadataTypeEntry,
} from '../metadata-admin/useMetadata.js';
import { scopeDirectoryEntries } from '../metadata-admin/directoryScope.js';
import { useMetadataRefreshNonce } from './useMetadataRefreshNonce.js';
import {
  STUDIO_MENU_ALWAYS_TYPES,
  studioMenuScope,
  type StudioMenuEntry,
  type StudioMenuGroup,
} from './studioMenuModel.js';

/** Each group's icon: the menu's, and the palette's for the group's items (objectstack#36900). */
export const STUDIO_MENU_GROUP_ICONS: Readonly<Record<StudioMenuGroup, LucideIcon>> = {
  data: Database,
  ui: Layers,
  automation: Workflow,
  system: Settings,
  security: ShieldCheck,
  ai: Sparkles,
};

/** The names of the entries that are not a type; the palette names them the same way (objectstack#36900). */
export const STUDIO_MENU_ENTRY_LABEL_KEYS: Readonly<Record<Exclude<StudioMenuEntry['kind'], 'type'>, string>> = {
  orgFlows: 'engine.studio.menu.orgFlows',
  owd: 'engine.studio.menu.owd',
  diagnostics: 'engine.studio.menu.diagnostics',
  allTypes: 'engine.studio.menu.allTypes',
};

/** 概览 Overview's name (objectstack#37454): the package's own page, the menu's first row. */
export const STUDIO_MENU_OVERVIEW_LABEL_KEY = 'engine.studio.menu.overview';

/** The title of 概览 Overview's badge: how many drafts wait for a publish. */
export const STUDIO_MENU_OVERVIEW_PENDING_KEY = 'engine.studio.menu.overviewPending';

/** {@link STUDIO_MENU_OVERVIEW_PENDING_KEY}'s singular, for a count of one (the catalogue's `…One` form). */
export const STUDIO_MENU_OVERVIEW_PENDING_ONE_KEY = 'engine.studio.menu.overviewPendingOne';

/** The menu's served data, for one `/studio/:segment` (see {@link useStudioMenuTypes}). */
export interface StudioMenuData {
  /** The segment the data was read for. */
  segment: string;
  /** The served type entries the directory's rule scoped to this menu, in served order. */
  types: RichMetadataTypeEntry[];
  /** Each type's served item count; empty when the sweep did not say. */
  counts: Readonly<Record<string, number>>;
  /** Both reads have answered: the registry's types and the diagnostics sweep. */
  settled: boolean;
  /**
   * The diagnostics sweep answered with its counts (objectstack#37201): a type
   * it counts nothing of holds none. False while it reads, and when it failed
   * (a server without the sweep answers no counts, not "none of each").
   */
  countsAnswered: boolean;
}

/**
 * The menu's served data: the registry's type entries, scoped by the
 * directory's rule, and each type's item count from the diagnostics sweep the
 * directory reads. Read again on the metadata-refresh pulse (a publish, a new
 * item), so the counts follow.
 */
export function useStudioMenuTypes(segment: string): StudioMenuData {
  const scope = studioMenuScope(segment);
  const packageId = scope.kind === 'package' ? scope.packageId : null;
  const client = useMetadataClient();
  const { entries, loading: typesLoading } = useMetadataTypes(client);
  const {
    countsByType,
    packagesByType,
    loading: sweepLoading,
    error: sweepError,
    reload,
  } = useGlobalDiagnostics(client, 'error', packageId ?? undefined);
  const refresh = useMetadataRefreshNonce();
  const reloadRef = React.useRef(reload);
  React.useLayoutEffect(() => {
    reloadRef.current = reload;
  });
  React.useEffect(() => {
    if (refresh > 0) reloadRef.current();
  }, [refresh]);
  const types = scopeDirectoryEntries(entries, {
    environment: scope.kind !== 'package',
    packageId,
    packagesByType,
    always: STUDIO_MENU_ALWAYS_TYPES,
  });
  const settled = !typesLoading && !sweepLoading;
  return { segment, types, counts: countsByType, settled, countsAnswered: settled && !sweepError };
}

/**
 * objectstack#36900 — the menu's data, read once for a whole Studio page: the
 * surface provides it, and the menu and the command palette both draw from it,
 * so opening the palette re-reads nothing the menu already holds.
 */
export const StudioMenuDataContext = React.createContext<StudioMenuData | null>(null);

/** The menu's data a `StudioMenuDataProvider` above holds, or `null` with none. */
export function useStudioMenuData(): StudioMenuData | null {
  return React.useContext(StudioMenuDataContext);
}
