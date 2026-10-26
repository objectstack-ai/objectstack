// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Approvals component registrations.
 *
 * Binds the `approvals:*` registry keys to the lazy-loaded console pages that
 * already implement these surfaces, so app metadata can point a nav item at
 * the Approvals Inbox declaratively:
 *
 * ```ts
 * { id: 'nav_approvals', type: 'component', componentRef: 'approvals:inbox' }
 * ```
 *
 * URL shape resolved by `ComponentNavView`:
 *   approvals:inbox → /apps/<app>/component/approvals/inbox
 *
 * ## Why a registry key rather than a `type: 'url'` nav item
 *
 * objectstack#7213 converges the three coexisting "待我审批" entries at the
 * METADATA level: the framework-side navigation points at this ref, not at a
 * literal path. objectui#2763 (approved, scheduled after v17) will rebuild the
 * approval surface on the standard SDUI renderers and delete this bespoke page;
 * when it does, only this file changes — every app's nav metadata keeps naming
 * `approvals:inbox` and nothing downstream churns.
 *
 * ## The standalone route stays
 *
 * `system/approvals` (declared in `AppContent.tsx`'s `systemRoutes` fragment,
 * mounted as both `extraRoutes` and `extraRoutesNoApp`) is NOT replaced by this
 * registration — server notification and email deep links carry
 * `/system/approvals?request=<id>`, and `InboxPopover` app-prefixes them. This
 * component ref is purely additive.
 *
 * Both mount paths sit under `/apps/:appName/*`, so `useParams().appName` — the
 * app segment `ApprovalsInboxPage` builds its record deep links from — resolves
 * identically either way, and `?request=<id>` reaches the page's
 * `useSearchParams()` drawer opener on both. Pinned in
 * `__tests__/approvalsInboxComponentRef.test.tsx`.
 */

import { lazy, Suspense } from 'react';
import { registerAppComponent } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';

const ApprovalsInboxPage = lazy(() =>
  import('./pages/system/ApprovalsInboxPage').then((m) => ({ default: m.ApprovalsInboxPage })),
);

function ApprovalsFallback() {
  const { t } = useObjectTranslation();
  return (
    <div className="p-6 text-sm text-muted-foreground">
      {t('common.loading', { defaultValue: 'Loading…' })}
    </div>
  );
}

registerAppComponent({
  ref: 'approvals:inbox',
  label: 'Approvals Inbox',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<ApprovalsFallback />}>
      <ApprovalsInboxPage {...props} />
    </Suspense>
  ),
});
