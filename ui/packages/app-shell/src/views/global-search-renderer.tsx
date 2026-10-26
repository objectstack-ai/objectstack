/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `global:search` — the cross-object search box, addressable from a page
 * schema (`f99932a42`).
 *
 * ## Why this exists
 *
 * `global:search` is a first-class member of `@objectstack/spec`'s
 * `PageComponentType`, kept declared by the maintainer ruling of 2026-08-26
 * (objectstack#12183) because its data source shipped. Nothing rendered it, so
 * a page that authored it drew `PlaceholderRenderer`'s literal "Component
 * Placeholder" scaffold: the author-time gate accepted the metadata and the
 * screen showed a dashed box.
 *
 * ## What backs it — nothing new
 *
 * `useRecordSearch` (`@object-ui/react`) is the platform's global-search read:
 * it prefers the adapter's `searchAll` (`GET /api/v1/search`, cross-object hits
 * with title/snippet/record and per-object caps) and falls back to the
 * per-object `find({ $search })` fanout only for adapters that do not expose
 * it. Two app-shell surfaces already consume it — the ⌘K `CommandPalette` and
 * the full-page `SearchResultsPage` — and this block is the third mount point
 * of the SAME hook, not a fourth search path.
 *
 * Scope is the whole searchable object set the `MetadataProvider` holds
 * (`searchable !== false`), because a page block has no app-nav context of its
 * own the way the palette and the results page do; that is `useRecordSearch`'s
 * documented default when `objectNames` is omitted, not a local widening.
 *
 * ## Declared propless, deliberately
 *
 * `ComponentPropsMap['global:search']` is an EMPTY shape, so this registration
 * publishes NO `inputs` — the same reason as `global:notifications`. It also
 * keeps the block in `EXPECTED_WITHOUT_INPUTS`, where the placeholder
 * registration already put it, rather than moving it into a coverage set whose
 * forward direction would then judge keys the contract does not declare.
 *
 * Registered in app-shell rather than `@object-ui/components` because the
 * adapter and metadata providers live here. The eager palette placeholder in
 * `components/renderers/placeholders.tsx` STAYS: it is the fallback for a host
 * that embeds `@object-ui/components` without app-shell, and this module
 * imports that package, so its registration always runs first and this one
 * overwrites it.
 */

import * as React from 'react';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ComponentRegistry } from '@object-ui/core';
import { useRecordSearch, useMetadata, useAdapter } from '@object-ui/react';
import { usePermissions } from '@object-ui/permissions';
import { Input, Card, CardContent, Badge } from '@object-ui/components';
import { Search } from 'lucide-react';
import { useObjectTranslation } from '@object-ui/i18n';
import { getIcon } from '../utils/getIcon.js';
import { getRecordDisplayName, resolveHostAppSegment } from '../utils/index.js';
import { useNavigationContext } from '../context/NavigationContext.js';

/** Keep the designer's own data attributes on the wrapper, drop the rest. */
const splitDesigner = (props: Record<string, any>) => {
  const { 'data-obj-id': id, 'data-obj-type': type, style } = props || {};
  return { 'data-obj-id': id, 'data-obj-type': type, style };
};

export interface GlobalSearchRendererProps {
  schema?: Record<string, any>;
  className?: string;
  [k: string]: any;
}

/** Nothing to search until the user types. */
const NO_SEARCH_OBJECTS: any[] = [];

export const GlobalSearchRenderer: React.FC<GlobalSearchRendererProps> = ({
  className,
  schema: _schema,
  ...props
}) => {
  const { t } = useObjectTranslation();
  const [query, setQuery] = useState('');
  const metadata = useMetadata();
  const { apps, ensureType } = metadata;
  const dataSource = useAdapter();
  const { appName } = useParams();
  const { currentAppName } = useNavigationContext();

  // objectui#12980 — the searchable objects are every object, so the whole
  // registry is read only once the user types: a page that places this block
  // does not load it on open. `ensureType('object')` asks for it; `objects` is
  // read only from then on.
  const searching = query.trim() !== '';
  if (searching) void ensureType('object');
  const metadataObjects = searching ? metadata.objects : NO_SEARCH_OBJECTS;

  // `useMetadata().objects` can hand back a fresh array each call; the hook
  // derives its own signature from the names, but a stable reference keeps the
  // memo above it from churning (same reason SearchResultsPage does it).
  const objects = useMemo(() => metadataObjects || [], [metadataObjects]);

  // A hit is labelled from the row as the viewer may read it: the hook removes
  // the fields this policy denies before the resolver reads it (objectui#10500).
  const perms = usePermissions();
  const { results, isSearching } = useRecordSearch({
    query,
    objects,
    dataSource,
    enabled: Boolean(dataSource),
    getDisplayName: getRecordDisplayName,
    fieldReadPolicy: perms,
  });

  // The hits host under the route's own app segment. Outside the
  // `/apps/:appName/*` router there is none, and `currentAppName` is the app's
  // NAME as the shell last published it — so it is resolved to the app's route
  // segment (ADR-0048 option A) by the resolver every app-independent link
  // uses, never spliced in raw (objectui#11818).
  const baseUrl = `/apps/${appName || resolveHostAppSegment(apps, currentAppName)}`;
  const placeholder = t('search.placeholder', {
    defaultValue: 'Search objects, dashboards, pages, reports…',
  }) as string;
  const ariaLabel = t('search.inputAriaLabel', {
    defaultValue: 'Search objects, dashboards, pages, reports',
  }) as string;

  return (
    <div
      className={className}
      data-block="global:search"
      role="search"
      {...splitDesigner(props)}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          className="pl-8"
          value={query}
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
        />
      </div>

      {isSearching && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t('console.commandPalette.searching', { defaultValue: 'Searching…' })}
        </p>
      )}

      {results.length > 0 && (
        <ul className="mt-2 grid gap-2" aria-label={t('console.commandPalette.records', { defaultValue: 'Records' }) as string}>
          {results.map((hit) => {
            const HitIcon = getIcon(hit.icon);
            return (
              <li key={`${hit.objectName}:${hit.recordId}`}>
                <Link
                  to={`${baseUrl}/${hit.objectName}/record/${hit.recordId}`}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="hover:bg-accent/50 transition-colors">
                    <CardContent className="flex items-center gap-3 p-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded bg-primary/10 text-primary">
                        <HitIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{hit.display}</p>
                        {hit.subtitle && (
                          <p className="truncate text-xs text-muted-foreground">{hit.subtitle}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="shrink-0 text-xs">
                        {hit.objectLabel}
                      </Badge>
                    </CardContent>
                  </Card>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

// Bare name + namespace (the registry prepends it itself); `skipFallback: true`
// keeps this off the top-level `search` key. No `inputs`: the spec shape is empty.
ComponentRegistry.register('search', GlobalSearchRenderer, {
  namespace: 'global',
  skipFallback: true,
  category: 'navigation',
  label: 'Global Search',
  icon: 'Search',
});

export default GlobalSearchRenderer;
