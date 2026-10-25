// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12851 — the header-left switcher names the organisation 「组织」 /
 * "Organization" (the maintainer's ruling on objectstack-ai/cloud#2939,
 * letter A). Rendered through the REAL locale packs in zh-CN with en as the
 * control; the sibling `WorkspaceSwitcher.test.tsx` stubs `t()` to its inline
 * default and cannot see a pack value.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

const ORGS = [
  { id: 'org_a', name: 'Plant A', slug: 'plant-a' },
  { id: 'org_b', name: 'Plant B', slug: 'plant-b' },
];
const getAuthConfig = vi.fn().mockResolvedValue({ features: { multiOrgEnabled: true } });
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    organizations: ORGS,
    activeOrganization: ORGS[0],
    switchOrganization: vi.fn(),
    getAuthConfig,
  }),
}));

vi.mock('../../console/organizations/resolveHomeUrl', () => ({ resolveRootUrl: () => '/root' }));

// Passthrough dropdown primitives: the open menu's content renders inline.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <button {...p} />,
  DropdownMenuContent: (p: any) => <div>{p.children}</div>,
  DropdownMenuItem: ({ onClick, children, ...p }: any) => <div onClick={onClick} data-testid={p['data-testid']}>{children}</div>,
  DropdownMenuLabel: (p: any) => <div {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));

import { I18nProvider } from '@object-ui/i18n';
import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

const renderIn = (language: 'en' | 'zh-CN') =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <WorkspaceSwitcher />
    </I18nProvider>,
  );

beforeEach(() => {
  navigate.mockReset();
});

describe('WorkspaceSwitcher — the organisation is 「组织」 (objectui#12851)', () => {
  it('zh-CN: the open switcher reads 切换组织 and offers 创建组织', async () => {
    renderIn('zh-CN');
    expect(await screen.findByTestId('workspace-create')).toHaveTextContent('创建组织');
    expect(screen.getByText('切换组织')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('工作区');
  });

  it('en (control): the same switcher reads "Switch organization" and "Create organization"', async () => {
    renderIn('en');
    expect(await screen.findByTestId('workspace-create')).toHaveTextContent('Create organization');
    expect(screen.getByText('Switch organization')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/workspace/i);
  });
});
