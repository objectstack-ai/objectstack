/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12992 — the scope a node's `visibleWhen` is evaluated against has
 * ONE builder, exported at the package entry so the `page:tabs` badge in
 * `@object-ui/components` calls it instead of spelling the scope again.
 *
 * This pins the four roots it returns for a fixture: the ambient predicate
 * scope, `current_user` aliased to `user`, `record` only when a row is bound,
 * and `page` variables.
 */

import { describe, it, expect } from 'vitest';
import { buildNodeEvaluationScope } from '../index';

const USER = { id: 'u1', email: 'ada@example.com' };
const ROW = { id: 'ENV-1', plan: 'pro' };
const PAGE = { selected: 'a' };

describe('buildNodeEvaluationScope (objectui#12992)', () => {
  it('is exported from the package entry', () => {
    expect(typeof buildNodeEvaluationScope).toBe('function');
  });

  it('returns the ambient scope, `user` / `current_user`, `record` and `page`', () => {
    const scope = buildNodeEvaluationScope({ user: USER, features: { beta: true } }, ROW, PAGE);
    expect(scope).toEqual({
      user: USER,
      features: { beta: true },
      current_user: USER,
      record: ROW,
      page: PAGE,
    });
    expect(scope.current_user).toBe(scope.user);
    expect(scope.record).toBe(ROW);
  });

  it('binds no `record` when no row is bound', () => {
    for (const noRow of [undefined, null, 'ENV-1', 7, [ROW]]) {
      const scope = buildNodeEvaluationScope({ user: USER }, noRow, PAGE);
      expect(Object.prototype.hasOwnProperty.call(scope, 'record'), String(noRow)).toBe(false);
    }
  });

  it('keeps an ambient `record` when no row is bound, and a bound row wins over it', () => {
    const ambient = { id: 'HOST' };
    expect(buildNodeEvaluationScope({ record: ambient }, undefined, PAGE).record).toBe(ambient);
    expect(buildNodeEvaluationScope({ record: ambient }, ROW, PAGE).record).toBe(ROW);
  });

  it('writes `current_user` and `page` over the ambient spread', () => {
    const scope = buildNodeEvaluationScope(
      { user: USER, current_user: { id: 'stale' }, page: { stale: true } },
      undefined,
      PAGE,
    );
    expect(scope.current_user).toBe(USER);
    expect(scope.page).toBe(PAGE);
  });
});
