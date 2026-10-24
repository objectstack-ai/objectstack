/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A form never ends on a screen that asserts BOTH outcomes (objectui#7252).
 *
 * ## The reported flow, and where the two toasts actually come from
 *
 * Showcase -> Workspace -> New Project (wizard): the last step's Create was
 * refused (400 `VALIDATION_FAILED`, "Invalid project status transition."), the
 * user went back a step, changed the status, hit Create again and got a 201 —
 * and the refusal was STILL on screen beside the success.
 *
 * The two toasts are raised by two different modules, which is why neither
 * could supersede the other on its own:
 *
 *  - the REFUSAL comes from the step form renderer, `@object-ui/components`'s
 *    `renderers/form/form.tsx`. `WizardForm` hands it `onSubmit:
 *    handleStepSubmit`; that handler rethrows a rejected write after calling
 *    `schema.onError`, so the rejection surfaces in the renderer's own catch,
 *    which sets the in-form banner AND toasts;
 *  - the SUCCESS comes from `WizardForm` itself (`toast.success(successMessage
 *    || 'Created')`).
 *
 * ## What was actually measured, not assumed
 *
 * The refusal toast is NOT sticky by configuration. `ConsoleToaster` sets
 * `toastOptions.duration: 4000` for every severity, `@object-ui/components`'
 * own `Toaster` sets none (sonner's default `TOAST_LIFETIME` is also 4000), and
 * `duration: Infinity` appears nowhere on any form path in this repo. So the
 * durations are left exactly as they are here: the defect this file pins is
 * SUPERSESSION, and it is reproducible inside any lifetime — the two toasts are
 * simply unrelated, so nothing retires the first when the second arrives.
 *
 * ## Why the pin models sonner rather than counting calls
 *
 * Asserting `toast.error` was called and `toast.success` was called says
 * nothing about what is on SCREEN — that is exactly the reading under which the
 * defect looks fine. So the module is replaced by a registry modelling the one
 * sonner behaviour the fix relies on: a toast raised under an id the registry
 * already holds REPLACES that entry, and `dismiss(id)` removes exactly that
 * one. The assertion is then the card's own sentence — what remains on screen.
 *
 * ⚠️ The mock target is `@object-ui/components/ui/sonner`, NOT bare `'sonner'`.
 * That wrapper is the single module BOTH raisers reach — the renderer imports
 * it as `../../ui/sonner`, and the `toast` `WizardForm` pulls from
 * `@object-ui/components` is this module's re-export — and it is the only one
 * of the two spellings that resolves from here: `plugin-form` does not depend
 * on `sonner`, so `vi.mock('sonner')` in this package registers against an id
 * nothing resolves to and intercepts NOTHING (measured: the run went red with
 * an EMPTY registry while the in-form banner rendered the refusal, i.e. the
 * real sonner had taken both toasts). A green run here is therefore also the
 * proof that the mock is in the graph at all.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

type ToastEntry = { type: string; message: string };

const { toastRegistry, fakeToast } = vi.hoisted(() => {
  const toastRegistry = new Map<string | number, { type: string; message: string }>();
  let auto = 0;
  const raise =
    (type: string) =>
    (message: unknown, options?: { id?: string | number }) => {
      // No id supplied is sonner's auto-id: a NEW toast every time, which is
      // precisely the pre-fix behaviour that let two outcomes coexist.
      const id = options?.id ?? `auto:${(auto += 1)}`;
      toastRegistry.set(id, { type, message: String(message) });
      return id;
    };
  const fakeToast: any = Object.assign(raise('message'), {
    success: raise('success'),
    error: raise('error'),
    info: raise('info'),
    warning: raise('warning'),
    loading: raise('loading'),
    custom: raise('custom'),
    promise: (p: unknown) => p,
    dismiss: (id?: string | number) => {
      if (id === undefined) toastRegistry.clear();
      else toastRegistry.delete(id);
      return id;
    },
  });
  return { toastRegistry, fakeToast };
});

vi.mock('@object-ui/components/ui/sonner', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: fakeToast };
});

import { registerAllFields } from '@object-ui/fields';
import { WizardForm } from './WizardForm';

registerAllFields();

const REFUSAL = 'Invalid project status transition.';
const SUCCESS = 'Your new project is ready.';

const objectSchema = {
  name: 'showcase_project',
  fields: {
    name: { type: 'text', label: 'Name' },
    status: { type: 'text', label: 'Status' },
  },
};

/** Refuses the first create the way the server did, accepts the second. */
const makeDataSource = () => {
  let creates = 0;
  return {
    getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
    create: vi.fn(async (_object: string, data: Record<string, unknown>) => {
      creates += 1;
      if (creates === 1) {
        throw Object.assign(new Error(REFUSAL), { status: 400, code: 'VALIDATION_FAILED' });
      }
      return { id: 'proj-1', ...data };
    }),
    update: vi.fn(),
    findOne: vi.fn(),
  };
};

const wizard = (dataSource: any) =>
  render(
    <WizardForm
      schema={
        {
          type: 'object-form',
          formType: 'wizard',
          objectName: 'showcase_project',
          mode: 'create',
          successMessage: SUCCESS,
          sections: [
            { label: 'Basics', fields: ['name'] },
            { label: 'Status', fields: ['status'] },
          ],
        } as any
      }
      dataSource={dataSource as any}
    />,
  );

const inputNamed = (container: HTMLElement, name: string) =>
  waitFor(() => {
    const el = container.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`input ${name} not ready`);
    return el;
  });

const submitStep = (container: HTMLElement) =>
  fireEvent.submit(container.querySelector('form') as HTMLFormElement);

/** What the user can actually see, in the order sonner holds it. */
const onScreen = (): ToastEntry[] => [...toastRegistry.values()];

beforeEach(() => {
  toastRegistry.clear();
});

afterEach(() => {
  cleanup();
});

describe('WizardForm — a later outcome supersedes this form’s earlier one', () => {
  it('leaves only the success toast after a refused submit is retried and accepted', async () => {
    const ds = makeDataSource();
    const { container } = wizard(ds);

    // Step 1 -> Step 2.
    fireEvent.change(await inputNamed(container, 'name'), { target: { value: 'Apollo' } });
    submitStep(container);

    // Step 2: Create, refused.
    fireEvent.change(await inputNamed(container, 'status'), { target: { value: 'archived' } });
    submitStep(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onScreen()).toEqual([{ type: 'error', message: REFUSAL }]));

    // Back to step 2 of the reported flow, change the status, and Create again.
    // The navigation matters: it is what proves the id survives step changes —
    // the renderer instance is reused across steps, so the attempt that
    // succeeds is the one that must retire the refusal.
    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    await inputNamed(container, 'name');
    submitStep(container);
    fireEvent.change(await inputNamed(container, 'status'), { target: { value: 'active' } });
    submitStep(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(2));

    // The card's own sentence: one form, one outcome on screen.
    await waitFor(() => expect(onScreen()).toEqual([{ type: 'success', message: SUCCESS }]));
  });

  it('does not stack a second refusal when the retry is refused too', async () => {
    const ds = makeDataSource();
    // Refuse every attempt this time.
    ds.create = vi.fn(async () => {
      throw Object.assign(new Error(REFUSAL), { status: 400, code: 'VALIDATION_FAILED' });
    });
    const { container } = wizard(ds);

    fireEvent.change(await inputNamed(container, 'name'), { target: { value: 'Apollo' } });
    submitStep(container);
    fireEvent.change(await inputNamed(container, 'status'), { target: { value: 'archived' } });

    submitStep(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onScreen()).toHaveLength(1));

    submitStep(container);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onScreen()).toEqual([{ type: 'error', message: REFUSAL }]));
  });
});
