// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

// The inspector loads the object list (published + drafts) for the lookup
// picker; stub both surfaces.
vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

// Lookup picker config reads the referenced object's fields; stub the catalog.
vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: (obj?: string) => ({
    fields: obj
      ? [
          { name: 'name', label: 'Name', type: 'text', hidden: false },
          { name: 'status', label: 'Status', type: 'select', hidden: false },
          { name: 'amount', label: 'Amount', type: 'currency', hidden: false },
          { name: 'billable', label: 'Billable', type: 'boolean', hidden: false },
        ]
      : [],
    loading: false,
    error: null,
  }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';
import { __setCelFormulaLoader } from '../celAuthoring';

afterEach(() => {
  cleanup();
  __setCelFormulaLoader(undefined);
});

function renderField(
  fields: Record<string, Record<string, unknown>>,
  selectedId: string,
  overrides: Record<string, unknown> = {},
) {
  const onPatch = vi.fn();
  const onSelectionChange = vi.fn();
  const utils = render(
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields }}
      selection={{ kind: 'field', id: selectedId }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={onSelectionChange}
      readOnly={false}
      locale={'en-US'}
      {...overrides}
    />,
  );
  return { onPatch, onSelectionChange, ...utils };
}

function controlFor(label: string): HTMLElement {
  const lab = screen.getByText(label);
  return lab.parentElement!.querySelector('input, textarea, select, [role="combobox"]') as HTMLElement;
}

describe('ObjectFieldInspector — duplicate field', () => {
  it('clones the field below itself with a unique name and selects it', () => {
    const { onPatch, onSelectionChange } = renderField(
      { email: { type: 'email', label: 'Email' } },
      'email',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate field' }));
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toEqual(['email', 'email_copy']);
    expect(patch.fields.email_copy).toMatchObject({ type: 'email', label: 'Email copy' });
    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'field', id: 'email_copy' }),
    );
  });

  it('avoids name collisions when a copy already exists', () => {
    const { onPatch } = renderField(
      { email: { type: 'email' }, email_copy: { type: 'email' } },
      'email',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate field' }));
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toContain('email_copy_2');
  });
});

describe('ObjectFieldInspector — label derives API name until customised', () => {
  // One `change` event — the paste/autofill shape. This case was already
  // green while typing the same label key by key stopped at its first
  // character; the per-keystroke cases live in
  // ObjectFieldInspector.apiNameSync.test.tsx (objectui#7615).
  it('syncs field_<N> (the nextFieldName() auto-name) to the label in one input event', () => {
    const { onPatch, onSelectionChange } = renderField(
      { field_2: { type: 'text', label: '' } },
      'field_2',
    );
    fireEvent.change(controlFor('Label'), { target: { value: 'Status' } });
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toEqual(['status']);
    expect(patch.fields.status).toMatchObject({ label: 'Status' });
    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'field', id: 'status' }),
    );
  });

  it('stops deriving once the API name has been hand-edited', () => {
    // Simulate the real parent, which feeds each onPatch back into `draft` —
    // a single static-props render (like the other cases here) can't observe
    // this, since the second edit needs the FIRST edit's rename reflected in
    // `entry.name` before it decides whether the name is still auto-generated.
    function Stateful() {
      const [fields, setFields] = React.useState<Record<string, Record<string, unknown>>>({
        field_2: { type: 'text', label: '' },
      });
      return (
        <ObjectFieldInspector
          type="object"
          name="account"
          draft={{ name: 'account', fields }}
          selection={{ kind: 'field', id: Object.keys(fields)[0] }}
          onPatch={(patch: any) => setFields(patch.fields)}
          onClearSelection={() => {}}
          onSelectionChange={() => {}}
          readOnly={false}
          locale={'en-US'}
        />
      );
    }
    render(<Stateful />);
    fireEvent.change(controlFor('API name'), { target: { value: 'ticket_status' } });
    fireEvent.change(controlFor('Label'), { target: { value: 'Status' } });
    expect(controlFor('API name')).toHaveValue('ticket_status');
  });

  it('leaves an already-meaningful name untouched when the label changes', () => {
    const { onPatch } = renderField({ priority: { type: 'text', label: 'Priority' } }, 'priority');
    fireEvent.change(controlFor('Label'), { target: { value: 'Urgency' } });
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toEqual(['priority']);
    expect(patch.fields.priority.label).toBe('Urgency');
  });
});

describe('ObjectFieldInspector — default value', () => {
  it('commits a text default for a text field', () => {
    const { onPatch } = renderField({ note: { type: 'text', label: 'Note' } }, 'note');
    fireEvent.change(controlFor('Default value'), { target: { value: 'hello' } });
    expect(onPatch).toHaveBeenCalledWith(
      expect.objectContaining({ fields: expect.anything() }),
    );
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(patch.fields.note.defaultValue).toBe('hello');
  });

  it('offers a select (not a text box) default for a boolean field', () => {
    renderField({ active: { type: 'boolean', label: 'Active' } }, 'active');
    expect(screen.getByText('Default value')).toBeInTheDocument();
    // Boolean default uses a tri-state Select (— / True / False), so the
    // control is a combobox rather than a free-text input.
    const ctrl = controlFor('Default value');
    expect(ctrl.getAttribute('role')).toBe('combobox');
  });

  it('omits the default-value editor for computed fields', () => {
    renderField({ total: { type: 'formula', label: 'Total' } }, 'total');
    expect(screen.queryByText('Default value')).not.toBeInTheDocument();
  });

  it('omits the default-value editor for lookup fields', () => {
    renderField({ owner: { type: 'lookup', label: 'Owner' } }, 'owner');
    expect(screen.queryByText('Default value')).not.toBeInTheDocument();
  });
});

describe('ObjectFieldInspector — power props (conditional & validation)', () => {
  it('commits inline help text', () => {
    const { onPatch } = renderField({ note: { type: 'text', label: 'Note' } }, 'note');
    fireEvent.change(controlFor('Help text'), { target: { value: 'Enter the note' } });
    expect(onPatch.mock.calls.at(-1)![0].fields.note.inlineHelpText).toBe('Enter the note');
  });

  it('commits min length for text fields (alongside max length)', () => {
    const { onPatch } = renderField({ note: { type: 'text' } }, 'note');
    expect(screen.getByText('Min length')).toBeInTheDocument();
    expect(screen.getByText('Max length')).toBeInTheDocument();
    fireEvent.change(controlFor('Min length'), { target: { value: '3' } });
    expect(onPatch.mock.calls.at(-1)![0].fields.note.minLength).toBe(3);
  });

  it('commits a required-when CEL predicate (as requiredWhen)', () => {
    const { onPatch } = renderField({ note: { type: 'text' } }, 'note');
    fireEvent.change(controlFor('Required when'), { target: { value: 'record.x == 1' } });
    const field = onPatch.mock.calls.at(-1)![0].fields.note;
    expect(field.requiredWhen).toBe('record.x == 1');
    expect(field.conditionalRequired).toBeUndefined();
  });

  it('offers the conditional rules for non-text types too', () => {
    renderField({ active: { type: 'boolean' } }, 'active');
    expect(screen.getByText('Conditional rules (CEL)')).toBeInTheDocument();
    expect(screen.getByText('Visible when')).toBeInTheDocument();
    expect(screen.getByText('Read-only when')).toBeInTheDocument();
    expect(screen.getByText('Required when')).toBeInTheDocument();
    // Min length is text-only, so it should not show for a boolean.
    expect(screen.queryByText('Min length')).not.toBeInTheDocument();
  });
});

describe('ObjectFieldInspector — conditional rules (CEL editors, #1582)', () => {
  // Deterministic fake engine — the editors' live lint/autocomplete against the
  // REAL engine is covered by CelPredicateField.test.tsx; here we test the
  // inspector's wiring (read/write shapes, legacy migration).
  const stubEngine = () =>
    __setCelFormulaLoader(() =>
      Promise.resolve({
        validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
        introspectScope: () => ({
          fields: ['note', 'status'],
          roots: ['record', 'previous', 'parent'],
          functions: ['has'],
        }),
      }),
    );

  it('commits a visibleWhen predicate as the bare-string shorthand', () => {
    stubEngine();
    const { onPatch } = renderField({ note: { type: 'text' } }, 'note');
    fireEvent.change(controlFor('Visible when'), { target: { value: "record.status != 'draft'" } });
    const field = onPatch.mock.calls.at(-1)![0].fields.note;
    expect(field.visibleWhen).toBe("record.status != 'draft'");
  });

  it('reads an Expression envelope and preserves its extra keys on write', () => {
    stubEngine();
    const envelope = { dialect: 'cel', source: 'record.a == 1', meta: { rationale: 'AI draft' } };
    const { onPatch } = renderField({ note: { type: 'text', readonlyWhen: envelope } }, 'note');
    expect(controlFor('Read-only when')).toHaveValue('record.a == 1');
    fireEvent.change(controlFor('Read-only when'), { target: { value: 'record.a == 2' } });
    expect(onPatch.mock.calls.at(-1)![0].fields.note.readonlyWhen).toEqual({
      dialect: 'cel',
      source: 'record.a == 2',
      meta: { rationale: 'AI draft' },
    });
  });

  it('clears a rule when the editor is emptied', () => {
    stubEngine();
    const { onPatch } = renderField(
      { note: { type: 'text', visibleWhen: 'record.a == 1' } },
      'note',
    );
    fireEvent.change(controlFor('Visible when'), { target: { value: '' } });
    expect(onPatch.mock.calls.at(-1)![0].fields.note.visibleWhen).toBeUndefined();
  });

  // The retired `conditionalRequired` alias (@objectstack/spec 17, #3855) is no
  // longer read into the editor: it is not a required-predicate slot, and a
  // draft carrying it is rejected by the spec parse with the rename
  // prescription (see clientValidation.fieldRules.test.ts).
  it('does not read the retired conditionalRequired alias into Required when', () => {
    stubEngine();
    renderField({ note: { type: 'text', conditionalRequired: 'record.x == 1' } }, 'note');
    expect(controlFor('Required when')).toHaveValue('');
  });
});

describe('ObjectFieldInspector — read-only', () => {
  it('hides the duplicate action when read-only', () => {
    renderField({ email: { type: 'email' } }, 'email', { readOnly: true });
    expect(screen.queryByRole('button', { name: 'Duplicate field' })).not.toBeInTheDocument();
  });

  it('disables the power-prop inputs when read-only', () => {
    renderField({ note: { type: 'text' } }, 'note', { readOnly: true });
    expect(controlFor('Help text')).toBeDisabled();
    expect(controlFor('Required when')).toBeDisabled();
  });
});

describe('ObjectFieldInspector — lookup picker config', () => {
  const lookupFields = {
    account: { type: 'lookup', label: 'Account', reference: 'crm_account' },
    name: { type: 'text' },
  };

  it('surfaces displayField / selectable-records / depends-on for a lookup field', () => {
    renderField(lookupFields, 'account');
    expect(screen.getByText('Picker config')).toBeInTheDocument();
    expect(screen.getByText('Display field')).toBeInTheDocument();
    expect(screen.getByText('Description field')).toBeInTheDocument();
    expect(screen.getByText('Selectable records')).toBeInTheDocument();
    expect(screen.getByText(/Depends on/)).toBeInTheDocument();
    expect(screen.getByText('Allow quick-create')).toBeInTheDocument();
  });

  it('does NOT render picker config for a non-lookup field', () => {
    renderField({ amount: { type: 'number' } }, 'amount');
    expect(screen.queryByText('Picker config')).not.toBeInTheDocument();
  });

  it('adds a structured lookupFilters row via onPatch', () => {
    const { onPatch } = renderField(lookupFields, 'account');
    fireEvent.click(screen.getByText('Add filter'));
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(patch.fields.account.lookupFilters).toEqual([{ field: '', operator: 'eq', value: '' }]);
  });

  it('reads an existing structured filter and renders its row', () => {
    renderField(
      { account: { type: 'lookup', reference: 'crm_account', lookupFilters: [{ field: 'status', operator: 'eq', value: 'active' }] } },
      'account',
    );
    expect(screen.getByText('Filter 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('active')).toBeInTheDocument();
  });
});

describe('ObjectFieldInspector — API name derives from label while auto-named', () => {
  it('derives from a generic field_N auto name (Data pillar "+ Add field")', () => {
    const { onPatch, onSelectionChange } = renderField(
      { field_2: { type: 'text', label: 'New field' } },
      'field_2',
    );
    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Status' } });
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toContain('status');
    expect(Object.keys(patch.fields)).not.toContain('field_2');
    expect(onSelectionChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'field', id: 'status' }),
    );
  });

  it('derives from a type-based auto name (canvas add)', () => {
    const { onPatch } = renderField(
      { text_2: { type: 'text', label: 'New field' }, name: { type: 'text' } },
      'text_2',
    );
    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Serial No' } });
    const patch = onPatch.mock.calls.at(-1)![0];
    expect(Object.keys(patch.fields)).toContain('serial_no');
    expect(Object.keys(patch.fields)).not.toContain('text_2');
  });

  it('does NOT rename once the user customised the API name', () => {
    const { onPatch } = renderField(
      { my_field: { type: 'text', label: 'New field' } },
      'my_field',
    );
    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Status' } });
    const renamed = onPatch.mock.calls.some((c) => Object.keys(c[0].fields ?? {}).includes('status'));
    expect(renamed).toBe(false);
  });

  it('keeps the unique auto name for a CJK-only label (slugify yields nothing)', () => {
    const { onPatch } = renderField(
      { field_2: { type: 'text', label: 'New field' } },
      'field_2',
    );
    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: '状态' } });
    const renamed = onPatch.mock.calls.some((c) => !Object.keys(c[0].fields ?? {}).includes('field_2'));
    expect(renamed).toBe(false);
  });

  it('does not steal an existing sibling name on collision', () => {
    const { onPatch } = renderField(
      { status: { type: 'select' }, field_2: { type: 'text', label: 'New field' } },
      'field_2',
    );
    fireEvent.change(screen.getByTestId('field-label-input'), { target: { value: 'Status' } });
    const stolen = onPatch.mock.calls.some((c) => !Object.keys(c[0].fields ?? {}).includes('field_2'));
    expect(stolen).toBe(false);
  });
});

/* ─────────────── Formula expression editor (#1582 follow-up) ─────────────── */

/** A no-op engine stub with a canned type verdict — inspector tests stay deterministic. */
const stubEngine = (inferred: string) => () =>
  Promise.resolve({
    validateExpression: () => ({ ok: true, errors: [], warnings: [] }),
    introspectScope: () => ({ fields: [], roots: ['record'], functions: [] }),
    inferExpressionType: () => inferred as 'number',
  });

/**
 * Real-parent harness: feeds each onPatch back into `draft`, so the
 * controlled editor sees its own edits and the debounced type inference
 * runs against the NEW expression (a static-props render can't observe the
 * async `returnType` stamp).
 */
function StatefulFormulaHarness({
  initialFields,
  selected,
  patches,
}: {
  initialFields: Record<string, Record<string, unknown>>;
  selected: string;
  patches: Array<Record<string, any>>;
}) {
  const [fields, setFields] = React.useState(initialFields);
  return (
    <ObjectFieldInspector
      type="object"
      name="account"
      draft={{ name: 'account', fields }}
      selection={{ kind: 'field', id: selected }}
      onPatch={(patch: any) => {
        patches.push(patch);
        setFields(patch.fields);
      }}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
      locale={'en-US'}
    />
  );
}

describe('ObjectFieldInspector — formula expression editor', () => {
  it('renders the CEL editor seeded from the spec `expression` (envelope shape)', () => {
    renderField(
      {
        amount: { type: 'number' },
        total: { type: 'formula', expression: { dialect: 'cel', source: 'record.amount * 0.2' } },
      },
      'total',
    );
    const ta = controlFor('Formula (CEL)') as HTMLTextAreaElement;
    expect(ta).toHaveValue('record.amount * 0.2');
    // The CEL editor (combobox textarea), not the old plain textarea.
    expect(ta.getAttribute('role')).toBe('combobox');
  });

  it('commits edits to `expression` and migrates the legacy `formula` key', () => {
    const { onPatch } = renderField(
      { amount: { type: 'number' }, total: { type: 'formula', formula: 'record.amount' } },
      'total',
    );
    const ta = controlFor('Formula (CEL)') as HTMLTextAreaElement;
    // The engine-dead legacy key still seeds the editor…
    expect(ta).toHaveValue('record.amount');
    fireEvent.change(ta, { target: { value: 'record.amount * 0.2' } });
    const patch = onPatch.mock.calls.at(-1)![0];
    // …but the edit lands on the spec key and retires the alias.
    expect(patch.fields.total.expression).toBe('record.amount * 0.2');
    // ABSENT, not an own `undefined`: the spec check counts a present key
    // whatever its value (objectui#12681).
    expect(patch.fields.total).not.toHaveProperty('formula');
  });

  it('preserves an envelope (dialect, meta) when editing over it', () => {
    const { onPatch } = renderField(
      {
        amount: { type: 'number' },
        total: {
          type: 'formula',
          expression: { dialect: 'cel', source: 'record.amount', meta: { rationale: 'ai draft' } },
        },
      },
      'total',
    );
    fireEvent.change(controlFor('Formula (CEL)'), { target: { value: 'record.amount * 2.0' } });
    expect(onPatch.mock.calls.at(-1)![0].fields.total.expression).toEqual({
      dialect: 'cel',
      source: 'record.amount * 2.0',
      meta: { rationale: 'ai draft' },
    });
  });

  it('stamps `returnType` from the inferred type after an edit', async () => {
    __setCelFormulaLoader(stubEngine('number'));
    const patches: Array<Record<string, any>> = [];
    render(
      <StatefulFormulaHarness
        initialFields={{ amount: { type: 'number' }, total: { type: 'formula' } }}
        selected="total"
        patches={patches}
      />,
    );
    fireEvent.change(controlFor('Formula (CEL)'), { target: { value: 'record.amount * 0.2' } });
    await waitFor(
      () => expect(patches.some((p) => p.fields?.total?.returnType === 'number')).toBe(true),
      { timeout: 3000 },
    );
  });

  it('does NOT stamp `returnType` on mere selection (no edit this session)', async () => {
    __setCelFormulaLoader(stubEngine('number'));
    const patches: Array<Record<string, any>> = [];
    render(
      <StatefulFormulaHarness
        initialFields={{
          amount: { type: 'number' },
          total: { type: 'formula', expression: 'record.amount * 0.2' },
        }}
        selected="total"
        patches={patches}
      />,
    );
    // Let the debounced lint + inference land, then confirm nothing patched.
    await new Promise((r) => setTimeout(r, 500));
    expect(patches).toEqual([]);
  });

  it('clears `returnType` when the inference degrades to unknown', async () => {
    __setCelFormulaLoader(stubEngine('unknown'));
    const patches: Array<Record<string, any>> = [];
    render(
      <StatefulFormulaHarness
        initialFields={{
          amount: { type: 'number' },
          total: { type: 'formula', expression: 'record.amount * 0.2', returnType: 'number' },
        }}
        selected="total"
        patches={patches}
      />,
    );
    fireEvent.change(controlFor('Formula (CEL)'), { target: { value: 'record.amount + record.name' } });
    await waitFor(
      () =>
        expect(
          patches.some(
            (p) => p.fields?.total && 'returnType' in p.fields.total && p.fields.total.returnType === undefined,
          ),
        ).toBe(true),
      { timeout: 3000 },
    );
  });
});

/* ─────────────── Roll-up summary editor (summaryOperations) ─────────────── */

describe('ObjectFieldInspector — summary roll-up editor', () => {
  it('renders the structured roll-up editor (no CEL formula editor) for a summary field', () => {
    renderField(
      {
        total: {
          type: 'summary',
          summaryOperations: { object: 'crm_order', function: 'sum', field: 'amount' },
        },
      },
      'total',
    );
    expect(screen.getByText('Child object')).toBeInTheDocument();
    expect(screen.getByText('Aggregation')).toBeInTheDocument();
    expect(screen.getByText('Child field to aggregate')).toBeInTheDocument();
    expect(screen.queryByText('Formula (CEL)')).not.toBeInTheDocument();
  });

  it('commits the child object into summaryOperations', () => {
    const { onPatch } = renderField({ total: { type: 'summary' } }, 'total');
    // objectui#11783 — the object picker commits on blur or Enter, never on a
    // keystroke, so the typed name is committed by leaving the input.
    const input = controlFor('Child object');
    fireEvent.change(input, { target: { value: 'crm_order' } });
    fireEvent.blur(input);
    expect(onPatch.mock.calls.at(-1)![0].fields.total.summaryOperations).toEqual({
      object: 'crm_order',
    });
  });

  it('keeps the aggregate-field picker for count (the spec requires the key) with the ignored note', () => {
    renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'count' } } },
      'total',
    );
    expect(screen.getByText('Child field to aggregate')).toBeInTheDocument();
    expect(screen.getByText(/ignored for count/i)).toBeInTheDocument();
    expect(screen.getByText('Child relationship field (optional)')).toBeInTheDocument();
  });

  /* ── filter editor (framework#1868): summaryOperations.filter ── */

  it('renders the filter section for a summary field', () => {
    renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'sum', field: 'amount' } } },
      'total',
    );
    expect(screen.getByText('Filter (rows to aggregate)')).toBeInTheDocument();
    expect(screen.getByText('No filter — every child row is aggregated.')).toBeInTheDocument();
  });

  it('adds a condition, defaulting the field to the first child field', () => {
    const { onPatch } = renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'sum', field: 'amount' } } },
      'total',
    );
    fireEvent.click(screen.getByText('Add condition'));
    expect(onPatch.mock.calls.at(-1)![0].fields.total.summaryOperations.filter).toEqual({ name: '' });
  });

  it('reads an existing filter into a row', () => {
    renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'sum', field: 'amount', filter: { status: 'approved' } } } },
      'total',
    );
    expect(screen.getByText('Filter 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('approved')).toBeInTheDocument();
  });

  it('coerces a boolean child field value to a real boolean in the emitted FilterCondition', () => {
    const { onPatch } = renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'sum', field: 'amount', filter: { billable: '' } } } },
      'total',
    );
    fireEvent.change(controlFor('Value'), { target: { value: 'true' } });
    fireEvent.blur(controlFor('Value'));
    expect(onPatch.mock.calls.at(-1)![0].fields.total.summaryOperations.filter).toEqual({ billable: true });
  });

  it('coerces a numeric operator value to a number (amount >= 500)', () => {
    const { onPatch } = renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'count', field: 'amount', filter: { amount: { $gte: 0 } } } } },
      'total',
    );
    fireEvent.change(controlFor('Value'), { target: { value: '500' } });
    fireEvent.blur(controlFor('Value'));
    expect(onPatch.mock.calls.at(-1)![0].fields.total.summaryOperations.filter).toEqual({ amount: { $gte: 500 } });
  });

  it('shows a read-only note for an advanced ($or) filter instead of clobbering it', () => {
    renderField(
      { total: { type: 'summary', summaryOperations: { object: 'crm_order', function: 'sum', field: 'amount', filter: { $or: [{ status: 'approved' }, { status: 'submitted' }] } } } },
      'total',
    );
    expect(screen.getByText(/advanced shape/i)).toBeInTheDocument();
    expect(screen.queryByText('Filter 1')).not.toBeInTheDocument();
  });
});
