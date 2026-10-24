// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7959 — `apiJson` reads the producer-marked `error.userMessage`.
 *
 * This page's shared reader had the ladder `error.message || error || message
 * || 'Request failed (n)'`. It read the diagnostic and stopped: a
 * producer-marked `error.userMessage` arrived on the wire and had nowhere to
 * appear, and `error.code` was never rendered at all. It is the third
 * independent implementation of "read the ADR-0112 failure envelope" on the
 * package surfaces — the drift that motivated extracting one rule
 * (`utils/apiErrorEnvelope.ts`, pinned in `apiErrorEnvelope.test.ts`).
 *
 * Driven through the PAGE rather than by calling `apiJson` directly, because
 * `apiJson` is module-private and because what the card is about is what the
 * person reads: the list load calls it, and the error banner renders
 * `e.message` verbatim.
 *
 * ## ⚠️ Two rungs stay, and they are NOT the envelope
 *
 * A bare-string `error` and a top-level `message` are older runtimes' shapes,
 * live for this page's lifecycle routes and for no other consumer of the rule.
 * They stay HERE, below the shared read — folding them into the shared helper
 * would hand every other consumer a tolerant dialect it never asked for. §6
 * pins that they still work.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { PackagesPage } from './PackagesPage';

/** The generic sentence the 5xx prose withhold substitutes (`INTERNAL_ERROR_MESSAGE`). */
const GENERIC = 'Internal server error';
/** A producer's marked text: what `userMessage` carries, written for the person. */
const MARKED = 'Publishing is temporarily unavailable. Nothing was changed.';
/** The card's measured sample — a refusal that names the capability to grant. */
const CAPABILITY = 'Reading packages requires the `studio.access` or `setup.access` capability.';

/**
 * `apiJson` reads the body as TEXT and `JSON.parse`s it (not `res.json()`), so
 * the stub has to answer `text` — mirroring `PackageFormDialog.test.tsx`.
 */
function stubBody(status: number, body: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    })) as unknown as typeof fetch,
  );
}

/** A failure exactly as `sendError` writes it. */
const envelope = (error: Record<string, unknown>) => ({ success: false, error });

/** What the page's error banner ends up showing the person. */
async function bannerFor(status: number, body: unknown): Promise<string> {
  stubBody(status, body);
  render(
    <MemoryRouter>
      <PackagesPage />
    </MemoryRouter>,
  );
  const banner = await screen.findByTestId('packages-load-error');
  await waitFor(() => expect(banner.textContent).toBeTruthy());
  return banner.textContent ?? '';
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PackagesPage / apiJson — the four combinations (#7959)', () => {
  /**
   * ⭐ GREEN with the fix reverted, and load-bearing for exactly that reason.
   * This reader already rendered `error.message`, so the unmarked refusal — the
   * overwhelmingly common case — must come through byte for byte. It is the pin
   * that stops "prefer `userMessage`" from being implemented as "read
   * `userMessage` INSTEAD", which would have blanked every refusal this page
   * serves today.
   *
   * Deliberately code-less: the code append is new behaviour and would make
   * this case red on revert, costing the guard its role. §5 covers the code.
   */
  it('§1 `message` only, no code — the unmarked refusal, byte for byte as before', async () => {
    expect(await bannerFor(403, envelope({ message: CAPABILITY }))).toBe(CAPABILITY);
  });

  it('§2 `userMessage` only — the marked sentence instead of `Request failed (503)`', async () => {
    const shown = await bannerFor(503, envelope({ code: 'SERVICE_UNAVAILABLE', userMessage: MARKED }));
    expect(shown).toBe(`${MARKED} (SERVICE_UNAVAILABLE)`);
    expect(shown).not.toContain('Request failed');
  });

  it('§3 both — the mark displaces the generic substitution', async () => {
    const shown = await bannerFor(500, envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED }));
    expect(shown).toBe(`${MARKED} (INTERNAL_ERROR)`);
    expect(shown).not.toContain(GENERIC);
  });

  it('§4 neither — this page names the status its own way, unchanged', async () => {
    expect(await bannerFor(503, envelope({ code: 'SERVICE_UNAVAILABLE' }))).toBe('Request failed (503)');
  });
});

describe('PackagesPage / apiJson — how `code` composes', () => {
  it('§5 the code is appended to whichever prose won — the diagnostic', async () => {
    expect(await bannerFor(403, envelope({ code: 'FORBIDDEN', message: CAPABILITY }))).toBe(
      `${CAPABILITY} (FORBIDDEN)`,
    );
  });

  it('§5 the code is appended to whichever prose won — the mark', async () => {
    expect(await bannerFor(409, envelope({ code: 'RESOURCE_CONFLICT', message: GENERIC, userMessage: MARKED }))).toBe(
      `${MARKED} (RESOURCE_CONFLICT)`,
    );
  });

  it('§5 a marked body with no code renders the bare sentence', async () => {
    expect(await bannerFor(503, envelope({ message: GENERIC, userMessage: MARKED }))).toBe(MARKED);
  });

  it('§5 a non-string mark is not a mark — it falls through to the diagnostic', async () => {
    expect(await bannerFor(500, envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: 42 }))).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });

  it('§5 an empty-string mark is not a mark either', async () => {
    expect(await bannerFor(500, envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: '' }))).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });
});

describe('PackagesPage / apiJson — the legacy rungs below the envelope (GREEN with the fix reverted)', () => {
  it('§6 a bare-string `error` still reaches the banner', async () => {
    expect(await bannerFor(500, { success: false, error: 'metadata service unavailable' })).toBe(
      'metadata service unavailable',
    );
  });

  it('§6 a top-level `message` still reaches the banner', async () => {
    expect(await bannerFor(500, { success: false, message: 'metadata service unavailable' })).toBe(
      'metadata service unavailable',
    );
  });

  it('§6 a body with no readable prose anywhere still names the status', async () => {
    expect(await bannerFor(500, { success: false })).toBe('Request failed (500)');
  });
});

/**
 * ⚠️ Its own block, and NOT under the green-when-reverted heading above: this
 * one asserts the mark, so it goes RED on revert like §2/§3/§5. The forward
 * control caught it living under that heading, which would have read as a
 * claim the run does not support.
 */
describe('PackagesPage / apiJson — the 200 that declares failure', () => {
  /**
   * ⭐ The failure trigger is `!res.ok || payload.success === false`, so a 200
   * that declares failure is a refusal too — and it is the arm a fix that
   * reached only for `!res.ok` would silently leave behind.
   */
  it('§7 a 200 that declares `success: false` is still a refusal, and now carries the mark', async () => {
    expect(await bannerFor(200, envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED }))).toBe(
      `${MARKED} (INTERNAL_ERROR)`,
    );
  });
});
