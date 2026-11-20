import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import React from 'react';
import { registerAllFields } from '@object-ui/fields';
import { MePermissionsProvider } from '@object-ui/permissions';
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

  it('says the failure when the atomic write fails (rollback)', async () => {
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
    // The failure is surfaced, once, by the form's banner (objectstack-ai/objectstack#27520).
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
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

  it('create: a failing child create compensates by deleting the just-created parent + says the failure', async () => {
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
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
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

describe('MasterDetailForm — a new line starts on the child\'s defaults and waits to read red (objectstack#35940)', () => {
  const USER_ID = 'user-42';
  // `name` is required with no default; `note` is required with one;
  // `applicant` defaults to the acting user, which only a known session can seed.
  const lineSchema = {
    name: 'po_line',
    fields: {
      name: { type: 'text', label: 'Name', required: true },
      note: { type: 'text', label: 'Note', required: true, defaultValue: 'Pending' },
      applicant: { type: 'user', label: 'Applicant', defaultValue: 'current_user' },
      po: { type: 'master_detail', label: 'PO', reference: 'po' },
    },
  };
  const ME_PERMISSIONS = {
    authenticated: true,
    userId: USER_ID,
    tenantId: 't1',
    roles: ['user'],
    permissionSets: [],
    objects: { '*': { allowCreate: true, allowRead: true, allowEdit: true, allowDelete: true } },
    fields: {},
  };
  const columns = [
    { name: 'name', label: 'Name', type: 'text', required: true },
    { name: 'note', label: 'Note', type: 'text', required: true },
  ];
  const lineDataSource = (overrides: any = {}) =>
    makeDataSource({
      getObjectSchema: vi.fn(async (name: string) => (name === 'po_line' ? lineSchema : parentSchema)),
      ...overrides,
    });
  const schemaWith = (detail: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    ({
      objectName: 'po',
      mode: 'create',
      fields: ['ref'],
      details: [{ childObject: 'po_line', relationshipField: 'po', columns, ...detail }],
      ...extra,
    }) as any;
  const cell = (container: HTMLElement, row: number, col: number) =>
    container.querySelector(`[data-cell="${row}-${col}"]`) as HTMLInputElement | null;
  /** Add a line once the child schema (and so its defaults) has answered. */
  const addSeededLine = async (container: HTMLElement) => {
    await waitFor(() => expect(cell(container, 0, 1)?.value).toBe('Pending')); // the entry line
    fireEvent.click(screen.getByTestId('line-items-add'));
    await waitFor(() => expect(container.querySelectorAll('[data-testid="line-items"] tbody tr').length).toBe(2));
  };
  const createOps = (batch: ReturnType<typeof vi.fn>) =>
    (batch.mock.calls[0][0] as Array<{ object: string; action: string; data?: Record<string, unknown> }>).filter(
      (op) => op.object === 'po_line' && op.action === 'create',
    );

  it('an added line shows the defaults and no red cell; once a save is tried its empty required cell reads red', async () => {
    const batchTransaction = vi.fn().mockRejectedValue(new Error('Name is required'));
    const { container } = render(<MasterDetailForm schema={schemaWith()} dataSource={lineDataSource({ batchTransaction })} />);
    await addSeededLine(container);
    expect(cell(container, 0, 1)!.value).toBe('Pending');
    // An edit to another cell: the line is the user's input, its Name still empty.
    fireEvent.change(cell(container, 0, 1)!, { target: { value: 'Later' } });
    expect(container.querySelector('[data-testid^="line-items-invalid-"]')).toBeNull();

    fireEvent.click(screen.getByTestId('md-form-submit'));
    await waitFor(() => expect(screen.getByTestId('line-items-invalid-0-name')).toBeInTheDocument());
    // The cell with a default is filled, so it is never flagged.
    expect(screen.queryByTestId('line-items-invalid-0-note')).toBeNull();
  });

  it('CONTROL: a stored line\'s empty required cell is flagged at once, as before', async () => {
    const ds = lineDataSource({
      find: vi.fn().mockResolvedValue({ data: [{ id: 'l1', po: 'p1', name: null, note: 'x' }] }),
      findOne: vi.fn().mockResolvedValue({ id: 'p1', ref: 'PO-1' }),
    });
    render(<MasterDetailForm schema={schemaWith({}, { mode: 'edit', recordId: 'p1' })} dataSource={ds} />);
    await waitFor(() => expect(screen.getByTestId('line-items-invalid-0-name')).toBeInTheDocument());
  });

  it('the line is written with its defaults, the acting user included (the context a create form seeds with)', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }, { id: 'l1' }] });
    const { container } = render(
      <MePermissionsProvider initialPermissions={ME_PERMISSIONS as any}>
        <MasterDetailForm schema={schemaWith()} dataSource={lineDataSource({ batchTransaction })} />
      </MePermissionsProvider>,
    );
    await addSeededLine(container);
    fireEvent.change(cell(container, 0, 0)!, { target: { value: 'Bolts' } });
    fireEvent.click(screen.getByTestId('md-form-submit'));
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    expect(createOps(batchTransaction)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ name: 'Bolts', note: 'Pending', applicant: USER_ID }) }),
    ]);
  });

  it('form mode: Add opens the row editor on the defaults', async () => {
    const ds = lineDataSource();
    render(<MasterDetailForm schema={schemaWith({ inlineMode: 'form', formFields: ['name', 'note'] })} dataSource={ds} />);
    // The defaults come from the child schema: let its read answer first.
    await waitFor(() => expect(ds.getObjectSchema).toHaveBeenCalledWith('po_line'));
    await act(async () => {});
    fireEvent.click(screen.getByTestId('line-items-add'));
    const editor = await waitFor(() => screen.getByTestId('md-row-form'));
    await waitFor(() =>
      expect((editor.querySelector('input[name="note"]') as HTMLInputElement | null)?.value).toBe('Pending'),
    );
  });

  it('a line Add started and the row editor then applied is input, and is written', async () => {
    const batchTransaction = vi.fn().mockResolvedValue({ results: [{ id: 'po1' }, { id: 'l1' }] });
    const { container } = render(
      <MasterDetailForm
        schema={schemaWith({ formFields: ['name', 'note', 'applicant'] })}
        dataSource={lineDataSource({ batchTransaction })}
      />,
    );
    await addSeededLine(container);
    fireEvent.click(screen.getByTestId('line-items-expand-0'));
    const editor = await waitFor(() => screen.getByTestId('md-row-form'));
    const name = await waitFor(() => {
      const el = editor.querySelector('input[name="name"]') as HTMLInputElement | null;
      if (!el) throw new Error('row editor not ready');
      return el;
    });
    // Typed in the editor, not in the grid: only Apply carries it to the line,
    // and a line still marked untouched would be skipped whatever it holds.
    fireEvent.change(name, { target: { value: 'Washers' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.queryByTestId('md-row-form')).toBeNull());
    fireEvent.click(screen.getByTestId('md-form-submit'));
    await waitFor(() => expect(batchTransaction).toHaveBeenCalledTimes(1));
    expect(createOps(batchTransaction)).toEqual([
      expect.objectContaining({ data: expect.objectContaining({ name: 'Washers', note: 'Pending' }) }),
    ]);
  });
});
