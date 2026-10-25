// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * System-page component registrations (objectui#10520).
 *
 * Binds registry keys to two console pages under `pages/system/` that
 * framework navigation can otherwise not reach, so app metadata can point a
 * nav item at them declaratively:
 *
 * ```ts
 * { type: 'component', componentRef: 'audit:log' }
 * { type: 'component', componentRef: 'ai:approvals' }
 * ```
 *
 * URL shape resolved by `ComponentNavView`:
 *   audit:log    → /apps/<app>/component/audit/log
 *   ai:approvals → /apps/<app>/component/ai/approvals
 *
 * ## Why these two need a key
 *
 * Both pages were linked from exactly one place in the app: the System Hub
 * card wall, which objectui#3743 retired so that navigation is the single
 * source of truth. Framework navigation reaches a console page only through a
 * `type: 'component'` item whose `componentRef` is a registry key, never a
 * console path, so a page with no key has no way back into navigation.
 *
 * Both are KEPT rather than retired, because no navigation-reachable surface
 * covered everything they offer when objectui#10520 compared them capability
 * by capability. That comparison is a one-time reading, and nothing
 * re-derives it:
 *
 *   - `AuditLogPage`: the `sys_audit_log` object view (Setup's Audit Logs
 *     entry) gives filterable, paginated list views, but its record page shows
 *     `old_value` / `new_value` as raw JSON text. The page's detail drawer
 *     pretty-prints the before and after payloads, and the metadata, side by
 *     side.
 *   - `AiPendingActionsPage`: the only surface that lists the whole AI
 *     pending-action queue. The chat renders approval cards for its own
 *     conversation only, and the build debug drawer for its own build.
 *
 * ## Namespaces
 *
 * Each key is named for the capability that owns the data, the way
 * `approvals:inbox` is, and not for the console path the page happens to be
 * mounted at. `audit` is the capability that owns `sys_audit_log`
 * (`plugin-audit`, which registers the `audit` kernel service). `ai` is the
 * service that serves `/api/v1/ai/pending-actions`. `ai:approvals` lives in
 * this app-component registry, which is separate from the SDUI block registry
 * that holds the protocol's `ai:*` block types.
 *
 * ## The standalone routes stay
 *
 * `system/audit-log` and `system/ai-approvals` (declared in `AppContent.tsx`'s
 * `systemRoutes` fragment) are NOT replaced: bookmarks and deep links carry
 * them. These component refs are purely additive. Pinned in
 * `__tests__/orphanedPageComponentRefs-10520.test.tsx`.
 */

import { lazy, Suspense } from 'react';
import { registerAppComponent } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';

const AuditLogPage = lazy(() =>
  import('./pages/system/AuditLogPage').then((m) => ({ default: m.AuditLogPage })),
);
const AiPendingActionsPage = lazy(() =>
  import('./pages/system/AiPendingActionsPage').then((m) => ({ default: m.AiPendingActionsPage })),
);

function SystemPageFallback() {
  const { t } = useObjectTranslation();
  return (
    <div className="p-6 text-sm text-muted-foreground">
      {t('common.loading', { defaultValue: 'Loading…' })}
    </div>
  );
}

registerAppComponent({
  ref: 'audit:log',
  label: 'Audit Log',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<SystemPageFallback />}>
      <AuditLogPage {...props} />
    </Suspense>
  ),
});

registerAppComponent({
  ref: 'ai:approvals',
  label: 'AI Approvals',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<SystemPageFallback />}>
      <AiPendingActionsPage {...props} />
    </Suspense>
  ),
});
