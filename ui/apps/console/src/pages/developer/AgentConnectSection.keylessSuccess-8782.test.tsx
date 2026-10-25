// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#8782 — the agent-key generator's two failure modes must produce two
 * DIFFERENT sentences.
 *
 * Before: one `throw` behind a disjunction —
 *
 *   if (!res.ok || !data?.key) {
 *     throw new Error(json?.error?.message || `Request failed (${res.status})`);
 *   }
 *
 * so a response that was `ok` but carried no key reached the same template and
 * the real status got interpolated: a **200** was reported to the developer as
 * `Request failed (200)`. Nothing about the transport went wrong; the sentence
 * named the one layer known to have worked, and the thrown string is the entire
 * report `setError(...)` shows.
 *
 * ── Why the keyless-success arm is reachable (measured, not assumed) ─────────
 * The mint route cannot itself emit a keyless success: its only success is
 * `201` and it always carries `data.key` (objectstack
 * `packages/runtime/src/domains/keys.ts`, pinned at `expect(res.response.status)
 * .toBe(201)` in `http-dispatcher.keys.test.ts`). The arm is reachable through
 * the CONSUMER instead — `await res.json().catch(() => ({}))` turns every 2xx
 * whose body is not that envelope into `{}`: an SSO or proxy interstitial
 * answering `200` with HTML, an empty body, a gateway page. §3 drives exactly
 * that shape.
 *
 * ── The control ─────────────────────────────────────────────────────────────
 * §3's load-bearing assertions are ABSENCES (no `Request failed`, no status).
 * An absence passes vacuously if the harness never produced an error at all —
 * a dead selector, a click that missed, a component that never threw. So §3
 * re-runs `errorTextFor` on a `!res.ok` response IN THE SAME TEST and requires
 * `/Request failed \(\d+\)/` to fire: same helper, same command shape, same
 * selector, same click. With the control lit, §3's zero is a reading. §2 is the
 * same control standing on its own as a regression pin for the `!res.ok` arm.
 *
 * ⛔ Out of scope, deliberately: `error.userMessage` and `error.code`
 * (objectui#7980, gated). The `json?.error?.message` read is pinned here
 * UNCHANGED by §1 — this card must not move it.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AgentConnectSection } from './AgentConnectSection';

/** Discovery is answered so the mount effect settles before the click. */
const DISCOVERY = { data: { routes: { mcp: '/api/v1/mcp' } } };

interface KeysAnswer {
  status: number;
  /** `undefined` ⇒ a body that is not JSON at all (the proxy-page shape). */
  body?: unknown;
}

/**
 * ONE command shape, shared by every section below — that is what makes §3's
 * control a control. Renders the section, clicks `Generate key`, and returns
 * the text of the error paragraph.
 *
 * The selector tracks the source's own literal `className` on the error node
 * (`<p className="mt-1 text-xs text-destructive">{error}</p>`); it is a plain
 * string there, not a `cn()` merge, so it is exact. A selector that stopped
 * matching would take the control down with it, which is the point.
 */
async function errorTextFor(keys: KeysAnswer): Promise<string> {
  const fetchMock = vi.fn(async (url: unknown) => {
    if (String(url).includes('/discovery')) {
      return { ok: true, status: 200, json: async () => DISCOVERY } as unknown as Response;
    }
    return {
      ok: keys.status >= 200 && keys.status < 300,
      status: keys.status,
      json: async () => {
        if (!('body' in keys)) throw new SyntaxError('Unexpected token < in JSON at position 0');
        return keys.body;
      },
    } as unknown as Response;
  });
  vi.stubGlobal('fetch', fetchMock);

  const { container } = render(<AgentConnectSection />);
  // Let the discovery effect settle so its state update is not interleaved
  // with the click's.
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());

  await userEvent.click(within(container).getByRole('button', { name: /Generate key/i }));
  // objectui#13383: the click opens a confirm naming the key; confirming it is
  // what sends the POST. No provider here, so the label reads as its key.
  const confirm = await screen.findByRole('alertdialog');
  await userEvent.click(within(confirm).getByRole('button', { name: 'connectAgent.apiKey.mint' }));

  await waitFor(() => {
    expect(container.querySelector('p.text-destructive')).not.toBeNull();
  });
  const text = container.querySelector('p.text-destructive')?.textContent ?? '';
  cleanup();
  return text;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AgentConnectSection — generateKey failure sentences (objectui#8782)', () => {
  it('§1 `!res.ok` with an envelope message — unchanged: the diagnostic message', async () => {
    const text = await errorTextFor({
      status: 500,
      body: { success: false, error: { message: 'Data service not available' } },
    });
    expect(text).toBe('Data service not available');
  });

  it('§2 `!res.ok` with no envelope message — unchanged: `Request failed (<status>)`', async () => {
    // The lit control, standing alone. `Request failed (n)` is CORRECT here:
    // 503 is a real failure and the status is real evidence of it.
    const text = await errorTextFor({ status: 503, body: { success: false } });
    expect(text).toBe('Request failed (503)');
  });

  it('§3 a 200 that carried no key — its own sentence, and no status quoted', async () => {
    const text = await errorTextFor({ status: 200, body: { success: true, data: {} } });

    // Positive: the arm now says what actually happened.
    expect(text).toBe(
      'The request succeeded but the response carried no API key. '
        + 'Nothing failed in transit — inspect the response body of POST /api/v1/keys.',
    );

    // ── The two absences this card exists for ──────────────────────────────
    expect(text).not.toMatch(/Request failed/);
    // ⛔ No status at all: quoting a 2xx is what made the old string read as a
    // transport failure that never happened.
    expect(text).not.toMatch(/\d{3}/);

    // ── CONTROL, in this same test: the same helper, the same command shape,
    // the same selector and click DO produce a `Request failed (n)` string.
    // Without this the two absences above would also pass on a harness that
    // rendered no error whatsoever.
    const control = await errorTextFor({ status: 503, body: { success: false } });
    expect(control).toMatch(/Request failed \(\d{3}\)/);
    expect(control).toMatch(/\d{3}/);
  });

  it('§4 a 200 whose body is not JSON at all — the same sentence, not a transport failure', async () => {
    // The measured real-world shape: `res.json()` rejects, the source's
    // `.catch(() => ({}))` swallows it, and `!data?.key` is the arm that
    // catches it. This is how a proxy or sign-in interstitial arrives.
    const text = await errorTextFor({ status: 200 });
    expect(text).toMatch(/^The request succeeded but the response carried no API key\./);
    expect(text).not.toMatch(/Request failed/);
  });
});
