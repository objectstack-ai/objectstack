/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#5028 — what the bind-failure surface actually shows a human, and
 * from which of the panel's TWO failure readers it comes.
 *
 * The card asked for one call site to stop preferring a machine code:
 * `poll()`'s terminal branch read `body?.error?.code ?? t(...)`, while
 * `getJson()` fifty lines above already reads `message ?? code ?? error`. That
 * change is made and pinned below.
 *
 * ## The card's SYMPTOM claim does not survive verification
 *
 * The card predicted that after objectstack#9267 / PR #9369 a user would see
 * `DEVICE_CODE_FAILED` where they previously saw `expired_token`, i.e. that the
 * device-authorization failure is displayed by the `poll()` branch. It is not.
 * That envelope is served with HTTP **400**
 * (`packages/cloud-connection/src/cloud-connection-plugin.ts`, the `/bind/poll`
 * terminal exit — 400 before PR #9369 and 400 after it), and `getJson` throws
 * on any non-2xx whose body is not `success: true`. So the string a user reads
 * for an expired or denied device code has always come from `getJson`'s
 * precedence, which already preferred `message` — the upstream fix reached the
 * UI the moment it merged, with no change needed here.
 *
 * The first case below is the CONTROL that pins exactly that, so the next
 * reader is not sent looking for this text in `poll()`.
 *
 * ## What is genuinely reached by the changed line
 *
 * `poll()`'s terminal branch runs only for a body `getJson` hands BACK, i.e. a
 * 2xx, that then says neither `data.pending` nor `data.bound` nor
 * `success: true`. `/bind/poll` has exactly one such exit: it returns the
 * control plane's own `/bind` answer verbatim, `c.json(bindJson,
 * bindResp.status)`. A control plane answering 200 with `success: false` — an
 * envelope violation on its side, and precisely the population objectstack#9364
 * is still counting — lands here, and this is where a code used to be rendered
 * instead of the sentence beside it.
 *
 * ## Reverse verification (direction predicted BEFORE running)
 *
 *   - Revert the line to `code ?? t(...)`: case 2 RED (reads
 *     `ENVIRONMENT_BIND_FAILED` where the sentence was expected), cases 3 and 4
 *     GREEN (no `message` to prefer), case 1 GREEN — it never used this line.
 *   - Invert the chain to `code ?? message ?? t(...)`: case 2 RED for the same
 *     reason, 1/3/4 GREEN. Only case 2 can tell the two orders apart, because
 *     it is the only fixture that carries both halves.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

// Spread the real module: other exports (`createSafeTranslation`) are pulled
// from it by packages this component's graph imports, and a bare factory would
// blank them out.
vi.mock('@object-ui/i18n', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@object-ui/i18n');
  return {
    ...actual,
    // Identity `t`: an assertion on the KEY is the honest way to say "the
    // translated string was chosen", without pinning today's English copy.
    useObjectTranslation: () => ({ t: (key: string) => key, language: 'en' }),
  };
});

import { CloudConnectionPanel } from '../CloudConnectionPanel';

const BIND_FAILED_KEY = 'cloudConnection.errors.bindFailed';

/** The `/bind/poll` answer the case under test wants. */
let pollReply: { status: number; body: unknown } = { status: 200, body: {} };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith('/status')) {
      return reply(200, { success: true, data: { environmentId: null, bound: false, connection: null } });
    }
    if (url.endsWith('/bind/start')) {
      // No verification_uri: the popup path is not this file's subject, and
      // leaving it out keeps window.open out of the run entirely.
      return reply(200, {
        success: true,
        data: { device_code: 'dc_1', user_code: 'ABCD-EFGH', interval: 2, expires_in: 600 },
      });
    }
    if (url.endsWith('/bind/poll')) return reply(pollReply.status, pollReply.body);
    throw new Error(`unexpected fetch: ${url}`);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** Move the clock, flushing the promises each timer wakes. */
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

/**
 * Mount, connect, and let exactly one poll tick land. `interval: 2` is the
 * floor `poll()` clamps to, so the first tick fires at 2000ms.
 */
async function connectAndPollOnce() {
  render(<CloudConnectionPanel />);
  await advance(0); // the mount-time /status read settles -> unbound
  const connect = screen.getByRole('button', { name: /cloudConnection\.unbound\.connect/ });
  await act(async () => { connect.click(); });
  await advance(0); // /bind/start settles -> waiting, first tick scheduled
  await advance(2000); // the tick, and the /bind/poll read it issues
}

describe('objectui#5028 — the bind-failure text a human reads', () => {
  it('CONTROL: the upstream 400 device-authorization envelope is rendered by getJson, not by poll()', async () => {
    // objectstack#9267's body, verbatim, at the status it is served with.
    // `getJson` throws on it, so the message shown is the one IT picked; the
    // changed line in poll() is not on this path in either direction.
    //
    // objectui#5054 moved what "the one IT picked" IS. This case used to assert
    // the wire sentence `Device authorization failed: expired_token`; that was
    // the measured asymmetry — the SAME expiry noticed by the panel's own clock
    // rendered `cloudConnection.errors.expired`, so one condition read in two
    // languages. `getJson` now carries the envelope's codes across its throw and
    // the catch maps the two user-causable RFC 8628 spellings onto that key, so
    // both readers land on it. The fixture is untouched — it is still the
    // producer's verbatim envelope — and the `DEVICE_CODE_FAILED` negative is
    // still this file's own subject: no machine code reaches a human.
    //
    // ⚠️ What this case lost, and where it went: the wire English used to
    // DISCRIMINATE the two readers, because only `getJson` produced it. Post-fix
    // both readers answer `expired_token` identically — that is the point of the
    // card — so the route claim in this case's title now rests on the argument
    // above (400 -> `getJson` throws) rather than on its own assertion. The
    // measurable discriminator moved to `CloudConnectionPanel.bindErrorLocale
    // .test.tsx`'s ROUTE case, which uses a 400 carrying no `error` object at
    // all: `getJson` renders `HTTP 400`, poll()'s terminal branch would render
    // `cloudConnection.errors.bindFailed`, and nothing else tells them apart.
    pollReply = {
      status: 400,
      body: {
        success: false,
        data: { pending: false },
        error: {
          code: 'DEVICE_CODE_FAILED',
          declaredCode: 'expired_token',
          message: 'Device authorization failed: expired_token',
        },
      },
    };

    await connectAndPollOnce();

    expect(screen.getByText('cloudConnection.errors.expired')).toBeInTheDocument();
    expect(screen.queryByText('Device authorization failed: expired_token')).not.toBeInTheDocument();
    expect(screen.queryByText('DEVICE_CODE_FAILED')).not.toBeInTheDocument();
  });

  it('prefers error.message over error.code on a 2xx failure body — the changed line', async () => {
    // The `/bind` pass-through: the control plane's answer, forwarded with its
    // own status. 2xx, so getJson returns it; no pending/bound/success, so
    // poll()'s terminal branch is what renders it.
    pollReply = {
      status: 200,
      body: {
        success: false,
        data: { pending: false },
        error: { code: 'ENVIRONMENT_BIND_FAILED', message: 'This environment is already bound to another organization.' },
      },
    };

    await connectAndPollOnce();

    expect(screen.getByText('This environment is already bound to another organization.')).toBeInTheDocument();
    expect(screen.queryByText('ENVIRONMENT_BIND_FAILED')).not.toBeInTheDocument();
  });

  it('falls back to error.code when the body carries no message', async () => {
    // The pre-#9369 shape, and any producer still short of ApiErrorSchema's
    // required `message`. Showing the code beats showing nothing, so the
    // fallback arm stays.
    pollReply = {
      status: 200,
      body: { success: false, data: { pending: false }, error: { code: 'ENVIRONMENT_BIND_FAILED' } },
    };

    await connectAndPollOnce();

    expect(screen.getByText('ENVIRONMENT_BIND_FAILED')).toBeInTheDocument();
    expect(screen.queryByText(BIND_FAILED_KEY)).not.toBeInTheDocument();
  });

  it('falls back to the translated string when there is no error object at all', async () => {
    pollReply = { status: 200, body: { success: false, data: { pending: false } } };

    await connectAndPollOnce();

    expect(screen.getByText(BIND_FAILED_KEY)).toBeInTheDocument();
  });
});
