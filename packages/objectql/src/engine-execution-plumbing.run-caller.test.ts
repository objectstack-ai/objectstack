// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A write of a decided flow segment whose run began for no caller carries that
 * fact on the hook session it hands its hooks (the run-caller mark,
 * `@objectstack/core`), so a run the write starts — the record-change trigger
 * — begins for no caller too. The segment's `userId` (its decider) stays the
 * session's attribution user.
 */

import { describe, it, expect } from 'vitest';
import { markRunCaller, runCallerOf } from '@objectstack/core';
import { buildSession } from './engine-execution-plumbing.js';

describe('the hook session of a decided segment of a run that began for no caller', () => {
  it('carries the run-caller mark, beside the decider as its user', () => {
    const session = buildSession(markRunCaller({ userId: 'u_decider', isSystem: true, flowRunId: 'run_1' }, null) as any);
    expect(session).toMatchObject({ userId: 'u_decider', isSystem: true });
    expect(runCallerOf(session)).toBeNull();
  });

  it('control: a segment that names its run’s caller, and an unmarked write, carry no mark', () => {
    expect(runCallerOf(buildSession(markRunCaller({ userId: 'u_decider', isSystem: true }, 'u_alice') as any))).toBeUndefined();
    expect(runCallerOf(buildSession({ userId: 'u_alice' } as any))).toBeUndefined();
  });
});
