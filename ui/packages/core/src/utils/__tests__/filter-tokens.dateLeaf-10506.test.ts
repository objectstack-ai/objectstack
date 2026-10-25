/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, expect, it } from 'vitest';
import { resolveFilterPlaceholders, resolveContextTokens } from '../filter-tokens';
import { resolveDateMacros } from '../date-macros';

/**
 * objectui#10506 — the placeholder walks return a NON-plain object as a leaf.
 *
 * `resolveContextTokens` and `resolveDateMacros` walked every
 * `typeof value === 'object'` as a bag and rebuilt it from `Object.keys`. A
 * `Date` has no own keys, so a `Date` comparand came back as an empty object:
 * `[['due', '>=', someDate]]` resolved to `[['due', '>=', {}]]`, a filter that
 * compares against nothing. The spec admits `Date` as a comparand
 * (`ACCEPTED_FILTER_COMPARAND_TYPES`; `$gte` and its siblings declare
 * `z.date()`), and the resolver's own header promised "arrays and plain
 * objects" only.
 *
 * "Plain" is a prototype of `Object.prototype` or `null`. Both are still
 * walked; the two controls below hold that half, so a fix that stopped
 * walking objects altogether would go red here too.
 */
describe('objectui#10506 — a Date comparand survives the placeholder walks', () => {
  const SCOPE = { currentUserId: 'usr_42', currentOrgId: 'org_7', onUnresolved: null };

  it('resolveFilterPlaceholders keeps a Date comparand as the SAME instance', () => {
    const due = new Date('2026-01-01T00:00:00Z');
    const out = resolveFilterPlaceholders(
      [['due', '>=', due], ['owner', '=', '{current_user_id}']],
      SCOPE,
    ) as unknown[][];
    expect(out[0][2]).toBe(due);
    // The token beside it is still resolved in the same pass.
    expect(out[1][2]).toBe('usr_42');
  });

  it('keeps a Date inside an operator map as the SAME instance', () => {
    const due = new Date('2026-01-01T00:00:00Z');
    const out = resolveFilterPlaceholders({ due: { $gte: due }, owner: '{current_user_id}' }, SCOPE) as {
      due: { $gte: unknown };
      owner: unknown;
    };
    expect(out.due.$gte).toBe(due);
    expect(out.owner).toBe('usr_42');
  });

  it('each walk on its own returns the Date untouched (both hunks are needed)', () => {
    const due = new Date('2026-01-01T00:00:00Z');
    expect((resolveDateMacros([['due', '>=', due]]) as unknown[][])[0][2]).toBe(due);
    expect((resolveContextTokens([['due', '>=', due]], SCOPE) as unknown[][])[0][2]).toBe(due);
  });

  it('CONTROL: a plain object carrying a token is still walked and resolved', () => {
    expect(resolveFilterPlaceholders({ owner: '{current_user_id}', org: '{current_org_id}' }, SCOPE)).toEqual({
      owner: 'usr_42',
      org: 'org_7',
    });
  });

  it('CONTROL: a null-prototype object carrying a token is still walked and resolved', () => {
    const bag = Object.assign(Object.create(null) as Record<string, unknown>, {
      owner: '{current_user_id}',
      nested: Object.assign(Object.create(null) as Record<string, unknown>, { org: '{current_org_id}' }),
    });
    const out = resolveFilterPlaceholders(bag, SCOPE) as Record<string, any>;
    expect(out.owner).toBe('usr_42');
    expect(out.nested.org).toBe('org_7');
  });
});
