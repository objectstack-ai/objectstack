// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The option editor reads label first, fills a new option's value in from its
 * label, and draws the lifecycle kind only where a kind steers something
 * (objectstack#27521, Studio row 25).
 *
 * A Studio author typed three labels into a new picklist, left the monospace
 * `value` boxes empty, and the inspector kept saying the field "needs at least
 * one option": a row with no value is never written. Every option also offered
 * a "No kind" picker of Open / Won / Lost on a field no record path follows.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';

vi.mock('../useMetadata', () => ({
  useMetadataClient: () => ({
    list: vi.fn().mockResolvedValue([]),
    listDrafts: vi.fn().mockResolvedValue([]),
  }),
}));

vi.mock('../previews/useObjectFields', () => ({
  useObjectFields: () => ({ fields: [], loading: false, error: null }),
}));

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

type Def = Record<string, unknown>;

function renderField(name: string, fields: Record<string, Def>, stageField?: string | false) {
  const onPatch = vi.fn();
  const initial: Record<string, unknown> = { name: 'probe_widget', fields };
  if (stageField !== undefined) initial.stageField = stageField;
  function Host() {
    const [draft, setDraft] = React.useState(initial);
    return (
      <ObjectFieldInspector
        type="object"
        name="probe_widget"
        draft={draft}
        selection={{ kind: 'field', id: name }}
        onPatch={(patch: Record<string, unknown>) => {
          onPatch(patch);
          setDraft((d) => ({ ...d, ...patch }));
        }}
        onClearSelection={vi.fn()}
        onSelectionChange={vi.fn()}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  render(<Host />);
  const savedOptions = () => {
    const last = onPatch.mock.calls.at(-1);
    return ((last?.[0].fields as Record<string, Def> | undefined)?.[name]?.options ?? []) as Def[];
  };
  return { onPatch, savedOptions };
}

const labels = () => screen.getAllByTestId('option-label') as HTMLInputElement[];
const values = () => screen.getAllByTestId('option-value') as HTMLInputElement[];

describe('ObjectFieldInspector · options read label first (objectstack#27521)', () => {
  it('a new option: Label comes before the value, and typing the label fills the value in', () => {
    const { savedOptions } = renderField('size', { size: { type: 'select', label: 'Size' } });

    const row = labels()[0].parentElement!;
    expect(row.firstElementChild).toBe(labels()[0]);
    expect(row.lastElementChild).toBe(values()[0]);

    fireEvent.change(labels()[0], { target: { value: 'Extra Large' } });
    expect(values()[0].value).toBe('extra_large');
    expect(savedOptions()).toEqual([{ value: 'extra_large', label: 'Extra Large' }]);
    expect(FieldSchema.safeParse({ name: 'size', type: 'select', label: 'Size', options: savedOptions() }).success).toBe(true);
  });

  it('three labelled new options are three written options, so nothing holds the save', () => {
    const { savedOptions } = renderField('size', { size: { type: 'select', label: 'Size' } });
    const add = screen.getByRole('button', { name: /Add value/ });
    fireEvent.change(labels()[0], { target: { value: 'Small' } });
    fireEvent.click(add);
    fireEvent.change(labels()[1], { target: { value: 'Medium' } });
    fireEvent.click(add);
    fireEvent.change(labels()[2], { target: { value: 'Large' } });

    expect(savedOptions().map((o) => o.value)).toEqual(['small', 'medium', 'large']);
    expect(screen.queryByTestId('field-held-hint')).toBeNull();
  });

  it('a value typed by hand stops following the label', () => {
    const { savedOptions } = renderField('size', { size: { type: 'select', label: 'Size' } });
    fireEvent.change(labels()[0], { target: { value: 'Small' } });
    fireEvent.change(values()[0], { target: { value: 's' } });
    fireEvent.change(labels()[0], { target: { value: 'Small size' } });
    expect(savedOptions()).toEqual([{ value: 's', label: 'Small size' }]);
  });

  it('CONTROL — relabelling an authored option keeps the value its records store', () => {
    const { savedOptions } = renderField('size', {
      size: { type: 'select', label: 'Size', options: [{ value: 'sm', label: 'Small' }] },
    });
    fireEvent.change(labels()[0], { target: { value: 'Tiny' } });
    expect(savedOptions()).toEqual([{ value: 'sm', label: 'Tiny' }]);
  });

  it('no kind picker on a select no record path follows', () => {
    renderField('size', {
      size: { type: 'select', label: 'Size', options: [{ value: 'sm', label: 'Small' }] },
    });
    expect(screen.queryByTestId('option-kind')).toBeNull();
    // POSITIVE CONTROL for the query above: the row is drawn.
    expect(labels()).toHaveLength(1);
  });

  it('the kind picker shows on the field the object names as its stage field', () => {
    renderField('phase_code', { phase_code: { type: 'select', label: 'Phase', options: [{ value: 'a', label: 'A' }] } }, 'phase_code');
    expect(screen.getAllByTestId('option-kind')).toHaveLength(1);
  });

  it('the kind picker shows on the field the record path finds by name when no stage field is set', () => {
    renderField('status', { status: { type: 'select', label: 'Status', options: [{ value: 'a', label: 'A' }] } });
    expect(screen.getAllByTestId('option-kind')).toHaveLength(1);
  });

  it('`stageField: false` turns the path off, and with it the picker', () => {
    renderField('status', { status: { type: 'select', label: 'Status', options: [{ value: 'a', label: 'A' }] } }, false);
    expect(screen.queryByTestId('option-kind')).toBeNull();
  });

  it('an option that already declares a kind keeps the picker, so the kind stays editable', () => {
    renderField('size', {
      size: { type: 'select', label: 'Size', options: [{ value: 'sm', label: 'Small', kind: 'open' }, { value: 'lg', label: 'Large' }] },
    });
    expect(screen.getAllByTestId('option-kind')).toHaveLength(2);
  });
});
