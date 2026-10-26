// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins that clearing a picklist option's Label in the field designer emits an
 * option that the CONTRACT accepts (objectui#7014 Q2).
 *
 * The bug was a truthiness guard in `patchOptions`:
 *
 *   const out: Option = { value: o.value };
 *   if (o.label) out.label = o.label;      // <- drops the key on ''
 *
 * Measured on `@objectstack/spec` 17.2.0 (`SelectOptionSchema`):
 *
 *   { value: 'alpha', label: 'Alpha' }  -> ACCEPT     (lit control)
 *   { value: 'alpha', label: '' }       -> ACCEPT     <- the key reading
 *   { value: 'alpha' }                  -> REJECT invalid_type at [label]
 *   { value: 'alpha', label: undefined } -> REJECT invalid_type at [label]
 *   { value: 'alpha', label: 'A', bogus: 1 } -> REJECT unrecognized_keys
 *                                              (strictness control: the
 *                                               ACCEPTs above are real, not a
 *                                               passthrough)
 *
 * So an empty label is a document the platform accepts, and the guard was
 * rewriting that LEGAL document into an ILLEGAL one — the author cleared the
 * Label box, the save went out without the key, and the API answered 422.
 *
 * Both halves are pinned deliberately: asserting only "the `label` key is
 * present" would keep passing against a fix that emitted, say, `label:
 * undefined` or fell back to the option's `value`. Each case therefore ends at
 * `SelectOptionSchema` / `FieldSchema` — the guard and the contract, wired
 * together.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SelectOptionSchema, FieldSchema } from '@objectstack/spec/data';

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

function renderField(fields: Record<string, Def>, selectedId: string) {
  const onPatch = vi.fn();
  render(
    <ObjectFieldInspector
      type="object"
      name="probe_widget"
      draft={{ name: 'probe_widget', fields }}
      selection={{ kind: 'field', id: selectedId }}
      onPatch={onPatch}
      onClearSelection={vi.fn()}
      onSelectionChange={vi.fn()}
      readOnly={false}
      locale={'en-US'}
    />,
  );
  /** The fields map the host's Save would persist after the last edit. */
  const savedFields = () => onPatch.mock.calls.at(-1)![0].fields as Record<string, Def>;
  return { onPatch, savedFields };
}

/** The option list the designer would persist for `status`. */
const savedOptions = (fields: Record<string, Def>): Def[] =>
  (fields.status as { options?: Def[] }).options ?? [];

/** The whole field as the PUT body carries it (record key -> `name`). */
const savedField = (fields: Record<string, Def>): Def => ({ name: 'status', ...fields.status });

/** The structural slice of a Zod schema this file needs -- no `any` (AGENTS.md #6). */
type SpecIssue = { code: string; path: ReadonlyArray<PropertyKey> };
type SpecSchema = {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: SpecIssue[] } };
};

/** Every issue the contract raises, as `code@[path]`, for readable failures. */
const rejectionsOf = (schema: SpecSchema, doc: unknown): string[] => {
  const r = schema.safeParse(doc);
  return r.success ? [] : (r.error?.issues ?? []).map((i) => `${i.code}@[${i.path.join('.')}]`);
};

const selectField = (options: Def[]): Record<string, Def> => ({
  status: { type: 'select', label: 'Status', options },
});

describe('ObjectFieldInspector · an emptied option Label stays a legal document (objectui#7014 Q2)', () => {
  it('emits `label: ""` — not a dropped key — when the author clears the Label box', () => {
    const { savedFields } = renderField(
      selectField([{ value: 'alpha', label: 'Alpha' }]),
      'status',
    );

    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: '' } });

    const [option] = savedOptions(savedFields());
    // The key is present AND empty. `toBe('')` alone would also pass on a
    // dropped key (`undefined !== ''`), so both facts are asserted.
    expect(Object.prototype.hasOwnProperty.call(option, 'label')).toBe(true);
    expect(option.label).toBe('');
    // Nothing was invented to fill the hole — B ("fall back to `value`") would
    // have stored `Alpha`/`alpha` behind the author's back.
    expect(option.value).toBe('alpha');
  });

  it('that emitted option is ACCEPTED by SelectOptionSchema and FieldSchema', () => {
    const { savedFields } = renderField(
      selectField([{ value: 'alpha', label: 'Alpha' }]),
      'status',
    );

    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: '' } });

    const fields = savedFields();
    expect(rejectionsOf(SelectOptionSchema, savedOptions(fields)[0])).toEqual([]);
    expect(rejectionsOf(FieldSchema, savedField(fields))).toEqual([]);
  });

  it('the contract really requires the key — the ACCEPT above is not a vacuous one', () => {
    // Lit control: the shape the OLD guard emitted is genuinely refused, and
    // refused AT [label] — so the green above is the fix, not a schema that
    // waves everything through.
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha' })).toEqual([
      'invalid_type@[label]',
    ]);
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: undefined })).toEqual([
      'invalid_type@[label]',
    ]);
    // Strictness control: this schema does reject things, so its ACCEPTs mean
    // something.
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: 'Alpha', bogus: 1 })).toEqual([
      'unrecognized_keys@[]',
    ]);
    // And the ACCEPT side of the same pair.
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: 'Alpha' })).toEqual([]);
    expect(rejectionsOf(SelectOptionSchema, { value: 'alpha', label: '' })).toEqual([]);
  });

  it('a non-empty label still round-trips untouched', () => {
    const { savedFields } = renderField(
      selectField([{ value: 'alpha', label: 'Alpha' }]),
      'status',
    );

    fireEvent.change(screen.getByPlaceholderText('Label'), { target: { value: 'Alpha II' } });

    const [option] = savedOptions(savedFields());
    expect(option).toEqual({ value: 'alpha', label: 'Alpha II' });
    expect(rejectionsOf(FieldSchema, savedField(savedFields()))).toEqual([]);
  });

  it('an option that arrived with no usable label leaves as a legal one', () => {
    // `readOptions` maps a missing (or non-string) stored `label` to
    // `undefined`, and that row reaches `patchOptions` untouched when the
    // author edits some OTHER row. The old guard passed the illegal shape
    // straight back out; there is no legal document that omits the key, and ''
    // is what the Label input has been showing for this option all along.
    const { savedFields } = renderField(
      selectField([{ value: 'alpha' }, { value: 'beta', label: 'Beta' }]),
      'status',
    );

    // Touch the SECOND row only.
    fireEvent.change(screen.getAllByPlaceholderText('Label')[1], { target: { value: 'Beta II' } });

    const options = savedOptions(savedFields());
    expect(options).toEqual([
      { value: 'alpha', label: '' },
      { value: 'beta', label: 'Beta II' },
    ]);
    expect(rejectionsOf(FieldSchema, savedField(savedFields()))).toEqual([]);
  });
});
