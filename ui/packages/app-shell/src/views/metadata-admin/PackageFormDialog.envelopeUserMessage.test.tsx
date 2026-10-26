// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7979 — `PackageFormDialog`'s `apiJson` reads the producer-marked
 * `error.userMessage`.
 *
 * This dialog held the FOURTH copy of the ADR-0112 failure-envelope ladder,
 * character for character the one `PackagesPage`'s `apiJson` had before
 * objectui#7959: `error.message || error || message || 'Request failed (n)'`.
 * It read the diagnostic and stopped, so a producer-marked `error.userMessage`
 * arrived on the wire with nowhere to appear and `error.code` never reached the
 * author at all. The rule now comes from ONE place —
 * `utils/apiErrorEnvelope.ts` (`readEnvelopeFailureText`), pinned in
 * `apiErrorEnvelope.test.ts` — and this file pins what THIS call site does with
 * it. Shape copied from `PackagesPage.envelopeUserMessage.test.tsx`.
 *
 * Driven through the DIALOG rather than by calling `apiJson` directly, because
 * `apiJson` is module-private and because what the card is about is what the
 * author reads: create/edit is where a person meets a refusal that names what
 * to fix, and the banner renders the caught `e.message` verbatim.
 *
 * ## ⚠️ Two rungs stay, and they are NOT the envelope
 *
 * A bare-string `error` and a top-level `message` are older runtimes' shapes,
 * live for this call site and for no other consumer of the rule. They stay
 * HERE, below the shared read — folding them into the shared helper would hand
 * every other consumer a tolerant dialect it never asked for. §6 pins that they
 * still work.
 *
 * ## ⚠️ Why §1–§7 use neither 403 nor 409
 *
 * Unlike the page, this dialog's `catch` has two STATUS-driven arms in front of
 * the banner (409 → the localized "already exists" copy, 403 → the localized
 * capability copy, objectstack#8270). §1–§7 are about the LADDER, so each
 * uses a status that reaches the `else` arm and none of them depends on what
 * the arms do.
 *
 * §8 is about the arms themselves, and objectui#8051 changed them: the ruling
 * of record is 「本地化分支改为优先使用生产方消息」 — a producer-marked
 * `userMessage` OUTRANKS the localized constant on both arms, and the constant
 * stays as the fallback for an unmarked body. The pins below were written by
 * objectui#7979 to record the arms as untouched; they are UPDATED here rather
 * than removed, and the before/after of each is stated on the case.
 */

import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { PackageFormDialog } from './PackageFormDialog';
import { t } from './i18n';

// Only `useMetadataLocale` is replaced — the `t` resolver and both string
// tables stay real, so §8 asserts against the strings the product ships.
vi.mock('./i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataLocale: () => 'en-US',
}));

/** The generic sentence the 5xx prose withhold substitutes (`INTERNAL_ERROR_MESSAGE`). */
const GENERIC = 'Internal server error';
/** A producer's marked text: what `userMessage` carries, written for the person. */
const MARKED = 'Publishing is temporarily unavailable. Nothing was changed.';
/** An ordinary unmarked refusal on this surface — a version rule, stated by the door. */
const VERSION = 'Version 1.2.0 is published; bump the version before saving.';
/** A second one — the namespace rule the card names as a create-time refusal. */
const NAMESPACE = 'Namespace `Acme CRM` is not a legal object-name namespace.';

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

/** Fill the create form and submit it; returns what the error banner shows. */
async function bannerFor(status: number, body: unknown): Promise<string> {
  stubBody(status, body);
  render(<PackageFormDialog mode="create" open onOpenChange={vi.fn()} onSaved={vi.fn()} />);
  fireEvent.change(await screen.findByLabelText(/package id/i), { target: { value: 'com.acme.new' } });
  fireEvent.change(screen.getByLabelText(/display name/i), { target: { value: 'New App' } });
  fireEvent.click(screen.getByTestId('package-form-submit'));
  const banner = await screen.findByTestId('package-form-error');
  return banner.textContent ?? '';
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PackageFormDialog / apiJson — the four combinations (#7979)', () => {
  /**
   * ⭐ GREEN with the fix reverted, and load-bearing for exactly that reason.
   * This reader already rendered `error.message`, so the unmarked refusal — the
   * overwhelmingly common case, and everything on the wire today — must come
   * through byte for byte. It is the pin that stops "prefer `userMessage`" from
   * being implemented as "read `userMessage` INSTEAD", which would have blanked
   * every ordinary refusal this dialog serves.
   *
   * Deliberately code-less: the code append is new behaviour and would make
   * this case red on revert, costing the guard its role. §5 covers the code.
   */
  it('§1 `message` only, no code — the unmarked refusal, byte for byte as before', async () => {
    expect(await bannerFor(422, envelope({ message: VERSION }))).toBe(VERSION);
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

  it('§4 neither — this dialog names the status its own way, unchanged', async () => {
    expect(await bannerFor(503, envelope({ code: 'SERVICE_UNAVAILABLE' }))).toBe('Request failed (503)');
  });
});

describe('PackageFormDialog / apiJson — how `code` composes', () => {
  it('§5 the code is appended to whichever prose won — the diagnostic', async () => {
    expect(await bannerFor(422, envelope({ code: 'INVALID_NAMESPACE', message: NAMESPACE }))).toBe(
      `${NAMESPACE} (INVALID_NAMESPACE)`,
    );
  });

  it('§5 the code is appended to whichever prose won — the mark', async () => {
    expect(await bannerFor(500, envelope({ code: 'STORAGE_UNAVAILABLE', message: GENERIC, userMessage: MARKED }))).toBe(
      `${MARKED} (STORAGE_UNAVAILABLE)`,
    );
  });

  it('§5 a marked body with no code renders the bare sentence', async () => {
    expect(await bannerFor(500, envelope({ message: GENERIC, userMessage: MARKED }))).toBe(MARKED);
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

describe('PackageFormDialog / apiJson — the legacy rungs below the envelope (GREEN with the fix reverted)', () => {
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
 * one asserts the mark, so it goes RED on revert like §2/§3/§5.
 */
describe('PackageFormDialog / apiJson — the 200 that declares failure', () => {
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

/**
 * objectui#8051 — the two localized arms in front of the banner, and which
 * sentence wins on each.
 *
 * ## The rule these pin
 *
 * The localized constants are a GENERIC SUBSTITUTION. objectui#3821's rule, in
 * the envelope writer's words, is that a consumer "renders it verbatim and
 * keeps its generic substitution for everything unmarked" — so a MARKED body
 * outranks the constant and an UNMARKED body still gets it. objectui#7979
 * pinned the arms as unchanged (both cases below showed the localized copy
 * "mark or no mark"); the ruling of record on objectui#8051 changed that for
 * the marked half only, and these cases now pin both halves.
 *
 * ## ⛔ Why this does not regress objectstack#8270
 *
 * #8270 (maintainer ruling 2026-08-13) put the localized capability copy here
 * because "Managing packages requires the `manage_metadata` capability." was
 * measured verbatim in a zh console. That sentence is the door's DIAGNOSTIC —
 * `sendError(res, 403, 'FORBIDDEN', …)` in `@objectstack/rest`
 * `package-routes.ts` passes no `extra`, so nothing marks it — and the
 * unmarked cases below are that exact body: they still show the localized copy.
 * The ruling's measurement is preserved, not traded away.
 *
 * ## What the arms hand over when the mark wins
 *
 * The COMPOSED sentence, i.e. the same bytes `§1–§7`'s `else` arm would show
 * for the same body (mark, plus the declared `code` in parentheses) — not the
 * bare `userMessage`. That is the point of the card: the divergence it measured
 * was that a marked body read one way with a status and another way without
 * one, and §8d pins that it now reads the SAME way. Handing over the bare
 * sentence here would have shrunk that divergence to the code suffix rather
 * than removing it.
 */
describe('PackageFormDialog — the status-driven arms in front of the banner (#8051)', () => {
  it('§8a a 409 carrying a mark now shows the mark — was: the localized "already exists" copy', async () => {
    const shown = await bannerFor(409, envelope({ code: 'RESOURCE_CONFLICT', message: GENERIC, userMessage: MARKED }));
    expect(shown).toBe(`${MARKED} (RESOURCE_CONFLICT)`);
    expect(shown).not.toBe(t('engine.packages.create.exists', 'en-US'));
  });

  it('§8a a 403 carrying a mark now shows the mark — was: the localized capability copy', async () => {
    const shown = await bannerFor(403, envelope({ code: 'FORBIDDEN', message: GENERIC, userMessage: MARKED }));
    expect(shown).toBe(`${MARKED} (FORBIDDEN)`);
    expect(shown).not.toBe(t('engine.packages.noCapability', 'en-US'));
  });

  /**
   * ⭐ The half objectstack#8270 ruled, and the half that carries every refusal
   * on the wire today. GREEN both before and after objectui#8051, and
   * load-bearing for exactly that reason: it is the pin that stops "prefer the
   * mark" from being implemented as "read the mark INSTEAD", which would have
   * blanked the localized posture on every real 409 and 403 this dialog serves.
   */
  it('§8b an UNMARKED 409 still shows the localized "already exists" copy', async () => {
    expect(await bannerFor(409, envelope({ code: 'RESOURCE_CONFLICT', message: GENERIC }))).toBe(
      t('engine.packages.create.exists', 'en-US'),
    );
  });

  it("§8b an UNMARKED 403 — the door's own sentence, exactly as objectstack#8270 measured it — still shows the localized capability copy", async () => {
    expect(
      await bannerFor(403, envelope({ code: 'FORBIDDEN', message: 'Managing packages requires the `manage_metadata` capability.' })),
    ).toBe(t('engine.packages.noCapability', 'en-US'));
  });

  /**
   * The mark predicate is the shared reader's, byte for byte: a typed `string`
   * check, not a truthiness one. Neither of these bodies is marked, so both
   * take the localized arm — ⛔ never the raw diagnostic, which is what a
   * truthiness check would have leaked here.
   */
  it('§8c a non-string mark is not a mark — the 403 arm keeps the localized copy', async () => {
    expect(await bannerFor(403, envelope({ code: 'FORBIDDEN', message: GENERIC, userMessage: 42 }))).toBe(
      t('engine.packages.noCapability', 'en-US'),
    );
  });

  it('§8c an empty-string mark is not a mark either — the 409 arm keeps the localized copy', async () => {
    expect(await bannerFor(409, envelope({ code: 'RESOURCE_CONFLICT', message: GENERIC, userMessage: '' }))).toBe(
      t('engine.packages.create.exists', 'en-US'),
    );
  });

  /**
   * ⭐ The card's decisive measurement, now pinned as an EQUALITY rather than
   * as two separate readings.
   *
   * Before objectui#8051 the answer to "does a producer's `userMessage` reach
   * the author?" depended on whether an HTTP status survived the transport: with
   * a 409 the localized copy answered, with the status dropped the arms fell
   * back to probing the message and the mark came through. That is an accident
   * of transport, not a posture. These two renders send the SAME body and differ
   * only in whether the status arrived; they must now agree.
   */
  it('§8d the same marked body reads the same with a status and without one', async () => {
    const body = envelope({ code: 'RESOURCE_CONFLICT', message: "Package 'com.acme.new' already exists", userMessage: MARKED });
    const withStatus = await bannerFor(409, body);
    cleanup();
    const withoutStatus = await bannerFor(0, body);
    expect(withStatus).toBe(withoutStatus);
    expect(withStatus).toBe(`${MARKED} (RESOURCE_CONFLICT)`);
  });

  /**
   * The same equality against the `else` arm, which is the one place the mark
   * always reached the author. A 503 is not 409 or 403, so it lands there; the
   * body is identical. ⛔ If these ever diverge, the arms have grown a dialect.
   */
  it('§8d a marked 403 reads exactly as the same body would on a status with no arm', async () => {
    const body = envelope({ code: 'FORBIDDEN', message: GENERIC, userMessage: MARKED });
    const onTheArm = await bannerFor(403, body);
    cleanup();
    const onTheElseArm = await bannerFor(503, body);
    expect(onTheArm).toBe(onTheElseArm);
  });

  /**
   * objectui#7979's third §8 case, unchanged in both text and verdict: with no
   * status the arms probe the MESSAGE, the probe reads whichever prose won, and
   * a mark that does not repeat the diagnostic's wording reaches the author.
   * It was the evidence that the old divergence was transport-shaped; it stays
   * as the pin that the no-status path did not move while the status path did.
   */
  it('§8e with no status at all, the probe reads whichever prose won', async () => {
    expect(
      await bannerFor(0, envelope({ message: "Package 'com.acme.new' already exists", userMessage: MARKED })),
    ).toBe(MARKED);
  });
});
