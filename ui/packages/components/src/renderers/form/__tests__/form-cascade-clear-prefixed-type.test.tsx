/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The form host's cascade clear recognises the PREFIXED widget id (objectui#4014).
 *
 * `field:select` and `select` name the same field kind: the object-form path
 * (`mapFieldTypeToFormType`) emits the prefixed id, hand-written SDUI schemas
 * the bare one. The cascade-clear effect (#2284) compared the RAW type string
 * against the bare-name set, so every option field coming from an OBJECT schema
 * fell out of the effect entirely — its parent could narrow the offered set and
 * the now-unoffered value was never dropped, so the form submitted exactly the
 * stale "china + california" pair the effect exists to prevent.
 *
 * This is a BEHAVIOUR CHANGE, not an equivalent refactor: the object-form path
 * gains cascade clearing for the first time. The pins below are therefore
 * written as POSITIVE assertions on the prefixed path (the parent narrows the
 * set → the stale value is gone from the payload), with the bare-name path kept
 * alongside as the unchanged control and a non-option field as the
 * fail-open control.
 *
 * Same normalization the render path applies for `isOptionField` (objectui#3231,
 * the first half of this family) — the two readers of "is this an option field?"
 * must agree.
 *
 * These components tests never load `@object-ui/fields`, so `field:select` does
 * not resolve to a registered widget here and renders through the fallback
 * branch. That is deliberate and sufficient: the effect under test reads the
 * FIELD CONFIG, not whatever component ends up rendering, and the submitted
 * payload is the fact the issue is about. Nothing but `form.tsx`'s own effect
 * can move a value in this environment.
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

/** What `mapFieldTypeToFormType` emits for an object schema's picklist fields. */
const PREFIXED_FIELDS = [
  { name: 'country', label: 'Country', type: 'input' },
  {
    name: 'province',
    label: 'Province',
    type: 'field:select',
    dependsOn: 'country',
    options: PROVINCE_OPTIONS,
  },
  {
    name: 'provinces',
    label: 'Provinces',
    type: 'field:multiselect',
    dependsOn: 'country',
    options: PROVINCE_OPTIONS,
  },
  {
    name: 'homeProvince',
    label: 'Home province',
    type: 'field:radio',
    dependsOn: 'country',
    options: PROVINCE_OPTIONS,
  },
  {
    name: 'visited',
    label: 'Visited',
    type: 'field:checkboxes',
    dependsOn: 'country',
    options: PROVINCE_OPTIONS,
  },
];

/** The hand-written-SDUI spelling of the same form — the unchanged control. */
const BARE_FIELDS = PREFIXED_FIELDS.map((f) =>
  typeof f.type === 'string' && f.type.startsWith('field:')
    ? { ...f, type: f.type.slice('field:'.length) }
    : f,
);

async function submitAndRead(onSubmit: ReturnType<typeof vi.fn>) {
  fireEvent.click(screen.getByRole('button', { name: /save/i }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
  return onSubmit.mock.calls[0][0] as Record<string, unknown>;
}

describe('form host cascade clear — prefixed widget ids are option fields too (#4014)', () => {
  it('drops the values the CHOSEN parent no longer offers', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: PREFIXED_FIELDS,
      // Parent IS chosen (so the list is resolved, not gated — #4247) and `ca`
      // is a US province, genuinely excluded by `country == 'cn'`.
      defaultValues: {
        country: 'cn',
        province: 'ca',
        provinces: ['ca'],
        homeProvince: 'ca',
        visited: ['ca'],
      },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBeNull();
    expect(payload.homeProvince).toBeNull();
    expect(payload.provinces).toEqual([]);
    expect(payload.visited).toEqual([]);
  });

  it('drops the stale value when the user NARROWS the set by changing the parent', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: PREFIXED_FIELDS,
      // Starts consistent: `zj` is offered while country is `cn`.
      defaultValues: {
        country: 'cn',
        province: 'zj',
        provinces: ['zj'],
        homeProvince: 'zj',
        visited: ['zj'],
      },
      onSubmit,
    });

    // The user switches the parent to one whose list excludes the stored value.
    fireEvent.change(screen.getByLabelText(/country/i), { target: { value: 'us' } });
    await waitFor(() =>
      expect((screen.getByLabelText(/country/i) as HTMLInputElement).value).toBe('us'),
    );

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBeNull();
    expect(payload.homeProvince).toBeNull();
    expect(payload.provinces).toEqual([]);
    expect(payload.visited).toEqual([]);
  });

  it('keeps the values the chosen parent still offers', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: PREFIXED_FIELDS,
      defaultValues: {
        country: 'cn',
        province: 'zj',
        provinces: ['zj'],
        homeProvince: 'zj',
        visited: ['zj'],
      },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBe('zj');
    expect(payload.homeProvince).toBe('zj');
    expect(payload.provinces).toEqual(['zj']);
    expect(payload.visited).toEqual(['zj']);
  });

  it('leaves a GATED prefixed list alone — gated is unknown, not invalid (#4247)', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: PREFIXED_FIELDS,
      // Controlling field arrives empty: the whole list is withheld, which says
      // nothing about the stored value. Reaching this effect at all is new for
      // the prefixed path, so the #4247 ruling is pinned here too.
      defaultValues: {
        country: '',
        province: 'zj',
        provinces: ['zj'],
        homeProvince: 'zj',
        visited: ['zj'],
      },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBe('zj');
    expect(payload.homeProvince).toBe('zj');
    expect(payload.provinces).toEqual(['zj']);
    expect(payload.visited).toEqual(['zj']);
  });
});

describe('control — the bare-name (hand-written SDUI) path is unchanged', () => {
  it('still drops the values the chosen parent no longer offers', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: BARE_FIELDS,
      defaultValues: {
        country: 'cn',
        province: 'ca',
        provinces: ['ca'],
        homeProvince: 'ca',
        visited: ['ca'],
      },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBeNull();
    expect(payload.homeProvince).toBeNull();
    expect(payload.provinces).toEqual([]);
    expect(payload.visited).toEqual([]);
  });

  it('still keeps the values the chosen parent offers', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: BARE_FIELDS,
      defaultValues: {
        country: 'cn',
        province: 'zj',
        provinces: ['zj'],
        homeProvince: 'zj',
        visited: ['zj'],
      },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.province).toBe('zj');
    expect(payload.provinces).toEqual(['zj']);
  });
});

describe('control — normalization does not widen the effect to non-option fields', () => {
  it('never touches a prefixed NON-option field that declares dependsOn', async () => {
    const onSubmit = vi.fn();
    renderForm({
      fields: [
        { name: 'country', label: 'Country', type: 'input' },
        {
          // A `field:`-prefixed type whose bare name is NOT in the cascade set.
          // Normalizing the comparison must not sweep it in: its value carries
          // no relation to the option list beside it.
          name: 'note',
          label: 'Note',
          type: 'field:text',
          dependsOn: 'country',
          options: PROVINCE_OPTIONS,
        },
      ],
      defaultValues: { country: 'cn', note: 'ca' },
      onSubmit,
    });

    const payload = await submitAndRead(onSubmit);
    expect(payload.note).toBe('ca');
  });
});
