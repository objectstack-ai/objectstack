// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12113 — the app designer's preview names a `component` entry as the
 * landing, in step with the runtime.
 *
 * The preview's `findFirstLanding` mirrors the console's `findFirstRoute`. It
 * already took any entry with an in-app route, a `component` entry included,
 * while the runtime walked object, page, dashboard and report entries only, so
 * for the Studio app the preview named a landing the runtime did not open.
 * The runtime now walks `component` entries too; this pins the preview's half
 * on the same navigation order the console test pins
 * (`AppContent.studioRootLanding-12113.test.tsx`).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AppPreview } from './AppPreview';

afterEach(cleanup);

describe('objectui#12113 — AppPreview names the first entry as the landing, whatever its type', () => {
  it('names a `component` entry ahead of an `object` entry', () => {
    render(
      <AppPreview
        type="app"
        name="account"
        draft={{
          name: 'account',
          label: 'Account',
          navigation: [
            { id: 'nav_account_profile', type: 'component', label: 'Profile', componentRef: 'account:profile_card' },
            { id: 'nav_account_notifications', type: 'object', label: 'Notifications', objectName: 'sys_inbox_message' },
          ],
        }}
      />,
    );
    expect(screen.getByText('→ Profile')).toBeTruthy();
  });

  it('control: an `object` entry ahead of a `component` entry is still the landing', () => {
    render(
      <AppPreview
        type="app"
        name="crm"
        draft={{
          name: 'crm',
          label: 'CRM',
          navigation: [
            { id: 'nav_accounts', type: 'object', label: 'Accounts', objectName: 'account' },
            { id: 'nav_tools', type: 'component', label: 'Tools', componentRef: 'developer:api-console' },
          ],
        }}
      />,
    );
    expect(screen.getByText('→ Accounts')).toBeTruthy();
  });
});
