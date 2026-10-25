/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it, vi } from 'vitest';
import { resolveContextTokens } from '../filter-tokens';

/**
 * objectui#9129 — the near-miss suggestion lookup must never read
 * `Object.prototype`.
 *
 * `resolveContextTokens` looks a near-miss spelling up in
 * `CONTEXT_TOKEN_SUGGESTIONS` (a plain object) with a bracket index. `{
 * constructor}` and `{__proto__}` lower-case to inherited `Object.prototype`
 * member names, so the index resolved to `Object.prototype.constructor` /
 * `Object.prototype.__proto__` instead of `undefined`, and the resulting
 * warning asserted a "suggestion" that was actually native-code / object
 * text — not a token, not spellable, not anything an author can act on.
 *
 * This is NOT prototype pollution: the index is a read, never an assignment;
 * the resolved value is passed through untouched either way, so no filter is
 * ever widened or narrowed and no record is ever mis-matched. The only
 * observable effect was a confusing string inside a `console.warn` call.
 *
 * ## What this pins, and why not today's strings
 *
 * The fix closes the lookup against the WHOLE prototype-chain class (any
 * inherited member, present or future), not just these two spellings — so
 * the pin asserts SILENCE (no warning, value passed through), never today's
 * `[native code]` / `[object Object]` text. Pinning those strings would only
 * prove today's two names are special-cased; it would say nothing about the
 * next inherited member that happens to already be lower-case.
 */
describe('objectui#9129 — near-miss lookup does not read Object.prototype', () => {
  const SCOPE = { currentUserId: 'usr_42', currentOrgId: 'org_7' };

  it.each(['constructor', '__proto__'])(
    'passes "{%s}" through silently instead of warning with a prototype value',
    (token) => {
      const warn = vi.fn();
      const out = resolveContextTokens({ f: `{${token}}` }, { ...SCOPE, onUnresolved: warn });

      // Never substituted — it is not a recognised context token either way.
      expect(out).toEqual({ f: `{${token}}` });
      // The load-bearing assertion: no warning at all, not merely a
      // different one. A `[native code]` / `[object Object]` string in the
      // warning is exactly the defect; silence is the only correct outcome
      // for a spelling that names nothing in the suggestion map.
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('still warns with a real suggestion — the guard must not silence genuine near-misses', () => {
    // Lit control: `user_id` is a genuine near-miss (own-property entry in
    // CONTEXT_TOKEN_SUGGESTIONS), proving the suggestion feature itself
    // still works and the fix did not just make the resolver quiet.
    const warn = vi.fn();
    const out = resolveContextTokens({ f: '{user_id}' }, { ...SCOPE, onUnresolved: warn });

    expect(out).toEqual({ f: '{user_id}' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('did you mean "{current_user_id}"?');
  });
});
