/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * objectui#5112 — `EmbeddableForm`'s thank-you redirect stops being mount-blind.
 *
 * The redirect used to end in one unconditional `window.location.href = url`.
 * That is correct for the external destination this key deliberately admits, and
 * wrong for the in-app one it equally admits: a rooted path such as `/thanks`
 * assigned to `location.href` resolves against the ORIGIN root, so under a host
 * mounted at a sub-path (the console runs at basename `/_console`) the submitter
 * lands outside the application — usually on the host's own 404. This is
 * objectui#4989 defect 4 on the key that card explicitly did not cover, and the
 * seam that fixes it (`HostNavigationContext`, `@object-ui/react`) landed with
 * PR #5111.
 *
 * ## The arm split this file pins, and the one thing it must NOT do
 *
 * Per the ruling on this card: an app-relative destination goes through the host
 * navigate when a host supplied one and falls back to the browser navigation
 * when none was; an external destination admitted by `allowedRedirectHosts`
 * keeps browser-level navigation **unconditionally**. The nail on that second
 * arm is the point of half this file — the seam's own type contract says `to` is
 * "an already-resolved, application-relative path, never an absolute URL", so a
 * renderer handing a router a cross-origin address would be laundering an
 * external destination through the host.
 *
 * What is NOT touched: `isRedirectUrlSafe` and `allowedRedirectHosts` — WHICH
 * destinations are followed. That acceptance set (same-origin OR allowlist) is
 * this key's own contract and is not this card's to change; objectstack#7496's
 * relative-only ruling belongs to `submitBehavior.url` and is deliberately not
 * imported here. The last describe block below re-measures the guard's verdicts
 * so a future edit to the arm split cannot quietly widen or narrow them.
 *
 * ## Reverse verification — direction predicted before it was run
 *
 * Restoring the executor to an unconditional `window.location.href = url` (the
 * pre-change body) was predicted to turn red **exactly** the cases that assert a
 * host navigate RECEIVED the destination, and to leave every browser-arm case
 * green — because those describe behaviour that was already correct and is
 * deliberately unchanged. The measured result is recorded in the PR.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { registerAllFields } from '@object-ui/fields';
import { HostNavigationProvider } from '@object-ui/react';

import { EmbeddableForm, isRedirectUrlSafe, type EmbeddableFormConfig } from './EmbeddableForm';
import { isAppRelativeDestination } from './thankYouRedirectNavigation';

// ObjectForm resolves field widgets through the global registry.
registerAllFields();

/** The mount the framework CLI configures for an embedded deployment. */
const MOUNT = '/_console';

/** Same-origin, app-relative — the destination this card is about. */
const RELATIVE_DESTINATION = '/thanks-5112';
/** Cross-origin but explicitly allowlisted below — accepted, and external. */
const ALLOWED_HOST = 'trusted.example.com';
const EXTERNAL_DESTINATION = `https://${ALLOWED_HOST}/ok`;
/** Cross-origin and NOT allowlisted — the guard refuses it. */
const REFUSED_DESTINATION = 'https://evil.example.com/phish';

/** Short enough to observe inside a test, long enough to act before it fires. */
const SHORT_DELAY_MS = 120;
/** Long enough that nothing can have fired by the time the test looks. */
const LONG_DELAY_MS = 10_000;

const realSetTimeout = globalThis.setTimeout;
/** Real-clock sleep — this file never fakes the clock (see the sibling files). */
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
    formId: 'f5112',
    objectName: 'lead',
    customFields: [{ name: 'email', label: 'Email', type: 'email', required: true } as any],
    // The anti-bot minimum fill time is a different gate; disable it so submit
    // reaches the redirect arm without fighting a 1.5s timer.
    minFillTime: 0,
    ...overrides,
  };
}

let hrefSetter: ReturnType<typeof vi.fn<(url: string) => void>>;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  hrefSetter = vi.fn<(url: string) => void>();

  // `window.location.href = url` is the component's browser-level navigation.
  // Shadow just that accessor on the real Location instance (the prototype's is
  // configurable) so `origin` — which `isRedirectUrlSafe` reads — stays
  // genuinely real and the guard therefore genuinely runs on every fixture
  // below. `delete` restores the prototype accessor in the teardown.
  const realHref = window.location.href;
  Object.defineProperty(window.location, 'href', {
    configurable: true,
    get: () => realHref,
    set: (value: string) => { hrefSetter(value); },
  });

  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  delete (window.location as any).href;
});

interface SubmitOptions {
  /** The host's navigate, or `undefined` for a host that wires no seam. */
  navigate?: (to: string, options?: { replace?: boolean }) => void;
}

/** Renders the form (optionally inside a host seam) and drives one submit. */
async function submitOnce(
  config: EmbeddableFormConfig,
  ds: ReturnType<typeof buildDataSource>,
  opts: SubmitOptions = {},
) {
  const form = (
    <EmbeddableForm
      config={config}
      // Prefilled programmatically so react-hook-form's required-field
      // validation passes without racing a typed value into its state — the
      // same reason the sibling EmbeddableForm suites prefill.
      prefillParams={{ email: 'a@b.com' }}
      dataSource={ds as any}
    />
  );
  const view = render(
    // No provider at all in the absent-seam cases: the default context value is
    // what a router-less host actually sees, and mounting a provider carrying
    // `navigate: undefined` would test a different (and easier) thing.
    opts.navigate
      ? <HostNavigationProvider value={{ navigate: opts.navigate }}>{form}</HostNavigationProvider>
      : form,
  );
  await screen.findByLabelText(/email/i);
  fireEvent.click(await screen.findByRole('button', { name: /^submit$/i }));
  await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));
  return view;
}

// ─── The predicate that picks who travels ──────────────────────────────────

describe('isAppRelativeDestination', () => {
  it('accepts the references a host router can place', () => {
    expect(isAppRelativeDestination('/thanks')).toBe(true);
    expect(isAppRelativeDestination('thanks')).toBe(true);
    expect(isAppRelativeDestination('/a/b?ok=1#done')).toBe(true);
    expect(isAppRelativeDestination('?ok=1')).toBe(true);
    expect(isAppRelativeDestination('#done')).toBe(true);
  });

  it('refuses anything carrying its own authority or scheme', () => {
    expect(isAppRelativeDestination(EXTERNAL_DESTINATION)).toBe(false);
    // Protocol-relative: no scheme, but it still supplies a host.
    expect(isAppRelativeDestination(`//${ALLOWED_HOST}/ok`)).toBe(false);
    expect(isAppRelativeDestination('javascript:alert(1)')).toBe(false);
    expect(isAppRelativeDestination('http://[invalid-host')).toBe(false);
  });

  it('refuses a same-origin ABSOLUTE url — deliberately, not by omission', () => {
    // The one shape the card's two named arms do not cover. Routing it through
    // the seam would mean rewriting the author's full address into a path a
    // mounted router then places somewhere else; an author who spelled the whole
    // address asked for that address. See the module docblock.
    expect(isAppRelativeDestination(`${window.location.origin}/thanks`)).toBe(false);
    // …and it is still an ACCEPTED destination — the guard is untouched.
    expect(isRedirectUrlSafe(`${window.location.origin}/thanks`)).toBe(true);
  });

  it('the invariant: an accepted app-relative reference is always same-origin', () => {
    // A relative reference cannot carry an authority (RFC 3986), so it resolves
    // to the base's origin whatever it says. This is what makes "the host seam
    // can never be handed a cross-origin URL" structural rather than a promise.
    for (const raw of ['/thanks', 'thanks', '?ok=1', '#done', 'not a url at all']) {
      expect(isAppRelativeDestination(raw)).toBe(true);
      expect(new URL(raw, window.location.href).origin).toBe(window.location.origin);
    }
  });
});

// ─── Arm 1: an app-relative destination ────────────────────────────────────

describe('objectui#5112 — an app-relative thank-you destination', () => {
  it('goes to the host navigate, and the browser navigates nowhere', async () => {
    const navigate = vi.fn();
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: RELATIVE_DESTINATION, redirectDelay: SHORT_DELAY_MS } }),
      ds,
      { navigate },
    );

    await waitFor(() => expect(navigate).toHaveBeenCalledWith(RELATIVE_DESTINATION));
    // The whole defect: `location.href = '/thanks-5112'` resolves against the
    // ORIGIN root, so under a mounted host it left the app. It must not happen
    // at all when a host offered to place the path itself.
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('falls back to the browser navigation when no host supplied a seam', async () => {
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: RELATIVE_DESTINATION, redirectDelay: SHORT_DELAY_MS } }),
      ds,
    );

    // Byte-for-byte the previous behaviour: one `location.href` assignment of
    // the authored destination. A host with no router has no basename, so
    // origin-rooted resolution is already right there — absent seam is a
    // supported state, not a degraded one.
    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith(RELATIVE_DESTINATION));
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  it('lets a mounted host place the destination inside its mount', async () => {
    // A STUB host navigate that joins its mount, standing in for a router with a
    // basename — this asserts the seam's consequence at this layer (the renderer
    // hands over a path a host can still place), not React Router's behaviour,
    // which is pinned against a real router in the app-shell bridge's own test.
    const visited: string[] = [];
    const navigate = (to: string) => visited.push(new URL(`.${to}`, `https://h${MOUNT}/`).pathname);
    const ds = buildDataSource();

    await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: RELATIVE_DESTINATION, redirectDelay: SHORT_DELAY_MS } }),
      ds,
      { navigate },
    );

    await waitFor(() => expect(visited).toEqual([`${MOUNT}${RELATIVE_DESTINATION}`]));
    // The counterfactual, measured rather than asserted in prose: the same
    // string through a browser-level navigation resolves at the origin root and
    // leaves the application.
    expect(new URL(RELATIVE_DESTINATION, `https://h${MOUNT}/`).pathname).toBe(RELATIVE_DESTINATION);
  });

  it('uses the LATEST injected navigate, exactly once, when the host rebuilds it', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const ds = buildDataSource();
    const config = baseConfig({
      thankYouPage: { redirectUrl: RELATIVE_DESTINATION, redirectDelay: SHORT_DELAY_MS },
    });
    const tree = (navigate: (to: string) => void) => (
      <HostNavigationProvider value={{ navigate }}>
        <EmbeddableForm config={config} prefillParams={{ email: 'a@b.com' }} dataSource={ds as any} />
      </HostNavigationProvider>
    );

    const view = render(tree(first));
    await screen.findByLabelText(/email/i);
    fireEvent.click(await screen.findByRole('button', { name: /^submit$/i }));
    await waitFor(() => expect(ds.create).toHaveBeenCalledTimes(1));

    // An inline arrow in a host's JSX is a NEW function every render, which is
    // the ordinary shape. Re-rendering mid-wait must not lose the navigation,
    // must not duplicate it, and must not restart the declared pause.
    view.rerender(tree(second));

    await waitFor(() => expect(second).toHaveBeenCalledWith(RELATIVE_DESTINATION));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('cancels on unmount — a host navigate must not fire into a form that is gone', async () => {
    const navigate = vi.fn();
    const ds = buildDataSource();
    const view = await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: RELATIVE_DESTINATION, redirectDelay: SHORT_DELAY_MS } }),
      ds,
      { navigate },
    );

    view.unmount();
    await sleep(SHORT_DELAY_MS * 5);

    // objectui#5049's property, restated for the injected path: an SPA
    // transition yanking a submitter who has moved on is worse than a full page
    // load doing it, not better.
    expect(navigate).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
  });

  it('does not shorten the declared wait just because a seam is present', async () => {
    const navigate = vi.fn();
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: RELATIVE_DESTINATION, redirectDelay: LONG_DELAY_MS } }),
      ds,
      { navigate },
    );

    expect(navigate).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
  });
});

// ─── Arm 2: an external destination ────────────────────────────────────────

describe('objectui#5112 — an external thank-you destination never reaches the seam', () => {
  it('keeps browser-level navigation even when a host supplied a navigate', async () => {
    const navigate = vi.fn();
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({
        thankYouPage: { redirectUrl: EXTERNAL_DESTINATION, redirectDelay: SHORT_DELAY_MS },
        allowedRedirectHosts: [ALLOWED_HOST],
      }),
      ds,
      { navigate },
    );

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith(EXTERNAL_DESTINATION));
    // The nail: a host navigate is a client-side router transition, and the
    // seam's declared input is an application-relative path. A cross-origin
    // address is not the router's to attempt, and handing it over would launder
    // an external destination through the host.
    expect(navigate).not.toHaveBeenCalled();
    expect(hrefSetter).toHaveBeenCalledTimes(1);
  });

  it('keeps browser-level navigation for a same-origin ABSOLUTE url too', async () => {
    const navigate = vi.fn();
    const ds = buildDataSource();
    const absolute = `${window.location.origin}/thanks-5112-absolute`;
    await submitOnce(
      baseConfig({ thankYouPage: { redirectUrl: absolute, redirectDelay: SHORT_DELAY_MS } }),
      ds,
      { navigate },
    );

    await waitFor(() => expect(hrefSetter).toHaveBeenCalledWith(absolute));
    expect(navigate).not.toHaveBeenCalled();
  });

  it('a refused destination reaches neither the seam nor the browser', async () => {
    const navigate = vi.fn();
    const ds = buildDataSource();
    await submitOnce(
      baseConfig({
        thankYouPage: { redirectUrl: REFUSED_DESTINATION, redirectDelay: SHORT_DELAY_MS },
      }),
      ds,
      { navigate },
    );

    await sleep(SHORT_DELAY_MS * 5);
    // The verdict is taken before anything reaches a navigation, by design: an
    // injected host navigate is not a way around `isRedirectUrlSafe`.
    expect(navigate).not.toHaveBeenCalled();
    expect(hrefSetter).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[EmbeddableForm] Blocked unsafe redirect target:',
      REFUSED_DESTINATION,
    );
    // The write itself succeeded — refusing the redirect does not undo it.
    expect(ds.create).toHaveBeenCalledTimes(1);
  });
});

// ─── The acceptance set this card does not touch ───────────────────────────

describe('objectui#5112 — `isRedirectUrlSafe` verdicts are unchanged', () => {
  it('answers exactly what it answered before the arm split', () => {
    // Restated here, next to the arm split, so an edit that widens or narrows
    // WHICH destinations are followed cannot pass as an edit to WHO travels.
    // The exhaustive table lives in `__tests__/EmbeddableForm.test.tsx`.
    expect(isRedirectUrlSafe(RELATIVE_DESTINATION)).toBe(true);
    expect(isRedirectUrlSafe('thanks')).toBe(true);
    expect(isRedirectUrlSafe(`${window.location.origin}/thanks`)).toBe(true);
    expect(isRedirectUrlSafe(REFUSED_DESTINATION)).toBe(false);
    expect(isRedirectUrlSafe(EXTERNAL_DESTINATION)).toBe(false);
    expect(isRedirectUrlSafe(EXTERNAL_DESTINATION, [ALLOWED_HOST])).toBe(true);
    expect(isRedirectUrlSafe('https://app.example.com/ok', ['*.example.com'])).toBe(true);
    expect(isRedirectUrlSafe('https://example.com/ok', ['*.example.com'])).toBe(false);
    expect(isRedirectUrlSafe('javascript:alert(1)')).toBe(false);
    expect(isRedirectUrlSafe('http://[invalid-host')).toBe(false);
  });
});
