// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9248 — a flow screen field renders the three keys
 * objectstack#17306 gave it, spelled as the spec spells them: the numeric
 * bound `min` / `max`, the help text `inlineHelpText`, and the lookup target
 * `reference`. The ruling's condition is that the keys ship WITH their
 * rendering, so each gets a pin on the rendered body, and a field carrying
 * none of them is the control that renders as it did before.
 *
 * The submit-time refusal of an out-of-bound value is the runner's, pinned on
 * the dialog in `__tests__/FlowRunner.bounds-9248.test.tsx`; this file pins
 * the comparison it calls (`screenFieldBoundViolations`) against the engine's
 * resume rule.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
// Module scope, per AGENTS.md 测试纪律: the lookup arm reaches `LookupField`
// through a `React.lazy` factory inside `@object-ui/fields`; importing the
// barrel here resolves that factory before any test's `findBy` budget starts.
import '@object-ui/fields';
import { ScreenView, screenFieldBoundViolations, type ScreenSpec } from './ScreenView';

afterEach(cleanup);

function specOf(fields: ScreenSpec['fields']): ScreenSpec {
  return { nodeId: 'n1', title: 'Step', fields } as ScreenSpec;
}

function renderScreen(fields: ScreenSpec['fields'], extra: { values?: Record<string, unknown>; dataSource?: unknown } = {}) {
  return render(
    <ScreenView
      screen={specOf(fields)}
      values={extra.values ?? {}}
      onValueChange={() => {}}
      dataSource={extra.dataSource}
    />,
  );
}

describe('objectui#9248 — `min` / `max` land on the numeric input', () => {
  it('a number field declaring `min: 1, max: 10` carries both native bounds', () => {
    renderScreen([{ name: 'qty', label: 'Quantity', type: 'number', min: 1, max: 10 }]);
    const input = screen.getByRole('spinbutton', { name: 'Quantity' });
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '10');
  });

  it('a currency field is numeric too, and a lone bound is carried alone', () => {
    renderScreen([{ name: 'amount', label: 'Amount', type: 'currency', min: 0 }]);
    const input = screen.getByRole('spinbutton', { name: 'Amount' });
    expect(input).toHaveAttribute('min', '0');
    expect(input).not.toHaveAttribute('max');
  });

  it('a bound declared on a non-numeric input is not written onto it (a date input would read it as a date)', () => {
    const { container } = renderScreen([{ name: 'due', label: 'Due', type: 'date', min: 1, max: 10 }]);
    const input = container.querySelector('#ff-due');
    expect(input).toHaveAttribute('type', 'date');
    expect(input).not.toHaveAttribute('min');
    expect(input).not.toHaveAttribute('max');
  });
});

describe('objectui#9248 — `screenFieldBoundViolations` applies the engine resume rule', () => {
  const qty = { name: 'qty', label: 'Quantity', type: 'number', min: 1, max: 10 };

  it('refuses a value above `max` and below `min`, naming the field and the bound', () => {
    expect(screenFieldBoundViolations(specOf([qty]), { qty: 11 })).toEqual([
      { field: qty, bound: 'max', limit: 10 },
    ]);
    expect(screenFieldBoundViolations(specOf([qty]), { qty: 0 })).toEqual([
      { field: qty, bound: 'min', limit: 1 },
    ]);
  });

  it('the bounds are inclusive: the limits themselves pass', () => {
    expect(screenFieldBoundViolations(specOf([qty]), { qty: 10 })).toEqual([]);
    expect(screenFieldBoundViolations(specOf([qty]), { qty: 1 })).toEqual([]);
  });

  it('an empty optional field is not refused — absence is `required`\'s question', () => {
    expect(screenFieldBoundViolations(specOf([qty]), {})).toEqual([]);
    expect(screenFieldBoundViolations(specOf([qty]), { qty: undefined })).toEqual([]);
  });

  it('a field its `visibleWhen` hides is not compared; shown, it is', () => {
    const gated = { ...qty, visibleWhen: 'bulk == true' };
    const fields = [{ name: 'bulk', label: 'Bulk', type: 'boolean' }, gated];
    expect(screenFieldBoundViolations(specOf(fields), { bulk: false, qty: 99 })).toEqual([]);
    expect(screenFieldBoundViolations(specOf(fields), { bulk: true, qty: 99 })).toEqual([
      { field: gated, bound: 'max', limit: 10 },
    ]);
  });

  it('CONTROL — a field declaring no bound is never refused, whatever it holds', () => {
    expect(screenFieldBoundViolations(specOf([{ name: 'qty', type: 'number' }]), { qty: 1e9 })).toEqual([]);
  });
});

describe('objectui#9248 — `inlineHelpText` is drawn under the control and describes it', () => {
  it('renders below the input and is linked by `aria-describedby`', () => {
    renderScreen([{ name: 'note', label: 'Note', type: 'text', inlineHelpText: 'Shown below' }]);
    const input = screen.getByRole('textbox', { name: 'Note' });
    const help = screen.getByText('Shown below');

    expect(input).toHaveAttribute('aria-describedby', help.id);
    expect(help.id).not.toBe('');
    expect(input).toHaveAccessibleDescription('Shown below');
    // BELOW: the help element follows the control in document order.
    expect(input.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Not the placeholder — that carrier is gone the moment the user types.
    expect(input).not.toHaveAttribute('placeholder', 'Shown below');
  });

  it('stays on screen while the input holds a value', () => {
    renderScreen(
      [{ name: 'note', label: 'Note', type: 'text', placeholder: 'e.g. ACME', inlineHelpText: 'Shown below' }],
      { values: { note: 'typed' } },
    );
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('typed');
    expect(screen.getByText('Shown below')).toBeVisible();
  });

  it('describes every control arm, not only the text input', () => {
    renderScreen([
      { name: 'body', label: 'Body', type: 'textarea', inlineHelpText: 'Body help' },
      { name: 'agree', label: 'Agree', type: 'boolean', inlineHelpText: 'Agree help' },
      { name: 'kind', label: 'Kind', options: [{ label: 'A', value: 'a' }], inlineHelpText: 'Kind help' },
      { name: 'qty', label: 'Qty', type: 'number', inlineHelpText: 'Qty help' },
    ]);
    expect(screen.getByRole('textbox', { name: 'Body' })).toHaveAccessibleDescription('Body help');
    expect(screen.getByRole('checkbox', { name: 'Agree' })).toHaveAccessibleDescription('Agree help');
    expect(screen.getByRole('combobox', { name: 'Kind' })).toHaveAccessibleDescription('Kind help');
    expect(screen.getByRole('spinbutton', { name: 'Qty' })).toHaveAccessibleDescription('Qty help');
  });
});

const ACCOUNTS = [
  { id: 'acc-1', name: 'Northwind Traders' },
  { id: 'acc-2', name: 'Contoso Ltd' },
];

function makeDataSource() {
  const queries: string[] = [];
  return {
    queries,
    find: vi.fn(async (objectName: string) => {
      queries.push(objectName);
      return { data: ACCOUNTS, total: ACCOUNTS.length, hasMore: false, pageSize: 50 };
    }),
    findOne: vi.fn(async (_o: string, id: string) => ACCOUNTS.find((a) => a.id === id) ?? null),
    getObjectSchema: async (name: string) => ({ name, fields: { id: { type: 'text' }, name: { type: 'text' } } }),
  };
}

describe('objectui#9248 — a `type: \'lookup\'` field resolves its picker from `reference`', () => {
  it('the picker lists `account` records from the screen\'s data source', async () => {
    const ds = makeDataSource();
    // No `SchemaRendererProvider` here on purpose: the only way the picker can
    // reach this data source is the `dataSource` prop `ScreenView` threads.
    renderScreen([{ name: 'acct', label: 'Account', type: 'lookup', reference: 'account', required: true }], {
      dataSource: ds,
    });

    const trigger = await screen.findByTestId('lookup-trigger-acct');
    expect(trigger).toHaveAttribute('id', 'ff-acct');
    expect(trigger).toHaveAttribute('aria-required', 'true');
    fireEvent.click(trigger);

    await waitFor(() => expect(screen.getByText('Northwind Traders')).toBeInTheDocument());
    expect(screen.getByText('Contoso Ltd')).toBeInTheDocument();
    // Asserted on the object NAME, not a call count: a picker that queried the
    // wrong object would satisfy a bare count.
    expect(ds.queries).toContain('account');
    expect(ds.queries.every((q) => q === 'account')).toBe(true);
  });

  it('a lookup with no `reference` keeps the plain input it always had (a run suspended before the key)', () => {
    renderScreen([{ name: 'acct', label: 'Account', type: 'lookup' }]);
    expect(screen.getByRole('textbox', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByTestId('lookup-trigger-acct')).toBeNull();
  });
});

describe('objectui#9248 — CONTROL: a field declaring none of the keys renders as before', () => {
  it('no bound, no description, no help element, no picker', () => {
    const { container } = renderScreen([
      { name: 'qty', label: 'Qty', type: 'number' },
      { name: 'title', label: 'Title', type: 'text', placeholder: 'Type here' },
      { name: 'agree', label: 'Agree', type: 'boolean' },
      { name: 'acct', label: 'Account', type: 'text' },
    ]);
    const qty = screen.getByRole('spinbutton', { name: 'Qty' });
    expect(qty).not.toHaveAttribute('min');
    expect(qty).not.toHaveAttribute('max');
    for (const control of [
      qty,
      screen.getByRole('textbox', { name: 'Title' }),
      screen.getByRole('checkbox', { name: 'Agree' }),
      screen.getByRole('textbox', { name: 'Account' }),
    ]) {
      expect(control).not.toHaveAttribute('aria-describedby');
    }
    expect(container.querySelector('[id$="-help"]')).toBeNull();
    expect(container.querySelector('[data-testid^="lookup-trigger"]')).toBeNull();
    // Each field is still exactly a label and its control.
    for (const block of container.querySelectorAll('.space-y-1\\.5')) {
      expect(block.children).toHaveLength(2);
    }
  });
});
