/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `FormSchema.onChange` must actually fire (#4259).
 *
 * It is one of four lifecycle callbacks the schema declares and the renderer
 * destructures together — `onSubmit`, `onChange`, `onDirtyChange`, `onCancel`.
 * Three were wired; `onChange` was destructured and then never referenced
 * again, so a consumer handed a typed, exported, autocompleted callback got a
 * silent no-op: no warning, no dev notice, no type error. Ruled 2026-08-17:
 * wire it, using the same subscription plumbing `onDirtyChange` proves exists
 * beside it. The pin has two halves and this file delivers both, plus the
 * ordering property the layout phase exists to protect.
 *
 *   1. POSITIVE — an authored `onChange` fires on a value change and receives
 *      the FORM VALUES, not a DOM event. (A `onChange` reaching the <form>
 *      element instead would fire with a SyntheticEvent; that is a different
 *      contract, and the top-level props strip keeps it off the DOM node.)
 *   2. NEGATIVE — absence of `onChange` changes nothing, made observable
 *      rather than asserted: a schema that authors no `onChange` must
 *      establish NO subscription at all. The subscription is guarded (like
 *      `onAction`) precisely so this stays literally true; watching
 *      unconditionally (like `onDirtyChange`) would add a third `form.watch`
 *      to every form in the product on behalf of callers who asked for
 *      nothing. The probe below counts `form.watch(fn)` calls so the guard
 *      cannot be dropped without turning this red.
 *   3. RESET ORDERING — a `defaultValues` reset (a record landing in edit
 *      mode) is not reported to `onChange` as a user edit. This is what the
 *      LAYOUT phase buys: React runs every layout destroy before any layout
 *      create, so a caller passing a fresh inline arrow each render — the
 *      common case — has the subscription torn down before the reset and
 *      re-established after. Move the effect to `React.useEffect` and the
 *      order inverts: a landing record looks like the user editing every
 *      field it filled (#2968). Pinned here, or the next refactor takes it
 *      away silently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { ComponentRegistry } from '@object-ui/core';
// Registers the renderers at module scope, NOT inside a `beforeAll` — there the
// cold transform is billed to `hookTimeout`. See
// object-ui/no-dynamic-import-in-test-hook (objectui#3010/#3021).
import '../../../renderers';

// Counts value-subscription establishment: every `form.watch(callback)` on the
// form instance this renderer creates. `useForm` returns one stable object per
// form (RHF keeps it in a ref), so the patch below applies exactly once per
// form and does not perturb the `[form, onChangeProp]` effect deps it is there
// to observe. `watch()` with no callback (the render-time read) is not a
// subscription of this kind and is not counted.
const watchProbe = vi.hoisted(() => ({ subscribeCalls: 0 }));

vi.mock('react-hook-form', async () => {
  const actual = await vi.importActual<typeof import('react-hook-form')>('react-hook-form');
  return {
    ...actual,
    useForm: (...args: unknown[]) => {
      const form = (actual.useForm as (...a: unknown[]) => Record<string, any>)(...args);
      if (!form.__osWatchProbed) {
        form.__osWatchProbed = true;
        const realWatch = form.watch.bind(form);
        form.watch = (...watchArgs: unknown[]) => {
          if (typeof watchArgs[0] === 'function') watchProbe.subscribeCalls += 1;
          return realWatch(...watchArgs);
        };
      }
      return form;
    },
  };
});

const FIELDS = [
  { name: 'name', label: 'Name', type: 'input' },
  { name: 'note', label: 'Note', type: 'input' },
];

type Record_ = Record<string, unknown>;
const getFormRenderer = () =>
  ComponentRegistry.get('form') as React.ComponentType<{ schema: Record_ }>;

const nameInput = (root: ParentNode) =>
  root.querySelector('input[name="name"]') as HTMLInputElement | null;

beforeEach(() => {
  watchProbe.subscribeCalls = 0;
});

describe('form — FormSchema.onChange is honoured', () => {
  it('calls an authored onChange with the form values on a value change', async () => {
    const Form = getFormRenderer();
    const received: unknown[] = [];
    const onChange = (values: unknown) => { received.push(values); };

    const { container } = render(
      <Form
        schema={{ type: 'form', fields: FIELDS, showSubmit: false, onChange }}
      />,
    );
    await waitFor(() => {
      if (!nameInput(container)) throw new Error('not ready');
    });
    received.length = 0;

    fireEvent.change(nameInput(container)!, { target: { value: 'Alice' } });

    // Pre-fix this never fires at all — `onChangeProp` was destructured and
    // dropped on the floor.
    await waitFor(() => expect(received.length).toBeGreaterThan(0));

    // Assert on a VALUE, not on a call count: the declared contract is
    // `(data: Record<string, any>) => void`, so the callback has to be handed
    // the form values.
    const last = received[received.length - 1] as Record_;
    expect(last).toEqual(expect.objectContaining({ name: 'Alice' }));

    // ...and specifically NOT a DOM event, which is what a top-level `onChange`
    // landing on the <form> element would have delivered.
    expect(last).not.toHaveProperty('nativeEvent');
    expect(last).not.toHaveProperty('target');
    expect(typeof (last as { preventDefault?: unknown }).preventDefault).not.toBe('function');

    // A second edit keeps reporting live values — this is a channel, not a
    // one-shot.
    fireEvent.change(nameInput(container)!, { target: { value: 'Bob' } });
    await waitFor(() =>
      expect(received[received.length - 1]).toEqual(expect.objectContaining({ name: 'Bob' })),
    );
  });

  it('establishes no extra subscription when the schema authors no onChange', async () => {
    const Form = getFormRenderer();

    // Case A — no lifecycle callback authored at all.
    watchProbe.subscribeCalls = 0;
    const a = render(
      <Form schema={{ type: 'form', fields: FIELDS, showSubmit: false }} />,
    );
    await waitFor(() => {
      if (!nameInput(a.container)) throw new Error('not ready');
    });
    const withoutOnChange = watchProbe.subscribeCalls;
    a.unmount();

    // Case B — byte-identical schema plus an authored `onChange`.
    watchProbe.subscribeCalls = 0;
    const onChange = vi.fn();
    const b = render(
      <Form schema={{ type: 'form', fields: FIELDS, showSubmit: false, onChange }} />,
    );
    await waitFor(() => {
      if (!nameInput(b.container)) throw new Error('not ready');
    });
    const withOnChange = watchProbe.subscribeCalls;
    b.unmount();

    // The load-bearing assertion: authoring `onChange` costs exactly one
    // subscription, and authoring nothing costs none. Drop the `if
    // (onChangeProp)` guard and both counts become equal — this goes red.
    expect(withOnChange).toBe(withoutOnChange + 1);

    // Deliberate ratchet on the absolute number: a callback-free form
    // establishes exactly ONE value subscription — the pre-existing
    // unconditional `onDirtyChange` watcher. If a later change adds another
    // unconditional `form.watch`, this is the line that says so.
    expect(withoutOnChange).toBe(1);
  });

  it('leaves a form without onChange behaving identically', async () => {
    const Form = getFormRenderer();
    const submitted: Record_[] = [];

    const { container } = render(
      <Form
        schema={{
          type: 'form',
          fields: FIELDS,
          defaultValues: { name: 'seed' },
          showSubmit: false,
          onSubmit: (d: Record_) => { submitted.push(d); },
        }}
      />,
    );
    await waitFor(() => {
      if (!nameInput(container)) throw new Error('not ready');
    });

    // Typing, the seeded default and submission all still work with no
    // `onChange` in the schema — wiring the callback is additive.
    expect(nameInput(container)!.value).toBe('seed');
    fireEvent.change(nameInput(container)!, { target: { value: 'Alice' } });
    await waitFor(() => expect(nameInput(container)!.value).toBe('Alice'));

    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(submitted.length).toBe(1));
    expect(submitted[0]).toEqual(expect.objectContaining({ name: 'Alice' }));
  });

  it('does not report a defaultValues reset to onChange as a user edit', async () => {
    const Form = getFormRenderer();
    const received: Record_[] = [];
    let setDefaults!: (v: Record_) => void;

    const Host = () => {
      const [defaults, setD] = React.useState<Record_>({});
      setDefaults = setD;
      return (
        <Form
          schema={{
            type: 'form',
            fields: FIELDS,
            defaultValues: defaults,
            showSubmit: false,
            // A FRESH inline arrow each render — the common caller shape, and
            // the one the layout phase is written for. Its changing identity
            // re-runs the effect, so the subscription is torn down (layout
            // destroy) before the reset (layout create) and re-established
            // after it.
            onChange: (values: Record_) => { received.push(values); },
          }}
        />
      );
    };

    const { container } = render(<Host />);
    await waitFor(() => {
      if (!nameInput(container)) throw new Error('not ready');
    });
    await act(async () => {});
    received.length = 0;

    // The record finishes loading after first paint and the form resets to it.
    // That is the host's own data arriving, not the user typing.
    await act(async () => { setDefaults({ name: 'Loaded', note: 'from server' }); });

    // The reset must not come back to the host as an edit.
    expect(
      received.some(
        (v) => v && (v as Record_).name === 'Loaded' && (v as Record_).note === 'from server',
      ),
    ).toBe(false);

    // The reset itself still happened — this test pins the ordering, not the
    // absence of the reset.
    await waitFor(() => expect(nameInput(container)!.value).toBe('Loaded'));

    // ...and the channel is still live afterwards: a real user edit that
    // follows the reset IS reported.
    fireEvent.change(nameInput(container)!, { target: { value: 'Edited' } });
    await waitFor(() =>
      expect(received[received.length - 1]).toEqual(expect.objectContaining({ name: 'Edited' })),
    );
  });
});
