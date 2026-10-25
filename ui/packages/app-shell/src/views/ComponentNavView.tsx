// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ComponentNavView — route target for `<Route path="component/:ns/:name/*">`.
 *
 * Phase 3b: resolves the colon-joined registry key (e.g. `metadata:resource`)
 * from `:ns/:name` URL segments, looks it up in the ComponentRegistry,
 * and renders the matching component. Props are the union of the URL
 * query string and any extra props passed by the parent route element.
 *
 * If no component is registered for the ref, we render a structured empty
 * state that tells the operator which plugin is likely missing — much
 * better than a blank screen or a thrown error.
 */

import React from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Empty, EmptyTitle, EmptyDescription } from '@object-ui/components';
import { getAppComponent } from '../services/componentRegistry.js';

export interface ComponentNavViewProps {
  /** Extra props injected by the parent route element (typically empty). */
  extraProps?: Record<string, unknown>;
}

export function ComponentNavView({ extraProps }: ComponentNavViewProps = {}) {
  const params = useParams();
  const [search] = useSearchParams();

  // URL: /apps/:appName/component/:ns/:name (sub-routes via /*)
  const ns = params.ns;
  const name = params.name;
  const ref = ns && name ? `${ns}:${name}` : (ns ?? '');

  const entry = getAppComponent(ref);

  if (!entry) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <Empty>
          <EmptyTitle>Component not registered</EmptyTitle>
          <EmptyDescription>
            No component is registered for <code className="font-mono">{ref || '(empty)'}</code>.
            Ensure the plugin that provides this surface is installed and has called
            <code className="font-mono"> registerAppComponent()</code>.
          </EmptyDescription>
        </Empty>
      </div>
    );
  }

  // Merge query string into props. Strings only at this layer — the
  // component can coerce as needed. Nav-metadata `params` (the
  // `{ type: 'object' }` from setup.app.ts) are forwarded by the
  // sidebar URL builder as query string, so this merge captures them.
  const queryProps: Record<string, string> = {};
  for (const [k, v] of search.entries()) queryProps[k] = v;

  const Component = entry.component;
  return <Component {...queryProps} {...(extraProps ?? {})} />;
}

export default ComponentNavView;
