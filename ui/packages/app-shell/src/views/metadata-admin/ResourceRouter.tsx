// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * MetadataResourceRouter — top-level component bound to
 * `metadata:resource`. Switches between list / create / edit /
 * history based on the trailing wildcard URL.
 *
 * URL shape (the parent route is `/apps/:appName/component/:ns/:name/*`,
 * so the wildcard begins AFTER `metadata/resource`):
 *
 *   `?type=view`                      → list of `view` items
 *   `/new?type=view`                  → create new view
 *   `/account?type=object`            → edit object `account`
 *   `/account/history?type=object`    → history for object `account`
 *
 * The `type` query param is the single source of truth for the
 * metadata type. The wildcard provides the item name (or `'new'`).
 *
 * Why parse the wildcard manually instead of nested `<Routes>`?
 * The parent route's `path` is `component/:ns/:name/*` and React
 * Router strips the matched portion before passing what's left to
 * `useParams['*']`, so we just split on `/`.
 */

import * as React from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import { MetadataResourceListPage } from './ResourceListPage.js';
import { MetadataResourceEditPage } from './ResourceEditPage.js';
import { MetadataResourceHistoryPage } from './ResourceHistoryPage.js';

/**
 * Props forwarded by `ComponentNavView` — it merges URL query-string
 * into props, so we accept both `type` (from `?type=…`) and route
 * nav `params: { type: 'object' }` style.
 */
export interface MetadataResourceRouterProps {
  /** Singular metadata type, e.g. 'view'. */
  type?: string;
}

export function MetadataResourceRouter({ type }: MetadataResourceRouterProps) {
  const location = useLocation();
  const [search] = useSearchParams();
  const resolvedType = type ?? search.get('type') ?? '';

  if (!resolvedType) {
    return (
      <div className="p-8 h-full flex items-center justify-center">
        <Empty>
          <EmptyTitle>Missing metadata type</EmptyTitle>
          <EmptyDescription>
            This page expects a <code className="font-mono">?type=</code> query
            param (e.g. <code className="font-mono">?type=view</code>) or a
            nav-metadata <code className="font-mono">params: {`{ type: 'view' }`}</code>.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // Parse the trailing wildcard. The parent route consumed
  // `/apps/:appName/component/metadata/resource`, so what's left in
  // location.pathname AFTER that prefix is our sub-path. We don't have
  // the prefix exactly, but we can find `/resource/` and slice — it's
  // unambiguous because `:ns/:name` are colon-joined → "metadata/resource".
  const subPath = extractSubPath(location.pathname);
  const segments = subPath.split('/').filter(Boolean);

  // No sub-path → list page.
  if (segments.length === 0) {
    return <MetadataResourceListPage type={resolvedType} />;
  }

  // /new → create page.
  if (segments[0] === 'new' && segments.length === 1) {
    return (
      <MetadataResourceEditPage
        key={`${resolvedType}:__new__`}
        type={resolvedType}
        name=""
        createMode
      />
    );
  }

  // /:name/history → history.
  if (segments.length === 2 && segments[1] === 'history') {
    return (
      <MetadataResourceHistoryPage
        type={resolvedType}
        name={decodeURIComponent(segments[0])}
      />
    );
  }

  // /:name → edit.
  if (segments.length === 1) {
    return (
      <MetadataResourceEditPage
        key={`${resolvedType}:${segments[0]}`}
        type={resolvedType}
        name={decodeURIComponent(segments[0])}
      />
    );
  }

  // Unknown sub-path.
  return (
    <div className="p-8 h-full flex items-center justify-center">
      <Empty>
        <EmptyTitle>Unknown sub-path</EmptyTitle>
        <EmptyDescription>
          The path <code className="font-mono">{subPath}</code> isn't recognized.
          Valid forms are <code className="font-mono">/</code> (list),{' '}
          <code className="font-mono">/new</code> (create),{' '}
          <code className="font-mono">/:name</code> (edit),{' '}
          <code className="font-mono">/:name/history</code>.
        </EmptyDescription>
      </Empty>
    </div>
  );
}

function extractSubPath(pathname: string): string {
  // Find the literal `/metadata/resource` prefix and return what follows.
  const marker = '/metadata/resource';
  const idx = pathname.indexOf(marker);
  if (idx === -1) return '';
  return pathname.slice(idx + marker.length); // includes leading '/' if any
}
