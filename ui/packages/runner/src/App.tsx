/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

// Ensure this file is treated as a module
export {}; 

import { SchemaRenderer } from '@object-ui/react';
import '@object-ui/components';
import '@object-ui/plugin-kanban';
import '@object-ui/plugin-charts';
import { PageNodeSchema, AppComponentSchema } from '@object-ui/types';
import { useState, useEffect, useMemo, useCallback } from 'react';
import { LayoutRenderer } from './LayoutRenderer';
import { LocalBundleLoader, NetworkLoader, MetadataLoader } from './lib/MetadataLoader';

/**
 * Build the URL an in-app navigation to `to` should push, carrying the query
 * string that is currently in the address bar along with it (objectui#3578).
 *
 * The Runner keeps addressable state (ADR-0054 C3) in the query string, and
 * more than one kind of it: `?api=<base>` selects the metadata loader below,
 * and `@object-ui/core`'s `?__debug…` flags are read straight off
 * `window.location.search` by the tree this app renders. Preserving the whole
 * string rather than re-emitting a single known parameter keeps both working —
 * and keeps working for whatever else starts reading the query later.
 *
 * `to` normally is a bare path from the app's navigation metadata, in which
 * case the current query string is carried over verbatim (no re-encoding, so
 * the address bar keeps exactly what the user typed). A target that declares
 * its own query keeps it and wins on collision; the remaining current
 * parameters are merged in behind it, so the result is never the malformed
 * `path?a=1?b=2` that plain concatenation would produce. That merge rebuilds
 * the query through `URLSearchParams`, so values come out canonically
 * percent-encoded — the same parameters, spelled the standard way.
 */
function withPreservedQuery(to: string, currentSearch: string): string {
  if (!currentSearch || currentSearch === '?') return to;

  const hashIndex = to.indexOf('#');
  const hash = hashIndex === -1 ? '' : to.slice(hashIndex);
  const pathAndQuery = hashIndex === -1 ? to : to.slice(0, hashIndex);
  const queryIndex = pathAndQuery.indexOf('?');

  if (queryIndex === -1) {
    const search = currentSearch.startsWith('?') ? currentSearch : `?${currentSearch}`;
    return `${pathAndQuery}${search}${hash}`;
  }

  const merged = new URLSearchParams(pathAndQuery.slice(queryIndex + 1));
  // Snapshot the target's own keys first: appending while testing `merged.has`
  // would swallow the second value of a repeated preserved parameter.
  const ownKeys = new Set(merged.keys());
  for (const [key, value] of new URLSearchParams(currentSearch)) {
    if (!ownKeys.has(key)) merged.append(key, value);
  }
  const search = merged.toString();
  return `${pathAndQuery.slice(0, queryIndex)}${search ? `?${search}` : ''}${hash}`;
}

/**
 * Root component of the standalone SDUI runner: loads an app config plus the
 * page for the current path and hands both to `<SchemaRenderer>`.
 *
 * Named `RunnerApp`, not `App` (objectui#3161, objectstack#4115 ledger batch 7).
 * `@objectstack/spec/ui` exports `App` twice over — the authored application
 * METADATA type (`z.infer<typeof AppSchema>`: `name`, `label`, `branding`,
 * `navigation`, `tabs`, …) and the `App.create()` builder namespace that
 * produces one. This is the React root that RENDERS such a document, and it
 * loads it into a variable already correctly named `appConfig`. A default
 * export costs nothing to rename — `main.tsx` binds it under whatever local
 * name it likes — so the name goes back to the metadata with no consumer churn
 * at all, which is the whole reason this one was cheap and `<AuthProvider>`
 * (batch 5) was not.
 */
export default function RunnerApp() {
  const [appConfig, setAppConfig] = useState<AppComponentSchema | null>(null);
  const [pageSchema, setPageSchema] = useState<PageNodeSchema | null>(null);
  const [currentPath, setCurrentPath] = useState(window.location.pathname);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Initialize Loader Strategy
  const loader = useMemo<MetadataLoader>(() => {
    const params = new URLSearchParams(window.location.search);
    const apiUrl = params.get('api');
    
    // IF ?api=... is present, use Network Loader
    if (apiUrl) {
      return new NetworkLoader(apiUrl);
    }

    // ELSE use bundled files (Local Development)
    return new LocalBundleLoader();
  }, []);

  // --- 1. Load Global Config (once) ---
  useEffect(() => {
    const loadApp = async () => {
      try {
        const config = await loader.loadAppConfig();
        if (config) setAppConfig(config);
      } catch (e) {
        console.error("Error loading app config", e);
      }
    };
    loadApp();
  }, [loader]);

  // --- 2. Route Handling ---
  const handleNavigate = useCallback((to: string) => {
    // The route is `to`; the query string rides along so that reloading or
    // sharing the resulting URL still resolves the same backend (#3578).
    window.history.pushState({}, '', withPreservedQuery(to, window.location.search));
    setCurrentPath(to);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    const onPopState = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // --- 3. Page Loading Logic ---
  useEffect(() => {
    const loadPage = async () => {
      setLoading(true);
      setError(null);
      try {
        const schema = await loader.loadPage(currentPath);
        if (schema) {
          setPageSchema(schema);
        } else {
          // No document for this route, `/` included: the error branch below
          // renders the 404 block.
          setError(`Page not found: ${currentPath}`);
          setPageSchema(null);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load page.");
      } finally {
        setLoading(false);
      }
    };

    loadPage();
  }, [currentPath, loader]);

  // --- Render ---

  // 1. Initial App Boot: Show Full Loader (only if app config isn't ready)
  if (!appConfig && loading) {
    return (
      <div className="flex h-screen items-center justify-center text-slate-400">
         <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600 mr-2" />
         Loading App...
      </div>
    );
  }

  // 2. Prepare Main Content (Page)
  let mainContent;

  if (loading) {
     // Page transition loading - shows INSIDE layout
     mainContent = (
      <div className="flex flex-col items-center justify-center h-full text-slate-400 min-h-[50vh]">
         <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600 mr-2" />
         Loading Page...
      </div>
     );
  } else if (error || !pageSchema) {
     // Error State
     mainContent = (
      <div className="flex flex-col items-center justify-center h-full p-12 text-red-600">
        <h1 className="text-2xl font-bold">404</h1>
        <p className="mt-2 text-slate-600">{error || 'Page not found'}</p>
        <button type="button" onClick={() => handleNavigate('/')} className="mt-4 text-blue-600 hover:underline">
          Go Home
        </button>
      </div>
     );
  } else {
     // Success State
     mainContent = <SchemaRenderer schema={pageSchema} />;
  }

  // 3. Render Wrapper
  if (appConfig) {
    return (
      <LayoutRenderer app={appConfig} currentPath={currentPath} onNavigate={handleNavigate}>
        {mainContent}
      </LayoutRenderer>
    );
  }

  // Fallback if no appConfig but somehow done loading (e.g. error loading app.json)
  return (
    <div className="object-ui-app">
      {mainContent}
    </div>
  );
}
