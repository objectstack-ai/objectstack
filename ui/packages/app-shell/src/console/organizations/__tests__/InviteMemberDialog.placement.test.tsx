// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * InviteMemberDialog — scoped-invitation placement (framework ADR-0105 D8).
 *
 * The placement section NARROWS to what the issuer may actually delegate
 * (`security/my-delegable-scope`); the server still authorizes the pair
 * against the issuer's `adminScope`. So the behaviours worth pinning are the
 * ones a user would notice going wrong:
 *
 *   1. no delegated authority (or no runtime exposing it) ⇒ no placement UI at
 *      all — never a form the server would refuse;
 *   2. the options offered are exactly the delegable ones;
 *   3. a chosen placement reaches `inviteMember`, and a HALF-chosen one does
 *      not (a unit with no positions is not a placement).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => String(options?.defaultValue ?? key),
  }),
}));

const inviteMember = vi.fn();
const describeDelegableScope = vi.fn();
// Only `useAuth` is faked — the role vocabulary / narrowing helpers stay REAL,
// so a change to the cap surfaces here instead of being mocked away. These
// cases are about placement, so the caller is an owner (widest role list).
vi.mock('@object-ui/auth', async (importActual) => ({
  ...(await importActual<typeof import('@object-ui/auth')>()),
  useAuth: () => ({ inviteMember, describeDelegableScope, activeMember: { role: 'owner' } }),
}));

// Passthrough primitives — the Select is rendered as a native <select> so the
// test can drive it without Radix portal machinery.
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
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
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

const DELEGABLE = {
  isTenantAdmin: false,
  placeableBusinessUnitIds: ['bu_plant_a', 'bu_plant_a_qc'],
  assignablePositions: ['qc_inspector'],
  scopes: [],
};

const renderDialog = () =>
  render(
    <InviteMemberDialog organizationId="org-42" open onOpenChange={() => {}} />,
  );

const fillEmail = () =>
  fireEvent.change(screen.getByTestId('invite-email-input'), {
    target: { value: 'p@x.test' },
  });

beforeEach(() => {
  vi.clearAllMocks();
  inviteMember.mockResolvedValue({ id: 'inv-1', email: 'p@x.test', role: 'member' });
});

describe('InviteMemberDialog — placement (ADR-0105 D8)', () => {
  it('hides placement entirely when the caller may delegate nothing', async () => {
    describeDelegableScope.mockResolvedValue({
      isTenantAdmin: false,
      placeableBusinessUnitIds: [],
      assignablePositions: [],
      scopes: [],
    });
    renderDialog();
    await waitFor(() => expect(describeDelegableScope).toHaveBeenCalled());
    expect(screen.queryByTestId('invite-placement-section')).not.toBeInTheDocument();
  });

  it('hides placement when the deployment does not expose the surface at all', async () => {
    describeDelegableScope.mockResolvedValue(null);
    renderDialog();
    await waitFor(() => expect(describeDelegableScope).toHaveBeenCalled());
    expect(screen.queryByTestId('invite-placement-section')).not.toBeInTheDocument();
  });

  it('offers exactly the delegable units, and positions only once a unit is chosen', async () => {
    describeDelegableScope.mockResolvedValue(DELEGABLE);
    renderDialog();
    await screen.findByTestId('invite-placement-section');

    const unitSelect = within(screen.getByTestId('invite-placement-section')).getByTestId('select');
    expect(unitSelect).toHaveTextContent('bu_plant_a');
    expect(unitSelect).toHaveTextContent('bu_plant_a_qc');
    // Positions appear only after a unit is picked — an unanchored assignment
    // is refused by the gate, so offering it first would be misleading.
    expect(screen.queryByTestId('invite-positions')).not.toBeInTheDocument();

    fireEvent.change(unitSelect, { target: { value: 'bu_plant_a' } });
    await screen.findByTestId('invite-positions');
    expect(screen.getByTestId('invite-position-qc_inspector')).toBeInTheDocument();
  });

  it('sends a complete placement with the invitation', async () => {
    describeDelegableScope.mockResolvedValue(DELEGABLE);
    const { container } = renderDialog();
    await screen.findByTestId('invite-placement-section');

    fillEmail();
    fireEvent.change(within(screen.getByTestId('invite-placement-section')).getByTestId('select'), {
      target: { value: 'bu_plant_a' },
    });
    fireEvent.click(await screen.findByTestId('invite-position-qc_inspector'));
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(inviteMember).toHaveBeenCalledTimes(1));
    expect(inviteMember).toHaveBeenCalledWith({
      organizationId: 'org-42',
      email: 'p@x.test',
      role: 'member',
      businessUnitId: 'bu_plant_a',
      positions: ['qc_inspector'],
    });
  });

  it('a unit with no positions is NOT a placement — the invite goes out plain', async () => {
    describeDelegableScope.mockResolvedValue(DELEGABLE);
    const { container } = renderDialog();
    await screen.findByTestId('invite-placement-section');

    fillEmail();
    fireEvent.change(within(screen.getByTestId('invite-placement-section')).getByTestId('select'), {
      target: { value: 'bu_plant_a' },
    });
    fireEvent.submit(container.querySelector('form')!);

    await waitFor(() => expect(inviteMember).toHaveBeenCalledTimes(1));
    expect(inviteMember).toHaveBeenCalledWith({
      organizationId: 'org-42',
      email: 'p@x.test',
      role: 'member',
    });
  });
});
