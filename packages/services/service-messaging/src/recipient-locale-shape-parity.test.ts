// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The read side and the write side of `sys_user.locale` must agree on what a
 * locale tag looks like.
 *
 * Until the maintainer ruling of 2026-09-03 there was only one reader: this
 * package normalized whatever happened to be in the column, and nothing
 * checked values on the way in (the column was `readonly` and off the ADR-0092
 * D2 whitelist, so no user-facing surface could write it). The ruling made the
 * column user-writable and, in the same sentence, required that "a malformed
 * value is refused loudly by the column's BCP-47 shape check … and never
 * dead-letters a notification" — which put a SECOND copy of the shape on the
 * write path, in `@objectstack/platform-objects`.
 *
 * Two copies is a deliberate choice, not an oversight: `recipient-locale.ts` is
 * documented as pure and total and runs per recipient after fan-out, so making
 * it import the identity barrel to borrow a regex would have a notification
 * normalizer pay a package barrel's module load. What the choice costs is
 * drift, and this file is what is paid instead.
 *
 * ## What drift would actually do
 *
 * The two directions fail differently and neither is loud on its own:
 *
 *  - **write looser than read** — a tag the column accepts and this module
 *    discards. The user picks a language, the write succeeds, every
 *    notification keeps arriving in the deployment default, and nothing
 *    anywhere reports a problem: the row holds exactly what the user asked
 *    for. This is the direction that is indistinguishable from the setting
 *    never having existed.
 *  - **write stricter than read** — a tag this module would have honoured but
 *    the column refuses. The user is told their language is invalid when it is
 *    not, and the refusal names a shape the platform contradicts one layer
 *    over.
 *
 * Neither shows up in a test of either package alone, which is the whole
 * argument for this file living in the package that can see both.
 */

import { describe, it, expect } from 'vitest';
import { SYS_USER_LOCALE_TAG_PATTERN } from '@objectstack/platform-objects/identity';
import { LOCALE_TAG_SHAPE, normalizeRecipientLocale } from './recipient-locale.js';

describe('recipient locale shape ↔ sys_user.locale write rule', () => {
  it('is the same regex source, byte for byte', () => {
    // Source equality rather than a behavioural sample, because a sample can
    // only catch a divergence it happens to contain, and this is the assertion
    // that cannot miss one. The write side stores the SOURCE STRING (a
    // `format` validation rule carries `regex` as text and objectql compiles it
    // with `new RegExp(...)`), so both ends are compared as text.
    expect(LOCALE_TAG_SHAPE.source).toBe(SYS_USER_LOCALE_TAG_PATTERN);
    // Flags too: `i` or `m` on one side alone changes which tags match without
    // changing a character of the pattern.
    expect(LOCALE_TAG_SHAPE.flags).toBe('');
  });

  it.each([
    'zh', 'zh-CN', 'zh-Hans-CN', 'es-419', 'en-US', 'yue-HK',
    'Chinese (Simplified)', 'zh_CN', '-CN', 'zh-Hansumlaut', '1zh', 'zh CN',
    '../../etc/passwd', '',
  ])('agrees with the compiled write-side pattern on %j', (value) => {
    // The behavioural half. Redundant while the sources are equal — and that
    // is the point: it is what still answers if a future change makes the two
    // sides share intent instead of a literal (a named export on one side, a
    // generated constant on the other), when source equality would stop being
    // expressible but agreement would still be required.
    const writeSide = new RegExp(SYS_USER_LOCALE_TAG_PATTERN).test(value);
    expect(LOCALE_TAG_SHAPE.test(value)).toBe(writeSide);
  });

  it('the read side is deliberately STRICTER on the stringified-nothing literals', () => {
    // `"null"` is four letters, so it is shape-legal on both sides — the write
    // rule accepts it and only `NOTHING_LITERALS` in this module stops it
    // reaching a template lookup. Pinned as intended asymmetry so a future
    // reader does not "fix" the shared regex to close it: a lossy producer's
    // stringified nothing arrives below the data API, where the write rule
    // never runs, so tightening the shape would cost real tags (`null` is not
    // a language, but neither is it reachable by a user picking one from a
    // list) without closing the path it arrived by.
    expect(new RegExp(SYS_USER_LOCALE_TAG_PATTERN).test('null')).toBe(true);
    expect(LOCALE_TAG_SHAPE.test('null')).toBe(true);
    expect(normalizeRecipientLocale('null')).toBeUndefined();
    // `"undefined"` is nine letters and fails the shape on both sides — it
    // never depended on the literal list.
    expect(new RegExp(SYS_USER_LOCALE_TAG_PATTERN).test('undefined')).toBe(false);
    expect(normalizeRecipientLocale('undefined')).toBeUndefined();
  });
});
