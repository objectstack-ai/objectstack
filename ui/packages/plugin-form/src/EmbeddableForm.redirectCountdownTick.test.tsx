/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5083 — `EmbeddableForm`'s thank-you countdown must actually count
 * down.
 *
 * The panel's "Redirecting in {{seconds}} seconds…" line is documented, in
 * all ten locale packs (`packages/i18n/src/locales/*.ts`,
 * `publicForm.redirecting`), as showing "the remaining seconds". Before this
 * fix the number was computed exactly once — at the render that first shows
 * the panel — and never touched again: accurate the instant it was drawn,
 * then a static prop for the rest of the wait (a full, unmoving 3 seconds on
 * the default delay).
 *
 * A test asserting only that render would pass against BOTH the broken and
 * the fixed behaviour and pin nothing — see the reverse-verification section
 * below, where that is exactly what happens. This file's job is the half
 * that only the fixed behaviour can pass: the number genuinely decreasing,
 * once per second, while `EmbeddableForm` owns the interval driving it.
 *
 * ## Why this file fakes the clock, when the #5049 sibling deliberately does
 * not
 *
 * `EmbeddableForm.redirectTimerLifetime.test.tsx` keeps the real clock on
 * purpose: the submit path is a chain of awaited promises, and faking the
 * clock around it makes the observation race the promise resolution instead
 * of the delay. That reasoning is about `@testing-library/react`'s `waitFor`
 * / `findBy*`, which poll with a plain, timer-blind `setTimeout` — under
 * `vi.useFakeTimers()` that `setTimeout` never fires because the fake clock
 * never advances on its own, so those helpers would simply hang.
 *
 * `vi.waitFor` (vitest's own, imported as `vi.waitFor`, NOT
 * `@testing-library`'s `waitFor`) does not have that problem: its polling
 * loop is backed by the REAL, un-mocked timers (`getSafeTimers()` inside
 * vitest), and on every poll it checks `vi.isFakeTimers()` and advances the
 * fake clock itself before re-checking the callback. So the awaited
 * `dataSource.create(...)` in the submit handler still resolves on its own
 * microtask — fake timers never touch promises — while every timer this file
 * cares about (the countdown's `setInterval`, and the sibling navigation
 * `setTimeout` armed alongside it) is fully virtual and fully controllable
 * via `vi.advanceTimersByTime`. Every wait below uses `vi.waitFor` for
 * exactly this reason; `@testing-library`'s `waitFor`/`findBy*` are not used
 * once fake timers are installed.
 *
 * ## What this file deliberately does not touch
 *
 * WHETHER a destination is followed (`isRedirectUrlSafe` /
 * `allowedRedirectHosts`, objectui#4989) and WHETHER the navigation wait
 * itself is owned correctly (objectui#5049 / PR #5070,
 * `EmbeddableForm.redirectTimerLifetime.test.tsx`) are unchanged and pinned
 * elsewhere. Every fixture below uses a same-origin relative destination,
 * already accepted before this file's subject — the countdown DISPLAY —
 * begins.
 *
 * ## Reverse-verification (predicted BEFORE running, then measured)
 *
 * Reverting `EmbeddableForm.tsx` to compute the seconds once from
 * `pendingRedirect.delayMs` (dropping `useRedirectCountdownSeconds` and its
 * `setInterval`), with every test below kept as-is:
 *
 * 1. **`submitAndWaitForCountdown`'s own `expect(armed.length).toBe(1)`
 *    check goes red in all three tests** (the reverted code never calls
 *    `setInterval` at all, so `armed` stays empty forever and the assertion
 *    fails deterministically — no interval to wait for). This is the
 *    assertion that PINS the fix; nothing else in this file can even run
 *    once it fails.
 * 2. **The `vi.waitFor` immediately above it, asserting
 *    `Redirecting in 4 seconds`, stays GREEN on the reverted code** — the
 *    static one-shot text was already correct before this fix, which is
 *    exactly the "asserts only the initial render" trap the card warns
 *    about. Recorded here so that green is not miscounted as evidence for
 *    anything.
 * 3. Every subsequent decrement assertion (`3 seconds`, `2 seconds`,
 *    `1 seconds`, `0 seconds` and the self-clear) is unreachable on the
 *    reverted code — the suite fails at (1) before getting there — so they
 *    are not independently informative in THIS reversion; they are pinned by
 *    the fact that (1) already fails.
 *
 * Measured (reverting `EmbeddableForm.tsx` only, to
 * `de4e29a81` — one commit before this fix, keeping every test in this file
 * unchanged): all three tests fail, each with the identical
 * `AssertionError: expected +0 to be 1` at the `armed.length` check inside
 * `submitAndWaitForCountdown` — exactly (1). The `Redirecting in 4 seconds`
 * `vi.waitFor` immediately above it did not itself report a failure in any
 * of the three runs, consistent with (2): it is satisfied by the reverted
 * code too, so its own green tells you nothing about whether this fix is
 * present. Restoring the committed `EmbeddableForm.tsx` returns all three
 * tests to green with no other changes.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';

import { EmbeddableForm, type EmbeddableFormConfig } from './EmbeddableForm';
import { REDIRECT_COUNTDOWN_TICK_MS } from './thankYouRedirectCountdown';

// ObjectForm resolves field widgets through the global registry.
registerAllFields();

const DESTINATION = '/thanks-5083';
/** Long enough to observe four independent per-second decrements (4→0). */
const DELAY_MS = 4000;

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
    formId: 'f5083',
    objectName: 'lead',
    customFields: [{ name: 'email', label: 'Email', type: 'email', required: true } as any],
    // The anti-bot minimum fill time is a different gate; disable it so
    // submit reaches the redirect arm without fighting a 1.5s timer.
    minFillTime: 0,
    thankYouPage: { redirectUrl: DESTINATION, redirectDelay: DELAY_MS },
    ...overrides,
  };
}

const realHrefDescriptor = Object.getOwnPropertyDescriptor(window.location, 'href');

let hrefSetter: ReturnType<typeof vi.fn<(url: string) => void>>;
let setIntervalSpy: ReturnType<typeof vi.spyOn>;
let clearIntervalSpy: ReturnType<typeof vi.spyOn>;
/** One entry per `setInterval` call the component makes, in arming order. */
let armed: { ms: number; handle: unknown }[];
/** Every handle passed to `clearInterval`, by anyone. */
let cleared: unknown[];

beforeEach(() => {
  armed = [];
  cleared = [];
  hrefSetter = vi.fn<(url: string) => void>();

  // `window.location.href = url` is the sibling navigation hook's call —
  // shadowed so it never actually navigates jsdom/happy-dom away mid-test;
  // not this file's subject, but the countdown and the navigation wait are
  // armed by the same accepted `pendingRedirect`, so this file's setup
  // mirrors the #5049 sibling's exactly.
  const realHref = window.location.href;
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => realHref,
    set: (value: string) => { hrefSetter(value); },
  });

  // Fake timers from the very first render — see the file docblock for why
  // this is safe here (and deliberately different from the #5049 sibling).
  vi.useFakeTimers();

  // Captured AFTER `useFakeTimers()`, so this is the fake implementation —
  // the pass-through below still registers with vitest's virtual clock, it
  // is just observable through this file's spy on the way in.
  const fakeSetInterval = globalThis.setInterval;
  const fakeClearInterval = globalThis.clearInterval;

  setIntervalSpy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
    cb: any,
    ms?: number,
    ...rest: any[]
  ) => {
    const handle = (fakeSetInterval as any)(cb, ms, ...rest);
    if (ms === REDIRECT_COUNTDOWN_TICK_MS) armed.push({ ms, handle });
    return handle;
  }) as any);

  clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval').mockImplementation(((handle: any) => {
    cleared.push(handle);
    return (fakeClearInterval as any)(handle);
  }) as any);
});

afterEach(() => {
  clearIntervalSpy.mockRestore();
  setIntervalSpy.mockRestore();
  vi.useRealTimers();
  if (realHrefDescriptor) {
    Object.defineProperty(window.location, 'href', realHrefDescriptor);
  } else {
    delete (window.location as any).href;
  }
});

/**
 * Renders the form and drives one successful submit through to `create`.
 *
 * Deliberately does NOT additionally wrap these `vi.waitFor` calls in
 * `act(async () => …)`: `ObjectForm` loads field widgets behind a Suspense
 * boundary, and nesting an async wait inside `act()` here stalls that
 * resolution — measured, not theoretical: the form gets stuck on its
 * "Loading form…" fallback and every subsequent query times out. `vi.waitFor`
 * on its own is already fake-timer-aware (see the file docblock) and every
 * assertion in this file is deterministic without the extra wrapping; the
 * cost is a handful of benign "not wrapped in act(...)" console warnings for
 * updates this file fully intends and is already asserting on, which is the
 * lesser problem.
 */
async function submitOnce(config: EmbeddableFormConfig, ds: ReturnType<typeof buildDataSource>) {
  const view = render(
    <EmbeddableForm
      config={config}
      // Prefilled programmatically so react-hook-form's required-field
      // validation passes without racing a typed value into its state — the
      // same reason the sibling EmbeddableForm suites prefill.
      prefillParams={{ email: 'a@b.com' }}
      dataSource={ds as any}
    />,
  );
  await vi.waitFor(() => {
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
  fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
  await vi.waitFor(() => {
    expect(ds.create).toHaveBeenCalledTimes(1);
  });
  return view;
}

/**
 * Submits, then waits for BOTH the initial countdown text AND its interval
 * to be armed. The order matters for the reverse-verification recorded in
 * the file docblock: the text check alone is satisfied by the pre-fix static
 * render too, so it is the `armed.length` check that actually pins the fix.
 */
async function submitAndWaitForCountdown(
  config: EmbeddableFormConfig,
  ds: ReturnType<typeof buildDataSource>,
  expectedInitialSeconds: number,
) {
  const view = await submitOnce(config, ds);

  await vi.waitFor(() => {
    expect(
      screen.getByText(new RegExp(`Redirecting in ${expectedInitialSeconds} seconds`, 'i')),
    ).toBeInTheDocument();
  });

  // Proves an interval mechanism exists at all, not merely that the number
  // happened to read right once — the failure mode a render-only assertion
  // cannot distinguish from the pre-fix behaviour.
  await vi.waitFor(() => {
    expect(armed.length).toBe(1);
  });
  expect(armed[0].ms).toBe(REDIRECT_COUNTDOWN_TICK_MS);

  return view;
}

describe('objectui#5083 — EmbeddableForm thank-you countdown ticks', () => {
  it('decrements the displayed seconds once per second, and self-clears on reaching 0', async () => {
    const ds = buildDataSource();
    await submitAndWaitForCountdown(baseConfig(), ds, 4);

    expect(screen.getByText(/Redirecting in 4 seconds/i)).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS); });
    expect(screen.getByText(/Redirecting in 3 seconds/i)).toBeInTheDocument();
    // Counter-probe: the stale reading is gone, paired with the fresh one
    // above actually being present — an empty query here would also pass on
    // a panel that stopped rendering the countdown at all.
    expect(screen.queryByText(/Redirecting in 4 seconds/i)).toBeNull();

    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS); });
    expect(screen.getByText(/Redirecting in 2 seconds/i)).toBeInTheDocument();
    expect(screen.queryByText(/Redirecting in 3 seconds/i)).toBeNull();

    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS); });
    expect(screen.getByText(/Redirecting in 1 seconds/i)).toBeInTheDocument();
    expect(screen.queryByText(/Redirecting in 2 seconds/i)).toBeNull();

    // The 4th tick lands exactly on the declared 4000ms delay — the same
    // instant the sibling navigation timer (a different file, objectui#5049)
    // fires. This assertion pins only that the countdown does not run past
    // 0 and stops itself, regardless of firing order between the two timers.
    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS); });
    expect(screen.getByText(/Redirecting in 0 seconds/i)).toBeInTheDocument();
    expect(cleared).toContain(armed[0].handle);

    // The write itself already succeeded — a ticking display does not touch it.
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('clears the countdown interval when the form unmounts mid-countdown', async () => {
    const ds = buildDataSource();
    const view = await submitAndWaitForCountdown(baseConfig(), ds, 4);

    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS); });
    expect(screen.getByText(/Redirecting in 3 seconds/i)).toBeInTheDocument();

    // The host page removes the embed, or the route changes under it.
    view.unmount();

    expect(cleared).toContain(armed[0].handle);

    // Advancing well past the original delay after unmount must not throw —
    // there is nothing left running to tick.
    expect(() => {
      act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS * 10); });
    }).not.toThrow();
  });

  it('clears the countdown interval when "Submit Another Response" resets the pending destination', async () => {
    const ds = buildDataSource();
    await submitAndWaitForCountdown(baseConfig({ allowMultiple: true }), ds, 4);

    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS); });
    expect(screen.getByText(/Redirecting in 3 seconds/i)).toBeInTheDocument();

    const armedHandle = armed[0].handle;
    fireEvent.click(screen.getByRole('button', { name: /submit another response/i }));

    expect(cleared).toContain(armedHandle);

    // The reset's offer: a fresh form, not a blank screen — the absence of
    // the countdown line below is earned by the reset, not by the panel
    // failing to render at all (counter-probe with a known-present term).
    await vi.waitFor(() => {
      expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/redirecting/i)).toBeNull();

    // No further ticks after reset — advancing well past the original delay
    // must not resurrect a countdown for a destination that was dropped.
    act(() => { vi.advanceTimersByTime(REDIRECT_COUNTDOWN_TICK_MS * 10); });
    expect(screen.queryByText(/redirecting/i)).toBeNull();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });
});
