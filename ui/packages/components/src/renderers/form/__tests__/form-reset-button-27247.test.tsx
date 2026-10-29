/**
 * The `form` renderer's Reset button (objectstack#27247): `showReset` draws it
 * in the action bar, `resetLabel` names it, and pressing it — or any reset
 * button naming the form by `id` from outside it — restores the values the
 * form opened with, without a submit.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
// Module-scope import (not `beforeAll`) — objectui#3010/#3021.
import '../../../renderers';

type Rec = Record<string, unknown>;

function renderForm(schema: Rec, after?: React.ReactNode) {
  const Form = ComponentRegistry.get('form')!;
  return render(
    <>
      <Form
        schema={{
          type: 'form',
          fields: [{ name: 'title', label: 'Title', type: 'input' }],
          defaultValues: { title: 'Opening' },
          ...schema,
        }}
      />
      {after}
    </>,
  );
}

const titleInput = () => screen.getByLabelText('Title') as HTMLInputElement;

describe('form renderer — showReset (objectstack#27247)', () => {
  afterEach(cleanup);

  it('draws no Reset button unless showReset is set', () => {
    const { container } = renderForm({});
    expect(container.querySelector('button[type="reset"]')).toBeNull();
  });

  it('restores the opening values and submits nothing', async () => {
    const onSubmit = vi.fn();
    renderForm({ showReset: true, resetLabel: 'Start over', onSubmit });
    fireEvent.change(titleInput(), { target: { value: 'Edited' } });
    expect(titleInput().value).toBe('Edited');

    fireEvent.click(screen.getByRole('button', { name: 'Start over' }));

    await waitFor(() => expect(titleInput().value).toBe('Opening'));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a reset button outside the form reaches it through the form id', async () => {
    renderForm(
      { id: 'f-27247', showActions: false },
      <button type="reset" form="f-27247">Outside</button>,
    );
    fireEvent.change(titleInput(), { target: { value: 'Edited' } });
    fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => expect(titleInput().value).toBe('Opening'));
  });
});
