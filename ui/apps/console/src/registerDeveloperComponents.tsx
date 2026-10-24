// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Developer component registrations.
 *
 * Binds the `developer:*` registry keys to the lazy-loaded console pages
 * that already host these tools. The framework's Studio app names the first
 * three from its Developer navigation group.
 *
 * URL shape resolved by `ComponentNavView`:
 *   developer:api-console  → /apps/<app>/component/developer/api-console
 *   developer:flow-runs    → /apps/<app>/component/developer/flow-runs
 *   developer:public-forms → /apps/<app>/component/developer/public-forms
 *   developer:integrations → /apps/<app>/component/developer/integrations
 *
 * `developer:integrations` (objectui#10520): the Integrations & APIs page
 * was linked from exactly one place, a card on the console's Developer Hub
 * page, and that hub had no in-app link of its own once the System Hub card
 * wall retired (objectui#3743). With this key, all four of the hub's
 * destinations are registry keys, so the hub page is retired and navigation
 * is the one way in. The page is kept, not retired: when objectui#10520
 * compared it with Studio, no Studio surface showed the environment's base URL
 * or the `x-api-key` cURL sample it carries (a one-time reading that nothing
 * re-derives).
 *
 * The standalone `/developer/*` routes in `AppContent.tsx` stay in place,
 * because bookmarks and deep links carry them. This module only wires the
 * metadata-driven entry from app sidebars. Pinned in
 * `__tests__/orphanedPageComponentRefs-10520.test.tsx`.
 */

import { lazy, Suspense } from 'react';
import { registerAppComponent } from '@object-ui/app-shell';

const ApiConsolePage = lazy(() =>
  import('./pages/developer/ApiConsolePage').then((m) => ({ default: m.ApiConsolePage })),
);
const FlowRunsPage = lazy(() =>
  import('./pages/developer/FlowRunsPage').then((m) => ({ default: m.FlowRunsPage })),
);
const PublicFormsPage = lazy(() =>
  import('./pages/developer/PublicFormsPage').then((m) => ({ default: m.PublicFormsPage })),
);
const IntegrationsPage = lazy(() =>
  import('./pages/developer/IntegrationsPage').then((m) => ({ default: m.IntegrationsPage })),
);

function DeveloperFallback({ label }: { label: string }) {
  return <div className="p-6 text-sm text-muted-foreground">Loading {label}…</div>;
}

registerAppComponent({
  ref: 'developer:api-console',
  label: 'API Console',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<DeveloperFallback label="API console" />}>
      <ApiConsolePage {...props} />
    </Suspense>
  ),
});

registerAppComponent({
  ref: 'developer:flow-runs',
  label: 'Flow Runs',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<DeveloperFallback label="flow runs" />}>
      <FlowRunsPage {...props} />
    </Suspense>
  ),
});

registerAppComponent({
  ref: 'developer:public-forms',
  label: 'Public Forms',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<DeveloperFallback label="public forms" />}>
      <PublicFormsPage {...props} />
    </Suspense>
  ),
});

registerAppComponent({
  ref: 'developer:integrations',
  label: 'Integrations & APIs',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<DeveloperFallback label="integrations" />}>
      <IntegrationsPage {...props} />
    </Suspense>
  ),
});
