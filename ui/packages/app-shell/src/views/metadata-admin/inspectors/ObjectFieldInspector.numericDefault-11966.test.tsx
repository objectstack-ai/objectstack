// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11966 — a `rating`, `slider` or `progress` field's *Default value*
 * control is the number control, so the default it writes is a number.
 *
 * `FieldSchema` judges a literal default against the field's own stored value
 * contract, and these three types store a number: the text control's string
 * (`defaultValue: '3'`) was refused with "expected number, received string".
 * Triage's direction on the card: unlike `record` (objectui#11947, no
 * control), a number default is authorable, so these types get the existing
 * number control.
 *
 * Pinned through the real inspector:
 *   - each of the three renders a number input, and what it writes is a JS
 *     number that `FieldSchema` parses (with the declared bounds the
 *     objectstack showcase's field zoo gives each type on the field);
 *   - control: `text` keeps the text control and still writes a string;
 *     `number` keeps the number control; `summary`, a computed member of the
 *     spec's numeric class, still gets none;
 *   - a default already stored as a string (what the text control wrote) is
 *     not converted: an unrelated edit carries it unchanged, and only typing
 *     a number over it replaces it.
 *
 * The inspector is mounted in a host that applies each `onPatch` as the
 * designers do (`{ ...draft, ...patch }`), so every assertion reads the field
 * the next save would carry.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FieldSchema } from '@objectstack/spec/data';
import { t } from '../i18n';

type Row = Record<string, unknown>;

vi.mock('../useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../useMetadata')>();
  const client = { list: async () => [], listDrafts: async () => [] };
  return { ...mod, useMetadataClient: () => client };
});

vi.mock('../previews/useObjectFields', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../previews/useObjectFields')>();
  return { ...mod, useObjectFields: () => ({ fields: [], loading: false, error: null }) };
});

import { ObjectFieldInspector } from './ObjectFieldInspector';

afterEach(cleanup);

/** The inspector over one field `f`, in a host that applies its patches. */
function mount(def: Row) {
  let latest: Row = { name: 'acme_account', fields: { f: def } };
  function Host() {
    const [draft, setDraft] = React.useState<Row>(latest);
    return (
      <ObjectFieldInspector
        type="object"
        name="acme_account"
        draft={draft}
        selection={{ kind: 'field', id: 'f' }}
        onPatch={(patch) => {
          setDraft((d) => {
            latest = { ...d, ...patch };
            return latest;
          });
        }}
        onClearSelection={() => {}}
        onSelectionChange={() => {}}
        readOnly={false}
        locale="en-US"
      />
    );
  }
  render(<Host />);
  return { field: () => (latest.fields as Record<string, Row>).f };
}

const DEFAULT_LABEL = t('designer.field.defaultValue', 'en-US');

/** Every *Default value* control the inspector renders, by its label. */
const defaultControls = () => screen.queryAllByLabelText(DEFAULT_LABEL);

const expectParses = (field: Row) => {
  const parsed = FieldSchema.safeParse(field);
  expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
};

/**
 * Each type with the bounds objectstack's `examples/app-showcase` field zoo
 * declares on it (`f_rating`, `f_slider`, `f_progress`), the typed text, and
 * the number the default must carry.
 */
const NUMERIC_CASES: ReadonlyArray<[string, Row, string, number]> = [
  ['rating', { type: 'rating', label: 'F', max: 5 }, '3', 3],
  ['slider', { type: 'slider', label: 'F', min: 0, max: 100, step: 5 }, '3', 3],
  ['progress', { type: 'progress', label: 'F', min: 0, max: 100 }, '40', 40],
];

describe('ObjectFieldInspector — a number Default value control for rating, slider and progress (objectui#11966)', () => {
  it.each(NUMERIC_CASES)(
    '%s: the control is a number input, and the default it writes is a number FieldSchema parses',
    (_type, def, typed, expected) => {
      const { field } = mount({ ...def });
      const controls = defaultControls();
      expect(controls).toHaveLength(1);
      expect(controls[0]).toHaveAttribute('type', 'number');

      fireEvent.change(controls[0], { target: { value: typed } });

      expect(field()).toEqual({ ...def, defaultValue: expected });
      expect(typeof field().defaultValue).toBe('number');
      expectParses(field());

      // Emptying the control removes the default rather than storing a blank.
      fireEvent.change(controls[0], { target: { value: '' } });
      expect(field().defaultValue).toBeUndefined();
      expectParses(field());
    },
  );

  it.each(NUMERIC_CASES)(
    '%s: the string the text control wrote is the shape FieldSchema refuses',
    (_type, def, typed, expected) => {
      // The refusal the card measured, so the editor choice above answers a
      // live contract rather than a remembered one.
      expectParses({ ...def, defaultValue: expected });
      const refused = FieldSchema.safeParse({ ...def, defaultValue: typed });
      expect(refused.success).toBe(false);
      expect(refused.error?.issues.map((i) => i.path.join('.'))).toEqual(['defaultValue']);
    },
  );

  it('control: a text field keeps the text control, and still writes a string', () => {
    const { field } = mount({ type: 'text', label: 'F' });
    const controls = defaultControls();
    expect(controls).toHaveLength(1);
    expect(controls[0]).not.toHaveAttribute('type', 'number');

    fireEvent.change(controls[0], { target: { value: '3' } });

    expect(field()).toEqual({ type: 'text', label: 'F', defaultValue: '3' });
    expectParses(field());
  });

  it('control: a number field keeps the number control', () => {
    const { field } = mount({ type: 'number', label: 'F' });
    const controls = defaultControls();
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveAttribute('type', 'number');

    fireEvent.change(controls[0], { target: { value: '7' } });

    expect(field()).toEqual({ type: 'number', label: 'F', defaultValue: 7 });
    expectParses(field());
  });

  it('control: a summary field, a computed member of the numeric class, still gets no control', () => {
    mount({ type: 'summary', label: 'F' });
    // The inspector did render: the field's Type control is there.
    expect(screen.getByRole('combobox', { name: t('designer.field.type', 'en-US') })).toBeInTheDocument();
    expect(defaultControls()).toHaveLength(0);
  });

  it('FieldSchema does not judge a default against the field min / max, so the control is not bounded by them', () => {
    // The control writes any number the author types. That is right only
    // while the spec admits a default outside the field's declared bounds; if
    // it ever refuses one, this goes red and the control must stop writing it.
    expectParses({ type: 'rating', label: 'F', max: 5, defaultValue: 7 });
    expectParses({ type: 'slider', label: 'F', min: 0, max: 100, defaultValue: 140 });
    expectParses({ type: 'progress', label: 'F', min: 0, max: 100, defaultValue: -5 });
  });
});

describe('ObjectFieldInspector — a default stored as a string is not converted (objectui#11966)', () => {
  it('a rating field keeps its stored string default when Required is ticked', () => {
    const { field } = mount({ type: 'rating', label: 'F', max: 5, defaultValue: '3' });
    fireEvent.click(screen.getByRole('checkbox', { name: t('designer.field.required', 'en-US') }));

    expect(field().required).toBe(true);
    expect(field().defaultValue).toBe('3');
  });

  it('the number control shows no number for it, so the box never claims a number the field does not carry', () => {
    mount({ type: 'slider', label: 'F', defaultValue: '3' });
    const controls = defaultControls();
    expect(controls).toHaveLength(1);
    expect(controls[0]).toHaveValue(null);
  });

  it('typing a number over it replaces it with the number, and the field then parses', () => {
    const { field } = mount({ type: 'progress', label: 'F', defaultValue: '40' });
    expect(FieldSchema.safeParse(field()).success, 'the stored string is refused').toBe(false);

    fireEvent.change(defaultControls()[0], { target: { value: '40' } });

    expect(field().defaultValue).toBe(40);
    expectParses(field());
  });
});
