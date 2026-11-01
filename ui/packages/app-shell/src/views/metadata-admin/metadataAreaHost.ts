// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Studio's "All metadata" area, as the metadata-admin pages see it
 * (objectstack ADR-0146 D1, #28561).
 *
 * D1 makes Studio the home of every metadata type: beside the four pillars, an
 * "All metadata" area holds what these pages hold today — the type directory,
 * the lists, the generic item page, history and diagnostics — per package and
 * across packages. The area MOUNTS these pages; it does not copy them. Setup
 * keeps mounting them too, unchanged, until N-28 redirects its routes.
 *
 * What differs under the area is a small set of facts the route alone cannot
 * give a page, so the area provides them here and a page reads them with
 * {@link useMetadataAreaHost}:
 *
 *  - which package is open. A page that would otherwise pick and repair its own
 *    `?package=` scope (the directory, the list) stays on the area's package;
 *  - whether that package is read-only. Every write the pages offer is then
 *    withheld: rollback, source save, reset, delete, the overlay save and the
 *    create doors. The server stays the authority; this is the courtesy gate
 *    the Studio pillars already apply (`StudioDesignSurface`'s `readOnly`),
 *    which the generic page needs most of all, because the server ACCEPTS an
 *    overlay save on a code package's item of an overlay-allowed type;
 *  - where the area is mounted, so a link that today climbs to `…/metadata`
 *    by reading the pathname reaches the area's root instead.
 *
 * ⛔ No provider, no change: with no area around it, every page renders exactly
 * as it does in Setup today (`null` below). A page reads the host only to add
 * the area's gate or scope, never to take one of Setup's away.
 */

import * as React from 'react';
import { SETUP_CATALOG_TYPES } from './catalog-scope.js';

export interface MetadataAreaHost {
  /**
   * The package the area is open on, or `null` in the cross-package leg, which
   * serves the environment catalog (`?scope=environment`) with no package.
   */
  packageId: string | null;
  /**
   * The open package is read-only (a code or installed package). Always
   * `false` in the cross-package leg, whose writes are the environment scope's
   * own gates (`catalog-scope.ts`), exactly as in Setup.
   */
  readOnly: boolean;
  /** The area's root route, `/studio/<package or ~all>/metadata`, without a trailing slash. */
  basePath: string;
}

export const MetadataAreaHostContext = React.createContext<MetadataAreaHost | null>(null);

/** The area this page is mounted in, or `null` outside one (Setup). */
export function useMetadataAreaHost(): MetadataAreaHost | null {
  return React.useContext(MetadataAreaHostContext);
}

/**
 * The types the cross-package leg's directory lists: the environment catalog,
 * each opened in the environment scope. The Setup catalog types with a switch,
 * plus `capability`, the catalog with none (`SETUP_CATALOG_TYPES` says why it
 * is absent there).
 */
export const ENVIRONMENT_AREA_TYPES: readonly string[] = [...SETUP_CATALOG_TYPES, 'capability'];

/**
 * Setup's Datasources page, the route the Setup sidebar names. A datasource is
 * runtime configuration, Setup's to administer (ADR-0146 D1), so the area's
 * datasource tile and its datasource URLs open this page.
 */
export const SETUP_DATASOURCES_PATH = '/apps/setup/metadata/datasource';
