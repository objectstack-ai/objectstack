// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { SharedRecordIds } from '@objectstack/spec/data';
import { describeFixedReadLeaf, fixedReadLeafRefusal, refuseFixedReadLeafOnce } from './fixed-read-leaf-refusal.js';

// [ADR-0155 D4] The fixed-read leaves' refusal: ADR-0139 D3's envelope, logged once per evaluator.
describe('the fixed-read leaf refusal', () => {
  it('is INTERNAL_ERROR / 500, never INVALID_FILTER, and names the evaluator and the leaf', () => {
    const leaf = SharedRecordIds.read('doc', 'u1');
    const err = fixedReadLeafRefusal('driver-x', `${describeFixedReadLeaf('where.id.$in', leaf)}, and so on.`, 'doc');
    expect(err).toMatchObject({ code: 'INTERNAL_ERROR', status: 500, httpStatus: 500, object: 'doc' });
    // The subjects it names, not its wording: the evaluator, the position, the leaf and its table.
    expect(err.message.startsWith('[driver-x] where.id.$in ')).toBe(true);
    expect(err.message).toContain('SharedRecordIds');
    expect(err.message).toContain("'sys_record_share'");
  });

  it('names no input of the leaf: the recipient is a principal\'s id', () => {
    const leaf = SharedRecordIds.write('doc', 'usr_secret_7', ['edit']);
    expect(describeFixedReadLeaf('where.id.$in', leaf)).not.toContain('usr_secret_7');
  });

  it('is logged at error once per state, and returned every time', () => {
    const log = { error: vi.fn(), warn: vi.fn() };
    const state = { logged: false };
    const a = refuseFixedReadLeafOnce('objectql', 'm.', log, state);
    const b = refuseFixedReadLeafOnce('objectql', 'm.', log, state);
    expect([a.code, b.code]).toEqual(['INTERNAL_ERROR', 'INTERNAL_ERROR']);
    expect(a).not.toBe(b);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringMatching(/^\[objectql\] m\. /));
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('falls back to warn on a sink without error', () => {
    const log = { warn: vi.fn() };
    refuseFixedReadLeafOnce('objectql', 'm.', log, { logged: false });
    expect(log.warn).toHaveBeenCalledTimes(1);
  });
});
