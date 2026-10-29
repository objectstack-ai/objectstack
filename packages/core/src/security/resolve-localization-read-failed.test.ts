// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27257] `resolveLocalizationContext` tells "the read failed" from "the read
// found no default". A messaging channel refuses a mail whose
// `{{ amount | currency }}` hole has no default, and grades that refusal
// permanent; it may do so only when the read succeeded. So the answer carries
// `readFailed: true` exactly when the direct `sys_setting` read threw, on the
// fresh read AND on the hit the failure memo serves inside its TTL, and never
// otherwise.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveLocalizationContext } from './resolve-authz-context.js';

/** A `sys_setting` read that throws while `broken`, else answers `rows`. */
function makeQl(rows: Array<Record<string, unknown>>, state = { broken: false }) {
  const counts = { sys_setting: 0 };
  return {
    counts,
    state,
    async find(object: string, o: any) {
      counts.sys_setting += 1;
      if (state.broken) throw new Error(`connection reset reading ${object}`);
      const where = o?.where ?? {};
      return rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('resolveLocalizationContext — a failed read says so (#27257)', () => {
  it('a direct read that throws answers the built-ins WITH `readFailed: true`', async () => {
    const ql = makeQl([], { broken: true });
    const answer = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(answer).toEqual({ timezone: 'UTC', locale: 'en-US', currency: undefined, readFailed: true });
    expect(ql.counts.sys_setting).toBe(1);
  });

  it('the failure memo\'s hit keeps the kind: no second read, still `readFailed: true`', async () => {
    const ql = makeQl([], { broken: true });
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    const hit = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(ql.counts.sys_setting).toBe(1); // served by the memo, not a fresh read
    expect(hit.readFailed).toBe(true);
    expect(hit.currency).toBeUndefined();
  });

  it('a read that SUCCEEDS and finds no default carries no `readFailed` at all', async () => {
    const ql = makeQl([
      { namespace: 'localization', key: 'timezone', scope: 'tenant', organization_id: 'o1', value: 'Asia/Tokyo' },
    ]);
    const answer = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(answer.timezone).toBe('Asia/Tokyo');
    expect(answer.currency).toBeUndefined();
    expect(answer).not.toHaveProperty('readFailed');
  });

  it('a settings-service refusal in front of a SUCCESSFUL direct read is not a failed read (#11877)', async () => {
    const settings = {
      get: async () => { throw new Error('unused'); },
      getMany: async () => { throw new Error("unknown settings namespace 'localization'"); },
    };
    const ql = makeQl([]);
    const answer = await resolveLocalizationContext({ ql, settings, organizationId: 'o1' });
    expect(answer.currency).toBeUndefined();
    expect(answer).not.toHaveProperty('readFailed');
  });

  it('the memo is not lengthened: past its TTL a recovered read answers the stored default, no kind', async () => {
    vi.useFakeTimers();
    const state = { broken: true };
    const ql = makeQl(
      [{ namespace: 'localization', key: 'currency', scope: 'tenant', organization_id: 'o1', value: 'CNY' }],
      state,
    );
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).readFailed).toBe(true);
    state.broken = false;
    await vi.advanceTimersByTimeAsync(30_001);
    const recovered = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(recovered.currency).toBe('CNY');
    expect(recovered).not.toHaveProperty('readFailed');
    expect(ql.counts.sys_setting).toBe(2);
  });
});
