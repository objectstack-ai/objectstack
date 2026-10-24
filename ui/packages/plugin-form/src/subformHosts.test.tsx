import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';

// sonner toast is wired to a mounted <Toaster> the tests don't render.
const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@object-ui/components', async (orig) => {
  const actual = await (orig as any)();
  return { ...actual, toast: { success: toastSuccess, error: toastError } };
});

registerAllFields();

const ds: any = {
  getObjectSchema: vi.fn().mockResolvedValue({
    name: 'expense_claim',
    fields: { title: { type: 'text', label: 'Title' } },
  }),
  batchTransaction: vi.fn(),
};

const subforms = [{ childObject: 'expense_line', relationshipField: 'claim', title: 'Lines', columns: [{ name: 'amount', type: 'number' }] }];

beforeEach(() => vi.clearAllMocks());

describe('ModalForm + DrawerForm host master-detail when subforms are set', () => {
  it('ModalForm renders MasterDetailForm inside the dialog (no plain footer)', async () => {
    render(
      <ModalForm
        schema={{
          objectName: 'expense_claim',
          mode: 'create',
          title: 'New Expense',
          open: true,
          onOpenChange: vi.fn(),
          subforms,
        } as any}
        dataSource={ds}
      />,
    );
    // The master-detail Save bar renders; the plain modal footer does not.
    await waitFor(() => expect(screen.getByTestId('md-form-submit')).toBeTruthy());
    expect(screen.getByText('Lines')).toBeTruthy();
    expect(screen.queryByTestId('modal-form-footer')).toBeNull();
  });

  it('DrawerForm renders MasterDetailForm inside the drawer', async () => {
    render(
      <DrawerForm
        schema={{
          objectName: 'expense_claim',
          mode: 'create',
          title: 'New Expense',
          open: true,
          onOpenChange: vi.fn(),
          subforms,
        } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('md-form-submit')).toBeTruthy());
    expect(screen.getByText('Lines')).toBeTruthy();
  });

  it('ModalForm renders a normal form (with footer) when no subforms', async () => {
    render(
      <ModalForm
        schema={{ objectName: 'expense_claim', mode: 'create', open: true, onOpenChange: vi.fn() } as any}
        dataSource={ds}
      />,
    );
    await waitFor(() => expect(screen.getByTestId('modal-form-footer')).toBeTruthy());
    expect(screen.queryByTestId('md-form-submit')).toBeNull();
  });
});
