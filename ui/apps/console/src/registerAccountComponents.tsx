// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Account component registrations.
 *
 * Binds the `account:*` registry keys (referenced from the framework's
 * Account App navigation) to the lazy-loaded console pages that already
 * implement these surfaces.
 *
 * Why register the SAME page that's already wired at `/system/profile`?
 * The personal-profile UX (avatar / name / password change / SSO recovery
 * banner) is identical regardless of whether the user lands via the
 * System hub or via the Account App's sidebar — DRY beats duplication.
 * `ComponentNavView` simply renders this component as the route body.
 *
 * URL shape resolved by `ComponentNavView`:
 *   account:profile_card → /apps/account/component/account/profile_card
 *
 * The standalone `/system/profile` route in `AppContent.tsx` is left in
 * place — Console-shell's System Hub still links to it directly. This
 * module only wires the metadata-driven entry from app sidebars (the
 * `nav_account_profile` item in `account.app.ts`).
 *
 * Future: add `account:security_card`, `account:sessions_card`,
 * `account:api_keys_card`, … the same way as we replace the remaining
 * generic object views in the Account App.
 */

import { lazy, Suspense } from 'react';
import { registerAppComponent } from '@object-ui/app-shell';
import { useObjectTranslation } from '@object-ui/i18n';

const ProfilePage = lazy(() =>
  import('./pages/system/ProfilePage').then((m) => ({ default: m.ProfilePage })),
);

function AccountFallback() {
  const { t } = useObjectTranslation();
  return (
    <div className="p-6 text-sm text-muted-foreground">
      {t('common.loading', { defaultValue: 'Loading…' })}
    </div>
  );
}

registerAppComponent({
  ref: 'account:profile_card',
  label: 'My Profile',
  source: '@object-ui/console',
  component: (props: any) => (
    <Suspense fallback={<AccountFallback />}>
      <ProfilePage {...props} />
    </Suspense>
  ),
});
