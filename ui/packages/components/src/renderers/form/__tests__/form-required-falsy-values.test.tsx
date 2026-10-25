/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `required` is a PRESENCE contract, not a truthiness one.
 *
 * `@objectstack/spec` FieldSchema.required (ADR-0113) reads "an insert must
 * provide a NON-NULL value", and the server's record validator implements
 * exactly that — `isMissing` is `undefined | null | blank string`, nothing
 * else. `false` and `0` are values.
 *
 * react-hook-form's built-in `required` rule disagrees on one point: it fails
 * whenever the value `isBoolean(v) && !v`, i.e. it reads every boolean field
 * as "must be checked" (its accept-the-terms checkbox heritage). Handing a
 * required boolean field to that rule turns `required` into `must be true`,
 * and the only value the control can express by default becomes unsubmittable
 * — an AI-built task tracker literally could not create an UNFINISHED task
 * (cloud#972).
 *
 * These tests pin the client verdict to the server's for every falsy value:
 * `false` and `0` pass, `null` / `undefined` / `''` still fail.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import '../../../renderers';

beforeEach(() => {
  if (!(Element.prototype as any).scrollIntoView) {
    (Element.prototype as any).scrollIntoView = () => {};
  }
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderForm(
  fields: any[],
  defaultValues: Record<string, unknown>,
  onSubmit: (data: any) => Promise<unknown> | unknown,
) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <Form
      schema={{
        type: 'form',
        mode: 'create',
        showSubmit: true,
        showCancel: false,
        submitLabel: 'Create',
        defaultValues,
        fields,
        onSubmit,
      }}
    />,
  );
}

const submit = () => fireEvent.click(screen.getByRole('button', { name: /create/i }));

describe('form renderer — required + falsy values', () => {
  it('accepts an unchecked required switch (cloud#972: "未完成" must be creatable)', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'title', label: 'Title', type: 'input', required: true },
        { name: 'is_done', label: 'Done', type: 'switch', required: true },
      ],
      { title: 'Write the report', is_done: false },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ title: 'Write the report', is_done: false });
    expect(screen.queryByText(/is required/i)).toBeNull();
  });

  it('accepts an unchecked required checkbox', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [{ name: 'agreed', label: 'Agreed', type: 'checkbox', required: true }],
      { agreed: false },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ agreed: false });
  });

  it('accepts a required select whose chosen option value is boolean false', async () => {
    // Option values round-trip TYPED (#3090), so a 是/否 picklist hands the form
    // a real `false` — the same RHF branch that breaks the switch.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        {
          name: 'billable',
          label: 'Billable',
          type: 'select',
          required: true,
          options: [
            { label: 'Yes', value: true },
            { label: 'No', value: false },
          ],
        },
      ],
      { billable: false },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ billable: false });
  });

  it('accepts a required number whose value is 0', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [{ name: 'hours', label: 'Hours', type: 'number', required: true }],
      { hours: 0 },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ hours: 0 });
  });

  it('still rejects an empty string — the server counts blank text as missing', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [{ name: 'title', label: 'Title', type: 'input', required: true }],
      { title: '' },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(screen.getByText(/Title is required/i)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still rejects a whitespace-only string, as the server does', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [{ name: 'title', label: 'Title', type: 'input', required: true }],
      { title: '   ' },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(screen.getByText(/Title is required/i)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still rejects null and undefined', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'title', label: 'Title', type: 'input', required: true },
        { name: 'stage', label: 'Stage', type: 'input', required: true },
      ],
      { title: null, stage: undefined },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(screen.getByText(/Title is required/i)).toBeTruthy());
    expect(screen.getByText(/Stage is required/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('still rejects an empty multiselect array', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        {
          name: 'tags',
          label: 'Tags',
          type: 'multiselect',
          required: true,
          options: [{ label: 'A', value: 'a' }],
        },
      ],
      { tags: [] },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(screen.getByText(/Tags is required/i)).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a field-authored required message still wins over the generated one', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        {
          name: 'title',
          label: 'Title',
          type: 'input',
          required: true,
          validation: { required: 'Give the task a name' },
        },
      ],
      { title: '' },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(screen.getByText('Give the task a name')).toBeTruthy());
  });

  it('a field-authored validate rule still runs alongside the required check', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        {
          name: 'title',
          label: 'Title',
          type: 'input',
          required: true,
          validation: { validate: (v: unknown) => (String(v).startsWith('T') ? true : 'Must start with T') },
        },
      ],
      { title: 'nope' },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(screen.getByText('Must start with T')).toBeTruthy());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a field that is NOT required accepts every falsy value', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    renderForm(
      [
        { name: 'title', label: 'Title', type: 'input' },
        { name: 'is_done', label: 'Done', type: 'switch' },
      ],
      { title: '', is_done: false },
      onSubmit,
    );

    submit();

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });
});
