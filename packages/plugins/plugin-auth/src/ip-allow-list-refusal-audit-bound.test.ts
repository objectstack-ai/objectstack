// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0069 D5 — the bound on IP allow-list refusal rows and the row itself
// (`ip-allow-list-refusal-audit.ts`), on an injected clock. The two refusing
// doors that use them are driven for real in
// `ip-allow-list-refusal-audit.test.ts`.

import { describe, it, expect, vi } from 'vitest';
import {
  IP_ALLOW_LIST_RULE,
  IP_REFUSAL_AUDIT_MARKS,
  IP_REFUSAL_AUDIT_ROW_CAP,
  IP_REFUSAL_AUDIT_WINDOW_MS,
  IpRefusalAuditBound,
  ipAllowListRefusalEventFor,
} from './ip-allow-list-refusal-audit';

const OUTSIDE = '198.51.100.9';

// ───────────────────────────────────────────────────────────────────────────
// The bound, on its own clock
// ───────────────────────────────────────────────────────────────────────────

describe('[#30924] the IP refusal row bound', () => {
  it('declares the ruled rule: a 10-minute window, rows at the 1st / 10th / 100th refusal, 1000 rows per window', () => {
    expect(IP_REFUSAL_AUDIT_WINDOW_MS).toBe(10 * 60_000);
    expect([...IP_REFUSAL_AUDIT_MARKS]).toEqual([1, 10, 100]);
    expect(IP_REFUSAL_AUDIT_ROW_CAP).toBe(1000);
    expect(IP_ALLOW_LIST_RULE).toBe('ip_allow_list');
  });

  it('per address, the count restarts when its window has passed', () => {
    let now = 0;
    const bound = new IpRefusalAuditBound({ now: () => now });
    const admitted: Array<number | undefined> = [];
    for (let i = 0; i < 10; i += 1) admitted.push(bound.admit(OUTSIDE));
    expect(admitted).toEqual([1, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 10]);
    now += IP_REFUSAL_AUDIT_WINDOW_MS - 1;
    expect(bound.admit(OUTSIDE)).toBeUndefined();
    now += 1;
    expect(bound.admit(OUTSIDE)).toBe(1);
  });

  it('an address the server could not establish is counted as one address', () => {
    const bound = new IpRefusalAuditBound({ now: () => 0 });
    expect(bound.admit(undefined)).toBe(1);
    expect(bound.admit(undefined)).toBeUndefined();
  });

  it('the global cap holds across addresses, with one operator line per window once dropping', () => {
    let now = 0;
    const warn = vi.fn();
    const bound = new IpRefusalAuditBound({ now: () => now, rowCap: 3 });
    const answers = ['10.0.0.1', '10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5'].map((a) => bound.admit(a, warn));
    expect(answers).toEqual([1, 1, 1, undefined, undefined]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('sys_audit_log');

    // The next window writes again, and may warn again.
    now += IP_REFUSAL_AUDIT_WINDOW_MS;
    expect(bound.admit('10.0.0.6', warn)).toBe(1);
    expect(['10.0.0.7', '10.0.0.8', '10.0.0.9'].map((a) => bound.admit(a, warn))).toEqual([1, 1, undefined]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the addresses it tracks are bounded too', () => {
    const bound = new IpRefusalAuditBound({ now: () => 0, rowCap: 1_000_000, trackedAddressCap: 4 });
    for (let i = 0; i < 50; i += 1) bound.admit(`10.0.1.${i}`);
    expect(bound.trackedAddresses).toBeLessThanOrEqual(4);
  });
});

describe('[#30924] the IP refusal event', () => {
  it('names the rule and the machine code, and only the fields it is given', () => {
    expect(
      ipAllowListRefusalEventFor({ path: '/sign-in/email', attempts: 10, fingerprint: { ipAddress: OUTSIDE } }),
    ).toEqual({
      action: 'login_failed',
      ipAddress: OUTSIDE,
      context: { endpoint: '/sign-in/email', reason: 'IP_NOT_ALLOWED', rule: 'ip_allow_list', attempts: 10 },
    });
  });
});
