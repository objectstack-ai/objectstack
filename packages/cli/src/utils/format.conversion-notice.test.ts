// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { CONVERSION_NOTICE_CODE, type ConversionNotice } from '@objectstack/spec';
import { formatConversionNotice } from './format.js';

/**
 * The VALUE pin for the ADR-0087 D2 conversion notice's human face (#13743).
 *
 * Its sibling in `test/validate-build-gate-parity.test.ts` is structural: it
 * holds the three authoring commands to ONE formatter so no copy can drift.
 * That rule says nothing about what the one source actually says — and the
 * sentence is the point. A conversion rewrites the old shape and asks the
 * author for nothing, so this notice is the only warning they get before the
 * conversion retires from the load path and their metadata stops loading.
 *
 * ⭐ It is also the measurement that made the #13743 extraction safe to do at
 * all. `os build`, `os validate` and `os lint` each carried a verbatim copy of
 * this template; the copies were byte-identical (one distinct template literal
 * across the three), so hoisting them onto one function changes no output. The
 * expected string below is that literal's rendering, transcribed from the
 * pre-extraction source — if the extraction had altered one byte, this fails.
 */
describe('formatConversionNotice (#13743)', () => {
  const notice: ConversionNotice = {
    code: CONVERSION_NOTICE_CODE,
    conversionId: 'page-jsx-to-html',
    surface: 'page.kind',
    toMajor: 15,
    retiresIn: 16,
    from: 'jsx',
    to: 'html',
    path: 'pages[0].kind',
    message: '[protocol] converted page.kind at pages[0].kind …',
  };

  it('renders the four fields an author needs, in the shipped wording', () => {
    expect(formatConversionNotice(notice)).toBe(
      "pages[0].kind: 'jsx' → 'html' (converted at load; conversion 'page-jsx-to-html', retires in protocol 16)",
    );
  });

  /**
   * The expiry is what separates this notice from an ordinary deprecation
   * warning: it names the protocol major in which the source STOPS LOADING.
   * Pinned separately from the whole-string assertion above so a future reword
   * cannot drop it while still looking like a reword.
   */
  it('always names the retiring major — the part that makes it actionable', () => {
    expect(formatConversionNotice({ ...notice, retiresIn: 21 })).toContain('retires in protocol 21');
  });

  /**
   * ⛔ NOT the notice's own `message`. `ConversionNotice.message` is a second,
   * longer prose form built in `packages/spec/src/conversions/apply.ts`, and it
   * is what the `--json` payloads carry under `conversions`. The text face has
   * always rendered its own terser sentence from the structured fields instead.
   * Pinned so the difference is a recorded fact rather than something the next
   * reader discovers and "fixes" in one command only — which is exactly the
   * divergence this card is about.
   */
  it('is derived from the structured fields, not from notice.message', () => {
    expect(formatConversionNotice({ ...notice, message: 'REPLACED' })).not.toContain('REPLACED');
  });
});
