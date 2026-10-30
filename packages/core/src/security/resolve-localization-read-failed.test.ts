// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27257] `resolveLocalizationContext` tells "the read failed" from "the read
// found no default". A messaging channel refuses a mail whose
// `{{ amount | currency }}` hole has no default, and grades that refusal
// permanent; it may do so only when the read succeeded. So the answer carries
// `readFailed: true` exactly when the direct `sys_setting` read threw, on the
// fresh read AND on the hit the failure memo serves inside its TTL, and never
// otherwise.
//
// [#27733] The read can also fail one step earlier: a caller that names no
// organization, where no wall stands, reads the rows of the organization the
// `sys_organization` probe derives. A store fault there means no row was read,
// so the answer carries `readFailed: true` too, and writes no memo of either
// kind, since it holds no value to keep.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveLocalizationContext } from './resolve-authz-context.js';

/** A `sys_setting` read answering `rows`, recording every read. */
function makeQl(rows: Array<Record<string, unknown>>) {
  const reads: string[] = [];
  return {
    reads,
    async find(object: string, o: any) {
      reads.push(object);
      const where = o?.where ?? {};
      const matched = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
      // Hold the caller's bound, after the filter and by presence.
      return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
    },
  };
}

/** A `sys_setting` read that throws: the backend fault the failure memo is for. */
function makeBrokenQl() {
  const reads: string[] = [];
  return {
    reads,
    async find(object: string): Promise<never> {
      reads.push(object);
      throw new Error('connection reset reading sys_setting');
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('resolveLocalizationContext — a failed read says so (#27257)', () => {
  it('a direct read that throws answers the built-ins WITH `readFailed: true`', async () => {
    const ql = makeBrokenQl();
    const answer = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(answer).toEqual({ timezone: 'UTC', locale: 'en-US', currency: undefined, readFailed: true });
    expect(ql.reads).toHaveLength(1);
  });

  it('the failure memo\'s hit keeps the kind: no second read, still `readFailed: true`', async () => {
    const ql = makeBrokenQl();
    await resolveLocalizationContext({ ql, organizationId: 'o1' });
    const hit = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(ql.reads).toHaveLength(1); // served by the memo, not a fresh read
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
    const broken = makeBrokenQl();
    const healthy = makeQl([
      { namespace: 'localization', key: 'currency', scope: 'tenant', organization_id: 'o1', value: 'CNY' },
    ]);
    // ONE engine (the memo is keyed on it), whose backend recovers mid-test.
    let backend: { find(object: string, o?: any): Promise<unknown> } = broken;
    const ql = { find: (object: string, o: any) => backend.find(object, o) };
    expect((await resolveLocalizationContext({ ql, organizationId: 'o1' })).readFailed).toBe(true);
    backend = healthy;
    await vi.advanceTimersByTimeAsync(30_001);
    const recovered = await resolveLocalizationContext({ ql, organizationId: 'o1' });
    expect(recovered.currency).toBe('CNY');
    expect(recovered).not.toHaveProperty('readFailed');
    expect(broken.reads.length + healthy.reads.length).toBe(2);
  });
});

/**
 * An engine whose `sys_organization` probe throws while `probeBroken` is set
 * (an outage, not a missing table), and otherwise holds the one organization
 * `org_a`. It carries the write-epoch and middleware seams, so a success-cache
 * entry WOULD be kept if the resolver wrote one.
 */
function makeProbeQl(rows: Array<Record<string, unknown>>) {
  const reads: string[] = [];
  const state = { probeBroken: true };
  const ql = {
    reads,
    state,
    writeEpoch: { current: 0, bump: () => 0, subscribe: () => () => {} },
    registerMiddleware: () => {},
    async find(object: string, o: any) {
      reads.push(object);
      if (object === 'sys_organization') {
        if (state.probeBroken) throw Object.assign(new Error('connection reset'), { code: 'ECONNRESET' });
        return [{ id: 'org_a' }].slice(0, o?.limit ?? 1);
      }
      const where = o?.where ?? {};
      const matched = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => {
          if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
          if (v && typeof v === 'object' && '$in' in (v as any)) return (v as any).$in.includes(r[k]);
          return r[k] === v;
        }),
      );
      // Hold the caller's bound, after the filter and by presence.
      return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
    },
  };
  return ql;
}

describe('resolveLocalizationContext — a failed organization probe says so too (#27733)', () => {
  const CNY = { namespace: 'localization', key: 'currency', scope: 'tenant', organization_id: 'org_a', value: 'CNY' };

  it('a store fault on the `sys_organization` probe answers the built-ins WITH `readFailed: true`, reading no row', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = makeProbeQl([CNY]);
    const answer = await resolveLocalizationContext({ ql });
    expect(answer).toEqual({ timezone: 'UTC', locale: 'en-US', currency: undefined, readFailed: true });
    expect(ql.reads).toEqual(['sys_organization']);
  });

  it('writes no memo: the next request probes again, and once the store answers it reads the stored default', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = makeProbeQl([CNY]);
    expect((await resolveLocalizationContext({ ql })).readFailed).toBe(true);
    expect((await resolveLocalizationContext({ ql })).readFailed).toBe(true);
    expect(ql.reads).toEqual(['sys_organization', 'sys_organization']);
    ql.state.probeBroken = false;
    const recovered = await resolveLocalizationContext({ ql });
    expect(recovered.currency).toBe('CNY');
    expect(recovered).not.toHaveProperty('readFailed');
  });

  it('a probe that SUCCEEDS and finds no organization is a real "no default": no `readFailed`', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'single');
    const ql = makeQl([]);
    const answer = await resolveLocalizationContext({ ql });
    expect(answer.currency).toBeUndefined();
    expect(answer).not.toHaveProperty('readFailed');
  });

  it('a derivation that fails for a reason other than the store (an unreadable posture) is not a failed read', async () => {
    vi.stubEnv('OS_TENANCY_POSTURE', 'not-a-posture');
    const ql = makeProbeQl([CNY]);
    const answer = await resolveLocalizationContext({ ql });
    expect(answer.currency).toBeUndefined();
    expect(answer).not.toHaveProperty('readFailed');
  });

  it('a caller naming its organization is not probed: a broken probe changes nothing', async () => {
    const ql = makeProbeQl([CNY]);
    const answer = await resolveLocalizationContext({ ql, organizationId: 'org_a' });
    expect(answer.currency).toBe('CNY');
    expect(answer).not.toHaveProperty('readFailed');
    expect(ql.reads).toEqual(['sys_setting']);
  });
});
