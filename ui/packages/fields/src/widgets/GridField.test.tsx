import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { UploadProvider } from './UploadProvider';
import { Dialog, DialogContent, DialogTitle } from '@object-ui/components';
import { formatDate, formatDateTime } from '@object-ui/core';
import { GridField, LineItemsField, sumColumn, lookupAutofillPatch, UNTOUCHED_NEW_ROW, isUntouchedNewRow, columnHelpByField } from './GridField';

const columns = [
  { name: 'description', label: 'Description', type: 'text' as const },
  { name: 'amount', label: 'Amount', type: 'currency' as const },
];

const field = { columns, totalField: 'amount' } as any;

describe('GridField / LineItemsField — editable line items', () => {
  it('is exported under both names', () => {
    expect(LineItemsField).toBe(GridField);
  });

  it('renders a column header per config and an empty hint', () => {
    render(<GridField value={[]} onChange={() => {}} field={field} />);
    expect(screen.getByText('Description')).toBeTruthy();
    expect(screen.getByText('Amount')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add line/i })).toBeTruthy();
  });

  it('Add line appends a blank row keyed by columns', () => {
    const onChange = vi.fn();
    render(<GridField value={[]} onChange={onChange} field={field} />);
    fireEvent.click(screen.getByRole('button', { name: /Add line/i }));
    expect(onChange).toHaveBeenCalledWith([{ description: null, amount: null }]);
  });

  describe('column chooser (defaultHidden columns)', () => {
    const withHidden = {
      columns: [
        { name: 'title', label: 'Title', type: 'text' as const, required: true },
        { name: 'amount', label: 'Amount', type: 'currency' as const },
        { name: 'notes', label: 'Notes', type: 'text' as const, defaultHidden: true },
      ],
    } as any;

    it('hides defaultHidden columns by default but keeps required/visible ones', () => {
      render(<GridField value={[]} onChange={() => {}} field={withHidden} />);
      expect(screen.getByText('Title')).toBeTruthy();
      expect(screen.getByText('Amount')).toBeTruthy();
      expect(screen.queryByText('Notes')).toBeNull(); // collapsed into the chooser
      expect(screen.getByTestId('line-items-columns')).toBeTruthy();
    });

    it('reveals an optional column when toggled in the chooser', () => {
      render(<GridField value={[]} onChange={() => {}} field={withHidden} />);
      fireEvent.click(screen.getByTestId('line-items-columns'));
      fireEvent.click(screen.getByLabelText('Notes'));
      expect(screen.getAllByText('Notes').length).toBeGreaterThan(0);
    });

    it('shows no chooser when there are no optional columns', () => {
      render(<GridField value={[]} onChange={() => {}} field={field} />);
      expect(screen.queryByTestId('line-items-columns')).toBeNull();
    });
  });

  describe('list mode (displayMode="list" — form-factor for fat children)', () => {
    const listField = {
      columns: [
        { name: 'title', label: 'Title', type: 'text' as const, required: true },
        { name: 'status', label: 'Status', type: 'select' as const, options: [{ label: 'To Do', value: 'todo' }] },
      ],
    } as any;

    it('renders rows read-only (no cell inputs) and an Add button', () => {
      const onAdd = vi.fn();
      render(
        <GridField
          value={[{ title: 'Ship it', status: 'todo' }]}
          onChange={() => {}}
          field={listField}
          displayMode="list"
          onRowExpand={() => {}}
          onAdd={onAdd}
        />,
      );
      // Read-only display: the status renders its option label, not a combobox.
      expect(screen.getByText('To Do')).toBeTruthy();
      expect(screen.queryByLabelText('Title')).toBeNull(); // no editable input
      expect(screen.getByRole('button', { name: /Open row/i })).toBeTruthy(); // per-row edit
    });

    it('Add calls onAdd (host opens the full form) instead of inserting a blank row', () => {
      const onAdd = vi.fn();
      const onChange = vi.fn();
      render(
        <GridField value={[]} onChange={onChange} field={listField} displayMode="list" onRowExpand={() => {}} onAdd={onAdd} />,
      );
      fireEvent.click(screen.getByTestId('line-items-add'));
      expect(onAdd).toHaveBeenCalledTimes(1);
      expect(onChange).not.toHaveBeenCalled(); // did NOT insert a blank inline row
    });
  });

  it('editing a text cell emits the raw string', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ description: '', amount: null }]} onChange={onChange} field={field} />);
    // [0] = the data row.
    fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'Taxi' } });
    expect(onChange).toHaveBeenCalledWith([{ description: 'Taxi', amount: null }]);
  });

  it('editing a currency cell coerces to a number', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ description: 'Taxi', amount: null }]} onChange={onChange} field={field} />);
    fireEvent.change(screen.getAllByLabelText('Amount')[0], { target: { value: '42.5' } });
    expect(onChange).toHaveBeenCalledWith([{ description: 'Taxi', amount: 42.5 }]);
  });

  /**
   * objectui#3566 — the sub-grid face of #3127. `<input type="date">` accepts
   * exactly `YYYY-MM-DD` and rejects every other shape SILENTLY: the attribute
   * still lands in the DOM, so the value looks present in the markup, while
   * `.value` reads back `''` and the cell paints its empty placeholder. Since
   * the API hands back `2026-06-17T00:00:00.000Z` for a `date` field, every
   * date cell in an inline child grid rendered blank on a row that has a value.
   * Asserting `.value` (never `getAttribute('value')`) is the only way to see
   * this bug at all.
   */
  describe('date columns echo the stored value (#3566)', () => {
    const dateField = {
      columns: [
        { name: 'description', label: 'Description', type: 'text' as const },
        { name: 'incurred_on', label: 'Incurred On', type: 'date' as const },
      ],
    } as any;

    // Both spellings the API may hand back for a `date` field. The bare form
    // must survive VERBATIM — re-parsing it as UTC midnight and reading local
    // calendar components back out would move it to the 16th anywhere west of
    // Greenwich, which is the off-by-one this fix must not introduce.
    it.each(['2026-06-17', '2026-06-17T00:00:00.000Z'])(
      'shows the stored calendar day for %s instead of an empty cell',
      (stored) => {
        render(
          <GridField value={[{ description: 'Taxi', incurred_on: stored }]} onChange={() => {}} field={dateField} />,
        );
        const cell = screen.getAllByLabelText('Incurred On')[0] as HTMLInputElement;
        expect(cell.type).toBe('date');
        expect(cell.value).toBe('2026-06-17');
      },
    );

    it('leaves an empty date cell empty', () => {
      render(<GridField value={[{ description: 'Taxi', incurred_on: null }]} onChange={() => {}} field={dateField} />);
      expect((screen.getAllByLabelText('Incurred On')[0] as HTMLInputElement).value).toBe('');
    });

    it('writes back the control\'s own YYYY-MM-DD, unchanged by the read fix', () => {
      // No paired conversion on the write side: `onChange` hands over exactly
      // what `<input type="date">` produces, matching DateField's contract. A
      // conversion here would put read and write on different bases.
      const onChange = vi.fn();
      render(
        <GridField
          value={[{ description: 'Taxi', incurred_on: '2026-06-17T00:00:00.000Z' }]}
          onChange={onChange}
          field={dateField}
        />,
      );
      fireEvent.change(screen.getAllByLabelText('Incurred On')[0], { target: { value: '2026-06-18' } });
      expect(onChange).toHaveBeenCalledWith([{ description: 'Taxi', incurred_on: '2026-06-18' }]);
    });
  });

  /**
   * objectui#3569 — the type collapse behind #3566's symptom. `datetime` and
   * `time` used to be mapped onto the ONE `date` column type, so a datetime
   * cell rendered `<input type="date">`. That is not merely an under-render:
   * the control emits a bare `YYYY-MM-DD`, so a user who only re-picked the
   * DAY silently wrote the record's time component out of existence. The
   * falsifiable claim of these tests is therefore the TIME COMPONENT, not the
   * control's markup.
   *
   * Local-wall-clock expectations are computed here from `Date` rather than
   * hard-coded, so the suite asserts the same thing in every timezone (and the
   * day-shift arithmetic is done in LOCAL parts, so it is DST-safe too).
   */
  describe('datetime / time columns get their own control (#3569)', () => {
    const pad2 = (n: number) => String(n).padStart(2, '0');
    /** The local wall clock an `<input type="datetime-local">` must show for `iso`. */
    const localInputValue = (iso: string | Date) => {
      const d = iso instanceof Date ? iso : new Date(iso);
      return (
        `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` +
        `T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
      );
    };

    const temporalField = {
      columns: [
        { name: 'merchant', label: 'Merchant', type: 'text' as const },
        { name: 'incurred_on', label: 'Incurred On', type: 'date' as const },
        { name: 'incurred_at', label: 'Incurred At', type: 'datetime' as const },
        { name: 'started_at', label: 'Started At', type: 'time' as const },
      ],
    } as any;

    const STORED_ISO = '2026-06-17T14:30:00.000Z';

    it('renders a datetime column as datetime-local, echoing the stored instant', () => {
      render(
        <GridField
          value={[{ merchant: 'Chipotle', incurred_at: STORED_ISO }]}
          onChange={() => {}}
          field={temporalField}
        />,
      );
      const cell = screen.getAllByLabelText('Incurred At')[0] as HTMLInputElement;
      expect(cell.type).toBe('datetime-local');
      expect(cell.value).toBe(localInputValue(STORED_ISO));
    });

    it('does NOT collapse the datetime column onto the date control', () => {
      render(
        <GridField
          value={[{ merchant: 'Chipotle', incurred_on: '2026-06-17', incurred_at: STORED_ISO }]}
          onChange={() => {}}
          field={temporalField}
        />,
      );
      // The sibling `date` column keeps its own control — the two are distinct
      // now, which is exactly what was lost before.
      expect((screen.getAllByLabelText('Incurred On')[0] as HTMLInputElement).type).toBe('date');
      expect((screen.getAllByLabelText('Incurred At')[0] as HTMLInputElement).type).toBe('datetime-local');
    });

    /** THE regression: editing only the day must not destroy the time. */
    it('keeps the time component when only the day is edited', () => {
      const onChange = vi.fn();
      render(
        <GridField
          value={[{ merchant: 'Chipotle', incurred_at: STORED_ISO }]}
          onChange={onChange}
          field={temporalField}
        />,
      );
      const cell = screen.getAllByLabelText('Incurred At')[0] as HTMLInputElement;

      // What a user does to correct a date: move the day forward one, leave
      // the wall clock alone.
      const before = new Date(STORED_ISO);
      const nextDay = new Date(before);
      nextDay.setDate(nextDay.getDate() + 1);
      fireEvent.change(cell, { target: { value: localInputValue(nextDay) } });

      const emitted = onChange.mock.calls[0][0][0].incurred_at;
      const after = new Date(emitted);
      expect(after.getHours()).toBe(before.getHours());
      expect(after.getMinutes()).toBe(before.getMinutes());
      // Round-tripped as ISO-8601 (`fromDateTimeInputValue`), NOT the control's
      // naive zone-less string — read and write share one basis.
      expect(emitted).toBe(nextDay.toISOString());
    });

    it('leaves an empty datetime cell empty', () => {
      render(
        <GridField value={[{ merchant: 'Chipotle', incurred_at: null }]} onChange={() => {}} field={temporalField} />,
      );
      expect((screen.getAllByLabelText('Incurred At')[0] as HTMLInputElement).value).toBe('');
    });

    it('renders a time column as a time control and round-trips HH:mm verbatim', () => {
      const onChange = vi.fn();
      render(
        <GridField
          value={[{ merchant: 'Chipotle', started_at: '14:30' }]}
          onChange={onChange}
          field={temporalField}
        />,
      );
      const cell = screen.getAllByLabelText('Started At')[0] as HTMLInputElement;
      expect(cell.type).toBe('time');
      expect(cell.value).toBe('14:30');
      // A `time` value is a zone-less wall clock — stored exactly as typed, the
      // same contract `TimeField` follows. No conversion in either direction.
      fireEvent.change(cell, { target: { value: '09:15' } });
      expect(onChange).toHaveBeenCalledWith([{ merchant: 'Chipotle', started_at: '09:15' }]);
    });

    /**
     * The read-only faces the issue calls out: `displayText()` and the
     * read-only table both fell through to `String(value)`, printing the raw
     * `2026-06-17T00:00:00.000Z` on screen. Neither could be fixed before the
     * collapse was undone — with one column type the renderer had no way to
     * know whether to show a day or a day plus a time.
     */
    describe('read-only display formats each temporal type as itself', () => {
      const row = { merchant: 'Chipotle', incurred_on: '2026-06-17T00:00:00.000Z', incurred_at: STORED_ISO, started_at: '14:30' };
      // Spelled `'en'` rather than a bare `toLocale*` call (objectui#4468): the
      // bare call reads the MACHINE's locale, so these pins agreed with the
      // widget only by the accident of a CI runner set to en-US — and they
      // would have kept agreeing with it after the widget started following the
      // session locale, which is the bug this suite has to be able to see.
      // `'en'` is what `useDisplayLocale()` resolves to with no provider.
      //
      // Both faces are asked of the SHARED functions rather than spelled out,
      // the `date-locale-channel.test.tsx` idiom: which face each register
      // renders is pinned by `fields-date-widget-convention-8194.test.tsx` and
      // `datetime-widget-faces-8209.test.tsx`, while this block's own claim is
      // that the three temporal types render as three DIFFERENT things.
      const expectedDay = formatDate(new Date(2026, 5, 17), undefined, { locale: 'en' });
      const dt = new Date(STORED_ISO);
      // objectui#8209 — the sub-grid `datetime` cell took `'compact'`, the face
      // of its register. Before it, this column composed a bare
      // `toLocaleDateString` + `toLocaleTimeString` pair.
      const expectedInstant = formatDateTime(dt, { style: 'compact', locale: 'en' });

      /**
       * FIXTURE VALIDITY. ⚠️ The `date` expectation used to be `Intl`'s bare
       * numeric default (`6/17/2026`), which the `datetime` cell beside it
       * CONTAINS — so `toContain(expectedDay)` was satisfied by the wrong
       * column and would have stayed green with the `date` column rendering
       * anything at all. That is only visible once the two faces are named, so
       * it is asserted here rather than left to the next reader.
       */
      it('the three temporal faces are three distinct strings', () => {
        expect(expectedInstant).not.toContain(expectedDay);
        expect(expectedDay).not.toBe('14:30');
        expect(expectedInstant).not.toBe('14:30');
      });

      it('formats date / datetime / time in the read-only table', () => {
        render(<GridField value={[row]} onChange={() => {}} field={temporalField} readonly />);
        const table = screen.getByTestId('line-items-readonly');
        expect(table.textContent).toContain(expectedDay);
        expect(table.textContent).toContain(expectedInstant);
        expect(table.textContent).toContain('14:30');
        // The raw stored ISO must never reach the screen.
        expect(table.textContent).not.toContain('2026-06-17T00:00:00.000Z');
        expect(table.textContent).not.toContain(STORED_ISO);
      });

      it('formats them the same way in list display mode', () => {
        const { container } = render(
          <GridField value={[row]} onChange={() => {}} field={temporalField} displayMode="list" onRowExpand={() => {}} />,
        );
        expect(container.textContent).toContain(expectedDay);
        expect(container.textContent).toContain(expectedInstant);
        expect(container.textContent).not.toContain(STORED_ISO);
      });

      it('shows a value it cannot parse rather than "Invalid Date"', () => {
        render(
          <GridField value={[{ merchant: 'X', incurred_at: 'not-a-date' }]} onChange={() => {}} field={temporalField} readonly />,
        );
        expect(screen.getByTestId('line-items-readonly').textContent).toContain('not-a-date');
      });

      // The `zh` half of this — the sub-grid following the SESSION locale
      // (objectui#4468) — lives in `__tests__/date-locale-channel.test.tsx`,
      // grouped with the rest of the locale cases.
      //
      // It used to be a HAZARD rather than a preference: mounting an
      // `I18nProvider` anywhere in this file left react-i18next's global on
      // that provider's instance, so the file-columns chip test ~200 lines
      // down read a Chinese `aria-label` and went red. objectui#4514 fixed
      // that in the harness — `installI18nGlobalReset()` in
      // `vitest.setup.base.ts` restores the global after every test, and
      // `packages/i18n/src/__tests__/global-instance-reset.test.tsx` fails if
      // it stops. A provider is safe to mount here now.
    });
  });

  // objectstack#35507 — the always-present trailing entry line is gone (see
  // the top-level `no trailing entry row beside Add` pins). It is drawn only
  // for an empty grid the form refused (objectui#3318), and there typing
  // into it still materialises the line.
  describe('the entry line of an empty grid the form refused', () => {
    it('is drawn only once the form reports the failure', () => {
      const { rerender } = render(<GridField value={[]} onChange={() => {}} field={field} />);
      expect(screen.queryAllByLabelText('Description')).toHaveLength(0);
      rerender(<GridField value={[]} onChange={() => {}} field={field} error="Lines is required" />);
      expect(screen.getAllByLabelText('Description')).toHaveLength(1);
    });

    it('typing into it materialises a new line', () => {
      const onChange = vi.fn();
      render(<GridField value={[]} onChange={onChange} field={field} error="Lines is required" />);
      fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'B' } });
      expect(onChange).toHaveBeenCalledWith([{ description: 'B', amount: null }]);
    });
  });

  describe('computed columns (amount = qty × unit_price)', () => {
    const computedField = {
      columns: [
        { name: 'product', label: 'Product', type: 'text' as const },
        { name: 'quantity', label: 'Qty', type: 'number' as const },
        { name: 'unit_price', label: 'Unit Price', type: 'currency' as const },
        // No `scale`: `@objectstack/spec` 17.5.0 refuses it on a column that
        // declares `type: 'currency'`, and the grid does not read it there
        // (objectui#10783). The currency's minor unit decides.
        { name: 'amount', label: 'Amount', type: 'currency' as const, computed: true, expr: 'record.quantity * record.unit_price' },
      ],
      totalField: 'amount',
    } as any;

    it('renders a computed column read-only (no input) and recomputes on edit', () => {
      const onChange = vi.fn();
      render(<GridField value={[{ product: 'Widget', quantity: 3, unit_price: 10, amount: 30 }]} onChange={onChange} field={computedField} />);
      // Amount is display-only — there is no editable Amount cell.
      expect(screen.queryByLabelText('Amount')).toBeNull();
      // Editing quantity recomputes amount in the emitted row.
      fireEvent.change(screen.getAllByLabelText('Qty')[0], { target: { value: '4' } });
      expect(onChange).toHaveBeenCalledWith([{ product: 'Widget', quantity: 4, unit_price: 10, amount: 40 }]);
    });

    it('shows a dash for a computed cell whose inputs are blank', () => {
      render(<GridField value={[{ product: 'Widget', quantity: null, unit_price: null, amount: null }]} onChange={() => {}} field={computedField} />);
      // The computed amount cell reads "—" until its inputs exist.
      expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    });
  });

  describe('keyboard navigation', () => {
    it('Enter moves focus to the same column in the next row', () => {
      render(<GridField value={[{ description: 'A', amount: 1 }, { description: 'B', amount: 2 }]} onChange={() => {}} field={field} />);
      const row0 = screen.getAllByLabelText('Description')[0];
      row0.focus();
      fireEvent.keyDown(row0, { key: 'Enter' });
      expect(document.activeElement).toBe(screen.getAllByLabelText('Description')[1]);
    });
  });

  it('removing a row emits the array without it', () => {
    const onChange = vi.fn();
    render(
      <GridField
        value={[{ description: 'A', amount: 1 }, { description: 'B', amount: 2 }]}
        onChange={onChange}
        field={field}
      />,
    );
    const removeButtons = screen.getAllByLabelText('Remove row');
    fireEvent.click(removeButtons[0]);
    expect(onChange).toHaveBeenCalledWith([{ description: 'B', amount: 2 }]);
  });

  it('row action buttons are always visible in grid mode (not hover-revealed)', () => {
    render(
      <GridField
        value={[{ description: 'A', amount: 1 }]}
        onChange={() => {}}
        field={field}
      />,
    );
    // Grid-mode rows previously gated these behind opacity-0/group-hover, so they
    // were invisible until hover and unreachable on touch — they must always show.
    expect(screen.getByLabelText('Remove row').className).not.toContain('opacity-0');
    expect(screen.getByTestId('line-items-duplicate-0').className).not.toContain('opacity-0');
  });

  it('readonly mode shows values and a summed total footer', () => {
    render(
      <GridField
        value={[{ description: 'A', amount: 10 }, { description: 'B', amount: 20 }]}
        onChange={() => {}}
        field={field}
        readonly
      />,
    );
    expect(screen.getByTestId('line-items-readonly')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
  });

  describe('lookupAutofillPatch (item typeahead auto-fill)', () => {
    const cols = [
      { name: 'product', type: 'lookup' as const, reference: 'product' },
      { name: 'description', type: 'text' as const },
      { name: 'quantity', type: 'number' as const },
      { name: 'unit_price', type: 'currency' as const },
      { name: 'amount', type: 'currency' as const, computed: true, expr: 'record.quantity * record.unit_price' },
    ];
    const product = { value: 'p1', label: 'Widget A', name: 'Widget A', description: 'Standard widget', unit_price: 29.99, sku: 'WIDGET-A' };

    it('sets the FK id and copies same-named sibling fields from the record', () => {
      const patch = lookupAutofillPatch(cols, cols[0], product);
      expect(patch).toEqual({ product: 'p1', description: 'Standard widget', unit_price: 29.99 });
      // quantity (not on the record) and computed amount are left to the row/compute.
      expect(patch).not.toHaveProperty('quantity');
      expect(patch).not.toHaveProperty('amount');
    });

    it('copies only the FK id when autofill is disabled', () => {
      const patch = lookupAutofillPatch(cols, { ...cols[0], autofill: false }, product);
      expect(patch).toEqual({ product: 'p1' });
    });
  });

  describe('P1 affordances (duplicate / validation)', () => {
    it('duplicates a row (id stripped) directly below the original', () => {
      const onChange = vi.fn();
      render(<GridField value={[{ id: 'r1', description: 'A', amount: 5 }]} onChange={onChange} field={field} />);
      fireEvent.click(screen.getByTestId('line-items-duplicate-0'));
      expect(onChange).toHaveBeenCalledWith([
        { id: 'r1', description: 'A', amount: 5 },
        { description: 'A', amount: 5 }, // copy without the id → persists as a new record
      ]);
    });

    it('flags a required, empty cell on a real row', () => {
      const reqField = { columns: [{ name: 'description', label: 'Description', type: 'text' as const, required: true }] } as any;
      render(<GridField value={[{ description: '' }]} onChange={() => {}} field={reqField} />);
      // The data row's required-empty cell is flagged...
      expect(screen.getByTestId('line-items-invalid-0-description')).toBeTruthy();
      // ...and no line below it is drawn to flag (objectstack#35507).
      expect(screen.queryByTestId('line-items-invalid-1-description')).toBeNull();
    });
  });

  describe('file columns (upload in a grid cell — #2360)', () => {
    const fileField = {
      columns: [
        { name: 'description', label: 'Description', type: 'text' as const },
        { name: 'receipt', label: 'Receipt', type: 'file' as const },
      ],
    } as any;

    it('renders a real upload control in the cell, not a text input', () => {
      render(<GridField value={[{ description: 'Taxi', receipt: null }]} onChange={() => {}} field={fileField} />);
      // One upload button per row, backed by a native file input.
      expect(screen.getAllByRole('button', { name: 'Receipt' }).length).toBeGreaterThan(0);
      expect(document.querySelector('input[type="file"]')).toBeTruthy();
      expect(screen.queryByRole('textbox', { name: 'Receipt' })).toBeNull();
    });

    it('uploads a picked file and writes the sys_file id into the row', async () => {
      const onChange = vi.fn();
      // The adapter mints a `sys_file` id, as the ObjectStack flow does. An
      // adapter that surfaces none is refused by the shared pipeline — pinned
      // in `fileSubmitRequiresId-7699.test.tsx`, not re-derived here.
      const adapter = {
        name: 'test',
        upload: async (f: File) => ({
          url: '/api/v1/storage/files/file_receipt',
          name: f.name,
          size: f.size,
          mimeType: f.type,
          meta: { fileId: 'file_receipt' },
        }),
      };
      render(
        <UploadProvider adapter={adapter as any}>
          <GridField value={[{ description: 'Taxi', receipt: null }]} onChange={onChange} field={fileField} />
        </UploadProvider>,
      );
      const file = new File(['x'], 'receipt.png', { type: 'image/png' });
      const input = document.querySelectorAll('input[type="file"]')[0] as HTMLInputElement;
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      // The reference form — never the inline blob (objectui#7699).
      expect(onChange).toHaveBeenCalledWith([{ description: 'Taxi', receipt: 'file_receipt' }]);
    });

    it('shows an uploaded file as a removable chip', () => {
      const onChange = vi.fn();
      render(
        <GridField
          value={[{ description: 'Taxi', receipt: { name: 'receipt.png', mime_type: 'image/png' } }]}
          onChange={onChange}
          field={fileField}
        />,
      );
      expect(screen.getByText('receipt.png')).toBeTruthy();
      fireEvent.click(screen.getByLabelText('Remove receipt.png'));
      expect(onChange).toHaveBeenCalledWith([{ description: 'Taxi', receipt: null }]);
    });

    it('announces a required, empty file cell on the focusable picker control (#5431)', () => {
      const reqFileField = {
        columns: [{ name: 'receipt', label: 'Receipt', type: 'file' as const, required: true }],
      } as any;
      render(<GridField value={[{ receipt: null }]} onChange={() => {}} field={reqFileField} />);
      // The VISUAL ring + testid predate #5431 and are not the assertion —
      // the announced state is. The carrier must be the focusable picker
      // button inside the cell, never the td wrapper (#3318 / #5223).
      const cell = screen.getByTestId('line-items-invalid-0-receipt');
      const carrier = cell.querySelector('[aria-invalid="true"]');
      expect(carrier).toBeTruthy();
      expect(carrier!.tagName).toBe('BUTTON');
      expect(cell.getAttribute('aria-invalid')).toBeNull();
    });

    it('does not announce invalid on an optional empty file cell', () => {
      const optFileField = {
        columns: [{ name: 'receipt', label: 'Receipt', type: 'file' as const }],
      } as any;
      const { container } = render(
        <GridField value={[{ receipt: null }]} onChange={() => {}} field={optFileField} />,
      );
      // The data row renders a picker; it may not announce invalid.
      expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    });

    it('stops announcing once the required file cell holds a file', () => {
      const reqFileField = {
        columns: [{ name: 'receipt', label: 'Receipt', type: 'file' as const, required: true }],
      } as any;
      const { container } = render(
        <GridField
          value={[{ receipt: { name: 'receipt.png', mime_type: 'image/png' } }]}
          onChange={() => {}}
          field={reqFileField}
        />,
      );
      expect(screen.queryByTestId('line-items-invalid-0-receipt')).toBeNull();
      expect(container.querySelector('[aria-invalid="true"]')).toBeNull();
    });

    it('passes the column accept list to the native picker', () => {
      const withAccept = {
        columns: [{ name: 'receipt', label: 'Receipt', type: 'file' as const, accept: ['image/*', '.pdf'] }],
      } as any;
      render(<GridField value={[{ receipt: null }]} onChange={() => {}} field={withAccept} />);
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      expect(input.getAttribute('accept')).toBe('image/*,.pdf');
    });

    it('renders the file name read-only in readonly mode', () => {
      render(
        <GridField
          value={[{ description: 'Taxi', receipt: { name: 'receipt.png' } }]}
          onChange={() => {}}
          field={fileField}
          readonly
        />,
      );
      expect(screen.getByText('receipt.png')).toBeTruthy();
      expect(document.querySelector('input[type="file"]')).toBeNull();
    });
  });

  it('sumColumn ignores blanks and NaN', () => {
    expect(sumColumn([{ amount: 1 }, { amount: 2 }, { amount: null }], 'amount')).toBe(3);
  });

  describe('parent-scoped conditional rules (B2 follow-up — "paid invoice → lock lines")', () => {
    const lockField = {
      columns: [
        { name: 'product', label: 'Product', type: 'text' as const },
        { name: 'qty', label: 'Qty', type: 'number' as const, readonlyWhen: "parent.status == 'paid'" },
        { name: 'unit_price', label: 'Unit Price', type: 'currency' as const, readonlyWhen: "parent.status == 'paid'" },
      ],
    } as any;

    it('leaves cells editable when the parent rule is FALSE', () => {
      render(
        <GridField
          value={[{ product: 'Widget', qty: 2, unit_price: 10 }]}
          onChange={() => {}}
          field={lockField}
          contextRecord={{ status: 'draft' }}
        />,
      );
      expect((screen.getAllByLabelText('Qty')[0] as HTMLInputElement).disabled).toBe(false);
      expect((screen.getAllByLabelText('Unit Price')[0] as HTMLInputElement).disabled).toBe(false);
    });

    it('locks cells whose readonlyWhen references the parent header', () => {
      render(
        <GridField
          value={[{ product: 'Widget', qty: 2, unit_price: 10 }]}
          onChange={() => {}}
          field={lockField}
          contextRecord={{ status: 'paid' }}
        />,
      );
      // The header is paid → quantity / unit price lock; product (no rule) stays editable.
      expect((screen.getAllByLabelText('Qty')[0] as HTMLInputElement).disabled).toBe(true);
      expect((screen.getAllByLabelText('Unit Price')[0] as HTMLInputElement).disabled).toBe(true);
      expect((screen.getAllByLabelText('Product')[0] as HTMLInputElement).disabled).toBe(false);
    });

    it('re-evaluates per row, mixing the parent header with row data', () => {
      const rowRule = {
        columns: [
          { name: 'qty', label: 'Qty', type: 'number' as const },
          // Locks only when the header is paid AND this row is already invoiced.
          { name: 'note', label: 'Note', type: 'text' as const, readonlyWhen: "parent.status == 'paid' && record.invoiced == true" },
        ],
      } as any;
      render(
        <GridField
          value={[{ qty: 1, note: 'a', invoiced: true }, { qty: 2, note: 'b', invoiced: false }]}
          onChange={() => {}}
          field={rowRule}
          contextRecord={{ status: 'paid' }}
        />,
      );
      const notes = screen.getAllByLabelText('Note') as HTMLInputElement[];
      expect(notes[0].disabled).toBe(true);  // invoiced row → locked
      expect(notes[1].disabled).toBe(false); // not-yet-invoiced row → editable
    });
  });
});

describe('GridField — a boolean column read as a boolean by the cell rules (objectstack#34972)', () => {
  // The shape `@object-ui/plugin-form` derives for a `boolean` child field: a
  // select column whose two options store the strings 'true' / 'false'.
  const won = {
    name: 'won',
    label: 'Won',
    type: 'select' as const,
    options: [
      { label: 'Yes', value: 'true' },
      { label: 'No', value: 'false' },
    ],
  };
  const requiredField = {
    columns: [won, { name: 'delivery_date', label: 'Delivery', type: 'text' as const, requiredWhen: 'record.won == true' }],
  } as any;

  it("marks the dependent cell required when the select holds 'true', and not when it holds 'false'", () => {
    render(
      <GridField
        value={[{ won: 'true', delivery_date: '' }, { won: 'false', delivery_date: '' }]}
        onChange={() => {}}
        field={requiredField}
      />,
    );
    expect(screen.getByTestId('line-items-invalid-0-delivery_date')).toBeTruthy();
    expect(screen.queryByTestId('line-items-invalid-1-delivery_date')).toBeNull();
  });

  it('reads a stored boolean the same way, and leaves the row the select wrote unchanged', () => {
    const value = [{ won: true, delivery_date: '' }, { won: 'true', delivery_date: '' }];
    const onChange = vi.fn();
    render(<GridField value={value} onChange={onChange} field={requiredField} />);
    expect(screen.getByTestId('line-items-invalid-0-delivery_date')).toBeTruthy();
    expect(screen.getByTestId('line-items-invalid-1-delivery_date')).toBeTruthy();
    expect(value[1].won).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it("locks a readonlyWhen cell over the same reading: 'true' locks, 'false' does not", () => {
    const lockField = {
      columns: [won, { name: 'note', label: 'Note', type: 'text' as const, readonlyWhen: 'record.won == true' }],
    } as any;
    render(
      <GridField value={[{ won: 'true', note: 'a' }, { won: 'false', note: 'b' }]} onChange={() => {}} field={lockField} />,
    );
    const notes = screen.getAllByLabelText('Note') as HTMLInputElement[];
    expect(notes[0].disabled).toBe(true);
    expect(notes[1].disabled).toBe(false);
  });

  it('CONTROL: a non-boolean select column keeps its string value in the predicate', () => {
    const stageField = {
      columns: [
        {
          name: 'stage',
          label: 'Stage',
          type: 'select' as const,
          options: [
            { label: 'Open', value: 'open' },
            { label: 'Closed', value: 'closed' },
          ],
        },
        { name: 'reason', label: 'Reason', type: 'text' as const, requiredWhen: "record.stage == 'closed'" },
      ],
    } as any;
    render(
      <GridField
        value={[{ stage: 'closed', reason: '' }, { stage: 'open', reason: '' }]}
        onChange={() => {}}
        field={stageField}
      />,
    );
    expect(screen.getByTestId('line-items-invalid-0-reason')).toBeTruthy();
    expect(screen.queryByTestId('line-items-invalid-1-reason')).toBeNull();
  });
});

describe('GridField — a new line starts on its defaults and waits to read red (objectstack#35816)', () => {
  const taskColumns = {
    columns: [
      { name: 'name', label: 'Name', type: 'text' as const, required: true },
      { name: 'status', label: 'Status', type: 'text' as const, required: true },
    ],
  } as any;

  it('Add and the entry line both start a line on the host\'s values', () => {
    const onChange = vi.fn();
    // The entry line is drawn for an empty grid the form refused
    // (objectstack#35507), so the failure is handed in.
    const { container } = render(
      <GridField value={[]} onChange={onChange} field={taskColumns} newRowValues={{ status: 'pending' }} error="Tasks is required" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add line/i }));
    expect(onChange).toHaveBeenLastCalledWith([{ name: null, status: 'pending', [UNTOUCHED_NEW_ROW]: true }]);
    const entryName = container.querySelector('[data-cell="0-0"]') as HTMLInputElement;
    fireEvent.change(entryName, { target: { value: 'Book the room' } });
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'Book the room', status: 'pending' }]);
  });

  it('a line Add started is marked untouched until its first edit, even an edit back to its default', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <GridField value={[]} onChange={onChange} field={taskColumns} newRowValues={{ status: 'pending' }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Add line/i }));
    const added = onChange.mock.lastCall![0] as Record<string, unknown>[];
    expect(isUntouchedNewRow(added[0])).toBe(true);
    // The mark is a symbol key: no write payload or key walk sees it.
    expect(Object.keys(added[0])).toEqual(['name', 'status']);
    expect(JSON.stringify(added[0])).toBe('{"name":null,"status":"pending"}');
    rerender(<GridField value={added} onChange={onChange} field={taskColumns} newRowValues={{ status: 'pending' }} />);
    const status = screen.getAllByDisplayValue('pending')[0] as HTMLInputElement;
    fireEvent.change(status, { target: { value: 'done' } });
    rerender(<GridField value={onChange.mock.lastCall![0]} onChange={onChange} field={taskColumns} newRowValues={{ status: 'pending' }} />);
    fireEvent.change(screen.getAllByDisplayValue('done')[0], { target: { value: 'pending' } });
    const edited = onChange.mock.lastCall![0] as Record<string, unknown>[];
    expect(edited[0]).toMatchObject({ status: 'pending' });
    expect(isUntouchedNewRow(edited[0])).toBe(false);
  });

  it('CONTROL: with no `newRowValues` an added line carries no mark, as before', () => {
    const onChange = vi.fn();
    render(<GridField value={[]} onChange={onChange} field={taskColumns} />);
    fireEvent.click(screen.getByRole('button', { name: /Add line/i }));
    expect(isUntouchedNewRow(onChange.mock.lastCall![0][0])).toBe(false);
  });

  it('a new line\'s empty required cell is not flagged until the host says so; a stored line is', () => {
    const rows = [{ id: 't1', name: null, status: 'open' }, { name: null, status: 'pending' }];
    const { rerender } = render(
      <GridField value={rows} onChange={() => {}} field={taskColumns} newRowRequiredShown={false} />,
    );
    expect(screen.getByTestId('line-items-invalid-0-name')).toBeTruthy();
    expect(screen.queryByTestId('line-items-invalid-1-name')).toBeNull();
    rerender(<GridField value={rows} onChange={() => {}} field={taskColumns} newRowRequiredShown />);
    expect(screen.getByTestId('line-items-invalid-1-name').getAttribute('title')).toBe('Name is required');
  });

  it('CONTROL: without the host\'s word a new line is flagged at once, as before', () => {
    render(<GridField value={[{ name: null, status: 'pending' }]} onChange={() => {}} field={taskColumns} />);
    expect(screen.getByTestId('line-items-invalid-0-name')).toBeTruthy();
  });
});

describe('GridField — a line Add started on its defaults and nobody edited never reads red (objectstack#35940)', () => {
  const taskColumns = {
    columns: [
      { name: 'name', label: 'Name', type: 'text' as const, required: true },
      { name: 'status', label: 'Status', type: 'text' as const, required: true },
    ],
  } as any;

  it('stays unflagged after the host says a save was refused, while an edited new line is flagged', () => {
    const rows = [
      { name: null, status: 'pending', [UNTOUCHED_NEW_ROW]: true },
      { name: null, status: 'done' },
    ];
    render(<GridField value={rows} onChange={() => {}} field={taskColumns} newRowValues={{ status: 'pending' }} newRowRequiredShown />);
    expect(screen.queryByTestId('line-items-invalid-0-name')).toBeNull();
    expect(screen.getByTestId('line-items-invalid-1-name')).toBeTruthy();
  });

  it('a line Enter appends on the last line starts on the defaults and is marked untouched, as Add\'s is', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ name: 'A', status: 'done' }]} onChange={onChange} field={taskColumns} newRowValues={{ status: 'pending' }} />);
    fireEvent.keyDown(screen.getByDisplayValue('done'), { key: 'Enter' });
    const appended = onChange.mock.lastCall![0][1];
    expect(appended).toMatchObject({ status: 'pending' });
    expect(isUntouchedNewRow(appended)).toBe(true);
  });

  it('its first edit makes it input, and from then on it is flagged like any new line', () => {
    const onChange = vi.fn();
    const field = { columns: [...taskColumns.columns, { name: 'note', label: 'Note', type: 'text' as const }] } as any;
    const rows = [{ name: null, status: 'pending', note: null, [UNTOUCHED_NEW_ROW]: true }];
    const { rerender } = render(
      <GridField value={rows} onChange={onChange} field={field} newRowValues={{ status: 'pending' }} newRowRequiredShown />,
    );
    fireEvent.change(screen.getAllByDisplayValue('pending')[0], { target: { value: 'done' } });
    rerender(<GridField value={onChange.mock.lastCall![0]} onChange={onChange} field={field} newRowValues={{ status: 'pending' }} newRowRequiredShown />);
    expect(screen.getByTestId('line-items-invalid-0-name')).toBeTruthy();
  });
});

/**
 * objectstack#35507 — no blank entry row beside "Add line". The grid used to
 * append an always-present empty "ghost" line under the data rows; it carried
 * no actions, produced no write, and sat directly above the Add button that
 * does the same job, so users read it as a broken line they could not delete.
 * It was drawn only when Add was drawn (both follow `allowAdd`), so dropping it
 * leaves no grid without a way to add a line. The keyboard path it carried
 * (Tab or Enter into an empty line and type) is kept by Add moving focus into
 * the new line and by Enter on the last line appending one.
 */
describe('no trailing entry row beside Add (objectstack#35507)', () => {
  function Stateful({ initial, f = field }: { initial: Record<string, unknown>[]; f?: any }) {
    const [rows, setRows] = React.useState(initial);
    return <GridField value={rows} onChange={setRows} field={f} />;
  }

  it('a grid with lines draws exactly its lines, and the Add button', () => {
    render(<GridField value={[{ description: 'A', amount: 1 }]} onChange={() => {}} field={field} />);
    expect(screen.getAllByLabelText('Description')).toHaveLength(1);
    expect(screen.getByTestId('line-items-add')).toBeTruthy();
  });

  it('an empty grid draws no entry row, and names the Add button in its empty state', () => {
    render(<GridField value={[]} onChange={() => {}} field={field} />);
    expect(screen.queryAllByLabelText('Description')).toHaveLength(0);
    expect(screen.getByText('No items yet — click “Add line” to begin.')).toBeTruthy();
  });

  it('CONTROL: with `allowAdd: false` there is neither an Add button nor an entry row, as before', () => {
    render(<GridField value={[{ description: 'A', amount: 1 }]} onChange={() => {}} field={{ ...field, allowAdd: false }} />);
    expect(screen.queryByTestId('line-items-add')).toBeNull();
    expect(screen.getAllByLabelText('Description')).toHaveLength(1);
  });

  it('CONTROL: an edit emits exactly the lines, with no blank line appended, as before', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ description: 'A', amount: 1 }]} onChange={onChange} field={field} />);
    // `[0]`: the data line's cell, whatever else the grid draws below it.
    fireEvent.change(screen.getAllByLabelText('Description')[0], { target: { value: 'B' } });
    expect(onChange).toHaveBeenLastCalledWith([{ description: 'B', amount: 1 }]);
  });

  it('Add moves focus into the new line, so the keyboard keeps typing', async () => {
    render(<Stateful initial={[{ description: 'A', amount: 1 }]} />);
    fireEvent.click(screen.getByTestId('line-items-add'));
    await waitFor(() => expect(screen.getAllByLabelText('Description')).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByLabelText('Description')[1]));
  });

  it('Enter in the last line appends a line and moves to the same column in it', async () => {
    render(<Stateful initial={[{ description: 'A', amount: 1 }]} />);
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Enter' });
    await waitFor(() => expect(screen.getAllByLabelText('Amount')).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toBe(screen.getAllByLabelText('Amount')[1]));
  });

  it('CONTROL: Enter in the last line appends nothing when adding is off', () => {
    const onChange = vi.fn();
    render(<GridField value={[{ description: 'A', amount: 1 }]} onChange={onChange} field={{ ...field, allowAdd: false }} />);
    fireEvent.keyDown(screen.getByLabelText('Amount'), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * objectstack#35804 — each column header shows its field's help. A grid column
 * carries no field definition, so the host that holds the child object's
 * served definition (the one the record form reads, with other packages'
 * `fieldPatches` applied and the help in the reader's language) hands the
 * texts over through `columnHelpByField`, which reads each field through the
 * form's own `fieldHelpText`.
 */
describe('column header help (objectstack#35804)', () => {
  const help = { amount: 'Enter the tax-inclusive amount.' };

  it('a column with help draws an info button whose accessible name is the help', () => {
    render(<GridField value={[]} onChange={() => {}} field={field} columnHelp={help} />);
    const button = screen.getByRole('button', { name: 'Enter the tax-inclusive amount.' });
    expect(button.closest('th')!.textContent).toContain('Amount');
  });

  it('focusing the info button shows the help', async () => {
    render(<GridField value={[]} onChange={() => {}} field={field} columnHelp={help} />);
    fireEvent.focus(screen.getByRole('button', { name: 'Enter the tax-inclusive amount.' }));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Enter the tax-inclusive amount.');
  });

  it('the read-only table draws the same help', () => {
    render(<GridField value={[{ description: 'A', amount: 1 }]} onChange={() => {}} field={field} readonly columnHelp={help} />);
    expect(screen.getByRole('button', { name: 'Enter the tax-inclusive amount.' })).toBeTruthy();
  });

  it('CONTROL: a column without help draws no info button', () => {
    render(<GridField value={[]} onChange={() => {}} field={field} columnHelp={help} />);
    const descriptionHeader = screen.getByText('Description').closest('th')!;
    expect(descriptionHeader.querySelector('button')).toBeNull();
  });

  it('columnHelpByField reads each field the way the record form does', () => {
    expect(
      columnHelpByField({
        unit_price: { inlineHelpText: 'Inline help wins.', description: 'Not this.' },
        quantity: { description: 'The served description.' },
        notes: { inlineHelpText: '' },
        bad: null,
      }),
    ).toEqual({ unit_price: 'Inline help wins.', quantity: 'The served description.' });
    expect(columnHelpByField(undefined)).toEqual({});
  });
});

describe('cell faces that open under the cell (objectstack#36023)', () => {
  const STATUS = [
    { label: 'To Do', value: 'todo' },
    { label: 'Done', value: 'done' },
    { label: 'Doing', value: 'doing' },
  ];
  const cols = {
    columns: [
      { name: 'description', label: 'Description', type: 'text' as const },
      { name: 'status', label: 'Status', type: 'select' as const, options: STATUS },
      { name: 'due_on', label: 'Due On', type: 'date' as const },
      { name: 'at', label: 'At', type: 'datetime' as const },
      { name: 'qty', label: 'Qty', type: 'number' as const },
    ],
  } as any;

  function Stateful({ initial, onChange }: { initial: any[]; onChange?: (v: any[]) => void }) {
    const [rows, setRows] = React.useState(initial);
    return (
      <GridField
        value={rows}
        onChange={(v: any[]) => {
          setRows(v);
          onChange?.(v);
        }}
        field={cols}
      />
    );
  }

  describe('a select cell', () => {
    it('shows the option label, and a click opens a searchable list under it; a pick writes and closes', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', status: 'todo' }]} onChange={onChange} />);
      const cell = screen.getByRole('combobox', { name: 'Status' });
      expect(cell.textContent).toBe('To Do');
      fireEvent.click(cell);
      const panel = await screen.findByTestId('line-items-select-panel');
      // The cell keeps its value while the list is open.
      expect(cell.textContent).toBe('To Do');
      const search = panel.querySelector('input') as HTMLInputElement;
      await waitFor(() => expect(document.activeElement).toBe(search));
      fireEvent.change(search, { target: { value: 'do' } });
      expect(Array.from(panel.querySelectorAll('[role="option"]')).map((o) => o.textContent)).toEqual(['To Do', 'Done', 'Doing']);
      fireEvent.change(search, { target: { value: 'don' } });
      fireEvent.click(screen.getByRole('option', { name: 'Done' }));
      expect(onChange.mock.calls.at(-1)![0][0].status).toBe('done');
      await waitFor(() => expect(screen.queryByTestId('line-items-select-panel')).toBeNull());
      expect(screen.getByRole('combobox', { name: 'Status' }).textContent).toBe('Done');
    });

    it('a typed letter opens the list with that letter as its search; Enter picks the first match', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', status: 'todo' }]} onChange={onChange} />);
      const cell = screen.getByRole('combobox', { name: 'Status' });
      cell.focus();
      fireEvent.keyDown(cell, { key: 'g' });
      const panel = await screen.findByTestId('line-items-select-panel');
      const search = panel.querySelector('input') as HTMLInputElement;
      expect(search.value).toBe('g');
      expect(Array.from(panel.querySelectorAll('[role="option"]')).map((o) => o.textContent)).toEqual(['Doing']);
      fireEvent.keyDown(search, { key: 'Enter' });
      expect(onChange.mock.calls.at(-1)![0][0].status).toBe('doing');
    });

    it('Esc in the list closes it and writes nothing', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', status: 'todo' }]} onChange={onChange} />);
      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const panel = await screen.findByTestId('line-items-select-panel');
      fireEvent.keyDown(panel.querySelector('input')!, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('line-items-select-panel')).toBeNull());
      expect(onChange).not.toHaveBeenCalled();
    });

    it('Tab in the list closes it and moves on to the next cell', async () => {
      render(<Stateful initial={[{ description: 'A', status: 'todo' }]} />);
      fireEvent.click(screen.getByRole('combobox', { name: 'Status' }));
      const panel = await screen.findByTestId('line-items-select-panel');
      fireEvent.keyDown(panel.querySelector('input')!, { key: 'Tab' });
      await waitFor(() => expect(screen.queryByTestId('line-items-select-panel')).toBeNull());
      expect(document.activeElement).toBe(screen.getAllByLabelText('Due On')[0]);
    });

    it('the arrows still move between lines from a select cell', () => {
      render(<Stateful initial={[{ status: 'todo' }, { status: 'done' }]} />);
      const [first, second] = screen.getAllByRole('combobox', { name: 'Status' });
      first.focus();
      fireEvent.keyDown(first, { key: 'ArrowDown' });
      expect(document.activeElement).toBe(second);
      expect(screen.queryByTestId('line-items-select-panel')).toBeNull();
    });
  });

  describe('a date cell', () => {
    it('stays the native control, typed into as before, and opens its calendar under the cell on arrival', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', due_on: '2026-06-17' }]} onChange={onChange} />);
      const input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
      expect(input.type).toBe('date');
      fireEvent.focus(input);
      expect(await screen.findByTestId('line-items-date-panel')).toBeTruthy();
      // The caret stays in the cell: keyboard entry is unchanged.
      fireEvent.change(input, { target: { value: '2026-06-20' } });
      expect(onChange.mock.calls.at(-1)![0][0].due_on).toBe('2026-06-20');
    });

    it('a calendar day writes the value and closes the calendar; the cell keeps the focus', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', due_on: '2026-06-17' }]} onChange={onChange} />);
      const input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
      input.focus();
      const panel = await screen.findByTestId('line-items-date-panel');
      const day = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent === '24')!;
      fireEvent.click(day);
      expect(onChange.mock.calls.at(-1)![0][0].due_on).toBe('2026-06-24');
      await waitFor(() => expect(screen.queryByTestId('line-items-date-panel')).toBeNull());
      expect(document.activeElement).toBe(screen.getAllByLabelText('Due On')[0]);
    });

    it('Clear empties the cell; Today writes today', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', due_on: '2026-06-17' }]} onChange={onChange} />);
      let input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
      input.focus();
      fireEvent.click(await screen.findByTestId('line-items-date-clear'));
      expect(onChange.mock.calls.at(-1)![0][0].due_on).toBe('');
      input = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
      fireEvent.click(input);
      const panel = await screen.findByTestId('line-items-date-panel');
      fireEvent.click(Array.from(panel.querySelectorAll('button')).find((b) => b.textContent === 'Today')!);
      const d = new Date();
      const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      expect(onChange.mock.calls.at(-1)![0][0].due_on).toBe(today);
    });

    it('a date-time day keeps the time of day', async () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', at: '2026-06-17T09:45' }]} onChange={onChange} />);
      const input = screen.getAllByLabelText('At')[0] as HTMLInputElement;
      expect(input.type).toBe('datetime-local');
      input.focus();
      const panel = await screen.findByTestId('line-items-date-panel');
      fireEvent.click(Array.from(panel.querySelectorAll('button')).find((b) => b.textContent === '24')!);
      const stored = onChange.mock.calls.at(-1)![0][0].at as string;
      const back = new Date(stored);
      expect([back.getFullYear(), back.getMonth() + 1, back.getDate(), back.getHours(), back.getMinutes()]).toEqual([2026, 6, 24, 9, 45]);
    });

    it('leaving the cell closes the calendar, and Enter still moves down', async () => {
      render(<Stateful initial={[{ due_on: '2026-06-17' }, { due_on: '2026-06-18' }]} />);
      const [first, second] = screen.getAllByLabelText('Due On');
      first.focus();
      await screen.findByTestId('line-items-date-panel');
      fireEvent.keyDown(first, { key: 'Enter' });
      expect(document.activeElement).toBe(second);
    });
  });

  describe('Esc in a cell', () => {
    it('takes back what this visit to the cell typed, and only that line', () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: 'A', qty: 1 }, { description: 'B', qty: 2 }]} onChange={onChange} />);
      const input = screen.getAllByLabelText('Description')[0] as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: 'Abc' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      const last = onChange.mock.calls.at(-1)![0];
      expect(last[0]).toEqual({ description: 'A', qty: 1 });
      expect(last[1]).toEqual({ description: 'B', qty: 2 });
      expect((screen.getAllByLabelText('Description')[0] as HTMLInputElement).value).toBe('A');
    });

    it('keeps the untouched mark of a new line it takes back', () => {
      const onChange = vi.fn();
      render(<Stateful initial={[{ description: null, [UNTOUCHED_NEW_ROW]: true }]} onChange={onChange} />);
      const input = screen.getAllByLabelText('Description')[0] as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: 'x' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(isUntouchedNewRow(onChange.mock.calls.at(-1)![0][0])).toBe(true);
    });

    it('does not reach a dialog the form is open in: the dialog and every line stay', async () => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Lines</DialogTitle>
            <Stateful initial={[{ description: 'A', due_on: '2026-06-17' }]} />
          </DialogContent>
        </Dialog>,
      );
      const input = screen.getAllByLabelText('Description')[0] as HTMLInputElement;
      input.focus();
      fireEvent.change(input, { target: { value: 'Abc' } });
      fireEvent.keyDown(input, { key: 'Escape' });
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(onOpenChange).not.toHaveBeenCalled();
      expect((screen.getAllByLabelText('Description')[0] as HTMLInputElement).value).toBe('A');
      // A cell's open calendar takes the Esc itself: it closes, the dialog stays.
      const date = screen.getAllByLabelText('Due On')[0] as HTMLInputElement;
      date.focus();
      await screen.findByTestId('line-items-date-panel');
      fireEvent.keyDown(date, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByTestId('line-items-date-panel')).toBeNull());
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it('control: Esc outside the grid still reaches the dialog', () => {
      const onOpenChange = vi.fn();
      render(
        <Dialog open onOpenChange={onOpenChange}>
          <DialogContent>
            <DialogTitle>Lines</DialogTitle>
            <button type="button">outside</button>
            <Stateful initial={[{ description: 'A' }]} />
          </DialogContent>
        </Dialog>,
      );
      const outside = screen.getByRole('button', { name: 'outside' });
      outside.focus();
      fireEvent.keyDown(outside, { key: 'Escape' });
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});
