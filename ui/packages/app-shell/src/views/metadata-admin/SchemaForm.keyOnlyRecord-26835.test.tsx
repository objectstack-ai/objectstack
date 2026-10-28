// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The key-only record control, and the Studio hook form's `refusals` row that
 * takes it (objectstack#26835).
 *
 * A hook's refusal catalogue is `Record<CODE, { message, status? }>` with each
 * entry CLOSED (`HookRefusalSchema`): the key is the code, and no member echoes
 * it. The default `record` face mirrors each key into its entry (`name` unless
 * `keyField.field` says otherwise), which that schema refuses — so the form
 * could not offer the catalogue at all. The key-only face edits the same map
 * and never writes the key into the value.
 *
 * Everything the control reads comes from the spec, never restated here: the
 * form row is `hookForm`'s own, the field schema is the served derivation of
 * `HookSchema` (the server's `z.toJSONSchema(…, { io: 'input' })`), and the key
 * rule is that schema's `propertyNames.pattern`, which the spec derives from
 * `HOOK_REFUSAL_CODE_PATTERN`.
 */

import * as React from 'react';
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { z } from 'zod';
import { HookSchema, hookForm, HOOK_REFUSAL_CODE_PATTERN } from '@objectstack/spec/data';
import { SchemaForm, KEY_ONLY_RECORD_WIDGET } from './SchemaForm';

afterEach(cleanup);

const HOOK_JSON_SCHEMA = z.toJSONSchema(HookSchema as unknown as z.ZodType, {
  io: 'input',
  unrepresentable: 'any',
}) as Record<string, unknown>;

type FormRow = { field?: string; type?: string; widget?: string; fields?: unknown[] };

/** The hook form's own `refusals` row — read from `hookForm`, never restated. */
function refusalsRow(): FormRow {
  for (const section of hookForm.sections ?? []) {
    for (const f of (section.fields ?? []) as Array<FormRow | string>) {
      if (typeof f !== 'string' && f.field === 'refusals') return f;
    }
  }
  throw new Error('hookForm offers no `refusals` row');
}

/** A form of the one row under test, so the body's code editor stays out of the render. */
function formOf(row: FormRow) {
  return { type: 'simple', sections: [{ label: 'Refusals', fields: [row] }] } as never;
}

/** A hook every other key of which `HookSchema` accepts: a sandboxed js body. */
const HOOK_BASE = {
  name: 'sign_contract',
  object: 'contract',
  events: ['beforeUpdate'],
  body: { language: 'js', source: 'return;' },
};

function Harness({
  row,
  initial,
  sink,
}: {
  row: FormRow;
  initial: Record<string, unknown>;
  sink: { value: Record<string, unknown> };
}) {
  const [value, setValue] = React.useState<Record<string, unknown>>(initial);
  return (
    <SchemaForm
      schema={HOOK_JSON_SCHEMA}
      form={formOf(row)}
      value={value}
      onChange={(next) => {
        sink.value = next;
        setValue(next);
      }}
    />
  );
}

function renderHook(row: FormRow, initial: Record<string, unknown> = HOOK_BASE) {
  const sink = { value: initial };
  render(<Harness row={row} initial={initial} sink={sink} />);
  return sink;
}

function addKey(code: string) {
  fireEvent.change(screen.getByPlaceholderText('Key'), { target: { value: code } });
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

function refusalsOf(sink: { value: Record<string, unknown> }) {
  return sink.value.refusals as Record<string, Record<string, unknown>> | undefined;
}

describe('the hook form offers `refusals` with the key-only record control (objectstack#26835)', () => {
  it('declares the row as a record that opts into the key-only face', () => {
    const row = refusalsRow();
    expect(row.type).toBe('record');
    expect(row.widget).toBe(KEY_ONLY_RECORD_WIDGET);
  });

  it('serves the key rule the control reads, derived from the spec code spelling', () => {
    const refusals = (HOOK_JSON_SCHEMA.properties as Record<string, Record<string, unknown>>).refusals;
    expect((refusals.propertyNames as { pattern?: string }).pattern).toBe(HOOK_REFUSAL_CODE_PATTERN.source);
  });
});

describe('the key-only record control (objectstack#26835)', () => {
  it('adds an entry without writing its key into the entry', () => {
    const sink = renderHook(refusalsRow());
    addKey('CLEAN_VERSION_REQUIRED');
    expect(refusalsOf(sink)).toEqual({ CLEAN_VERSION_REQUIRED: {} });
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'Sign a clean version.' } });
    expect(refusalsOf(sink)).toEqual({ CLEAN_VERSION_REQUIRED: { message: 'Sign a clean version.' } });
  });

  it('refuses a key that breaks the served key rule, and leaves the value as it was', () => {
    const sink = renderHook(refusalsRow());
    addKey('clean_version');
    expect(refusalsOf(sink)).toBeUndefined();
    expect(screen.getByText(`Key must match ${String(HOOK_REFUSAL_CODE_PATTERN)}`)).toBeInTheDocument();
  });

  it('a rename moves the entry, in place and unstamped, through an invalid intermediate spelling', () => {
    const sink = renderHook(refusalsRow(), {
      ...HOOK_BASE,
      refusals: {
        FIRST: { message: 'First.' },
        DRAFT: { message: 'Drafts cannot be signed.', status: 409 },
        LAST: { message: 'Last.' },
      },
    });
    fireEvent.click(screen.getByText('DRAFT'));
    const keyInput = screen.getByDisplayValue('DRAFT');
    // `DRAFT_` breaks the rule: the text stays typeable, the value does not move.
    fireEvent.change(keyInput, { target: { value: 'DRAFT_' } });
    expect(screen.getByDisplayValue('DRAFT_')).toBeInTheDocument();
    expect(Object.keys(refusalsOf(sink)!)).toEqual(['FIRST', 'DRAFT', 'LAST']);
    fireEvent.change(screen.getByDisplayValue('DRAFT_'), { target: { value: 'DRAFT_STATE' } });
    expect(Object.keys(refusalsOf(sink)!)).toEqual(['FIRST', 'DRAFT_STATE', 'LAST']);
    expect(refusalsOf(sink)!.DRAFT_STATE).toEqual({ message: 'Drafts cannot be signed.', status: 409 });
    // The renamed entry stays open under its new key.
    expect(screen.getByDisplayValue('DRAFT_STATE')).toBeInTheDocument();
  });

  it('a rename onto a key the record already holds is refused', () => {
    const sink = renderHook(refusalsRow(), {
      ...HOOK_BASE,
      refusals: { FIRST: { message: 'First.' }, SECOND: { message: 'Second.' } },
    });
    fireEvent.click(screen.getByText('SECOND'));
    fireEvent.change(screen.getByDisplayValue('SECOND'), { target: { value: 'FIRST' } });
    expect(Object.keys(refusalsOf(sink)!)).toEqual(['FIRST', 'SECOND']);
    expect(screen.getByText('Key "FIRST" already exists')).toBeInTheDocument();
  });

  it('a hook authored with two refusals saves a body HookSchema accepts as written, and reloads into the same rows', () => {
    const sink = renderHook(refusalsRow());
    addKey('CLEAN_VERSION_REQUIRED');
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'A current clean version is required before signing.' } });
    fireEvent.change(screen.getByLabelText(/Status/), { target: { value: '422' } });
    addKey('ALREADY_SIGNED');
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'This contract is already signed.' } });

    const saved = JSON.parse(JSON.stringify(sink.value)) as Record<string, unknown>;
    const parsed = HookSchema.safeParse(saved);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(JSON.stringify(parsed.data!.refusals)).toBe(JSON.stringify(saved.refusals));
    expect(saved.refusals).toEqual({
      CLEAN_VERSION_REQUIRED: { message: 'A current clean version is required before signing.', status: 422 },
      ALREADY_SIGNED: { message: 'This contract is already signed.' },
    });

    cleanup();
    renderHook(refusalsRow(), saved);
    const headers = screen.getAllByText(/^(CLEAN_VERSION_REQUIRED|ALREADY_SIGNED)$/).map((el) => el.textContent);
    expect(headers).toEqual(['CLEAN_VERSION_REQUIRED', 'ALREADY_SIGNED']);
    fireEvent.click(screen.getByText('CLEAN_VERSION_REQUIRED'));
    expect(screen.getByLabelText(/Message/)).toHaveValue('A current clean version is required before signing.');
    expect(screen.getByLabelText(/Status/)).toHaveValue(422);
  });
});

describe('the default record face is unchanged (objectstack#26835)', () => {
  it('still mirrors the key into the entry when no widget is declared', () => {
    const { widget: _widget, ...generic } = refusalsRow();
    const sink = renderHook(generic);
    fireEvent.change(screen.getByPlaceholderText('Name'), { target: { value: 'CLEAN_VERSION_REQUIRED' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText(/Message/), { target: { value: 'Sign a clean version.' } });
    expect(refusalsOf(sink)!.CLEAN_VERSION_REQUIRED).toEqual({ name: 'CLEAN_VERSION_REQUIRED', message: 'Sign a clean version.' });
    // …which is exactly the body the refusal entry's closed schema refuses.
    const parsed = HookSchema.safeParse(JSON.parse(JSON.stringify(sink.value)));
    expect(parsed.success).toBe(false);
    expect(parsed.error!.issues).toEqual([
      expect.objectContaining({ code: 'unrecognized_keys', keys: ['name'], path: ['refusals', 'CLEAN_VERSION_REQUIRED'] }),
    ]);
  });
});
