/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A date macro inside a longer string is a literal, on the client as on the
 * server (objectstack#35754).
 *
 * The spec reads a filter value as a placeholder only when it is ENTIRELY one
 * wrapped token (`FILTER_TOKEN_WRAPPED_RE` in `@objectstack/spec/data`): "a
 * value that merely CONTAINS braces (`'acme {x} deal'`) is untouched". The
 * server's `resolveFilterTokens` applies that reading. The client resolver
 * used to run a second, global pass that substituted a macro anywhere in the
 * string, so `'from {today} on'` matched one row set in the console and
 * another on the server.
 */

import { describe, it, expect } from 'vitest';
import { resolveDateMacros } from '../date-macros';
import { resolveFilterPlaceholders } from '../filter-tokens';
import { shiftFilterByCompareTo } from '../compare-to';

// Monday 2026-05-25, local time.
const now = new Date(2026, 4, 25, 12, 30, 0);

describe('an embedded date macro is a literal (objectstack#35754)', () => {
  it('leaves a fixed macro inside a longer string as written', () => {
    expect(resolveDateMacros('from {today} on', now)).toBe('from {today} on');
    expect(resolveDateMacros('since ${current_month_start}', now)).toBe('since ${current_month_start}');
  });

  it('leaves a parameterised macro inside a longer string as written', () => {
    expect(resolveDateMacros('about {7_days_ago}', now)).toBe('about {7_days_ago}');
  });

  it('leaves an embedded macro literal inside a filter tree, beside a whole one that resolves', () => {
    expect(
      resolveFilterPlaceholders({ note: 'due {tomorrow}', due: { $gte: '{today}' } }, {}, now),
    ).toEqual({ note: 'due {tomorrow}', due: { $gte: '2026-05-25' } });
  });

  it('does not rename an embedded macro for a previous-period comparison', () => {
    const filter = { note: 'from {today} on', at: { $gte: '{today}' } };
    expect(shiftFilterByCompareTo(filter, { kind: 'previousPeriod' }, now)).toEqual({
      note: 'from {today} on',
      at: { $gte: '2026-05-24' },
    });
  });

  it('CONTROL: a whole-value macro still resolves, in both spellings', () => {
    expect(resolveDateMacros('{today}', now)).toBe('2026-05-25');
    expect(resolveDateMacros('${today}', now)).toBe('2026-05-25');
    expect(resolveDateMacros('{7_days_ago}', now)).toBe('2026-05-18');
  });

  it('CONTROL: a value with braces that is not one wrapped token is untouched', () => {
    expect(resolveDateMacros('acme {x} deal', now)).toBe('acme {x} deal');
    expect(resolveDateMacros('{a}{b}', now)).toBe('{a}{b}');
    expect(resolveDateMacros('{{today}}', now)).toBe('{{today}}');
  });
});
