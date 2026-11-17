// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12851 — the organization switcher names the organisation 「组织」 /
 * "Organization" (the maintainer's ruling on objectstack-ai/cloud#2939,
 * letter A). Rendered through the REAL locale packs in zh-CN with en as the
 * control; the sibling `WorkspaceSwitcher.test.tsx` stubs `t()` to its inline
 * default and cannot see a pack value. The switcher is the avatar menu's
 * submenu (objectstack-ai/objectstack#34591); the menu's own create entry is
 * pinned by `AppHeader.organizationNoun-12851.test.tsx`.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const ORGS = [
  { id: 'org_a', name: 'Plant A', slug: 'plant-a' },
  { id: 'org_b', name: 'Plant B', slug: 'plant-b' },
];
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    organizations: ORGS,
    activeOrganization: ORGS[0],
    switchOrganization: vi.fn(),
  }),
}));

vi.mock('../../console/organizations/resolveHomeUrl', () => ({ resolveRootUrl: () => '/root' }));

// Passthrough submenu primitives: the open submenu's content renders inline.
vi.mock('@object-ui/components', async (importOriginal) => {
  const Pass = ({ children, ...p }: any) => <div {...p}>{children}</div>;
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    DropdownMenuSub: Pass,
    DropdownMenuSubTrigger: Pass,
    DropdownMenuSubContent: Pass,
    DropdownMenuItem: Pass,
    DropdownMenuLabel: Pass,
  };
});

import { I18nProvider } from '@object-ui/i18n';
import { WorkspaceSwitcherMenu } from '../WorkspaceSwitcher';

const renderIn = (language: 'en' | 'zh-CN', isGroupPosture = false) =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <WorkspaceSwitcherMenu isGroupPosture={isGroupPosture} />
    </I18nProvider>,
  );

describe('WorkspaceSwitcherMenu — the organisation is 「组织」 (objectui#12851)', () => {
  it('zh-CN: the switcher entry reads 切换组织, and group posture reads 当前工作组织', async () => {
    renderIn('zh-CN', true);
    expect(await screen.findByTestId('header-switch-organization')).toHaveTextContent('切换组织');
    expect(screen.getByText('当前工作组织')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('工作区');
  });

  it('en (control): the same switcher reads "Switch organization" and "Working organization"', async () => {
    renderIn('en', true);
    expect(await screen.findByTestId('header-switch-organization')).toHaveTextContent('Switch organization');
    expect(screen.getByText('Working organization')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/workspace/i);
  });
});
