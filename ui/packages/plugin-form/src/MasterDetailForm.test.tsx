import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MasterDetailForm } from './MasterDetailForm';

// Capture toast calls so we can assert the form is never a silent no-op.
// Mock target is the DEEP module `@object-ui/components/ui/sonner`, not the
// package barrel `@object-ui/components` — that used to be enough only
// because MasterDetailForm's OWN (now-removed, objectui#7354) `handleError`
// toast happened to go through the barrel, which this file's coarse mock DID
// intercept. It never saw the form renderer's toast
// (`packages/components/src/renderers/form/form.tsx`), which imports `toast`
// via a RELATIVE path (`../../ui/sonner`) and therefore never resolves
// through the barrel specifier a caller OUTSIDE that package uses. Now that
// MasterDetailForm no longer raises its own toast, the renderer's is the
// single surviving raiser, and only the deep-module mock can see it — the
// same reason `MasterDetailForm.outcomeToastSupersede.test.tsx` (#7345)
// already mocks this exact path.
const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock('@object-ui/components/ui/sonner', async (orig) => {
  const actual = await (orig as any)();
  // Inherit the real toast surface and override only what this file asserts:
  // a hand-listed double freezes sonner's methods at whatever was typed that
  // day, and the next one the form calls (`dismiss`, objectui#7345) resolves
  // to undefined — the `check:vi-mock-inherit` defect, one level down.
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: toastError } };
});

registerAllFields();

// Parent object with a single non-required text field so a jsdom submit can
// actually validate + succeed (no Radix selects in the test surface).
const parentSchema = { name: 'po', fields: { ref: { type: 'text', label: 'Ref' } } };

function makeDataSource(overrides: any = {}) {
  return {
    getObjectSchema: vi.fn().mockResolvedValue(parentSchema),
    find: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    bulk: vi.fn(),
    ...overrides,
  } as any;
}

describe('MasterDetailForm — submit feedback (never silent)', () => {
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  it('atomic path: built-in toast (no host onSuccess) + clears the form on create', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const ds = makeDataSource({ batchTransaction });

    const { container } = render(
      <MasterDetailForm
        schema={{
          objectName: 'po',
          mode: 'create',
          fields: ['ref'],
          details: [
            { childObject: 'po_line', relationshipField: 'po', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] },
          ],
        } as any}
        dataSource={ds}
      />,
    );

    const input = await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'PO-1' } });

    // Drive the bottom action bar's Create button.
    const createBtn = screen.getByRole('button', { name: /create/i });
    fireEvent.click(createBtn);

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    // No host onSuccess → the built-in toast is the fallback so the save is never silent.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // Parent form remounted (cleared) for the next entry.
    await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      expect(el && el.value).toBeFalsy();
    });
  });

  it('defers confirmation to a host onSuccess (no built-in toast → no double-confirm)', async () => {
    // When the host owns feedback (e.g. the console toasts a localized message
    // via its crud-success handler), MasterDetailForm must NOT also toast — the
    // same contract flat ObjectForm follows. Regression guard for the double
    // "Created" + "线索创建成功" toast on record create.
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }] });
    const onSuccess = vi.fn();
    const ds = makeDataSource({ batchTransaction });

    const { container } = render(
      <MasterDetailForm
        schema={{
          objectName: 'po',
          mode: 'create',
          fields: ['ref'],
          onSuccess,
          details: [
            { childObject: 'po_line', relationshipField: 'po', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] },
          ],
        } as any}
        dataSource={ds}
      />,
    );

    const input = await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'PO-1' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    // Host owns confirmation — no built-in toast fires.
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('shows an error toast when the atomic write fails (rollback)', async () => {
    const batchTransaction = vi.fn().mockRejectedValue(new Error('BATCH_ERROR: rolled back'));
    const ds = makeDataSource({ batchTransaction });

    const { container } = render(
      <MasterDetailForm
        schema={{
          objectName: 'po',
          mode: 'create',
          fields: ['ref'],
          details: [
            { childObject: 'po_line', relationshipField: 'po', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] },
          ],
        } as any}
        dataSource={ds}
      />,
    );

    const input = await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'PO-2' } });
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(batchTransaction).toHaveBeenCalled());
    await waitFor(() => expect(toastError).toHaveBeenCalled()); // <- failure is surfaced
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('MasterDetailForm — non-atomic fallback (emulation via runBatchTransaction)', () => {
  // A DataSource WITHOUT a batchTransaction method: runBatchTransaction falls
  // back to emulateBatchTransaction, which drives create/update/delete in order
  // and compensates on failure. This is the "adapter has no server atomicity"
  // path — the form code is identical, only the adapter differs.
  beforeEach(() => {
    toastSuccess.mockClear();
    toastError.mockClear();
  });

  const detailSchema = {
    objectName: 'po',
    mode: 'create',
    fields: ['ref'],
    details: [
      { childObject: 'po_line', relationshipField: 'po', columns: [{ name: 'qty', label: 'Qty', type: 'number' }] },
    ],
  } as any;

  async function fillHeaderAndLine(container: HTMLElement) {
    const input = await waitFor(() => {
      const el = container.querySelector('input[name="ref"]') as HTMLInputElement | null;
      if (!el) throw new Error('parent form not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'PO-1' } });
    // Fill the first (ghost) line so it persists as a real child row.
    const qty = await waitFor(() => screen.getAllByLabelText('Qty')[0] as HTMLInputElement);
    fireEvent.change(qty, { target: { value: '5' } });
  }

  it('create: emulation creates the parent then the child with $ref resolved to the parent id', async () => {
    const create = vi.fn(async (object: string, data: any) => ({
      id: object === 'po' ? 'po1' : 'line1',
      ...data,
    }));
    const ds = makeDataSource({ create }); // NO batchTransaction

    const { container } = render(<MasterDetailForm schema={detailSchema} dataSource={ds} />);
    await fillHeaderAndLine(container);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    await waitFor(() => expect(create).toHaveBeenCalledWith('po', expect.objectContaining({ ref: 'PO-1' })));
    // The child's { $ref: 0 } was resolved to the parent's minted id ('po1').
    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('po_line', expect.objectContaining({ po: 'po1' })),
    );
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });

  it('create: a failing child create compensates by deleting the just-created parent + error toast', async () => {
    const create = vi.fn(async (object: string, data: any) => {
      if (object === 'po_line') throw new Error('child create failed');
      return { id: 'po1', ...data };
    });
    const del = vi.fn(async () => true);
    const ds = makeDataSource({ create, delete: del }); // NO batchTransaction

    const { container } = render(<MasterDetailForm schema={detailSchema} dataSource={ds} />);
    await fillHeaderAndLine(container);
    fireEvent.click(screen.getByRole('button', { name: /create/i }));

    // Best-effort compensation removes the orphan parent that was created before
    // the child failed — the non-atomic path's stand-in for a rollback.
    await waitFor(() => expect(del).toHaveBeenCalledWith('po', 'po1'));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});

describe('MasterDetailForm — parent-scoped line rules ("paid invoice → lock lines", #1581)', () => {
  // Parent header carries a `status` text field (a real <select> can't be driven
  // by synthetic events in jsdom — that path is covered by the live e2e spec).
  const invSchema = { name: 'inv', fields: { status: { type: 'text', label: 'Status' } } };

  function lockDataSource(overrides: any = {}) {
    return {
      getObjectSchema: vi.fn().mockResolvedValue(invSchema),
      find: vi.fn().mockResolvedValue({ data: [] }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      bulk: vi.fn(),
      ...overrides,
    } as any;
  }

  const schema = {
    objectName: 'inv',
    mode: 'create',
    fields: ['status'],
    details: [
      {
        childObject: 'inv_line',
        relationshipField: 'inv',
        columns: [
          { name: 'product', label: 'Product', type: 'text' },
          { name: 'qty', label: 'Qty', type: 'number', readonlyWhen: "parent.status == 'paid'" },
        ],
      },
    ],
  } as any;

  it('locks a line cell when the header makes its readonlyWhen TRUE, and unlocks on change', async () => {
    const { container } = render(<MasterDetailForm schema={schema} dataSource={lockDataSource()} />);

    const status = await waitFor(() => {
      const el = container.querySelector('input[name="status"]') as HTMLInputElement | null;
      if (!el) throw new Error('header not ready');
      return el;
    });
    const qty = () => screen.getAllByLabelText('Qty')[0] as HTMLInputElement;

    // Header not paid → the Qty cell is editable.
    await waitFor(() => expect(qty().disabled).toBe(false));

    // Header becomes paid → the Qty cell locks (parent.status == 'paid').
    fireEvent.change(status, { target: { value: 'paid' } });
    await waitFor(() => expect(qty().disabled).toBe(true));
    // A column without a rule stays editable regardless of the header.
    expect((screen.getAllByLabelText('Product')[0] as HTMLInputElement).disabled).toBe(false);

    // Header moves off paid → the cell unlocks again.
    fireEvent.change(status, { target: { value: 'draft' } });
    await waitFor(() => expect(qty().disabled).toBe(false));
  });

  it('does not reset the header form when a line locks (isolated re-render)', async () => {
    const { container } = render(<MasterDetailForm schema={schema} dataSource={lockDataSource()} />);

    const status = await waitFor(() => {
      const el = container.querySelector('input[name="status"]') as HTMLInputElement | null;
      if (!el) throw new Error('header not ready');
      return el;
    });

    fireEvent.change(status, { target: { value: 'paid' } });
    // The scrape-driven lock must NOT wipe the value the user just typed.
    await waitFor(() => expect((screen.getAllByLabelText('Qty')[0] as HTMLInputElement).disabled).toBe(true));
    expect((container.querySelector('input[name="status"]') as HTMLInputElement).value).toBe('paid');
  });
});

describe('MasterDetailForm — showSubmit gate (Studio screen preview)', () => {
  const base = {
    objectName: 'po',
    mode: 'create',
    fields: ['ref'],
    details: [
      { childObject: 'po_line', relationshipField: 'po', columns: [{ key: 'qty', label: 'Qty', type: 'number' } as any] },
    ],
  } as any;

  it('renders its own Save/Create action bar by default', async () => {
    render(<MasterDetailForm schema={base} dataSource={makeDataSource()} />);
    await waitFor(() => expect(screen.getByTestId('md-form-submit')).toBeInTheDocument());
  });

  it('hides the action bar when showSubmit is false (non-persisting preview)', async () => {
    const { container } = render(
      <MasterDetailForm schema={{ ...base, showSubmit: false }} dataSource={makeDataSource()} />,
    );
    // The form/grid still renders — it just can never be submitted.
    await waitFor(() => {
      if (!container.querySelector('input[name="ref"]')) throw new Error('header not ready');
    });
    expect(screen.queryByTestId('md-form-submit')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /create|save/i })).not.toBeInTheDocument();
  });

  it('uses the host-supplied cancelText string', async () => {
    // A host may pass an already-localized string down. A per-locale map is
    // resolved by the form itself: `MasterDetailForm.i18nLabels.test.tsx`.
    render(
      <MasterDetailForm
        schema={{ ...base, cancelText: '取消', onCancel: vi.fn() }}
        dataSource={makeDataSource()}
      />,
    );
    const cancelBtn = await waitFor(() => screen.getByTestId('md-form-cancel'));
    expect(cancelBtn).toHaveTextContent('取消');
  });
});
