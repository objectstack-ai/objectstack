/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * New `defaultValues` must be applied in the SAME commit that renders them —
 * never a commit later (#2982).
 *
 * The form applies a `defaultValues` change by resetting react-hook-form to it.
 * While that ran in a PASSIVE effect there was a window: the render had already
 * committed, so the inputs were mounted and interactive, but the form still
 * held the old record. A value typed in that window was destroyed — the pending
 * `reset()` overwrote the whole record with `defaultValues`, dropping the field
 * the user had just filled, with no error and nothing in the payload.
 *
 * It surfaced as a flaky wizard test: a step transition changes `defaultValues`,
 * and `note` typed on the new step vanished from the create body. In a browser
 * it needs a busy main thread plus typing on the very first frame of the new
 * step — rare, but silent data loss when it hits.
 *
 * The test below constructs that window deterministically, without relying on
 * timing. React flushes passive effects in tree order, so a probe sibling
 * rendered BEFORE the form is guaranteed to run inside the window: its own
 * passive effect fires on the same commit that delivered the new defaults, but
 * strictly before the form's. Typing from there is therefore exactly the
 * hostile interleaving — a keystroke that beat the reset.
 *
 * With the reset in a layout effect it has already run by then and the typed
 * value survives; revert it to `React.useEffect` and this test fails every run.
 */
import { describe, it, expect } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`, which is why this carried a raised
// timeout. See object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

const FIELDS = [
  { name: 'name', label: 'Name', type: 'input' },
  { name: 'note', label: 'Note', type: 'input' },
];

type Record_ = Record<string, unknown>;
const getFormRenderer = () =>
  ComponentRegistry.get('form') as React.ComponentType<{ schema: Record_ }>;

describe('form — the defaultValues reset leaves no window open', () => {
  it('keeps a value typed in the same frame the new defaults commit', async () => {
    const Form = getFormRenderer();
    const submitted: Record_[] = [];
    let setDefaults!: (v: Record_) => void;

    // Fires on every commit, but only acts once armed. Rendered BEFORE <Form>,
    // so on the commit that delivers the new defaults this runs first — inside
    // the window, before the form's own effect.
    let armed = false;
    const TypeInsideTheWindow = () => {
      React.useEffect(() => {
        if (!armed) return;
        armed = false;
        const note = document.querySelector('input[name="note"]') as HTMLInputElement | null;
        if (note) fireEvent.change(note, { target: { value: 'hello' } });
      });
      return null;
    };

    const Host = () => {
      const [defaults, setD] = React.useState<Record<string, unknown>>({});
      setDefaults = setD;
      return (
        <>
          <TypeInsideTheWindow />
          <Form
            schema={{
              type: 'form',
              fields: FIELDS,
              defaultValues: defaults,
              showSubmit: false,
              onSubmit: (d: Record_) => { submitted.push(d); },
            }}
          />
        </>
      );
    };

    const { container } = render(<Host />);
    await waitFor(() => {
      if (!container.querySelector('input[name="note"]')) throw new Error('not ready');
    });
    await act(async () => {});

    // Commit a new `defaultValues` — what a wizard step transition does. The
    // armed probe types into `note` from within the resulting effect flush.
    armed = true;
    await act(async () => { setDefaults({ name: 'Alice' }); });

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    await waitFor(() => expect(submitted.length).toBe(1));
    // With a passive reset this is `{ name: 'Alice' }` — `note` silently gone.
    expect(submitted[0]).toEqual(expect.objectContaining({ name: 'Alice', note: 'hello' }));
  });

  it('still applies defaults that arrive late (edit-mode record landing)', async () => {
    const Form = getFormRenderer();
    let setDefaults!: (v: Record_) => void;

    const Host = () => {
      const [defaults, setD] = React.useState<Record_>({});
      setDefaults = setD;
      return (
        <Form
          schema={{ type: 'form', fields: FIELDS, defaultValues: defaults, showSubmit: false }}
        />
      );
    };

    const { container } = render(<Host />);
    await waitFor(() => {
      if (!container.querySelector('input[name="name"]')) throw new Error('not ready');
    });

    // The record finishes loading well after first paint — the form must adopt it.
    await act(async () => { setDefaults({ name: 'Loaded', note: 'from server' }); });

    await waitFor(() => {
      const name = container.querySelector('input[name="name"]') as HTMLInputElement;
      const note = container.querySelector('input[name="note"]') as HTMLInputElement;
      expect(name.value).toBe('Loaded');
      expect(note.value).toBe('from server');
    });
  });
});
