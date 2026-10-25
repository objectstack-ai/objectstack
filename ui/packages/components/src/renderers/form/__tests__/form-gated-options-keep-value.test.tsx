/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A GATED option list never deletes the form's stored value (objectui#4247).
 *
 * The form renderer runs its OWN cascade clear (#2284) alongside the widgets':
 * for every option field it resolves the offered set and `form.setValue(name,
 * null)` when the current value is no longer offered (a scalar; an array is
 * emptied to `[]`). `resolveCascadingOptions`
 * returns an EMPTY set whenever the list is gated — a declared `dependsOn`
 * parent is still empty — so a record that simply ARRIVES with the parent empty
 * (a later-cleared parent, an import, a partially-migrated row) had its
 * dependent picklist wiped on mount, before any interaction, while the field
 * rendered "select Country first" beside it.
 *
 * Ruling (#4247): **gated means UNKNOWN, not invalid.** Missing information is
 * not a reason to destroy stored data. Convergence stays where ADR-0058 put it:
 * once the parent IS chosen and the resolved set genuinely excludes the value,
 * the prune applies — pinned as the control below.
 *
 * This is the FORM host of the same defect pinned per-widget in
 * `@object-ui/fields` (`optionWidgets.gatedOptions.test.tsx`). The two clears
 * are independent code paths reading the same resolver, so both are pinned:
 * these components tests never load the fields package, so nothing but
 * `form.tsx`'s own effect can move the value here.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010.
import '../../../renderers';

function renderForm(schema: Record<string, unknown>) {
  const Form = ComponentRegistry.get('form')!;
  return render(<Form schema={{ type: 'form', submitLabel: 'Save', ...schema }} />);
}

const PROVINCE_OPTIONS = [
  { label: 'Zhejiang', value: 'zj', visibleWhen: "record.country == 'cn'" },
  { label: 'California', value: 'ca', visibleWhen: "record.country == 'us'" },
];

const FIELDS = [
  { name: 'country', label: 'Country', type: 'input' },
  {
    name: 'province',
    label: 'Province',
    type: 'select',
    dependsOn: 'country',
    options: PROVINCE_OPTIONS,
  },
  {
    name: 'provinces',
    label: 'Provinces',
    type: 'multiselect',
    dependsOn: 'country',
    options: PROVINCE_OPTIONS,
  },
];

async function submitAndRead(onSubmit: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0][0] as Record<string, unknown>;
}

describe('form renderer — a GATED option list keeps the stored value (#4247)', () => {
  it('submits the record it was given when the controlling field arrives empty', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: FIELDS,
      defaultValues: { country: '', province: 'zj', provinces: ['zj'] },
      onSubmit,
    });

    // The gate is up: the form is telling the user it cannot offer anything.
    expect(screen.getAllByText(/select country first/i).length).toBeGreaterThan(0);

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBe('zj');
    expect(payload.provinces).toEqual(['zj']);
  });
});

describe('control — a RESOLVED list still prunes what it does not offer (ADR-0058)', () => {
  it('clears the values the chosen parent excludes', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: FIELDS,
      // Parent IS chosen, and `ca` is a US province — genuinely excluded.
      defaultValues: { country: 'cn', province: 'ca', provinces: ['ca'] },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBeNull();
    expect(payload.provinces).toEqual([]);
  });

  it('keeps the values the chosen parent still offers', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: FIELDS,
      defaultValues: { country: 'cn', province: 'zj', provinces: ['zj'] },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBe('zj');
    expect(payload.provinces).toEqual(['zj']);
  });
});

describe('transition — the gate lifting is what converges the value (#4247)', () => {
  it('prunes only once the user picks a parent that excludes the stored value', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: FIELDS,
      defaultValues: { country: '', province: 'zj', provinces: ['zj'] },
      onSubmit,
    });

    // Gated on mount — nothing staged yet.
    expect(screen.getAllByText(/select country first/i).length).toBeGreaterThan(0);

    // The user picks a country whose list does NOT contain the stored value.
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'us' } });
    await waitFor(() =>
      expect(screen.queryAllByText(/select country first/i)).toHaveLength(0),
    );

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBeNull();
    expect(payload.provinces).toEqual([]);
  });
});
