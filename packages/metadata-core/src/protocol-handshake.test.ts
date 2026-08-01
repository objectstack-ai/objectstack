// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import {
  assertProtocolCompat,
  checkProtocolCompat,
  ProtocolIncompatibleError,
  rangeAdmitsMajor,
} from './protocol-handshake.js';

const RT = '11.0.0'; // runtime protocol version used across these tests

describe('rangeAdmitsMajor', () => {
  it('caret pins the major', () => {
    expect(rangeAdmitsMajor('^11', 11)).toBe(true);
    expect(rangeAdmitsMajor('^11.2.0', 11)).toBe(true);
    expect(rangeAdmitsMajor('^10', 11)).toBe(false);
    expect(rangeAdmitsMajor('^12', 11)).toBe(false);
  });

  it('tilde pins the major', () => {
    expect(rangeAdmitsMajor('~11.4.0', 11)).toBe(true);
    expect(rangeAdmitsMajor('~10.9.9', 11)).toBe(false);
  });

  it('bare exact / bare major', () => {
    expect(rangeAdmitsMajor('11', 11)).toBe(true);
    expect(rangeAdmitsMajor('11.0.0', 11)).toBe(true);
    expect(rangeAdmitsMajor('10', 11)).toBe(false);
  });

  it('wildcard forms', () => {
    expect(rangeAdmitsMajor('*', 11)).toBe(true);
    expect(rangeAdmitsMajor('latest', 11)).toBe(true);
    expect(rangeAdmitsMajor('11.x', 11)).toBe(true);
    expect(rangeAdmitsMajor('10.x', 11)).toBe(false);
  });

  it('single comparators', () => {
    expect(rangeAdmitsMajor('>=11', 11)).toBe(true);
    expect(rangeAdmitsMajor('>=12', 11)).toBe(false);
    expect(rangeAdmitsMajor('>=10.0.0', 11)).toBe(true);
    expect(rangeAdmitsMajor('<13', 11)).toBe(true);
    expect(rangeAdmitsMajor('<11', 11)).toBe(false);
    expect(rangeAdmitsMajor('>11', 11)).toBe(false); // bare major excludes 11
    expect(rangeAdmitsMajor('>11', 12)).toBe(true);
  });

  it('compound comparator ranges', () => {
    expect(rangeAdmitsMajor('>=11.0.0 <13.0.0', 11)).toBe(true);
    expect(rangeAdmitsMajor('>=11.0.0 <13.0.0', 12)).toBe(true);
    expect(rangeAdmitsMajor('>=11.0.0 <13.0.0', 13)).toBe(false);
    expect(rangeAdmitsMajor('>=12 <14', 11)).toBe(false);
  });

  it('hyphen ranges', () => {
    expect(rangeAdmitsMajor('10.0.0 - 12.0.0', 11)).toBe(true);
    expect(rangeAdmitsMajor('10.0.0 - 12.0.0', 13)).toBe(false);
  });

  it('returns null for unrecognized shapes (never a false rejection)', () => {
    expect(rangeAdmitsMajor('', 11)).toBeNull();
    expect(rangeAdmitsMajor('garbage', 11)).toBeNull();
    expect(rangeAdmitsMajor('workspace:*', 11)).toBeNull();
  });

  it('bounds pathological input (ReDoS-safe) without catastrophic backtracking', () => {
    // The engines string is externally authored; the comparator/hyphen parsing
    // must not degrade on adversarial input (CodeQL alerts 837/838).
    //
    // The adversarial shapes: an overlong comparator, a hyphen-range "bomb", and
    // a comparator pair separated by a huge whitespace run.
    const shapes = (scale: number) => [
      '<' + '\t'.repeat(scale),
      'a\t-\t' + '\t'.repeat(scale),
      '>=11.0.0 ' + ' '.repeat(scale) + '<13.0.0',
    ];

    // 1. Behaviour: every shape is *unrecognized*, never a false rejection.
    //    This is the assertion that actually pins the contract.
    for (const input of shapes(100_000)) {
      expect(rangeAdmitsMajor(input, 11)).toBeNull();
    }

    // 2. Cost: the parse must stay linear in the input length.
    //
    //    This deliberately asserts *no absolute wall-clock bound*. The previous
    //    50ms ceiling measured machine load rather than the parser: under the
    //    full-repo run (~130 parallel turbo tasks) it exceeded 50ms on a healthy
    //    tree and reddened PRs that never touched this package (#4485).
    //
    //    What the guard is really for is catastrophic backtracking — a regression
    //    that makes parsing *superlinear* in the input. So measure the scaling
    //    instead: the same shapes at 1x and 8x length. Load largely cancels out of
    //    a ratio, and min-of-N discards the samples the scheduler interrupted.
    //
    //    Healthy (linear) parsing tracks the input at ~8x; measured repeatedly at
    //    8.3-8.5x. The 40x ceiling therefore keeps ~5x headroom over healthy while
    //    still catching even a merely *quadratic* regression (which lands near
    //    64x), let alone an exponential one — which would not finish at all.
    //
    //    The two timings are taken back-to-back inside one iteration and the ratio
    //    is reduced by *minimum*, not the timings independently: a scheduler steal
    //    that lands in only one of the two windows would skew a ratio built from
    //    separately-minimised timings (observed reddening at 3x CPU
    //    oversubscription), whereas the cheapest single pair is the one iteration
    //    that ran cleanest end to end.
    //
    //    NB: a ratio of pathological-to-benign input would NOT work here: a benign
    //    16-char range parses ~300x faster than a 100k-char one purely because it
    //    is 100k characters shorter, which is linear scaling behaving correctly.
    const small = shapes(100_000);
    const big = shapes(800_000);
    const scan = (inputs: readonly string[]): number => {
      const t = performance.now();
      for (const input of inputs) rangeAdmitsMajor(input, 11);
      return performance.now() - t;
    };

    for (let i = 0; i < 10; i++) scan(small); // warm the JIT before measuring
    let ratio = Infinity;
    for (let i = 0; i < 20; i++) {
      ratio = Math.min(ratio, scan(big) / scan(small));
    }
    expect(ratio).toBeLessThan(40);
  });
});

describe('checkProtocolCompat', () => {
  it('ok when the declared protocol range admits the runtime major', () => {
    const r = checkProtocolCompat({ id: 'a', engines: { protocol: '^11' } }, RT);
    expect(r.status).toBe('ok');
  });

  it('incompatible with a structured diagnostic when it does not', () => {
    const r = checkProtocolCompat({ id: 'com.acme.crm', engines: { protocol: '^10' } }, RT);
    expect(r.status).toBe('incompatible');
    if (r.status !== 'incompatible') return;
    expect(r.diagnostic.code).toBe('OS_PROTOCOL_INCOMPATIBLE');
    expect(r.diagnostic.packageId).toBe('com.acme.crm');
    expect(r.diagnostic.requiredRange).toBe('^10');
    expect(r.diagnostic.rangeSource).toBe('engines.protocol');
    expect(r.diagnostic.runtimeVersion).toBe(RT);
    expect(r.diagnostic.targetMajor).toBe(10);
    expect(r.diagnostic.migrateCommand).toBe('objectstack migrate meta --from 10');
    // The message names both versions and the command — the whole point of D1.
    expect(r.diagnostic.message).toContain('^10');
    expect(r.diagnostic.message).toContain('11.0.0');
    expect(r.diagnostic.message).toContain('migrate meta --from 10');
  });

  it('the diagnostic is identical in shape one major behind or five', () => {
    const near = checkProtocolCompat({ id: 'p', engines: { protocol: '^10' } }, RT);
    const far = checkProtocolCompat({ id: 'p', engines: { protocol: '^6' } }, RT);
    expect(near.status).toBe('incompatible');
    expect(far.status).toBe('incompatible');
    if (near.status !== 'incompatible' || far.status !== 'incompatible') return;
    expect(Object.keys(near.diagnostic).sort()).toEqual(Object.keys(far.diagnostic).sort());
    expect(far.diagnostic.migrateCommand).toBe('objectstack migrate meta --from 6');
  });

  it('protocol-first precedence over platform and legacy engine', () => {
    // protocol wins even when platform/legacy would say otherwise
    const r = checkProtocolCompat(
      { id: 'p', engines: { protocol: '^11', platform: '^10' }, engine: { objectstack: '^9' } },
      RT,
    );
    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(r.source).toBe('engines.protocol');
  });

  it('falls back to platform, then legacy engine.objectstack', () => {
    const viaPlatform = checkProtocolCompat({ id: 'p', engines: { platform: '^11' } }, RT);
    expect(viaPlatform.status).toBe('ok');
    if (viaPlatform.status === 'ok') expect(viaPlatform.source).toBe('engines.platform');

    const viaLegacy = checkProtocolCompat({ id: 'p', engine: { objectstack: '>=10' } }, RT);
    expect(viaLegacy.status).toBe('ok');
    if (viaLegacy.status === 'ok') expect(viaLegacy.source).toBe('engine.objectstack');
  });

  it('no-range when nothing is declared (grandfathering)', () => {
    expect(checkProtocolCompat({ id: 'p' }, RT).status).toBe('no-range');
    expect(checkProtocolCompat({ id: 'p', engines: {} }, RT).status).toBe('no-range');
  });

  it('unparsed-range for a present but unrecognized range (no false rejection)', () => {
    const r = checkProtocolCompat({ id: 'p', engines: { protocol: 'workspace:*' } }, RT);
    expect(r.status).toBe('unparsed-range');
  });
});

describe('assertProtocolCompat', () => {
  it('throws ProtocolIncompatibleError on a positive mismatch', () => {
    expect(() =>
      assertProtocolCompat({ id: 'p', engines: { protocol: '^10' } }, RT, () => {}),
    ).toThrow(ProtocolIncompatibleError);
    try {
      assertProtocolCompat({ id: 'p', engines: { protocol: '^10' } }, RT, () => {});
    } catch (e) {
      expect(e).toBeInstanceOf(ProtocolIncompatibleError);
      expect((e as ProtocolIncompatibleError).code).toBe('OS_PROTOCOL_INCOMPATIBLE');
      expect((e as ProtocolIncompatibleError).diagnostic.migrateCommand).toContain('--from 10');
    }
  });

  it('returns silently on ok', () => {
    const warn = vi.fn();
    expect(() => assertProtocolCompat({ id: 'p', engines: { protocol: '^11' } }, RT, warn)).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns (does not throw) on no-range', () => {
    const warn = vi.fn();
    assertProtocolCompat({ id: 'p' }, RT, warn);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('no engines.protocol range');
  });

  it('warns (does not throw) on an unparsed range', () => {
    const warn = vi.fn();
    assertProtocolCompat({ id: 'p', engines: { protocol: '???' } }, RT, warn);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain('unrecognized');
  });
});
