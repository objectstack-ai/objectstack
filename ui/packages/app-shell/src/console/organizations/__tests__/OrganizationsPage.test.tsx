// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * OrganizationsPage — zero-org first-run auto-opens the create-workspace form.
 *
 * A brand-new user with NO organizations has nothing to pick, so the page must
 * land them straight on the "name your workspace" dialog instead of an empty
 * picker (one hop fewer on first run). Users who already have organizations
 * still see the picker; the `?create=1` entry still opens the dialog.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

const navigate = vi.fn();
let searchParams = new URLSearchParams();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useSearchParams: () => [searchParams],
}));

let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

vi.mock('../resolveHomeUrl', () => ({ resolveRootUrl: () => '/root' }));

// Stub the dialog so the test observes only whether it is opened.
vi.mock('../CreateWorkspaceDialog', () => ({
  CreateWorkspaceDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="create-workspace-dialog" /> : null,
}));

// Passthrough UI primitives (spread props → children render).
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Avatar: (p: any) => <div {...p} />,
  AvatarImage: (p: any) => <img {...p} />,
  AvatarFallback: (p: any) => <div {...p} />,
  Button: (p: any) => <button {...p} />,
  Input: (p: any) => <input {...p} />,
  Empty: (p: any) => <div {...p} />,
  EmptyTitle: (p: any) => <div {...p} />,
  EmptyDescription: (p: any) => <div {...p} />,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Plus: () => <span />,
  Search: () => <span />,
  Loader2: () => <span />,
}));

import { OrganizationsPage } from '../OrganizationsPage';

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams();
  authState = {
    organizations: [],
    activeOrganization: null,
    isOrganizationsLoading: false,
    switchOrganization: vi.fn(),
    getAuthConfig: vi.fn().mockResolvedValue({ features: { multiOrgEnabled: true } }),
  };
});

describe('OrganizationsPage — zero-org first run', () => {
  it('auto-opens the create-workspace dialog when the user has no organizations', async () => {
    render(<OrganizationsPage />);
    await waitFor(() =>
      expect(screen.getByTestId('create-workspace-dialog')).toBeInTheDocument(),
    );
    // Landed straight on the form — no picker card navigation happened.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does NOT auto-open the dialog when the user already has organizations', async () => {
    authState.organizations = [
      { id: 'o1', name: 'Alpha', slug: 'alpha' },
      { id: 'o2', name: 'Beta', slug: 'beta' },
    ];
    render(<OrganizationsPage />);
    await waitFor(() => expect((authState.getAuthConfig as any)).toHaveBeenCalled());
    expect(screen.queryByTestId('create-workspace-dialog')).toBeNull();
  });

  it('still opens the dialog via the explicit ?create=1 entry (regression)', async () => {
    authState.organizations = [{ id: 'o1', name: 'Alpha', slug: 'alpha' }];
    searchParams = new URLSearchParams('create=1');
    render(<OrganizationsPage />);
    await waitFor(() =>
      expect(screen.getByTestId('create-workspace-dialog')).toBeInTheDocument(),
    );
  });
});
