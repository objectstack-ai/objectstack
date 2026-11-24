import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
 * position in all three hosts; the record dialog's frame is pinned in the
 * objectstack#34819 block below. jsdom does no layout, so what is pinned is the
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

/**
 * objectstack#34819 — in the record dialog the Save bar sits at the dialog's
 * bottom at every scroll position. As a sticky box inside the dialog's body
 * scroller it stopped at the scroller's content edge — the scroller's bottom
 * padding above the dialog's own — and rose with any content past the form's
 * root. The dialog now hands the form a frame of fixed height: the form
 * scrolls its body in a box of its own and draws the bar as the flex row
 * below it, outside the scrolled content. jsdom does no layout, so what is
 * pinned is that structure, maximized too.
 */
describe('master-detail Save bar sits at the record dialog bottom (objectstack#34819)', () => {
  const OVERFLOW = /(^|\s)overflow-(auto|scroll|y-auto|y-scroll)(\s|$)/;
  const has = (el: Element | null | undefined, ...names: string[]) =>
    names.every((n) => (el?.getAttribute('class') ?? '').split(/\s+/).includes(n));

  function renderDialog() {
    render(
      <ModalForm
        schema={{ objectName: 'expense_claim', mode: 'create', title: 'New Expense', open: true, onOpenChange: vi.fn(), onCancel: vi.fn(), subforms } as any}
        dataSource={ds}
      />,
    );
  }

  async function assertFramed() {
    const submit = await waitFor(() => screen.getByTestId('md-form-submit'));
    const bar = screen.getByTestId('md-form-actions');
    const body = screen.getByTestId('md-form-body');
    const dialog = screen.getByRole('dialog');
    expect(bar.contains(submit)).toBe(true);

    // The bar is not sticky and paints no strip below itself: it is a flex
    // row that does not shrink, with the flat arm footer's padding.
    expect(has(bar, 'sticky')).toBe(false);
    expect(has(bar, 'bottom-0')).toBe(false);
    expect(bar.getAttribute('class') ?? '').not.toMatch(/(^|\s)after:/);
    expect(has(bar, 'shrink-0', 'border-t', 'bg-card', 'px-4', 'sm:px-5', 'py-3')).toBe(true);

    // Nothing between the bar and the dialog scrolls: the body's scroller is
    // the bar's sibling, so the bar is outside the scrolled content.
    for (let el = bar.parentElement; el && el !== dialog; el = el.parentElement) {
      expect(OVERFLOW.test(el.getAttribute('class') ?? '')).toBe(false);
    }
    expect(body.contains(bar)).toBe(false);
    expect(body.nextElementSibling).toBe(bar);
    expect(has(body, 'min-h-0', 'flex-1', 'overflow-y-auto', '@container', 'px-4', 'sm:px-5', 'py-4')).toBe(true);
    expect(body.querySelector('form')).not.toBeNull();

    // The form's root fills the dialog's frame, which fills the dialog below
    // its header: each a flex column that may shrink below its content.
    const root = bar.parentElement!;
    expect(has(root, 'flex', 'min-h-0', 'flex-1', 'flex-col')).toBe(true);
    const frame = screen.getByTestId('modal-form-md-frame');
    expect(frame.parentElement).toBe(dialog);
    expect(frame.contains(root)).toBe(true);
    expect(has(frame, 'flex', 'min-h-0', 'flex-1', 'flex-col')).toBe(true);
    expect(OVERFLOW.test(frame.getAttribute('class') ?? '')).toBe(false);
    expect(has(dialog, 'flex', 'flex-col', 'overflow-hidden')).toBe(true);

    // ADR-0035 Decision §6: the form owns its Save — one Save in the dialog,
    // and the dialog draws no footer of its own.
    expect(screen.queryByTestId('modal-form-footer')).toBeNull();
    expect(screen.getAllByTestId('md-form-submit')).toHaveLength(1);
    expect(screen.getByTestId('md-form-cancel')).toBeTruthy();
    return dialog;
  }

  it('the bar is the row below the body scroller, not inside it', async () => {
    renderDialog();
    await assertFramed();
  });

  it('keeps that frame when the dialog is maximized', async () => {
    renderDialog();
    const dialog = await assertFramed();
    expect(dialog.hasAttribute('data-maximized')).toBe(false);
    fireEvent.click(screen.getByTestId('modal-form-maximize'));
    await waitFor(() => expect(screen.getByRole('dialog').hasAttribute('data-maximized')).toBe(true));
    await assertFramed();
  });
});
