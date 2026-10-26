// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12851 — the organisations page names the organisation 「组织」 /
 * "Organization" (the maintainer's ruling on objectstack-ai/cloud#2939,
 * letter A). Rendered through the REAL locale packs in zh-CN with en as the
 * control; the sibling `OrganizationsPage.test.tsx` stubs `t()` to its inline
 * default and cannot see a pack value.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  // `?manage=1` keeps a multi-org user on the picker instead of auto-skipping.
  useSearchParams: () => [new URLSearchParams('manage=1')],
}));

const ORGS = [
  { id: 'o1', name: 'Alpha', slug: 'alpha' },
  { id: 'o2', name: 'Beta', slug: 'beta' },
];
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    organizations: ORGS,
    activeOrganization: ORGS[0],
    isOrganizationsLoading: false,
    switchOrganization: vi.fn(),
    getAuthConfig: vi.fn().mockResolvedValue({ features: { multiOrgEnabled: true } }),
  }),
}));

vi.mock('../resolveHomeUrl', () => ({ resolveRootUrl: () => '/root' }));
vi.mock('../CreateWorkspaceDialog', () => ({ CreateWorkspaceDialog: () => null }));

import { I18nProvider } from '@object-ui/i18n';
import { OrganizationsPage } from '../OrganizationsPage';

const renderIn = (language: 'en' | 'zh-CN') =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <OrganizationsPage />
    </I18nProvider>,
  );

beforeEach(() => {
  navigate.mockReset();
});

describe('OrganizationsPage — the organisation is 「组织」 (objectui#12851)', () => {
  it('zh-CN: the heading reads 您的组织 and the page never says 工作区', async () => {
    renderIn('zh-CN');
    expect(await screen.findByRole('heading', { name: '您的组织' })).toBeInTheDocument();
    expect(screen.getByText('当前组织')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('工作区');
  });

  it('en (control): the heading reads "Your Organizations"', async () => {
    renderIn('en');
    expect(await screen.findByRole('heading', { name: 'Your Organizations' })).toBeInTheDocument();
    expect(screen.getByText('Current organization')).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/workspace/i);
  });
});
