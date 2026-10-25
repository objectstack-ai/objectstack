// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11947 — a `record` field's inspector offers no *Default value*
 * control, as `composite` and `repeater` do not.
 *
 * A `record` field's stored value is a record, and `FieldSchema` judges a
 * literal default against that contract: the string the text control wrote
 * (`defaultValue: 'primary'`) was refused with "expected record, received
 * string". No control in the inspector can author a record, so the type joins
 * the inspector's no-default list (triage's direction on the card). `location`
 * and `address` store an object and took the same text control, with the same
 * refusal; they join the list in the same change.
 *
 * Pinned in both directions, because a control that is gone and a section that
 * failed to render look the same from the outside:
 *   - `record`, `location` and `address` render no default control;
 *   - control: `text` still renders one, and what it writes parses through
 *     `FieldSchema`;
 *   - control: `composite` still renders none.
 *
 * A default such a field already carries, authored in code, stays on the
 * field: an unrelated edit in the inspector writes it back unchanged.
 *
 * The inspector is the real one, mounted in a host that applies each
 * `onPatch` as the designers do (`{ ...draft, ...patch }`), so every assertion
 * reads the field the next save would carry.
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

describe('ObjectFieldInspector — no Default value control for a record-valued type (objectui#11947)', () => {
  it.each(['record', 'location', 'address'])(
    '%s: the inspector renders no Default value control',
    (type) => {
      mount({ type, label: 'F' });
      // The inspector did render: the field's Type control is there.
      expect(screen.getByRole('combobox', { name: t('designer.field.type', 'en-US') })).toBeInTheDocument();
      expect(defaultControls()).toHaveLength(0);
      expect(screen.queryAllByText(DEFAULT_LABEL)).toHaveLength(0);
    },
  );

  it('control: a text field still renders one, and the default it writes parses through FieldSchema', () => {
    const { field } = mount({ type: 'text', label: 'F' });
    const controls = defaultControls();
    expect(controls).toHaveLength(1);

    fireEvent.change(controls[0], { target: { value: 'primary' } });

    expect(field()).toEqual({ type: 'text', label: 'F', defaultValue: 'primary' });
    const parsed = FieldSchema.safeParse(field());
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('control: a composite field still renders none', () => {
    mount({ type: 'composite', label: 'F' });
    expect(screen.getByRole('combobox', { name: t('designer.field.type', 'en-US') })).toBeInTheDocument();
    expect(defaultControls()).toHaveLength(0);
  });

  it('the string the old control wrote is the shape FieldSchema refuses for a record field', () => {
    // The refusal the card measured, so the list entry above answers a live
    // contract rather than a remembered one: if the spec ever admits a string
    // here, this goes red and the entry should be reconsidered.
    expect(FieldSchema.safeParse({ type: 'record', label: 'F' }).success, 'the field without it parses').toBe(true);
    const refused = FieldSchema.safeParse({ type: 'record', label: 'F', defaultValue: 'primary' });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues.map((i) => i.path.join('.'))).toEqual(['defaultValue']);
  });
});

describe('ObjectFieldInspector — a default authored in code survives an unrelated edit (objectui#11947)', () => {
  // The showcase's seed value for its `record` field, `f_record`.
  const stored = { primary: { name: 'A', score: 9 }, backup: { name: 'B', score: 7 } };

  it('a record field keeps its stored default when Required is ticked, and the field still parses', () => {
    const before = FieldSchema.safeParse({ type: 'record', label: 'F', defaultValue: stored });
    expect(before.success, 'the stored default is one the spec admits').toBe(true);

    const { field } = mount({ type: 'record', label: 'F', defaultValue: structuredClone(stored) });
    fireEvent.click(screen.getByRole('checkbox', { name: t('designer.field.required', 'en-US') }));

    expect(field().required).toBe(true);
    expect(field().defaultValue).toEqual(stored);
    const parsed = FieldSchema.safeParse(field());
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it('nothing shows the stored record as text, so no keystroke can overwrite it with a string', () => {
    // The text control showed it as "[object Object]", and that control
    // commits the box's text as the default on every keystroke.
    mount({ type: 'record', label: 'F', defaultValue: structuredClone(stored) });
    expect(screen.queryByDisplayValue('[object Object]')).toBeNull();
    expect(defaultControls()).toHaveLength(0);
  });
});
