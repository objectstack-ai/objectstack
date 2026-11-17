import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { ModalForm } from './ModalForm';
import { DrawerForm } from './DrawerForm';
import { ObjectForm } from './ObjectForm';

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

/**
 * objectstack#34599 — the master-detail Save bar stays in view at any scroll
 * position in all three hosts. jsdom does no layout, so what is pinned is the
 * structure `position: sticky` depends on: the bar is sticky at the bottom, it
 * is a direct child of the form's root (sticky is confined to its parent box),
 * and the first ancestor that sets `overflow` is the host's own scroller — any
 * overflow box in between would become the sticky frame and the bar would
 * scroll away inside it.
 */
describe('master-detail Save bar is pinned to the host scroll frame (objectstack#34599)', () => {
  const OVERFLOW = /(^|\s)overflow-(auto|scroll|hidden|y-auto|y-scroll|y-hidden|x-auto|x-hidden)(\s|$)/;

  async function pinnedBar() {
    const submit = await waitFor(() => screen.getByTestId('md-form-submit'));
    const bar = screen.getByTestId('md-form-actions');
    expect(bar.contains(submit)).toBe(true);
    expect(bar.classList.contains('sticky')).toBe(true);
    expect(bar.classList.contains('bottom-0')).toBe(true);
    // Opaque, so lines scrolling beneath it do not show through.
    expect(bar.classList.contains('bg-background')).toBe(true);
    return bar;
  }

  /** The nearest ancestor of the bar whose classes set an overflow. */
  function firstOverflowAncestor(bar: HTMLElement): HTMLElement | null {
    let el = bar.parentElement;
    while (el && el !== document.body) {
      if (OVERFLOW.test(el.getAttribute('class') ?? '')) return el;
      el = el.parentElement;
    }
    return null;
  }

  it('ModalForm: the bar sticks to the dialog body scroller, and the dialog draws no footer of its own', async () => {
    render(
      <ModalForm
        schema={{ objectName: 'expense_claim', mode: 'create', title: 'New Expense', open: true, onOpenChange: vi.fn(), subforms } as any}
        dataSource={ds}
      />,
    );
    const bar = await pinnedBar();
    const scroller = firstOverflowAncestor(bar);
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(scroller?.className).toContain('flex-1');
    // ADR-0035 Decision §6: the form owns its Save — one Save in the dialog.
    expect(screen.queryByTestId('modal-form-footer')).toBeNull();
    expect(screen.getAllByTestId('md-form-submit')).toHaveLength(1);
  });

  it('DrawerForm: the bar sticks to the drawer content, which is the scroller', async () => {
    render(
      <DrawerForm
        schema={{ objectName: 'expense_claim', mode: 'create', title: 'New Expense', open: true, onOpenChange: vi.fn(), subforms } as any}
        dataSource={ds}
      />,
    );
    const bar = await pinnedBar();
    const scroller = firstOverflowAncestor(bar);
    expect(scroller?.getAttribute('role')).toBe('dialog');
    expect(scroller?.className).toContain('overflow-y-auto');
    expect(screen.queryByTestId('drawer-form-footer')).toBeNull();
  });

  it('ObjectForm page host: nothing between the bar and the page sets an overflow', async () => {
    const { container } = render(
      <ObjectForm
        schema={{ type: 'object-form', objectName: 'expense_claim', mode: 'create', subforms, onCancel: vi.fn() } as any}
        dataSource={ds}
      />,
    );
    const bar = await pinnedBar();
    // The record page's own scroller is the frame; inside this component
    // there is no overflow box for the bar to stick to instead.
    const hit = firstOverflowAncestor(bar);
    expect(hit === null || !container.contains(hit)).toBe(true);
    expect(bar.parentElement?.parentElement).toBe(container);
  });
});
