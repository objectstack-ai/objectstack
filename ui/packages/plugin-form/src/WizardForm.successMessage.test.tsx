/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * A metadata-only wizard cannot pass an `onSuccess` function, so it can now
 * declare a `successMessage` for the post-create toast. Verify it's honored.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: vi.fn() } };
});

import { WizardForm } from './WizardForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const objectSchema = { name: 'o', fields: { name: { type: 'text', label: 'Name' } } };
const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: '1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});

describe('WizardForm — declarative successMessage', () => {
  it('toasts the configured successMessage on create (no onSuccess function)', async () => {
    toastSuccess.mockClear();
    const ds = makeDS();
    const schema = {
      type: 'object-form', formType: 'wizard', objectName: 'o', mode: 'create',
      successMessage: 'Project created',
      sections: [{ label: 'A', fields: ['name'] }],
    };
    const { container } = render(<WizardForm schema={schema as any} dataSource={ds as any} />);
    const input = await waitFor(() => {
      const el = container.querySelector('input[name="name"]') as HTMLInputElement | null;
      if (!el) throw new Error('input not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement); // single step → create
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Project created'));
  });

  it('falls back to a default message when none configured', async () => {
    toastSuccess.mockClear();
    const ds = makeDS();
    const schema = {
      type: 'object-form', formType: 'wizard', objectName: 'o', mode: 'create',
      sections: [{ label: 'A', fields: ['name'] }],
    };
    const { container } = render(<WizardForm schema={schema as any} dataSource={ds as any} />);
    const input = await waitFor(() => {
      const el = container.querySelector('input[name="name"]') as HTMLInputElement | null;
      if (!el) throw new Error('input not ready');
      return el;
    });
    fireEvent.change(input, { target: { value: 'Beta' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Created'));
  });
});
