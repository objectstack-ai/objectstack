// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * WorkspaceSwitcher — ADR-0105 group-posture semantics.
 *
 * Under `group` tenancy posture the active organization is only the WRITE
 * target (reads span every organization the member belongs to), so the
 * dropdown must label it "Working organization" and explain the split.
 * Every other posture — isolated, single, absent, or an unrecognized value
 * from a newer server — keeps today's "Switch organization" rendering.
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
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

let authState: Record<string, unknown>;
vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => authState,
}));

vi.mock('../../console/organizations/resolveHomeUrl', () => ({ resolveRootUrl: () => '/root' }));

// Passthrough dropdown primitives so label/hint render without interaction.
vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DropdownMenu: (p: any) => <div>{p.children}</div>,
  DropdownMenuTrigger: (p: any) => <button {...p} />,
  DropdownMenuContent: (p: any) => <div>{p.children}</div>,
  DropdownMenuItem: ({ onClick, children }: any) => <div onClick={onClick}>{children}</div>,
  DropdownMenuLabel: (p: any) => <div {...p} />,
  DropdownMenuSeparator: () => <hr />,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ChevronsUpDown: () => <span />,
  Check: () => <span />,
  Plus: () => <span />,
  Users: () => <span />,
}));

import { WorkspaceSwitcher } from '../WorkspaceSwitcher';

const ORGS = [
  { id: 'org_a', name: 'Plant A', slug: 'plant-a' },
  { id: 'org_b', name: 'Plant B', slug: 'plant-b' },
];

function setAuthConfig(features: Record<string, unknown>) {
  authState = {
    organizations: ORGS,
    activeOrganization: ORGS[0],
    switchOrganization: vi.fn(),
    getAuthConfig: vi.fn().mockResolvedValue({ features }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('WorkspaceSwitcher (ADR-0105 tenancy posture)', () => {
  it('group posture: labels the active org as the working organization and explains the read/write split', async () => {
    setAuthConfig({ multiOrgEnabled: true, tenancyPosture: 'group' });
    render(<WorkspaceSwitcher />);
    await waitFor(() => {
      expect(screen.getByText('Working organization')).toBeInTheDocument();
    });
    expect(screen.getByTestId('workspace-switcher-group-hint')).toHaveTextContent(
      'New records are created here. Views show data from all your organizations.',
    );
    expect(screen.queryByText('Switch organization')).not.toBeInTheDocument();
  });

  it('isolated posture: keeps the plain switch label with no group hint', async () => {
    setAuthConfig({ multiOrgEnabled: true, tenancyPosture: 'isolated' });
    render(<WorkspaceSwitcher />);
    // The posture fetch resolves async — assert the steady state.
    await waitFor(() => {
      expect((authState.getAuthConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Switch organization')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-switcher-group-hint')).not.toBeInTheDocument();
  });

  it('absent or unrecognized posture fails toward today\'s rendering', async () => {
    setAuthConfig({ multiOrgEnabled: true, tenancyPosture: 'weird-future-value' });
    render(<WorkspaceSwitcher />);
    await waitFor(() => {
      expect((authState.getAuthConfig as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0);
    });
    expect(screen.getByText('Switch organization')).toBeInTheDocument();
    expect(screen.queryByTestId('workspace-switcher-group-hint')).not.toBeInTheDocument();
  });
});
