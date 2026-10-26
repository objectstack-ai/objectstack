// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7959 — the RULE, pinned where it is defined.
 *
 * Three readers on the package surfaces held three independent implementations
 * of "read the ADR-0112 failure envelope", and they had already drifted into
 * three different answers for the same body:
 *
 *   - `fetchPackages` (`views/studio-design/packages-io.ts`) never opened the
 *     body at all — `message`, `code` and `userMessage` were dropped together;
 *   - `apiJson` (`views/metadata-admin/PackagesPage.tsx`) read `error.message`
 *     and never `error.userMessage`, and appended no code;
 *   - `fetchFullPackage` (`StudioDesignSurface.tsx`) read `message` + `code`,
 *     and was taught the mark separately in objectui#7938.
 *
 * This file pins the extracted rule itself, so a fourth consumer inherits a
 * pinned rule rather than a fourth reading of the envelope. The CALL SITES are
 * pinned separately — `packages-io.envelopeUserMessage.test.ts` and
 * `PackagesPage.envelopeUserMessage.test.tsx` — because "the rule is right" and
 * "this reader actually asks it" are two different claims, and only the second
 * one is what the author sees.
 */

import { describe, expect, it } from 'vitest';
import { readEnvelopeFailureText } from './apiErrorEnvelope';

/** The generic sentence the 5xx prose withhold substitutes (`INTERNAL_ERROR_MESSAGE`). */
const GENERIC = 'Internal server error';
/** A producer's marked text: what `userMessage` carries, written for the person. */
const MARKED = 'Publishing is temporarily unavailable. Nothing was changed.';
/** The card's measured sample — a refusal that names the capability to grant. */
const CAPABILITY = 'Reading packages requires the `studio.access` or `setup.access` capability.';

/** A body exactly as `sendError` writes it: `{ success: false, error: { … } }`. */
const envelope = (error: Record<string, unknown>) => ({ success: false, error });

describe('readEnvelopeFailureText — the four combinations (#7959)', () => {
  /**
   * ⭐ The overwhelmingly common case, and the one this pin exists to protect:
   * "prefer `userMessage`" must never be implemented as "read `userMessage`
   * INSTEAD", which would blank every unmarked refusal the platform serves
   * today. Byte-identical to the pre-extraction diagnostic read.
   */
  it('§1 `message` only — the unmarked refusal renders the diagnostic', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'FORBIDDEN', message: CAPABILITY }))).toBe(
      `${CAPABILITY} (FORBIDDEN)`,
    );
  });

  it('§2 `userMessage` only — the mark is the only prose on the body', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'SERVICE_UNAVAILABLE', userMessage: MARKED }))).toBe(
      `${MARKED} (SERVICE_UNAVAILABLE)`,
    );
  });

  /**
   * The live 5xx case: the door substituted the generic sentence into
   * `message` and the mark rode through untouched. The mark DISPLACES the
   * diagnostic — it is not appended to it.
   */
  it('§3 both — the mark wins and the generic sentence does not also appear', () => {
    const shown = readEnvelopeFailureText(
      envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: MARKED }),
    );
    expect(shown).toBe(`${MARKED} (INTERNAL_ERROR)`);
    expect(shown).not.toContain(GENERIC);
  });

  it('§4 neither — no prose means no answer, and the caller states its own fallback', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'SERVICE_UNAVAILABLE' }))).toBeNull();
  });
});

describe('readEnvelopeFailureText — how `code` composes', () => {
  it('is appended to whichever prose won — the mark', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'CONFLICT', message: GENERIC, userMessage: MARKED }))).toBe(
      `${MARKED} (CONFLICT)`,
    );
  });

  it('is appended to whichever prose won — the diagnostic', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'CONFLICT', message: CAPABILITY }))).toBe(
      `${CAPABILITY} (CONFLICT)`,
    );
  });

  it('a marked body with NO code renders the bare sentence', () => {
    expect(readEnvelopeFailureText(envelope({ message: GENERIC, userMessage: MARKED }))).toBe(MARKED);
  });

  /**
   * ⛔ A code NEVER rescues a prose-less body. A machine code is not a
   * sentence to show a person, so this stays `null` and the caller falls back
   * to naming the status.
   */
  it('a code with no prose is still no prose', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'SERVICE_UNAVAILABLE' }))).toBeNull();
  });

  it('a non-string code is not a code — the prose renders bare', () => {
    expect(readEnvelopeFailureText(envelope({ code: 500, message: CAPABILITY }))).toBe(CAPABILITY);
  });
});

describe('readEnvelopeFailureText — what is not a mark', () => {
  it('a non-string `userMessage` falls through to the diagnostic', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: 42 }))).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });

  it('an empty-string `userMessage` falls through to the diagnostic', () => {
    // The producer's `declaredUserMessage` already applies the non-empty-string
    // rule, so an empty mark should never ship — this reader does not depend on
    // the producer having applied it.
    expect(readEnvelopeFailureText(envelope({ code: 'INTERNAL_ERROR', message: GENERIC, userMessage: '' }))).toBe(
      `${GENERIC} (INTERNAL_ERROR)`,
    );
  });

  it('a non-string `message` is not prose either', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'INTERNAL_ERROR', message: { nested: 'x' } }))).toBeNull();
  });

  it('an empty-string mark AND an empty-string diagnostic leave nothing to show', () => {
    expect(readEnvelopeFailureText(envelope({ code: 'INTERNAL_ERROR', message: '', userMessage: '' }))).toBeNull();
  });
});

describe('readEnvelopeFailureText — bodies that are not this envelope', () => {
  it.each([
    ['null (an unparseable body)', null],
    ['undefined', undefined],
    ['no `error` key at all', { success: false }],
    ['a bare-string `error` (an older runtime shape — the caller keeps that rung)', { error: 'boom' }],
    ['an array', [1, 2, 3]],
    ['a string', 'boom'],
    ['a number', 502],
  ])('%s → null', (_label, payload) => {
    expect(readEnvelopeFailureText(payload)).toBeNull();
  });
});

describe('readEnvelopeFailureText — structurally cannot be scoped to a status band', () => {
  /**
   * ⛔ The producing door applies NO status condition to the marked channel —
   * "a marked text is the producer's deliberate statement to the caller at any
   * status" — so a consumer honouring the mark in one band only would
   * re-create, on the reading end, the divergence that door refused to create
   * on the writing end (ruled on objectui#7938).
   *
   * This asserts that as a property of the SIGNATURE rather than as a behaviour
   * sampled at two statuses: the rule takes one parameter, the body, and the
   * status is not among its inputs. A future "only in the 5xx band" variant
   * cannot be written without changing the arity this line pins.
   */
  it('takes the body and nothing else — the status is not an input to the rule', () => {
    expect(readEnvelopeFailureText.length).toBe(1);
  });
});
