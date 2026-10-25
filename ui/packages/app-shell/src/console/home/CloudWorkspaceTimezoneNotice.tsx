// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * CloudWorkspaceTimezoneNotice — one line on the Cloud control plane's welcome
 * page naming the timezone a workspace was seeded with at creation, registered
 * as the SDUI widget `cloud:workspace-timezone-notice` (objectui#11930, the
 * objectui half of objectstack-ai/cloud#2676).
 *
 * The welcome page is static metadata: nothing in its expression scope carries
 * a per-organization value, so a page node cannot print the seeded zone. The
 * seed is only available from the org-scoped `GET /cloud/environment-entitlements`
 * summary (`data.workspaceTimezoneSeed`, an additive string). This widget reads
 * that summary and says one thing about it:
 *
 *   • the summary carries a seed   → one muted, localized line naming it;
 *   • the summary carries no seed  → nothing. That covers every workspace
 *     created before the seed existed and every control plane that does not
 *     send the field yet;
 *   • loading, failed, or no summary → nothing. The row-derived fallback of
 *     `useEnvironmentEntitlements` carries no seed, so a failed summary request
 *     degrades to the empty render, never to a guess and never to a throw.
 *
 * The zone is printed VERBATIM — it is an IANA id (`Asia/Shanghai`), not a
 * value to localize — and the line is text only: no link (a relative link from
 * the control plane would open the control plane's own settings, cloud#2676
 * Q2) and no dismissal state.
 *
 * ## The summary is read through `useEnvironmentEntitlements`
 *
 * The same hook the environment list uses: one reading of the endpoint and its
 * strict `{ success, data }` envelope, not another copy of the fetch.
 */

import { useState } from 'react';
import { cn } from '@object-ui/components';
import { createAuthenticatedFetch } from '@object-ui/auth';
import { ComponentRegistry } from '@object-ui/core';
import { useObjectTranslation } from '@object-ui/i18n';
import { useAdapter } from '../../providers/AdapterProvider.js';
import { useEnvironmentEntitlements } from '../../environment/useEnvironmentEntitlements.js';

export interface CloudWorkspaceTimezoneNoticeProps {
  /** Carries the scope class of the node's `responsiveStyles`. */
  className?: string;
}

export function CloudWorkspaceTimezoneNotice({ className }: CloudWorkspaceTimezoneNoticeProps) {
  const { t } = useObjectTranslation();
  const dataSource = useAdapter();
  // `useState`, not `useMemo`: one function per mount, with an identity React
  // guarantees to keep (AGENTS.md #10). The hook uses it only when this reader
  // is the one that starts the shared resolution (objectui#12808).
  const [authFetch] = useState(() => createAuthenticatedFetch());
  const entitlements = useEnvironmentEntitlements({
    enabled: true,
    dataSource,
    authFetch,
    apiBase: (import.meta.env.VITE_SERVER_URL as string | undefined) || '',
  });

  const zone = entitlements?.workspaceTimezoneSeed;
  if (typeof zone !== 'string' || zone === '') return null;

  return (
    <p className={cn('text-sm text-muted-foreground', className)} data-workspace-timezone-notice="seeded">
      {t('cloudWorkspaceTimezoneNotice.seeded', { zone })}
    </p>
  );
}

// SDUI registration — the Cloud welcome page places one node. Registered under
// the `cloud` namespace with no bare fallback, so the one key is
// `cloud:workspace-timezone-notice`: the spelling the page authors, and the one
// literal its `@object-ui/types` arm claims (`CloudWorkspaceTimezoneNoticeSchema`).
ComponentRegistry.register('workspace-timezone-notice', (props: CloudWorkspaceTimezoneNoticeProps) => (
  <CloudWorkspaceTimezoneNotice {...props} />
), {
  namespace: 'cloud',
  skipFallback: true,
  label: 'Cloud Workspace Timezone Notice',
  category: 'plugin',
  inputs: [],
});
