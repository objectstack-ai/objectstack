// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22049] The one reading of a share-link password's header pair. Both mounts
 * of the public share-link routes stand on it (`plugin-sharing`'s routes and
 * the runtime dispatcher's `/share-links` domain pin the same cases end to end),
 * so the rule is pinned HERE first, case by case:
 *
 *  - no encoding header: the password header is read raw, exactly as before —
 *    a Latin-1 password and one containing `%` included;
 *  - `X-Share-Password-Encoding: utf-8` (any case): percent-encoded UTF-8 is
 *    decoded, a CJK, an emoji and a space-edged password included;
 *  - a declared encoding that does not hold, or any other encoding, is a
 *    refusal whose message never carries the presented value.
 */

import { describe, it, expect } from 'vitest';
import {
  readSharePasswordHeader,
  SHARE_PASSWORD_ENCODING_HEADER,
  SHARE_PASSWORD_ENCODING_UTF8,
  SHARE_PASSWORD_HEADER,
  SHARE_PASSWORD_VARY,
} from './share-password-header.js';

const CJK = '分享密码二二零四九';
const EMOJI = 'open 🔐🦊 sesame';
const LATIN1 = 'Déjà vu ½ ÿ';
const RAW_PERCENT = 'grade 100% %zz 22049';
const RAW_PERCENT_ESCAPE = '50%25 off 22049';

describe('[#22049] the header names', () => {
  it('names the password header, its companion and the Vary value both doors send', () => {
    expect(SHARE_PASSWORD_HEADER).toBe('X-Share-Password');
    expect(SHARE_PASSWORD_ENCODING_HEADER).toBe('X-Share-Password-Encoding');
    expect(SHARE_PASSWORD_ENCODING_UTF8).toBe('utf-8');
    expect(SHARE_PASSWORD_VARY).toBe('X-Share-Password, X-Share-Password-Encoding');
  });
});

describe('[#22049] without the encoding header the value is read raw, unchanged', () => {
  it.each([
    ['ASCII', 'correct horse battery'],
    ['Latin-1', LATIN1],
    ['raw with a stray %', RAW_PERCENT],
    ['raw with a %-escape', RAW_PERCENT_ESCAPE],
    ['raw that looks percent-encoded', '%E5%88%86'],
    ['raw that looks RFC 8187-prefixed', "UTF-8''%E5%88%86"],
    ['empty', ''],
  ])('%s', (_label, value) => {
    expect(readSharePasswordHeader(value, undefined)).toEqual({ ok: true, password: value });
    expect(readSharePasswordHeader(value, null)).toEqual({ ok: true, password: value });
  });

  it('a repeated header is read by its first value, an absent one as no password', () => {
    expect(readSharePasswordHeader(['first', 'second'], undefined)).toEqual({ ok: true, password: 'first' });
    expect(readSharePasswordHeader(undefined, undefined)).toEqual({ ok: true, password: undefined });
    expect(readSharePasswordHeader(42, undefined)).toEqual({ ok: true, password: undefined });
  });
});

describe('[#22049] X-Share-Password-Encoding: utf-8 decodes percent-encoded UTF-8', () => {
  it.each([
    ['CJK', CJK],
    ['emoji', EMOJI],
    ['Latin-1', LATIN1],
    ['raw with a stray %', RAW_PERCENT],
    ['raw with a %-escape', RAW_PERCENT_ESCAPE],
    ['space-edged', '  spaced out  '],
    ['ASCII', 'correct horse battery'],
  ])('%s round-trips through encodeURIComponent', (_label, password) => {
    expect(readSharePasswordHeader(encodeURIComponent(password), 'utf-8')).toEqual({ ok: true, password });
  });

  it('the encoding name is compared case-insensitively, a repeated header by its first value', () => {
    for (const name of ['UTF-8', 'Utf-8', ['utf-8', 'latin1']]) {
      expect(readSharePasswordHeader(encodeURIComponent(CJK), name)).toEqual({ ok: true, password: CJK });
    }
  });

  it('a declared encoding with no password header presents no password', () => {
    expect(readSharePasswordHeader(undefined, 'utf-8')).toEqual({ ok: true, password: undefined });
  });

  it('a plus is a literal plus, never a space', () => {
    expect(readSharePasswordHeader('a+b', 'utf-8')).toEqual({ ok: true, password: 'a+b' });
  });
});

describe('[#22049] a declared encoding that does not hold is refused, never read raw', () => {
  it.each([
    ['a lone %', '100%'],
    ['% not followed by two hex digits', '%zz'],
    ['a truncated UTF-8 sequence', '%E5%88'],
    ['an octet that never starts UTF-8', '%FF'],
    ['an overlong form', '%C0%80'],
    ['an encoded surrogate', '%ED%A0%80'],
    ['a raw Latin-1 character', 'Déjà'],
    ['a raw space', 'two words'],
  ])('%s', (_label, value) => {
    const reading = readSharePasswordHeader(value, 'utf-8');
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe('malformed-value');
    expect(reading.message).toContain('X-Share-Password');
    expect(reading.message).not.toContain(value);
  });

  it.each([['latin1'], ['base64'], ['utf8'], [''], ['utf-8, utf-8']])('an encoding header naming %j', (name) => {
    const reading = readSharePasswordHeader(encodeURIComponent(CJK), name);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.reason).toBe('unknown-encoding');
    expect(reading.message).toContain('X-Share-Password-Encoding');
    expect(reading.message).not.toContain(encodeURIComponent(CJK));
  });

  it('an unknown encoding is refused even when no password header came with it', () => {
    expect(readSharePasswordHeader(undefined, 'latin1')).toMatchObject({ ok: false, reason: 'unknown-encoding' });
  });
});
