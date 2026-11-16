// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The account app's Mobile App entry sits right after Profile and targets the
// component the Console registers as `account:mobile_app` (the app-shell half
// of this pairing is pinned in `MobileAppPage.test.tsx`, which resolves the
// same ref through the component registry). A bare nav-count pin elsewhere
// shows that one id joined; this one shows which, where, and what it opens.
import { describe, it, expect } from 'vitest';
import { AppSchema } from '@objectstack/spec/ui';

import { ACCOUNT_APP } from './account.app.js';

type NavItem = { id?: string; type?: string; componentRef?: string; requiredPermissions?: unknown };

const topLevel = (): NavItem[] => (ACCOUNT_APP.navigation ?? []) as NavItem[];

describe("the account app's Mobile App entry", () => {
  it('sits immediately after Profile', () => {
    const ids = topLevel().map((item) => item.id);
    const profile = ids.indexOf('nav_account_profile');
    expect(profile, 'the account app lost its Profile entry').toBeGreaterThanOrEqual(0);
    expect(ids[profile + 1]).toBe('nav_account_mobile_app');
  });

  it('opens the `account:mobile_app` component, ungated', () => {
    const entry = topLevel().find((item) => item.id === 'nav_account_mobile_app');
    expect(entry).toMatchObject({ type: 'component', componentRef: 'account:mobile_app' });
    expect(entry?.requiredPermissions).toBeUndefined();
  });

  it('CONTROL: the app with the entry still parses as an App', () => {
    expect(AppSchema.safeParse(ACCOUNT_APP).success).toBe(true);
  });
});
