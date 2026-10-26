/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveContextTokens, resolveFilterPlaceholders } from '../filter-tokens';

const SCOPE = { currentUserId: 'usr_42', currentOrgId: 'org_7', onUnresolved: null };

describe('resolveContextTokens', () => {
  // The exact failure from framework #3574: a dashboard widget's filter is a
  // MongoDB-style OBJECT, and the predecessor helper bailed on non-arrays —
  // so the token reached SQL verbatim and the widget rendered 0.
  it('resolves inside an object-shaped widget filter', () => {
    expect(
      resolveContextTokens({ owner: '{current_user_id}', status: 'open' }, SCOPE),
    ).toEqual({ owner: 'usr_42', status: 'open' });
  });

  it('resolves inside an array-shaped list-view filter', () => {
    expect(
      resolveContextTokens(
        [{ field: 'owner', operator: 'equals', value: '{current_user_id}' }],
        SCOPE,
      ),
    ).toEqual([{ field: 'owner', operator: 'equals', value: 'usr_42' }]);
  });

  it('resolves inside triple-shaped filters', () => {
    expect(resolveContextTokens([['owner', '=', '{current_user_id}']], SCOPE)).toEqual([
      ['owner', '=', 'usr_42'],
    ]);
  });

  it('reaches nested $and / $or branches and operator objects', () => {
    expect(
      resolveContextTokens(
        {
          $and: [
            { status: 'open' },
            { $or: [{ owner: '{current_user_id}' }, { org: '{current_org_id}' }] },
          ],
          reviewer: { $in: ['{current_user_id}', 'usr_9'] },
        },
        SCOPE,
      ),
    ).toEqual({
      $and: [{ status: 'open' }, { $or: [{ owner: 'usr_42' }, { org: 'org_7' }] }],
      reviewer: { $in: ['usr_42', 'usr_9'] },
    });
  });

  it('accepts the ${token} spelling', () => {
    expect(resolveContextTokens({ owner: '${current_user_id}' }, SCOPE)).toEqual({
      owner: 'usr_42',
    });
  });

  it('leaves ordinary values, partial braces and non-strings alone', () => {
    const input = {
      name: 'Acme {Corp}',
      note: 'owner is {current_user_id} today',
      count: 3,
      active: true,
      missing: null,
    };
    expect(resolveContextTokens(input, SCOPE)).toEqual(input);
  });

  it('passes date macros through untouched — they are a separate vocabulary', () => {
    expect(resolveContextTokens({ created_at: { $gte: '{today}' } }, SCOPE)).toEqual({
      created_at: { $gte: '{today}' },
    });
  });

  it('passes nav-only context-selector ids through silently', () => {
    const warn = vi.fn();
    expect(
      resolveContextTokens({ pkg: '{active_package}' }, { ...SCOPE, onUnresolved: warn }),
    ).toEqual({ pkg: '{active_package}' });
    expect(warn).not.toHaveBeenCalled();
  });

  it('does not mutate its input', () => {
    const input = { owner: '{current_user_id}' };
    resolveContextTokens(input, SCOPE);
    expect(input).toEqual({ owner: '{current_user_id}' });
  });

  // Leaving the token yields an empty result set. Dropping the clause would
  // WIDEN the result set, which is far worse than silently narrowing.
  it('leaves a known token intact when scope has no value, and warns', () => {
    const warn = vi.fn();
    expect(
      resolveContextTokens({ owner: '{current_user_id}' }, { onUnresolved: warn }),
    ).toEqual({ owner: '{current_user_id}' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('current_user_id');
  });

  it('warns with a suggestion on near-miss spellings', () => {
    const warn = vi.fn();
    resolveContextTokens(
      { a: '{current_user}', b: '{user_id}', c: '{org_id}' },
      { ...SCOPE, onUnresolved: warn },
    );
    expect(warn).toHaveBeenCalledTimes(3);
    expect(warn.mock.calls[0][0]).toContain('{current_user_id}');
    expect(warn.mock.calls[2][0]).toContain('{current_org_id}');
  });

  it('handles null / undefined filters', () => {
    expect(resolveContextTokens(null, SCOPE)).toBeNull();
    expect(resolveContextTokens(undefined, SCOPE)).toBeUndefined();
  });
});

describe('resolveFilterPlaceholders', () => {
  // Calling only one resolver is the defect behind #3574 — dashboard widgets
  // expanded date macros and silently skipped session tokens.
  it('expands BOTH vocabularies in a single call', () => {
    const out = resolveFilterPlaceholders(
      { owner: '{current_user_id}', created_at: { $gte: '{today}' } },
      SCOPE,
      new Date('2026-07-27T12:00:00Z'),
    );
    expect(out.owner).toBe('usr_42');
    expect(out.created_at.$gte).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(out.created_at.$gte).not.toBe('{today}');
  });

  it('is a no-op on filters with no placeholders', () => {
    expect(resolveFilterPlaceholders({ status: 'open' }, SCOPE)).toEqual({ status: 'open' });
  });

  it('handles null / undefined filters', () => {
    expect(resolveFilterPlaceholders(undefined, SCOPE)).toBeUndefined();
  });
});
