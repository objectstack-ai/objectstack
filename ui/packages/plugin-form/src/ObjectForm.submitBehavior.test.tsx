/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * Declarative `submitBehavior` handling for metadata-only (non-wizard) forms —
 * mirrors WizardForm.successBehavior.test.tsx for the flat ObjectForm path.
 *
 * ## The `object-form.submitBehavior` MEMBER pin (objectui#8071)
 *
 * This file is objectui#8071's registered member pin for `object-form` ·
 * `submitBehavior`, and the rows below are what makes it one rather than a
 * restatement of the registration. The key is declared `{ type: 'object' }`
 * with the four `kind` arms in its description and `SubmitBehavior` types them
 * as a discriminated union — so what parses is settled, and what the RENDERER
 * READS off each arm is not. `ObjectForm.tsx`'s `switch (behavior.kind)` is the
 * read site, and every member it touches is touched ONCE there:
 * `url` and `delayMs ?? 0` on `redirect`, `title` and `message` on `thank-you`
 * (both guarded on `kind === 'thank-you'`, so no other arm can reach them), and
 * nothing at all on `continue` or `next-record`.
 *
 * Two arms of that read had no assertion anywhere until objectui#8071 added the
 * rows at the bottom of this file, and each is a way the key silently stops
 * working:
 *
 *   - **`delayMs` is a MEMBER, not a constant.** The arm spells it
 *     `behavior.delayMs ?? 0`. Collapsing that to `0` — the shape the
 *     declaration cannot distinguish, since an unset delay already means "go
 *     now" — takes away the readable pause without changing any destination,
 *     so every other row in this file and in `ObjectForm.submitRedirect.test.tsx`
 *     stays green. It is pinned on the number handed to `setTimeout`, with the
 *     same schema minus the member as the control.
 *   - **`next-record` is a declared arm that reads NO members.** It shares the
 *     confirmation-panel body with `thank-you` by falling through to it, so an
 *     edit that gave it its own arm, or dropped it into `continue`'s no-op,
 *     would leave a spec-legal authored value doing something else entirely
 *     with nothing red.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock('@object-ui/components', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, toast: { ...actual.toast, success: toastSuccess, error: vi.fn() } };
});

import { ObjectForm } from './ObjectForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

const objectSchema = {
  name: 'o',
  fields: { name: { type: 'text', label: 'Name' } },
};
const makeDS = () => ({
  getObjectSchema: vi.fn().mockResolvedValue(objectSchema),
  create: vi.fn(async (_o: string, d: any) => ({ id: 'r1', ...d })),
  update: vi.fn(),
  findOne: vi.fn(),
});
const waitInput = (c: HTMLElement, name: string) =>
  waitFor(() => {
    const el = c.querySelector(`input[name="${name}"]`) as HTMLInputElement | null;
    if (!el) throw new Error(`${name} not ready`);
    return el;
  });

describe('ObjectForm — submitBehavior', () => {
  beforeEach(() => toastSuccess.mockClear());

  // The guard on this arm is no longer `isSameOriginUrl` — objectui#4989 moved it
  // to the spec's own relative-only verdict (`submitRedirect.ts`), which this
  // authored value satisfies either way. The contract-level cases live in
  // `ObjectForm.submitRedirect.test.tsx`; what this one still pins is that a
  // followed redirect does NOT also toast.
  it('redirect: navigates a ruled relative path, no toast', async () => {
    const assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{
          type: 'object-form', objectName: 'o', mode: 'create',
          submitBehavior: { kind: 'redirect', url: '/apps/x/done' },
        } as any}
        dataSource={ds as any}
      />,
    );
    fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
    expect(toastSuccess).not.toHaveBeenCalled();
    assign.mockRestore();
  });

  it('thank-you: toasts the custom message', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{
          type: 'object-form', objectName: 'o', mode: 'create',
          submitBehavior: { kind: 'thank-you', message: 'All set!' },
        } as any}
        dataSource={ds as any}
      />,
    );
    fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('All set!'));
  });

  it('thank-you: replaces the filled form with a confirmation panel — no way to resubmit', async () => {
    const ds = makeDS();
    const { container, getByText } = render(
      <ObjectForm
        schema={{
          type: 'object-form', objectName: 'o', mode: 'create',
          submitBehavior: { kind: 'thank-you', title: 'Created', message: 'All set!' },
        } as any}
        dataSource={ds as any}
      />,
    );
    fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getByText('Created')).toBeTruthy());
    // The form (with its submit button) is gone — previously it stayed
    // mounted and fully filled, so a second click created a duplicate record.
    expect(container.querySelector('input[name="name"]')).toBeNull();
    expect(container.querySelector('form')).toBeNull();
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('continue: resets the form for another entry', async () => {
    const ds = makeDS();
    const { container } = render(
      <ObjectForm
        schema={{
          type: 'object-form', objectName: 'o', mode: 'create',
          submitBehavior: { kind: 'continue' },
        } as any}
        dataSource={ds as any}
      />,
    );
    fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const el = container.querySelector('input[name="name"]') as HTMLInputElement | null;
      if (!el) throw new Error('form gone');
      expect(el.value).toBe('');
    });
  });

});

/**
 * The two arms of the `submitBehavior` member read that nothing else asserts —
 * objectui#8071's member pin for `object-form.submitBehavior`. Kept in their own
 * describe because the `delayMs` row installs a pass-through `setTimeout` spy,
 * which the rows above neither need nor should run under.
 */
describe('ObjectForm — submitBehavior member shape (objectui#8071)', () => {
  /**
   * Distinctive enough that the pass-through spy can pick this form's own timer
   * out of the ones React and the testing library schedule — the same device
   * `submitRedirect.timerLifetime.test.tsx` uses, and for the same reason: the
   * submit path is a chain of awaited promises, so faking the clock around it
   * measures the resolution race rather than the declared delay.
   */
  const DELAY_MS = 241;

  const realSetTimeout = globalThis.setTimeout;
  let armed: number[];
  let setTimeoutSpy: ReturnType<typeof vi.spyOn>;
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    armed = [];
    toastSuccess.mockClear();
    assign = vi.spyOn(window.location, 'assign').mockImplementation(() => {});
    setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
      cb: any,
      ms?: number,
      ...rest: any[]
    ) => {
      if (ms === DELAY_MS) armed.push(ms);
      return (realSetTimeout as any)(cb, ms, ...rest);
    }) as any);
  });

  afterEach(() => {
    setTimeoutSpy.mockRestore();
    assign.mockRestore();
  });

  /** Submit a create form carrying `behavior`, and hand back its container. */
  async function submitWith(behavior: Record<string, unknown>) {
    const ds = makeDS();
    const { container, queryByText } = render(
      <ObjectForm
        schema={{
          type: 'object-form', objectName: 'o', mode: 'create',
          ...behavior,
        } as any}
        dataSource={ds as any}
      />,
    );
    fireEvent.change(await waitInput(container, 'name'), { target: { value: 'Alpha' } });
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
    return { container, queryByText, ds };
  }

  it('redirect: the declared `delayMs` is the number the wait is armed with, and the trip still happens', async () => {
    await submitWith({ submitBehavior: { kind: 'redirect', url: '/apps/x/done', delayMs: DELAY_MS } });
    await waitFor(() => expect(armed).toEqual([DELAY_MS]));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
  });

  it('redirect: control — the SAME declaration without `delayMs` arms no such wait, and still travels', async () => {
    // The lit half of the row above. Without it, `armed` staying empty would be
    // indistinguishable from a spy that never sees this renderer's timers at
    // all, and `delayMs ?? 0` collapsed to a bare `0` would read as pinned.
    await submitWith({ submitBehavior: { kind: 'redirect', url: '/apps/x/done' } });
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
    expect(armed).toEqual([]);
  });

  it('next-record: the fourth declared arm reaches the confirmation panel and reads no members of its own', async () => {
    const { container, queryByText } = await submitWith({
      submitBehavior: { kind: 'next-record' },
      successMessage: 'Saved — next one',
    });
    // The arm carries no `message`/`title` of its own, so the confirmation text
    // is the form's `successMessage`. A `next-record` routed into `continue`'s
    // no-op would leave the filled form mounted and toast nothing.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved — next one'));
    await waitFor(() => expect(queryByText('Saved — next one')).toBeTruthy());
    expect(container.querySelector('form')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
  });
});
