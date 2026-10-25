// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * InviteMemberDialog — the role select is narrowed by the ISSUER's own grade
 * (framework#3697).
 *
 * Before the framework registered `delegated_admin`, this select was a
 * hardcoded owner/admin/member list. Two things had to change together:
 *
 *   1. the new role must be offerable at all — otherwise the capability the
 *      framework grew is unreachable from the console;
 *   2. the list must narrow to what the issuer may actually confer — a
 *      `delegated_admin` who picks "Admin" gets a 403 from the server's role
 *      cap, so offering it is a trap, not a feature.
 *
 * The server remains the boundary; this only stops the console from proposing
 * something it knows will be refused.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

const inviteMember = vi.fn();
const describeDelegableScope = vi.fn();
// Mutable so each case can be a different kind of issuer. Only `useAuth` is
// faked — the narrowing helpers stay real.
const auth: { role: string | null } = { role: 'owner' };
vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => ({
    inviteMember,
    describeDelegableScope,
    activeMember: auth.role === null ? null : { role: auth.role },
  }),
}));

vi.mock('@object-ui/components', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Dialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  DialogContent: (p: any) => <div {...p} />,
  DialogDescription: (p: any) => <p {...p} />,
  DialogFooter: (p: any) => <div {...p} />,
  DialogHeader: (p: any) => <div {...p} />,
  DialogTitle: (p: any) => <h2 {...p} />,
  Button: ({ children, ...rest }: any) => <button {...rest}>{children}</button>,
  Input: (p: any) => <input {...p} />,
  Label: (p: any) => <label {...p} />,
  Select: ({ value, onValueChange, children }: any) => (
    <select data-testid="select" value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {children}
    </select>
  ),
  SelectContent: (p: any) => <>{p.children}</>,
  SelectItem: ({ value, children, ...rest }: any) => (
    <option value={value} {...rest}>
      {children}
    </option>
  ),
  SelectTrigger: (p: any) => <>{p.children}</>,
  SelectValue: () => null,
}));
vi.mock('lucide-react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Loader2: () => <span />,
  Copy: () => <span />,
  Check: () => <span />,
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { InviteMemberDialog } from '../manage/InviteMemberDialog';

// `describeDelegableScope` resolves null in every case here, so the placement
// section stays hidden and the role select is the only one on screen. (The
// Select mock renders a native <select data-testid="select">; the component's
// own testid lives on SelectTrigger, which the mock flattens away.)
const renderAs = async (role: string | null) => {
  auth.role = role;
  render(<InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />);
  await waitFor(() => expect(screen.getByTestId('select')).toBeInTheDocument());
};

const offered = () =>
  Array.from(screen.getByTestId('select').querySelectorAll('option'))
    .map((o) => o.getAttribute('value'))
    .filter(Boolean);

beforeEach(() => {
  vi.clearAllMocks();
  describeDelegableScope.mockResolvedValue(null);
  inviteMember.mockResolvedValue({ id: 'inv-1', email: 'p@x.test', role: 'member' });
});

describe('InviteMemberDialog — role cap (framework#3697)', () => {
  it('an owner is offered every role, delegated_admin included', async () => {
    await renderAs('owner');
    expect(offered()).toEqual(['owner', 'admin', 'delegated_admin', 'member', 'external']);
  });

  it('an admin may provision a delegate but may not invite an owner', async () => {
    await renderAs('admin');
    const roles = offered();
    expect(roles).toContain('delegated_admin');
    expect(roles).not.toContain('owner');
  });

  it('a DELEGATE is offered member and external only — the escalation chain has no UI entry', async () => {
    // Picking "Admin" here would 403 on the server's role cap; the console must
    // not propose it. This is the whole reason the select stopped being a
    // hardcoded three-item list.
    await renderAs('delegated_admin');
    expect(offered()).toEqual(['member', 'external']);
    expect(screen.queryByTestId('invite-role-admin')).not.toBeInTheDocument();
  });

  it('an unloaded membership still allows the ordinary member invite', async () => {
    await renderAs(null);
    expect(offered()).toEqual(['member', 'external']);
  });

  it('the narrowed default still submits a plain, unchanged invitation', async () => {
    // A delegate's ordinary invite must be byte-identical to what any other
    // caller sends — narrowing the picker changed the options, not the payload.
    await renderAs('delegated_admin');
    fireEvent.change(screen.getByTestId('invite-email-input'), {
      target: { value: 'p@x.test' },
    });
    fireEvent.submit(document.querySelector('form')!);
    await waitFor(() => expect(inviteMember).toHaveBeenCalledTimes(1));
    expect(inviteMember).toHaveBeenCalledWith({
      organizationId: 'org-42',
      email: 'p@x.test',
      role: 'member',
    });
  });
});
