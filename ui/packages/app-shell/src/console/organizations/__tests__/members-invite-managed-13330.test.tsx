// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13330 — on a cloud-managed environment (`features.cloudManaged`)
 * the members page does not offer Invite member: people join through the
 * hosting organisation in the cloud, and the server refuses an invitation made
 * here (the objectstack-ai/objectstack#25083 ruling, Q3 A). The button gives
 * its place to a note that says where to invite.
 *
 * The viewer is an org owner throughout, the role that is offered the button,
 * so the flag is the only variable. The control (the flag absent, `false`, or
 * `/auth/config` refusing) keeps the button.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';

const getMembers = vi.fn();
const getAuthConfig = vi.fn();
const describeDelegableScope = vi.fn();

vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    getMembers,
    removeMember: vi.fn(),
    updateMemberRole: vi.fn(),
    inviteMember: vi.fn(),
    describeDelegableScope,
    getAuthConfig,
    isAuthenticated: true,
    isLoading: false,
    activeMember: { role: 'owner' },
  }),
}));

vi.mock('@object-ui/i18n', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/i18n')>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key,
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock('react-router-dom', () => ({
  useOutletContext: () => ({ org: { id: 'org-42', name: 'Acme', slug: 'acme' } }),
  useNavigate: () => vi.fn(),
}));

vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const passthrough = (tag: string) => (p: any) => React.createElement(tag, p, p.children);
  return {
    ...actual,
    Avatar: passthrough('div'),
    AvatarFallback: passthrough('div'),
    AvatarImage: (p: any) => <img {...p} />,
    Badge: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
    Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    Separator: () => <hr />,
    Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
    DropdownMenu: ({ children }: any) => <div>{children}</div>,
    DropdownMenuContent: passthrough('div'),
    DropdownMenuItem: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
    DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  };
});

import { MembersPage } from '../manage/MembersPage';

beforeEach(() => {
  vi.clearAllMocks();
  describeDelegableScope.mockResolvedValue(null);
  getMembers.mockResolvedValue([
    { id: 'm-1', role: 'owner', userId: 'u-1', user: { name: 'Ada', email: 'ada@x.test' } },
  ]);
});

async function mounted() {
  render(<MembersPage />);
  await screen.findByText('Ada');
  await waitFor(() => expect(getAuthConfig).toHaveBeenCalled());
  // Let the config answer land.
  await Promise.resolve();
}

describe('MembersPage on a cloud-managed environment (objectui#13330)', () => {
  it('does not offer Invite member, and says where to invite instead', async () => {
    getAuthConfig.mockResolvedValue({ features: { cloudManaged: true } });
    await mounted();
    expect(await screen.findByTestId('invite-managed-note')).toHaveTextContent(
      'People join through your organization in the cloud. Invite them there.',
    );
    expect(screen.queryByTestId('invite-member-btn')).toBeNull();
    expect(screen.queryByTestId('invite-restricted-note')).toBeNull();
  });

  it.each([
    ['absent', () => getAuthConfig.mockResolvedValue({})],
    ['false', () => getAuthConfig.mockResolvedValue({ features: { cloudManaged: false } })],
    ['unreadable', () => getAuthConfig.mockRejectedValue(new Error('offline'))],
  ])('CONTROL: with the flag %s, the owner is offered Invite member', async (_label, arrange) => {
    arrange();
    await mounted();
    expect(screen.getByTestId('invite-member-btn')).toBeInTheDocument();
    expect(screen.queryByTestId('invite-managed-note')).toBeNull();
  });
});
