// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7980 — the agent-key generator reads the ADR-0112 failure envelope
 * through the ONE shared rule.
 *
 * `AgentConnectSection.generateKey` read `json?.error?.message` and stopped, so
 * two DECLARED things never reached the developer whose key generation had just
 * been refused:
 *
 *  - `error.userMessage` — the producer's #9934 marked channel. Its PRESENCE is
 *    the marking, and the envelope writer's own rule is that a consumer which
 *    sees the field renders it verbatim. ⭐ The 5xx band is where the loss is
 *    expensive and where §3 below lives: the producing door substitutes the
 *    generic `Internal server error` into `message` while the mark rides
 *    through untouched, so a marked 500/503 showed the developer the generic
 *    sentence and discarded the specific one written for them.
 *  - `error.code`, which never reached the surface at all.
 *
 * The thrown string lands in `setError(...)` and IS the whole report the
 * developer gets, so this file drives the SECTION and reads what is rendered —
 * "the rule is right" (pinned once, in `@object-ui/app-shell`'s
 * `utils/apiErrorEnvelope.test.ts`) and "this reader actually asks it" are two
 * different claims, and only the second is what the developer sees. The case
 * table below is deliberately the same one that pin asserts, so the two cannot
 * drift silently: §1 unmarked, §2 marked-only, §3 both, §4 neither.
 *
 * ⛔ NOT pinned here: the `!data?.key`-on-200 arm. That is objectui#8782 /
 * PR objectui#8787, in flight on this same file and free to change the
 * `Request failed (n)` wording. A pin of that string from THIS card would be a
 * tripwire on that one's landing. This card left the condition byte-identical.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentConnectSection } from './AgentConnectSection';

/** The generic sentence the 5xx prose withhold substitutes (`INTERNAL_ERROR_MESSAGE`). */
const GENERIC = 'Internal server error';
/** A producer's marked text: what `userMessage` carries, written for the person. */
const MARKED = 'Your plan allows 5 agent keys and 5 are already active. Revoke one first.';
/** An unmarked refusal's diagnostic — the overwhelmingly common case. */
const CAPABILITY = 'Minting an API key requires the `api.keys.manage` capability.';

/** A failure body exactly as `sendError` writes it. */
const envelope = (error: Record<string, unknown>) => ({ success: false, error });

/**
 * The section fires `/api/v1/discovery` on mount and `POST /api/v1/keys` on the
 * button. Only the second one carries the envelope under test; discovery is
 * answered with a plain enabled route so the component settles.
 */
function stubKeysFailure(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v1/discovery')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: { routes: { mcp: '/api/v1/mcp' } } }),
        };
      }
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
      };
    }) as unknown as typeof fetch,
  );
}

/** What the developer ends up reading under the Generate key button. */
async function shownErrorFor(status: number, body: unknown): Promise<string> {
  stubKeysFailure(status, body);
  render(<AgentConnectSection />);
  await userEvent.click(await screen.findByRole('button', { name: 'Generate key' }));
  // objectui#13383: the click opens a confirm naming the key; confirming it is
  // what sends the POST. No provider here, so the label reads as its key.
  const confirm = await screen.findByRole('alertdialog');
  await userEvent.click(within(confirm).getByRole('button', { name: 'connectAgent.apiKey.mint' }));
  const shown = await screen.findByText(/./, { selector: 'p.text-destructive' });
  await waitFor(() => expect(shown.textContent).toBeTruthy());
  return shown.textContent ?? '';
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentConnectSection — the envelope read (#7980)', () => {
  /**
   * The unmarked refusal. This reader already rendered `message`, so the prose
   * comes through unchanged — but `error.code` is now appended, which it never
   * was before. That append is the ruling's, not an embellishment: a developer
   * reading a refused mint needs the machine code to search for.
   */
  it('§1 `message` only — the diagnostic renders, with the declared code appended', async () => {
    expect(await shownErrorFor(403, envelope({ code: 'FORBIDDEN', message: CAPABILITY }))).toBe(
      `${CAPABILITY} (FORBIDDEN)`,
    );
  });

  it('§2 `userMessage` only — the mark is the only prose on the body', async () => {
    expect(
      await shownErrorFor(503, envelope({ code: 'SERVICE_UNAVAILABLE', userMessage: MARKED })),
    ).toBe(`${MARKED} (SERVICE_UNAVAILABLE)`);
  });

  /**
   * ⭐ The card's headline case. A marked 500: the door has already replaced
   * the producer's prose in `message` with the generic sentence, and the mark
   * rode through. The mark DISPLACES the diagnostic — the generic sentence must
   * not also appear, or the developer reads both and believes the generic one.
   */
  it('§3 both — the marked 5xx shows the mark, and the generic sentence is gone', async () => {
    const shown = await shownErrorFor(
      500,
      envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED }),
    );
    expect(shown).toBe(`${MARKED} (INTERNAL_ERROR)`);
    expect(shown).not.toContain(GENERIC);
  });

  /**
   * No prose at all: the shared rule answers `null` — ⛔ a code alone is never
   * promoted into a sentence for a person — and THIS caller states its own
   * fallback, which is why the rule returns `null` instead of folding one in.
   */
  it('§4 neither — no prose on the body leaves this caller its own fallback', async () => {
    expect(await shownErrorFor(503, envelope({ code: 'SERVICE_UNAVAILABLE' }))).toBe(
      'Request failed (503)',
    );
  });

  /**
   * The mark is honoured at ANY status, because the producing door applies no
   * status condition to the channel. A reader that honoured it in the 5xx band
   * only would re-create, on the READING end, the divergence that door refuses
   * to create on the WRITING end.
   */
  it('§5 the mark is not scoped to a status band — a marked 409 renders it too', async () => {
    expect(
      await shownErrorFor(409, envelope({ code: 'CONFLICT', message: GENERIC, userMessage: MARKED })),
    ).toBe(`${MARKED} (CONFLICT)`);
  });
});
