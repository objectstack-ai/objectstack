/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5049 — `EmbeddableForm`'s thank-you redirect must not outlive either
 * the component that armed it or the destination it was armed for.
 *
 * The wait used to be a bare `setTimeout` inside the submit handler: the handle
 * was not stored, not cleared, and owned by nobody. Two consequences, and the
 * second one needs no unmount at all:
 *
 * 1. The pending full-page navigation survived the form being taken off screen
 *    (an embed removed by the host page, a route change, a re-keyed subtree).
 *    With `redirectDelay` unset that window is the 3000 ms default — the NORMAL
 *    state of this surface, which is why the thank-you panel says
 *    `Redirecting in {{seconds}} seconds…` out loud.
 * 2. Under `allowMultiple`, `Submit Another Response` only flipped `submitted`
 *    back to false. The timer kept ticking, so the component invited the
 *    submitter into a fresh form and then threw the whole page away while they
 *    were typing the next response.
 *
 * The wait now lives in an effect keyed on the pending destination, so both
 * unmounting and dropping the destination cancel it.
 *
 * ## What each case measures, and why the positive one is required
 *
 * A negative case alone can pass for the WRONG reason: a form that never arms a
 * redirect also navigates nowhere. Two things stop that empty pass from reading
 * as a fix. Each negative case first REQUIRES the wait to have been armed (see
 * `waitUntilArmed`), so a form that arms nothing fails there rather than sailing
 * through to a satisfied `not.toHaveBeenCalled()`. And they are paired with a
 * mounted case asserting the destination IS reached when the delay ends, so
 * deleting the redirect outright is red too.
 *
 * ## Why a real clock, and how the arming is observed without racing it
 *
 * The submit path is a chain of awaited promises, so faking the clock around it
 * makes the observation race the resolution rather than the delay. This file
 * keeps the real clock and instead makes ARMING observable: `setTimeout` is
 * wrapped by a pass-through spy recording the delays this file declares. The
 * unmount (or the reset click) therefore provably happens AFTER the wait was
 * armed, which is the only ordering that can falsify anything.
 *
 * ## What this file deliberately does not touch
 *
 * Which destinations are followed and which are refused is `isRedirectUrlSafe` /
 * `allowedRedirectHosts` — a different contract from the relative-path-only
 * ruling that objectui#4989 covers, and unchanged here (its cases live in
 * `__tests__/EmbeddableForm.test.tsx`). Every destination below is same-origin
 * relative, i.e. already accepted before this file's subject begins. The
 * countdown copy is not touched either.
 *
 * ## Counterfactuals (measured, see the PR for the runs)
 *
 * 1. **Drop the `clearTimeout` from the effect cleanup**: BOTH negative cases go
 *    red on `expect(hrefSetter).not.toHaveBeenCalled()`. Note that this includes
 *    the reset case: dropping the destination only re-runs the effect, and it is
 *    that re-run's cleanup which does the cancelling — clearing the state is not
 *    itself a cancellation.
 * 2. **`handleReset` no longer clears the pending destination**: the reset case
 *    goes red and the unmount case stays green — unmount safety alone never
 *    covered the `Submit Another Response` path, which is the point of this
 *    issue over objectui#5033.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';

import { EmbeddableForm, type EmbeddableFormConfig } from './EmbeddableForm';

// ObjectForm resolves field widgets through the global registry.
registerAllFields();

/**
 * A declared delay long enough to act inside of, distinctive enough that the
 * pass-through spy below can recognise the form's own timer among the ones React
 * and the testing library schedule.
 */
const DELAY_MS = 149;
/** The delay the component applies when `redirectDelay` is left unset. */
const DEFAULT_DELAY_MS = 3000;
const DESTINATION = '/thanks-5049';

const buildDataSource = () => ({
  create: vi.fn(async (_obj: string, data: Record<string, unknown>) => ({ id: '1', ...data })),
  update: vi.fn(),
  delete: vi.fn(),
  findOne: vi.fn(),
  find: vi.fn(async () => ({ data: [], total: 0 })),
  getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
});

function baseConfig(overrides: Partial<EmbeddableFormConfig> = {}): EmbeddableFormConfig {
  return {
    formId: 'f5049',
    objectName: 'lead',
    customFields: [{ name: 'email', label: 'Email', type: 'email', required: true } as any],
    // The anti-bot minimum fill time is a different gate; disable it so the
    // submit reaches the redirect arm without fighting a 1.5s timer.
    minFillTime: 0,
    thankYouPage: { redirectUrl: DESTINATION, redirectDelay: DELAY_MS },
    ...overrides,
  };
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
/** Real-clock sleep, taken before the spy is installed so it is never recorded. */
const sleep = (ms: number) => new Promise((resolve) => { realSetTimeout(resolve, ms); });

let hrefSetter: ReturnType<typeof vi.fn<(url: string) => void>>;
let setTimeoutSpy: ReturnType<typeof vi.spyOn>;
let clearTimeoutSpy: ReturnType<typeof vi.spyOn>;
/** One entry per redirect wait armed by the component, in arming order. */
let armed: { ms: number; handle: unknown }[];
/** Every handle passed to `clearTimeout`, by anyone. */
let cleared: unknown[];

beforeEach(() => {
  armed = [];
  cleared = [];
  hrefSetter = vi.fn<(url: string) => void>();

  // `window.location.href = url` is the component's navigation call. Shadow just
  // that accessor on the real Location instance (the prototype's is
  // configurable) so `origin` / `search` — which `isRedirectUrlSafe` reads —
  // stay genuinely real, and the guard therefore genuinely runs. `delete`
  // restores the prototype accessor in the teardown below.
  const realHref = window.location.href;
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => realHref,
    set: (value: string) => { hrefSetter(value); },
  });

  setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(((
    cb: any,
    ms?: number,
    ...rest: any[]
  ) => {
    const handle = (realSetTimeout as any)(cb, ms, ...rest);
    if (ms === DELAY_MS || ms === DEFAULT_DELAY_MS) armed.push({ ms, handle });
    return handle;
  }) as any);

  // Pass-through, like the setTimeout spy: the cancellation this file is about
  // has to really happen, so the negative cases below measure the component and
  // not the spy.
  clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout').mockImplementation(((handle: any) => {
    cleared.push(handle);
    return (realClearTimeout as any)(handle);
  }) as any);
});

afterEach(() => {
  clearTimeoutSpy.mockRestore();
  setTimeoutSpy.mockRestore();
  delete (window.location as any).href;
});

/** Renders the form and drives one successful submit through to `create`. */
async function submitOnce(config: EmbeddableFormConfig, ds: ReturnType<typeof buildDataSource>) {
  const view = render(
    <EmbeddableForm
      config={config}
      // Prefilled programmatically so react-hook-form's required-field
      // validation passes without racing a typed value into its state — the
      // same reason the sibling EmbeddableForm suite prefills.
      prefillParams={{ email: 'a@b.com' }}
      dataSource={ds as any}
    />,
  );
  await screen.findByLabelText(/email/i);
  fireEvent.click(await screen.findByRole('button', { name: /^submit$/i }));
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  return view;
}

/** Waits until the form has armed its wait, and checks it has not fired yet. */
async function waitUntilArmed(ms: number) {
  await waitFor(() => expect(armed.length).toBe(1));
  expect(armed[0].ms).toBe(ms);
  expect(hrefSetter).not.toHaveBeenCalled();
}

describe('objectui#5049 — EmbeddableForm thank-you redirect is owned by the component', () => {
  it('navigates nowhere after the form is unmounted mid-delay', async () => {
    const ds = buildDataSource();
    const view = await submitOnce(baseConfig(), ds);
    await waitUntilArmed(DELAY_MS);

    // The host page removes the embed, or the route changes under it.
    view.unmount();

    // Well past the declared delay on the real clock.
    await sleep(DELAY_MS * 5);
    expect(hrefSetter).not.toHaveBeenCalled();
    // The write itself already succeeded — cancelling the wait does not undo it.
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('navigates nowhere after "Submit Another Response" is pressed mid-delay', async () => {
    const ds = buildDataSource();
    await submitOnce(baseConfig({ allowMultiple: true }), ds);
    await waitUntilArmed(DELAY_MS);

    fireEvent.click(await screen.findByRole('button', { name: /submit another response/i }));

    // The button's offer: a fresh form, which the submitter is now filling.
    await screen.findByLabelText(/email/i);

    await sleep(DELAY_MS * 5);
    expect(hrefSetter).not.toHaveBeenCalled();
    // Still on the fresh form, not on a page the redirect replaced.
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('reaches the destination when the delay ends on a mounted form', async () => {
    const ds = buildDataSource();
    await submitOnce(baseConfig(), ds);
    await waitUntilArmed(DELAY_MS);

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith(DESTINATION));
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  it('captures the 3000 ms default when redirectDelay is unset, and cancels it on unmount', async () => {
    const ds = buildDataSource();
    const view = await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: DESTINATION } }),
      ds,
    );
    // The default is the delay actually armed — it is captured at the moment the
    // write is accepted, not re-read at wait time.
    await waitUntilArmed(DEFAULT_DELAY_MS);

    view.unmount();

    // Cancellation is asserted on the handle rather than by outliving the delay:
    // waiting out 3 s of real time would buy no extra evidence about the
    // cleanup, which the two cases above already pin on the real clock. This
    // case exists to keep the default value itself from drifting.
    expect(cleared).toContain(armed[0].handle);
    expect(hrefSetter).not.toHaveBeenCalled();
  });
});
