/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11815 — the ONE helper every host asks whether a declared deadline
 * is settled for a row. Settled only when the field declares `dueLike: true`
 * and a `settledWhen` that holds; every other case, a faulting predicate
 * included, is not settled.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { isDeadlineSettled } from '../deadlineSettled';
import * as core from '../../index';

const DEADLINE = { name: 'due_date', dueLike: true, settledWhen: "record.status == 'done'" };

afterEach(() => vi.restoreAllMocks());

describe('isDeadlineSettled (objectui#11815)', () => {
  it('is settled when the declared predicate holds for the row', () => {
    expect(isDeadlineSettled(DEADLINE, { status: 'done' })).toBe(true);
  });

  it('takes the spec envelope form as well as the bare string', () => {
    const envelope = { ...DEADLINE, settledWhen: { dialect: 'cel', source: "record.status == 'done'" } };
    expect(isDeadlineSettled(envelope, { status: 'done' })).toBe(true);
    expect(isDeadlineSettled(envelope, { status: 'open' })).toBe(false);
  });

  it('is not settled when the predicate does not hold', () => {
    expect(isDeadlineSettled(DEADLINE, { status: 'open' })).toBe(false);
  });

  it('is not settled when the field declares no settledWhen', () => {
    expect(isDeadlineSettled({ name: 'due_date', dueLike: true }, { status: 'done' })).toBe(false);
  });

  it('is not settled when the field is not a declared deadline, whatever settledWhen says', () => {
    expect(isDeadlineSettled({ name: 'due_date', settledWhen: DEADLINE.settledWhen }, { status: 'done' })).toBe(false);
    expect(isDeadlineSettled({ ...DEADLINE, dueLike: false }, { status: 'done' })).toBe(false);
    expect(isDeadlineSettled(undefined, { status: 'done' })).toBe(false);
  });

  it('is not settled when the predicate fails to evaluate', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    // `status` is absent from the row: CEL faults `No such key`, never "settled".
    expect(isDeadlineSettled(DEADLINE, { title: 'x' })).toBe(false);
    expect(isDeadlineSettled({ ...DEADLINE, settledWhen: 'record.status ==' }, { status: 'done' })).toBe(false);
    expect(isDeadlineSettled(DEADLINE, null)).toBe(false);
  });

  it('reads the host scope beside the row', () => {
    const field = { ...DEADLINE, settledWhen: "record.status == 'done' && features.settle" };
    expect(isDeadlineSettled(field, { status: 'done' }, { scope: { features: { settle: true } } })).toBe(true);
    expect(isDeadlineSettled(field, { status: 'done' }, { scope: { features: { settle: false } } })).toBe(false);
  });

  it('is published from @object-ui/core', () => {
    expect(core.isDeadlineSettled).toBe(isDeadlineSettled);
  });
});
