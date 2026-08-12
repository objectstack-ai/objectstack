// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveTenancyPosture } from '@objectstack/types';
import type { TenancyPosture } from '@objectstack/spec/security';
import { printServerReady, type ServerReadyOptions } from './format.js';

/**
 * framework#4801 — the boot banner's `Tenancy:` row.
 *
 * [ADR-0105 D1] `OS_TENANCY_POSTURE` is the authoritative knob; the boolean
 * `OS_MULTI_ORG_ENABLED` survives only as its unset-fallback, folded in by
 * `resolveTenancyPosture()`. serve wires the runtime off that resolver, but the
 * banner printed a boolean sourced from `resolveMultiOrgEnabled()` — a second
 * source for one fact. Booting with `OS_TENANCY_POSTURE=isolated` alone printed
 * `Tenancy: single-tenant` on the same screen where the plugin table listed
 * `Organizations` (observed in cloud#1020): the banner said single-org while the
 * organization wall was up.
 *
 * So the property under test is not "the line looks right", it is **the banner
 * and the resolver cannot disagree**. Every case below computes
 * `resolveTenancyPosture()` from the environment and asserts the printed token
 * IS that value — including the cases that made the old code wrong: a posture
 * set with the boolean unset, a posture that contradicts the boolean, and
 * `group`, which a boolean cannot express at all.
 */
describe('printServerReady Tenancy row (#4801, ADR-0105 D1)', () => {
  const base: ServerReadyOptions = {
    port: 3000,
    configFile: 'objectstack.config.ts',
    isDev: true,
    pluginCount: 1,
  };

  const originalPosture = process.env.OS_TENANCY_POSTURE;
  const originalMultiOrg = process.env.OS_MULTI_ORG_ENABLED;

  let lines: string[];
  let spy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    lines = [];
    // stderr, not stdout (#7915): the whole banner is a diagnostic, and
    // `serve` keeps stdout clear for the MCP stdio transport.
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      // Strip SGR escapes so assertions hold whether or not chalk colors.
      lines.push(args.join(' ').replace(/\u001b\[[0-9;]*m/g, ''));
    });
  });

  afterEach(() => {
    spy.mockRestore();
    if (originalPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = originalPosture;
    if (originalMultiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = originalMultiOrg;
  });

  /** The single `Tenancy:` row, ANSI-stripped and trimmed. */
  const tenancyLine = (): string | undefined => {
    const rows = lines.filter((l) => l.includes('Tenancy:'));
    expect(rows.length).toBeLessThanOrEqual(1);
    return rows[0]?.trim();
  };

  /** The token the banner printed after `Tenancy:`. */
  const printedPosture = (): string | undefined => tenancyLine()?.replace(/^Tenancy:\s*/, '');

  /** Set the two knobs, exactly (unset = absent, not empty). */
  const env = (posture: string | undefined, multiOrg: string | undefined) => {
    if (posture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = posture;
    if (multiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = multiOrg;
  };

  /**
   * The invariant, applied to whatever the environment currently says: boot the
   * banner the way serve does — `tenancyPosture: resolveTenancyPosture()` — and
   * assert the row names precisely the resolver's answer.
   */
  const expectBannerAgreesWithResolver = (): TenancyPosture => {
    const resolved = resolveTenancyPosture();
    printServerReady({ ...base, tenancyPosture: resolved });
    expect(printedPosture()).toBe(resolved);
    return resolved;
  };

  describe('the banner never disagrees with resolveTenancyPosture()', () => {
    it('posture explicitly isolated, boolean unset — the cloud#1020 lie', () => {
      // The regression case. `resolveMultiOrgEnabled()` is false here, so the
      // old banner printed `single-tenant` while serve mounted the wall.
      env('isolated', undefined);
      expect(expectBannerAgreesWithResolver()).toBe('isolated');
      expect(tenancyLine()).toBe('Tenancy: isolated');
      expect(tenancyLine()).not.toContain('single-tenant');
    });

    it('posture unset, boolean true — the legacy fallback still reads isolated', () => {
      env(undefined, 'true');
      expect(expectBannerAgreesWithResolver()).toBe('isolated');
      expect(tenancyLine()).toBe('Tenancy: isolated');
    });

    it('posture single while the boolean says true — posture wins', () => {
      // Contradiction, the direction the old code got right by accident: the
      // boolean would have said `multi-tenant`, the runtime runs unwalled.
      env('single', 'true');
      expect(expectBannerAgreesWithResolver()).toBe('single');
      expect(tenancyLine()).toBe('Tenancy: single');
    });

    it('posture isolated while the boolean says false — posture wins', () => {
      // The same contradiction pointing the other way, which the old code got
      // wrong: banner `single-tenant`, runtime walled.
      env('isolated', 'false');
      expect(expectBannerAgreesWithResolver()).toBe('isolated');
      expect(tenancyLine()).toBe('Tenancy: isolated');
    });

    it('prints group — the posture a boolean can only misreport', () => {
      // `group` is why the field is not a boolean: flattened, it must print
      // either `multi-tenant` (wrong wall shape) or `single-tenant` (no wall).
      env('group', undefined);
      expect(expectBannerAgreesWithResolver()).toBe('group');
      expect(tenancyLine()).toBe('Tenancy: group');
    });

    it('posture unset and boolean unset — single, the default', () => {
      env(undefined, undefined);
      expect(expectBannerAgreesWithResolver()).toBe('single');
      expect(tenancyLine()).toBe('Tenancy: single');
    });

    it("accepts the legacy 'multi' spelling and prints its canonical name", () => {
      env('multi', undefined);
      expect(expectBannerAgreesWithResolver()).toBe('isolated');
      expect(tenancyLine()).toBe('Tenancy: isolated');
    });
  });

  it('prints the posture verbatim for every posture the spec defines', () => {
    for (const posture of ['single', 'group', 'isolated'] as const) {
      lines = [];
      printServerReady({ ...base, tenancyPosture: posture });
      expect(tenancyLine()).toBe(`Tenancy: ${posture}`);
    }
  });

  it('omits the row entirely when the caller has no posture to report', () => {
    printServerReady({ ...base });
    expect(tenancyLine()).toBeUndefined();
  });

  it('never flattens the posture back into multi-/single-tenant wording', () => {
    // The old vocabulary is the tell that a boolean crept back in: it has no
    // spelling for `group`, so its return means the spectrum was squashed again.
    for (const posture of ['single', 'group', 'isolated'] as const) {
      lines = [];
      printServerReady({ ...base, tenancyPosture: posture });
      // Assert the row EXISTS before asserting what it does not say — a
      // `not.toMatch` over a banner with no Tenancy row at all passes
      // vacuously, which reads identical to the bug this file exists to catch.
      expect(tenancyLine()).toBeDefined();
      expect(lines.join('\n')).not.toMatch(/multi-tenant|single-tenant/);
    }
  });

  it('rejects the boolean shape at COMPILE time, not at review time', () => {
    // These two directives are the structural half of the fix and are checked
    // by `pnpm typecheck` (tests are type-checked — AGENTS.md), not by the
    // assertions in this file. `resolveMultiOrgEnabled()` returns `boolean`, so
    // re-wiring the banner to the legacy knob can no longer compile, and the
    // retired field name can no longer be passed in silently ignored.
    // @ts-expect-error — tenancyPosture is a TenancyPosture, never a boolean.
    printServerReady({ port: 1, configFile: 'c', isDev: true, pluginCount: 0, tenancyPosture: true });
    // @ts-expect-error — `multiTenant` was removed with #4801; nothing reads it.
    printServerReady({ port: 1, configFile: 'c', isDev: true, pluginCount: 0, multiTenant: true });
    // @ts-expect-error — and an arbitrary string is not a posture.
    printServerReady({ port: 1, configFile: 'c', isDev: true, pluginCount: 0, tenancyPosture: 'multi' });
    expect(lines.filter((l) => l.includes('Tenancy:'))).toHaveLength(2);
  });
});
