/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5033 — the declared `submitBehavior: { kind: 'redirect' }` delay must
 * not outlive the component that armed it.
 *
 * Both rendered forms used to arm the wait with a bare `setTimeout` inside the
 * submit handler: the timer was not stored, not cleared, and owned by nobody. So
 * for the whole of `delayMs` there was a pending full-page navigation that
 * survived the form being taken off screen — a submitter who dismissed a
 * modal/drawer variant, clicked an in-app link, or whose host re-keyed the
 * subtree was pulled away from wherever they went. The wait now lives in an
 * effect keyed on the pending destination, so unmount cancels it.
 *
 * ## What each half measures, and why both are needed
 *
 * The unmount pin alone can pass for the WRONG reason: a form that never arms
 * the wait at all also assigns nothing after unmount. Two things stop that empty
 * pass from reading as a fix. Each unmount case first REQUIRES the wait to have
 * been armed (see below), so a form that arms nothing fails there rather than
 * sailing through to a satisfied `not.toHaveBeenCalled()`. And each is paired
 * with a same-schema case that does NOT unmount and asserts the destination IS
 * reached once the delay ends, so deleting the redirect outright is red too.
 *
 * ## Why a real clock, and how the arming is observed without racing it
 *
 * The submit path is a chain of awaited promises, so faking the clock around it
 * makes the observation race the resolution rather than the delay — the reason
 * the two component redirect files measure `delayMs` with real timers too. This
 * file keeps the real clock and instead makes ARMING observable: `setTimeout` is
 * wrapped by a pass-through spy that records calls carrying this file's
 * distinctive delay value. The unmount therefore provably happens AFTER the wait
 * was armed, which is the only ordering that can falsify anything.
 *
 * `delayMs` semantics are unchanged by this file's subject: an unset value still
 * means "go now" (a zero timer) and is covered by the `navigates to a ruled
 * relative path` cases in `ObjectForm.submitRedirect.test.tsx` /
 * `WizardForm.submitRedirect.test.tsx`. It is deliberately not raced against an
 * unmount here — there is no window to unmount inside of, and a test that tried
 * would measure scheduler luck.
 *
 * ## Counterfactuals (measured, see the PR for the run)
 *
 * 1. **Restore the bare in-handler `setTimeout`** (i.e. revert the fix): the two
 *    `assigns nothing after the form is unmounted` cases go red on
 *    `expect(assign).not.toHaveBeenCalled()`, having been handed the url by a
 *    timer that outlived the component.
 * 2. **Drop the `clearTimeout` from the effect cleanup**: same two cases, same
 *    assertion — the cleanup is the whole mechanism.
 * 3. **Key the effect on a constant (`[]`)**: the wait is then never armed at all.
 *    Note the direction, because it is not the one a reader expects from a file
 *    about unmount safety: ALL FOUR cases go red, and all four on the same
 *    `armed.length` assertion rather than on an `assign` one — the unmount pair
 *    included, because arming is a precondition here and not an assumption. That
 *    is the whole point of observing it: a mutation that quietly removes the
 *    redirect cannot buy a green unmount case with an empty one. (The navigation
 *    cases in both component redirect files go red under this mutation too.)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, fireEvent } from '@testing-library/react';
import React from 'react';

import { ObjectForm } from './ObjectForm';
import { WizardForm } from './WizardForm';
import { registerAllFields } from '@object-ui/fields';

registerAllFields();

/**
 * A declared delay long enough to unmount inside, distinctive enough that the
 * pass-through spy below can recognise the form's own timer among the ones React
 * and the testing library schedule.
 */
const DELAY_MS = 137;

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

const realSetTimeout = globalThis.setTimeout;
/** Real-clock sleep, taken before the spy is installed so it is never recorded. */
const sleep = (ms: number) => new Promise((resolve) => { realSetTimeout(resolve, ms); });

let assign: ReturnType<typeof vi.spyOn>;
let setTimeoutSpy: ReturnType<typeof vi.spyOn>;
/** One entry per `setTimeout(_, DELAY_MS)` — i.e. per armed redirect wait. */
let armed: number[];

beforeEach(() => {
  armed = [];
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

/** Renders a flat form whose redirect declares this file's delay, and submits it. */
async function submitObjectForm(ds: ReturnType<typeof makeDS>) {
  const view = render(
    <ObjectForm
      schema={{
        type: 'object-form', objectName: 'o', mode: 'create',
        submitBehavior: { kind: 'redirect', url: '/apps/x/done', delayMs: DELAY_MS },
      } as any}
      dataSource={ds as any}
    />,
  );
  fireEvent.change(await waitInput(view.container, 'name'), { target: { value: 'Alpha' } });
  fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  return view;
}

/** Same declaration, driven through the wizard's last step. */
async function submitWizardForm(ds: ReturnType<typeof makeDS>) {
  const view = render(
    <WizardForm
      schema={{
        type: 'object-form', formType: 'wizard', objectName: 'o', mode: 'create',
        sections: [{ label: 'A', fields: ['name'] }],
        submitBehavior: { kind: 'redirect', url: '/apps/x/done', delayMs: DELAY_MS },
      } as any}
      dataSource={ds as any}
    />,
  );
  fireEvent.change(await waitInput(view.container, 'name'), { target: { value: 'Alpha' } });
  fireEvent.submit(view.container.querySelector('form') as HTMLFormElement);
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  return view;
}

/** Waits until the form has armed its wait, and checks it has not fired yet. */
async function waitUntilArmed() {
  await waitFor(() => expect(armed.length).toBe(1));
  expect(assign).not.toHaveBeenCalled();
}

describe('objectui#5033 — ObjectForm redirect delay is owned by the component', () => {
  it('assigns nothing after the form is unmounted mid-delay', async () => {
    const ds = makeDS();
    const view = await submitObjectForm(ds);
    await waitUntilArmed();

    // The submitter closes the modal/drawer, or the host re-keys the subtree.
    view.unmount();

    // Well past the declared delay on the real clock.
    await sleep(DELAY_MS * 5);
    expect(assign).not.toHaveBeenCalled();
    // The write itself already succeeded — cancelling the wait does not undo it.
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('reaches the destination when the delay ends on a mounted form', async () => {
    const ds = makeDS();
    await submitObjectForm(ds);
    await waitUntilArmed();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
    expect(assign).toHaveBeenCalledTimes(1);
  });
});

describe('objectui#5033 — WizardForm redirect delay is owned by the component', () => {
  it('assigns nothing after the wizard is unmounted mid-delay', async () => {
    const ds = makeDS();
    const view = await submitWizardForm(ds);
    await waitUntilArmed();

    view.unmount();

    await sleep(DELAY_MS * 5);
    expect(assign).not.toHaveBeenCalled();
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('reaches the destination when the delay ends on a mounted wizard', async () => {
    const ds = makeDS();
    await submitWizardForm(ds);
    await waitUntilArmed();

    await waitFor(() => expect(assign).toHaveBeenCalledWith('/apps/x/done'));
    expect(assign).toHaveBeenCalledTimes(1);
  });
});
