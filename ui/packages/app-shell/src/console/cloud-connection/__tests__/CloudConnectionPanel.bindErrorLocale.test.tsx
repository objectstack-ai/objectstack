/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5054 — ONE bind failure must read in ONE language, whichever clock
 * noticed it.
 *
 * ## The asymmetry this file pins, measured on the pre-fix tip
 *
 * A device authorization that expires can be noticed by either of two clocks,
 * and the panel had a different answer for each:
 *
 *   - the SERVER's clock — `/bind/poll` answers HTTP 400 with
 *     `{ code: 'DEVICE_CODE_FAILED', declaredCode: 'expired_token',
 *        message: 'Device authorization failed: expired_token' }`
 *     (objectstack `packages/cloud-connection/src/cloud-connection-plugin.ts`,
 *     the terminal `/bind/poll` exit). `getJson` throws on any non-2xx, and the
 *     catch rendered `err.message` verbatim: an English sentence, on all ten
 *     locales.
 *   - the PANEL's own clock — `poll()`'s `expires_in` deadline fires first and
 *     renders `t('cloudConnection.errors.expired')`: translated, on all ten
 *     locales.
 *
 * Same abandoned approval, same user, two languages, decided by which clock
 * noticed first. The ruling on #5054 (Option A restricted + B fallback) maps the
 * two user-causable RFC 8628 spellings onto locale keys — `declaredCode` first,
 * then `code` — and leaves every unrecognized code rendering the wire `message`.
 *
 * ## Why BOTH sides get a case here
 *
 * A probe that only exercises the reported (server) side cannot fail on the
 * other, so it cannot testify that the asymmetry is closed — only that one half
 * moved. `SERVER` and `CLIENT` below are the same condition reached through the
 * two different readers, and `SYMMETRY` asserts they land on the same string.
 *
 * ## Predicted directions, written before running
 *
 * Pre-fix tip:  SERVER expired RED · SERVER denied RED · SYMMETRY RED ·
 *               CLIENT expired GREEN · CONTROL unknown-code GREEN.
 *               The two green ones are green on purpose: CLIENT is the side that
 *               was already correct (it must not regress), CONTROL is the
 *               B-fallback the ruling keeps. Their silence is not evidence, so
 *               each has its own mutation leg — see the PR body.
 *
 * The identity `t` below is deliberate (same idiom as the sibling
 * `CloudConnectionPanel.bindError.test.tsx`): asserting on the KEY says "the
 * translated string was chosen" without pinning today's English copy, and it is
 * what lets SYMMETRY compare the two readers' output directly.
 * `cloudConnection-locale-parity.test.ts` separately guarantees each key
 * resolves to a non-empty, actually-translated value in all ten packs.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    useObjectTranslation: () => ({ t: (key: string) => key, language: 'en' }),
  };
});

import { CloudConnectionPanel } from '../CloudConnectionPanel';

const EXPIRED_KEY = 'cloudConnection.errors.expired';
const ACCESS_DENIED_KEY = 'cloudConnection.errors.accessDenied';

/** The `/bind/start` answer — `expires_in` is which clock gets to notice. */
let startData: Record<string, unknown> = {
  device_code: 'dc_1', user_code: 'ABCD-EFGH', interval: 2, expires_in: 600,
};
/** The `/bind/poll` answer the case under test wants. */
let pollReply: { status: number; body: unknown } = { status: 200, body: {} };
/** Every URL fetched, in order — how CLIENT proves the server was never asked. */
let fetched: string[] = [];

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** objectstack's verbatim terminal `/bind/poll` envelope for an RFC 8628 code. */
const deviceAuthFailure = (declaredCode: string) => ({
  status: 400,
  body: {
    success: false,
    data: { pending: false },
    error: {
      code: 'DEVICE_CODE_FAILED',
      declaredCode,
      message: `Device authorization failed: ${declaredCode}`,
    },
  },
});

beforeEach(() => {
  fetched = [];
  startData = { device_code: 'dc_1', user_code: 'ABCD-EFGH', interval: 2, expires_in: 600 };
  pollReply = { status: 200, body: {} };
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    fetched.push(url);
    if (url.endsWith('/status')) {
      return reply(200, { success: true, data: { environmentId: null, bound: false, connection: null } });
    }
    // No verification_uri: the popup path is not this file's subject, and
    // leaving it out keeps window.open out of the run entirely.
    if (url.endsWith('/bind/start')) return reply(200, { success: true, data: startData });
    if (url.endsWith('/bind/poll')) return reply(pollReply.status, pollReply.body);
    throw new Error(`unexpected fetch: ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/**
 * Mount, connect, and let exactly one poll tick land. `interval: 2` is the floor
 * `poll()` clamps to, so the first tick fires at 2000ms — which is also what
 * decides the clock: `expires_in: 600` leaves the deadline far away (the SERVER
 * gets to answer), `expires_in: 1` has it already passed when the tick runs (the
 * PANEL answers without asking).
 */
async function connectAndPollOnce() {
  render(<CloudConnectionPanel />);
  await advance(0); // the mount-time /status read settles -> unbound
  const connect = screen.getByRole('button', { name: /cloudConnection\.unbound\.connect/ });
  await act(async () => { connect.click(); });
  await advance(0); // /bind/start settles -> waiting, first tick scheduled
  await advance(2000); // the tick
}

/** The text the error phase is currently rendering. */
const shownError = () => screen.getByRole('button', { name: /cloudConnection\.retry/ })
  .parentElement!.querySelector('.text-destructive')!.textContent!.trim();

describe('objectui#5054 — one bind failure, one language, whichever clock noticed', () => {
  it('SERVER-detected expiry reads the locale, not the wire English', async () => {
    pollReply = deviceAuthFailure('expired_token');

    await connectAndPollOnce();

    expect(fetched).toContain('/api/v1/cloud-connection/bind/poll');
    expect(screen.getByText(EXPIRED_KEY)).toBeInTheDocument();
    expect(screen.queryByText('Device authorization failed: expired_token')).not.toBeInTheDocument();
  });

  it('SERVER-detected denial reads the locale, not the wire English', async () => {
    pollReply = deviceAuthFailure('access_denied');

    await connectAndPollOnce();

    expect(screen.getByText(ACCESS_DENIED_KEY)).toBeInTheDocument();
    expect(screen.queryByText('Device authorization failed: access_denied')).not.toBeInTheDocument();
  });

  it('CLIENT-detected expiry reads the locale — the side that was already right', async () => {
    // expires_in below the 2s tick floor: the deadline has passed when the tick
    // runs, so `poll()` answers from its own clock and never asks the server.
    startData = { ...startData, expires_in: 1 };

    await connectAndPollOnce();

    expect(fetched).not.toContain('/api/v1/cloud-connection/bind/poll');
    expect(screen.getByText(EXPIRED_KEY)).toBeInTheDocument();
  });

  it('SYMMETRY: both clocks render the SAME string for the same expiry', async () => {
    pollReply = deviceAuthFailure('expired_token');
    await connectAndPollOnce();
    const serverDetected = shownError();

    // Second mount, same condition, the other reader.
    screen.getByRole('button', { name: /cloudConnection\.retry/ }); // the first is still up
    document.body.innerHTML = '';
    fetched = [];
    startData = { ...startData, expires_in: 1 };
    await connectAndPollOnce();
    const clientDetected = shownError();

    expect({ serverDetected, clientDetected })
      .toEqual({ serverDetected: EXPIRED_KEY, clientDetected: EXPIRED_KEY });
  });

  it('ROUTE: a 400 is read by getJson, never by poll()\'s terminal branch', async () => {
    // The discriminator the sibling suite's CONTROL case lost when this card
    // made both readers agree on `expired_token`. A 400 carrying NO `error`
    // object is the one fixture the two readers answer differently:
    //   getJson  -> its last arm, the literal `HTTP 400`;
    //   poll()   -> `t('cloudConnection.errors.bindFailed')`.
    // Seeing the first proves a non-2xx never reaches poll()'s display branch,
    // which is what makes `getJson` the site this card had to fix.
    pollReply = { status: 400, body: { success: false, data: { pending: false } } };

    await connectAndPollOnce();

    expect(screen.getByText('HTTP 400')).toBeInTheDocument();
    expect(screen.queryByText('cloudConnection.errors.bindFailed')).not.toBeInTheDocument();
  });

  it('CONTROL: an unrecognized code still renders the wire message (the B fallback)', async () => {
    // `invalid_grant` is a real RFC 8628 spelling the ruling deliberately did
    // NOT name — the map is closed at the two codes a user can cause. This case
    // is green before and after the fix; it fails only if the map widens.
    pollReply = deviceAuthFailure('invalid_grant');

    await connectAndPollOnce();

    expect(screen.getByText('Device authorization failed: invalid_grant')).toBeInTheDocument();
    expect(screen.queryByText(EXPIRED_KEY)).not.toBeInTheDocument();
    expect(screen.queryByText(ACCESS_DENIED_KEY)).not.toBeInTheDocument();
  });
});
