// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Registers the `datasource` metadata type as a custom-rendered resource in the
 * metadata-admin engine. datasource is a *side-effectful* type (secret +
 * connection pool + introspection), so it ships a bespoke ListPage that talks
 * to the framework `datasource-admin` REST — but it lives inside the engine
 * (engine route + registry slot + shell), reachable at the engine route
 * `…/metadata/datasource`, instead of a separate hand-written System page.
 *
 * The setup left-nav "Datasources" item names that engine route directly
 * (objectui#3660). The older alias spellings `AppContent` still declares are
 * redirects onto it rather than routes of their own — kept so bookmarks and
 * external links keep resolving — but no navigation in this repo is routed
 * through them any more.
 */

import { registerMetadataResource } from '../registry.js';
import { DatasourceResourcePage } from './DatasourceResourcePage.js';

let registered = false;

export function registerDatasourceResource(): void {
  if (registered) return;
  registered = true;
  registerMetadataResource({
    type: 'datasource',
    label: 'Datasources',
    domain: 'data',
    ListPage: DatasourceResourcePage,
  });
}
