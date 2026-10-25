/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5073 — the thank-you panel's copy must follow the component's own
 * redirect VERDICT, not the mere fact that a `redirectUrl` was authored.
 *
 * Two facts were measured on `6098ecd08` before the fix, and both are pinned
 * here:
 *
 * 1. The countdown paragraph rendered on `thankYou?.redirectUrl` — i.e. on
 *    whether the author declared a destination. When `isRedirectUrlSafe`
 *    refused that destination the submitter was still told
 *    `Redirecting in 3 seconds…` and was then never redirected. The panel is
 *    the terminal state of a public form, so nothing came after to correct it.
 * 2. `texts.redirectBlocked` was unreachable. The refusal arm set it through
 *    `setError(...)`, whose banner lives in the FORM branch — which the
 *    component has already left by then, `setSubmitted(true)` having run one
 *    statement earlier. The only assignment of that key could therefore never
 *    reach a screen, in any locale.
 *
 * The countdown is now keyed on `pendingRedirect` — the destination that was
 * actually ACCEPTED (the state PR #5070 introduced) — and the refusal is held
 * separately from `error`, so the author's `redirectBlocked` copy renders in
 * the panel the submitter is actually looking at.
 *
 * ## Why the cases are paired
 *
 * A negative case alone passes for the wrong reason: deleting the countdown
 * outright also makes it absent on a refused destination. The accepted cases
 * below therefore require the countdown to be PRESENT and, for the allowlisted
 * one, require the navigation itself to still happen — so "absent" can only be
 * earned by the verdict, never by subtraction.
 *
 * ## What this file deliberately does not touch
 *
 * `isRedirectUrlSafe` / `allowedRedirectHosts` — WHICH destinations are refused
 * — is unchanged, and so is the relative-path-only question of objectui#4989.
 * Every fixture below is judged by the guard exactly as it was before. Timer
 * ownership (objectui#5049 / PR #5070) is pinned by its own file,
 * `EmbeddableForm.redirectTimerLifetime.test.tsx`, and is untouched here.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';

import { EmbeddableForm, type EmbeddableFormConfig } from './EmbeddableForm';

// ObjectForm resolves field widgets through the global registry.
registerAllFields();

/** Cross-origin and NOT in `allowedRedirectHosts` — the guard refuses it. */
const REFUSED_DESTINATION = 'https://evil.example.com/phish';
/** Cross-origin but explicitly allowlisted below — the guard accepts it. */
const ALLOWED_HOST = 'trusted.example.com';
const ALLOWED_DESTINATION = `https://${ALLOWED_HOST}/ok`;
/** Same-origin relative — accepted without any allowlist entry. */
const SAME_ORIGIN_DESTINATION = '/thanks-5073';

/** Short enough to outlive inside a test, long enough to observe before it fires. */
const SHORT_DELAY_MS = 120;
/** Distinctive seconds reading, so the countdown copy can be matched exactly. */
const LONG_DELAY_MS = 5000;

const THANK_YOU_TITLE = 'Thanks for your answer';
/** The author's own words, addressed to the public — see the PM ruling on #5073. */
const BLOCKED_COPY = 'We could not send you on. You can close this window.';

const realSetTimeout = globalThis.setTimeout;
/** Real-clock sleep — this file never fakes the clock (see the sibling file). */
const sleep = (ms: number) => new Promise((resolve) => { realSetTimeout(resolve, ms); });

function buildDataSource() {
  return {
    create: vi.fn(async (_obj: string, data: Record<string, unknown>) => ({ id: '1', ...data })),
    update: vi.fn(),
    delete: vi.fn(),
    findOne: vi.fn(),
    find: vi.fn(async () => ({ data: [], total: 0 })),
    getObjectSchema: vi.fn(async (name: string) => ({ name, fields: {} })),
  };
}

function baseConfig(overrides: Partial<EmbeddableFormConfig> = {}): EmbeddableFormConfig {
  return {
    formId: 'f5073',
    objectName: 'lead',
    customFields: [{ name: 'email', label: 'Email', type: 'email', required: true } as any],
    // The anti-bot minimum fill time is a different gate; disable it so submit
    // reaches the redirect arm without fighting a 1.5s timer.
    minFillTime: 0,
    texts: { thankYouTitle: THANK_YOU_TITLE },
    ...overrides,
  };
}

let hrefSetter: ReturnType<typeof vi.fn<(url: string) => void>>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  hrefSetter = vi.fn<(url: string) => void>();

  // `window.location.href = url` is the component's navigation call. Shadow just
  // that accessor on the real Location instance so `origin` — which
  // `isRedirectUrlSafe` reads — stays genuinely real and the guard genuinely
  // runs on every fixture below.
  const realHref = window.location.href;
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => realHref,
    set: (value: string) => { hrefSetter(value); },
  });

  // The refusal's author-facing signal; kept out of the test output but
  // asserted on where it is the point.
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  delete (window.location as any).href;
});

/** Renders the form and drives one successful submit through to `create`. */
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
  await screen.findByLabelText(/email/i);
  fireEvent.click(await screen.findByRole('button', { name: /^submit$/i }));
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  await screen.findByText(THANK_YOU_TITLE);
  return view;
}

describe('objectui#5073 — the thank-you panel follows the redirect verdict', () => {
  it('refused destination: omits the countdown and renders the author\'s redirectBlocked copy', async () => {
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({
        thankYouPage: { redirectUrl: REFUSED_DESTINATION, redirectDelay: SHORT_DELAY_MS },
        texts: { thankYouTitle: THANK_YOU_TITLE, redirectBlocked: BLOCKED_COPY },
      }),
      ds,
    );

    // No promise of a navigation the component has already refused.
    expect(screen.queryByText(/Redirecting in/i)).toBeNull();
    // The author declared copy for exactly this case; it belongs on the screen
    // the submitter is looking at, which is the panel — not the form branch's
    // error banner, which is no longer rendered by the time refusal happens.
    expect(screen.getByText(BLOCKED_COPY)).toBeInTheDocument();

    // And the refusal itself still holds, well past the declared delay.
    await sleep(SHORT_DELAY_MS * 5);
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[EmbeddableForm] Blocked unsafe redirect target:',
      REFUSED_DESTINATION,
    );
    // The write itself succeeded — refusing the redirect does not undo it.
    expect(ds.create).toHaveBeenCalledTimes(1);
  });

  it('refused destination without redirectBlocked: the panel says nothing about redirecting', async () => {
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({
        thankYouPage: { redirectUrl: REFUSED_DESTINATION, redirectDelay: SHORT_DELAY_MS },
      }),
      ds,
    );

    // Silence is the ruling when the author declared no copy: no countdown, and
    // no component-invented notice standing in for one. `/redirect/i` catches
    // both the default countdown template and any hard-coded fallback.
    expect(screen.queryByText(/redirect/i)).toBeNull();
    // The author still gets told, on the channel that was always theirs.
    expect(warnSpy).toHaveBeenCalledWith(
      '[EmbeddableForm] Blocked unsafe redirect target:',
      REFUSED_DESTINATION,
    );

    await sleep(SHORT_DELAY_MS * 5);
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('allowlisted cross-origin destination: keeps the countdown and still navigates', async () => {
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({
        thankYouPage: { redirectUrl: ALLOWED_DESTINATION, redirectDelay: SHORT_DELAY_MS },
        allowedRedirectHosts: [ALLOWED_HOST],
        texts: { thankYouTitle: THANK_YOU_TITLE, redirectBlocked: BLOCKED_COPY },
      }),
      ds,
    );

    // Accepted: the promise is made, because it will be kept.
    expect(screen.getByText(/Redirecting in/i)).toBeInTheDocument();
    // …and the refusal copy is not shown for a destination that was accepted.
    expect(screen.queryByText(BLOCKED_COPY)).toBeNull();

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith(ALLOWED_DESTINATION));
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  it('same-origin destination: the countdown reads the delay of the accepted destination', async () => {
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({
        thankYouPage: { redirectUrl: SAME_ORIGIN_DESTINATION, redirectDelay: LONG_DELAY_MS },
      }),
      ds,
    );

    // 5000 ms accepted → "5 seconds". The reading comes from the destination
    // that was accepted, so it cannot describe a wait nobody is serving.
    expect(screen.getByText(/Redirecting in 5 seconds/i)).toBeInTheDocument();
    expect(hrefSetter).not.toHaveBeenCalled(); // still counting down
  });

  it('honeypot fake-success: no countdown, since no destination was ever accepted', async () => {
    const ds = buildDataSource();
    const { container } = render(
      <EmbeddableForm
        config={baseConfig({
          thankYouPage: { redirectUrl: SAME_ORIGIN_DESTINATION, redirectDelay: SHORT_DELAY_MS },
        })}
        prefillParams={{ email: 'a@b.com' }}
        dataSource={ds as any}
      />,
    );

    await screen.findByLabelText(/email/i);
    // A bot blindly fills every input, including the off-screen honeypot.
    const honeypot = container.querySelector(
      'input[name="_company_website_2"]',
    ) as HTMLInputElement | null;
    expect(honeypot).not.toBeNull();
    fireEvent.change(honeypot!, { target: { value: 'http://spam' } });
    fireEvent.click(await screen.findByRole('button', { name: /^submit$/i }));

    await screen.findByText(THANK_YOU_TITLE);
    // The submit was never accepted, so no destination was either — the panel
    // must not narrate a navigation that this path never arms.
    expect(screen.queryByText(/Redirecting in/i)).toBeNull();
    expect(ds.create).not.toHaveBeenCalled();

    await sleep(SHORT_DELAY_MS * 5);
    expect(hrefSetter).not.toHaveBeenCalled();
  });
});
