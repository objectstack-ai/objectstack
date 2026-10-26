// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12326 — on a `controlled_by_parent` object a `master_detail`
 * field's Required box is locked on, with a one-line reason, and a retype to
 * `master_detail` starts the field required.
 *
 * Since `@objectstack/spec` 18 (objectstack#23100, ADR-0055 §1) such an object
 * derives its master from exactly one `master_detail` declared
 * `required: true`; the save door refuses any other value. The installed
 * spec's `ObjectSchema` is the oracle for the object each edit leaves behind.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ObjectSchema } from '@objectstack/spec/data';
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

beforeEach(() => {
  // Radix reads pointer capture, which the DOM double does not implement.
  for (const m of ['hasPointerCapture', 'setPointerCapture', 'releasePointerCapture'] as const) {
    if (!(m in Element.prototype)) {
      (Element.prototype as unknown as Record<string, unknown>)[m] = m === 'hasPointerCapture' ? () => false : () => {};
    }
  }
  if (!('scrollIntoView' in Element.prototype)) {
    (Element.prototype as unknown as Record<string, unknown>).scrollIntoView = () => {};
  }
});

afterEach(cleanup);

/** The inspector in a host that applies its patches, as both designers do. */
function mount(object: Row, selected: string) {
  let latest: Row = object;
  function Host() {
    const [draft, setDraft] = React.useState<Row>(latest);
    return (
      <ObjectFieldInspector
        type="object"
        name={String(object.name)}
        draft={draft}
        selection={{ kind: 'field', id: selected }}
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
  return { object: () => latest, field: () => (latest.fields as Record<string, Row>)[selected] };
}

const requiredBox = () => screen.getByRole('checkbox', { name: t('designer.field.required', 'en-US') });

const REASON = t('designer.field.requiredCbpMaster', 'en-US');

describe('ObjectFieldInspector — a controlled_by_parent master is required, locked (objectui#12326)', () => {
  it('the Required box of the master is on and locked, with the reason', () => {
    mount(
      {
        name: 'crm_case',
        sharingModel: 'controlled_by_parent',
        fields: { account: { type: 'master_detail', reference: 'crm_account', required: true } },
      },
      'account',
    );
    expect(requiredBox()).toBeChecked();
    expect(requiredBox()).toBeDisabled();
    expect(screen.getByTestId('field-required-cbp-master')).toHaveTextContent(REASON);
  });

  it('a stored master without required can be ticked, and then no longer cleared', () => {
    const { object, field } = mount(
      {
        name: 'crm_case',
        sharingModel: 'controlled_by_parent',
        fields: { account: { type: 'master_detail', reference: 'crm_account' } },
      },
      'account',
    );
    expect(ObjectSchema.safeParse(object()).success).toBe(false);
    expect(requiredBox()).not.toBeChecked();
    expect(requiredBox()).toBeEnabled();
    fireEvent.click(requiredBox());
    expect(field().required).toBe(true);
    expect(requiredBox()).toBeDisabled();
    expect(ObjectSchema.safeParse(object()).success).toBe(true);
  });

  it('outside controlled_by_parent the box stays free and no reason is shown', () => {
    const { field } = mount(
      {
        name: 'crm_case',
        sharingModel: 'private',
        fields: { account: { type: 'master_detail', reference: 'crm_account', required: true } },
      },
      'account',
    );
    expect(requiredBox()).toBeEnabled();
    expect(screen.queryByTestId('field-required-cbp-master')).toBeNull();
    fireEvent.click(requiredBox());
    expect(field().required).toBeUndefined();
  });

  it('a lookup on a controlled_by_parent object is not locked', () => {
    mount(
      {
        name: 'crm_case',
        sharingModel: 'controlled_by_parent',
        fields: {
          account: { type: 'master_detail', reference: 'crm_account', required: true },
          owner: { type: 'lookup', reference: 'sys_user', required: true },
        },
      },
      'owner',
    );
    expect(requiredBox()).toBeEnabled();
    expect(screen.queryByTestId('field-required-cbp-master')).toBeNull();
  });

  it('retyping a field to master_detail on a controlled_by_parent object makes it the required master', async () => {
    const { object, field } = mount(
      {
        name: 'crm_case',
        sharingModel: 'controlled_by_parent',
        fields: { account: { type: 'lookup', label: 'Account', reference: 'crm_account' } },
      },
      'account',
    );
    expect(ObjectSchema.safeParse(object()).success).toBe(false);
    await userEvent.click(screen.getByRole('combobox', { name: t('designer.field.type', 'en-US') }));
    const list = await screen.findByRole('listbox', { name: t('designer.field.type', 'en-US') });
    await userEvent.click(within(list).getByRole('option', { name: 'Master-Detail' }));
    expect(field()).toEqual({ type: 'master_detail', label: 'Account', reference: 'crm_account', required: true });
    expect(ObjectSchema.safeParse(object()).success).toBe(true);
    expect(requiredBox()).toBeDisabled();
  });
});
