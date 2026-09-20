// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, expect, it, vi } from 'vitest';
// [#18378] The live control below asserts the two axes are independent, which
// needs the wall predicate beside the policy.
import { postureEnforcesWall } from '@objectstack/spec/security';
import {
  _resetEnvDeprecationWarnings,
  collectConfiguredLocales,
  readEnvWithDeprecation,
  resolveAllowDegradedTenancy,
  resolveAllowDevPlugin,
  resolveMultiOrgEnabled,
  resolveScheduledWorkEnabled,
  resolveScheduledWorkPolicy,
  resolveSearchPinyinEnabled,
  resolveSandboxTimeoutMs,
  resolveOrgMembershipLimit,
  isMcpServerEnabled,
  resolveMcpStdioAutoStart,
  stampSearchPinyinEnabled,
  SCHEDULED_WORK_DISABLED_REASON,
  SCHEDULED_WORK_ENV,
} from './env.js';

describe('readEnvWithDeprecation', () => {
  const originalPreferred = process.env.OS_TEST_FOO;
  const originalLegacy = process.env.TEST_FOO;

  afterEach(() => {
    if (originalPreferred === undefined) delete process.env.OS_TEST_FOO;
    else process.env.OS_TEST_FOO = originalPreferred;
    if (originalLegacy === undefined) delete process.env.TEST_FOO;
    else process.env.TEST_FOO = originalLegacy;
    _resetEnvDeprecationWarnings();
    vi.restoreAllMocks();
  });

  it('returns the preferred OS_ value when set and stays silent', () => {
    process.env.OS_TEST_FOO = 'os-value';
    process.env.TEST_FOO = 'legacy-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEnvWithDeprecation('OS_TEST_FOO', 'TEST_FOO')).toBe('os-value');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the legacy alias and warns exactly once per process', () => {
    delete process.env.OS_TEST_FOO;
    process.env.TEST_FOO = 'legacy-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEnvWithDeprecation('OS_TEST_FOO', 'TEST_FOO')).toBe('legacy-value');
    expect(readEnvWithDeprecation('OS_TEST_FOO', 'TEST_FOO')).toBe('legacy-value');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('TEST_FOO');
    expect(String(warn.mock.calls[0][0])).toContain('OS_TEST_FOO');
    expect(String(warn.mock.calls[0][0])).toContain('deprecated');
  });

  it('returns the legacy value without warning when silent is set', () => {
    delete process.env.OS_TEST_FOO;
    process.env.TEST_FOO = 'legacy-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(
      readEnvWithDeprecation('OS_TEST_FOO', 'TEST_FOO', { silent: true }),
    ).toBe('legacy-value');
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns undefined and does not warn when neither var is set', () => {
    delete process.env.OS_TEST_FOO;
    delete process.env.TEST_FOO;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEnvWithDeprecation('OS_TEST_FOO', 'TEST_FOO')).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats empty string as set (operator opt-in to blank value)', () => {
    process.env.OS_TEST_FOO = '';
    process.env.TEST_FOO = 'legacy-value';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEnvWithDeprecation('OS_TEST_FOO', 'TEST_FOO')).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  it('checks legacy aliases in order and warns for the matched one', () => {
    const originalAlt = process.env.ALT_TEST_FOO;
    try {
      delete process.env.OS_TEST_FOO;
      delete process.env.TEST_FOO;
      process.env.ALT_TEST_FOO = 'alt-value';
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(
        readEnvWithDeprecation('OS_TEST_FOO', ['TEST_FOO', 'ALT_TEST_FOO']),
      ).toBe('alt-value');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('ALT_TEST_FOO');
    } finally {
      if (originalAlt === undefined) delete process.env.ALT_TEST_FOO;
      else process.env.ALT_TEST_FOO = originalAlt;
    }
  });

  it('first legacy alias wins when multiple are set', () => {
    const originalAlt = process.env.ALT_TEST_FOO;
    try {
      delete process.env.OS_TEST_FOO;
      process.env.TEST_FOO = 'first-legacy';
      process.env.ALT_TEST_FOO = 'second-legacy';
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(
        readEnvWithDeprecation('OS_TEST_FOO', ['TEST_FOO', 'ALT_TEST_FOO']),
      ).toBe('first-legacy');
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain('TEST_FOO');
    } finally {
      if (originalAlt === undefined) delete process.env.ALT_TEST_FOO;
      else process.env.ALT_TEST_FOO = originalAlt;
    }
  });
});

describe('resolveAllowDegradedTenancy (ADR-0093 D5)', () => {
  const original = process.env.OS_ALLOW_DEGRADED_TENANCY;
  afterEach(() => {
    if (original === undefined) delete process.env.OS_ALLOW_DEGRADED_TENANCY;
    else process.env.OS_ALLOW_DEGRADED_TENANCY = original;
  });

  it('defaults OFF (unset → fail fast)', () => {
    delete process.env.OS_ALLOW_DEGRADED_TENANCY;
    expect(resolveAllowDegradedTenancy()).toBe(false);
  });

  it('accepts truthy opt-in values case-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'Yes']) {
      process.env.OS_ALLOW_DEGRADED_TENANCY = v;
      expect(resolveAllowDegradedTenancy()).toBe(true);
    }
  });

  it('treats anything else as off', () => {
    for (const v of ['0', 'false', 'off', 'no', '', 'maybe']) {
      process.env.OS_ALLOW_DEGRADED_TENANCY = v;
      expect(resolveAllowDegradedTenancy()).toBe(false);
    }
  });
});

describe('resolveAllowDevPlugin (ADR-0115 D6, #3900)', () => {
  const original = process.env.OS_ALLOW_DEV_PLUGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.OS_ALLOW_DEV_PLUGIN;
    else process.env.OS_ALLOW_DEV_PLUGIN = original;
  });

  it('defaults OFF (unset → the production guard refuses)', () => {
    delete process.env.OS_ALLOW_DEV_PLUGIN;
    expect(resolveAllowDevPlugin()).toBe(false);
  });

  it('accepts the same truthy vocabulary as every other OS_ALLOW_* hatch', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'Yes', ' 1 ']) {
      process.env.OS_ALLOW_DEV_PLUGIN = v;
      expect(resolveAllowDevPlugin()).toBe(true);
    }
  });

  it('treats anything else as off', () => {
    for (const v of ['0', 'false', 'off', 'no', '', 'maybe']) {
      process.env.OS_ALLOW_DEV_PLUGIN = v;
      expect(resolveAllowDevPlugin()).toBe(false);
    }
  });
});

describe('resolveSearchPinyinEnabled (#2486)', () => {
  const original = process.env.OS_SEARCH_PINYIN_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
    else process.env.OS_SEARCH_PINYIN_ENABLED = original;
  });

  it('defaults OFF with no env and no locales', () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    expect(resolveSearchPinyinEnabled()).toBe(false);
    expect(resolveSearchPinyinEnabled({ locales: [] })).toBe(false);
    expect(resolveSearchPinyinEnabled({ locales: ['en', 'ja-JP'] })).toBe(false);
  });

  it('derives ON from any configured zh-* locale when env is unset', () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    for (const locales of [['zh-CN'], ['en', 'zh-TW'], ['zh'], ['ZH-hans'], ['en', 'zh_CN']]) {
      expect(resolveSearchPinyinEnabled({ locales })).toBe(true);
    }
    expect(resolveSearchPinyinEnabled({ locales: ['zhx-nonsense'] })).toBe(false);
  });

  it('explicit env overrides the locale-derived default in both directions', () => {
    process.env.OS_SEARCH_PINYIN_ENABLED = 'false';
    expect(resolveSearchPinyinEnabled({ locales: ['zh-CN'] })).toBe(false);
    process.env.OS_SEARCH_PINYIN_ENABLED = 'true';
    expect(resolveSearchPinyinEnabled({ locales: ['en'] })).toBe(true);
    expect(resolveSearchPinyinEnabled()).toBe(true);
  });

  it('accepts truthy values case-insensitively; anything else is off', () => {
    for (const v of ['1', 'true', 'TRUE', 'on', 'Yes']) {
      process.env.OS_SEARCH_PINYIN_ENABLED = v;
      expect(resolveSearchPinyinEnabled()).toBe(true);
    }
    for (const v of ['0', 'false', 'off', 'no', 'maybe']) {
      process.env.OS_SEARCH_PINYIN_ENABLED = v;
      expect(resolveSearchPinyinEnabled()).toBe(false);
    }
  });
});

describe('collectConfiguredLocales / stampSearchPinyinEnabled (#3955)', () => {
  const original = process.env.OS_SEARCH_PINYIN_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env.OS_SEARCH_PINYIN_ENABLED;
    else process.env.OS_SEARCH_PINYIN_ENABLED = original;
  });

  it('collects defaultLocale, fallbackLocale and supportedLocales; garbage collapses to []', () => {
    expect(
      collectConfiguredLocales({ defaultLocale: 'en', fallbackLocale: 'en', supportedLocales: ['en', 'zh-CN'] }),
    ).toEqual(['en', 'en', 'en', 'zh-CN']);
    expect(collectConfiguredLocales({ supportedLocales: ['en', 42, null] })).toEqual(['en']);
    expect(collectConfiguredLocales(undefined)).toEqual([]);
    expect(collectConfiguredLocales(null)).toEqual([]);
    expect(collectConfiguredLocales('zh-CN')).toEqual([]);
  });

  it('stamps OS_SEARCH_PINYIN_ENABLED=true when a zh-* locale is configured and env is unset', () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    expect(stampSearchPinyinEnabled({ defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] })).toBe(true);
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBe('true');
    // Downstream no-arg consumers (per-engine SchemaRegistry, the plugin
    // gate) now read the same decision — the whole point of the stamp.
    expect(resolveSearchPinyinEnabled()).toBe(true);
  });

  it('leaves the env untouched (and returns false) for a non-Chinese config', () => {
    delete process.env.OS_SEARCH_PINYIN_ENABLED;
    expect(stampSearchPinyinEnabled({ defaultLocale: 'en', supportedLocales: ['en', 'ja-JP'] })).toBe(false);
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBeUndefined();
    expect(stampSearchPinyinEnabled(undefined)).toBe(false);
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBeUndefined();
  });

  it('an explicit env opt-out beats the locale-derived default and is not overwritten', () => {
    process.env.OS_SEARCH_PINYIN_ENABLED = 'false';
    expect(stampSearchPinyinEnabled({ supportedLocales: ['zh-CN'] })).toBe(false);
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBe('false');
  });

  it('an explicit env opt-in wins even with no zh locale configured', () => {
    process.env.OS_SEARCH_PINYIN_ENABLED = 'true';
    expect(stampSearchPinyinEnabled({ supportedLocales: ['en'] })).toBe(true);
    expect(process.env.OS_SEARCH_PINYIN_ENABLED).toBe('true');
  });
});

describe('MCP switches — HTTP surface vs stdio auto-start are decoupled (#3167)', () => {
  const origServer = process.env.OS_MCP_SERVER_ENABLED;
  const origServerLegacy = process.env.MCP_SERVER_ENABLED;
  const origStdio = process.env.OS_MCP_STDIO_ENABLED;
  const restore = (key: string, val: string | undefined) => {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  };
  afterEach(() => {
    restore('OS_MCP_SERVER_ENABLED', origServer);
    restore('MCP_SERVER_ENABLED', origServerLegacy);
    restore('OS_MCP_STDIO_ENABLED', origStdio);
  });

  it('isMcpServerEnabled (HTTP surface): default-on, only explicit falsy opts out', () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    expect(isMcpServerEnabled()).toBe(true);
    for (const v of ['false', '0', 'off', 'no', 'FALSE']) {
      process.env.OS_MCP_SERVER_ENABLED = v;
      expect(isMcpServerEnabled(), `${v} should opt out`).toBe(false);
    }
    for (const v of ['true', '1', 'anything']) {
      process.env.OS_MCP_SERVER_ENABLED = v;
      expect(isMcpServerEnabled(), `${v} keeps HTTP on`).toBe(true);
    }
  });

  it('stdio auto-start: default OFF when nothing is set', () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    delete process.env.OS_MCP_STDIO_ENABLED;
    expect(resolveMcpStdioAutoStart()).toEqual({ enabled: false, viaDeprecatedAlias: false });
  });

  it('stdio auto-start: canonical OS_MCP_STDIO_ENABLED (truthy, no deprecation)', () => {
    delete process.env.OS_MCP_SERVER_ENABLED;
    for (const v of ['1', 'true', 'on', 'yes', 'TRUE']) {
      process.env.OS_MCP_STDIO_ENABLED = v;
      expect(resolveMcpStdioAutoStart(), v).toEqual({ enabled: true, viaDeprecatedAlias: false });
    }
  });

  it('stdio auto-start: legacy OS_MCP_SERVER_ENABLED=true still starts it, flagged deprecated', () => {
    delete process.env.OS_MCP_STDIO_ENABLED;
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    expect(resolveMcpStdioAutoStart()).toEqual({ enabled: true, viaDeprecatedAlias: true });
  });

  it('stdio auto-start: OS_MCP_SERVER_ENABLED=false (or other) never starts stdio — no footgun', () => {
    delete process.env.OS_MCP_STDIO_ENABLED;
    for (const v of ['false', '0', 'off', '1', 'on', 'yes']) {
      process.env.OS_MCP_SERVER_ENABLED = v;
      // Only the literal `true` was ever the legacy stdio trigger.
      expect(resolveMcpStdioAutoStart().enabled, `server=${v}`).toBe(false);
    }
  });

  it('canonical switch wins over the legacy alias (no deprecation flag)', () => {
    process.env.OS_MCP_STDIO_ENABLED = 'true';
    process.env.OS_MCP_SERVER_ENABLED = 'true';
    expect(resolveMcpStdioAutoStart()).toEqual({ enabled: true, viaDeprecatedAlias: false });
  });
});

describe('resolveSandboxTimeoutMs (#3259)', () => {
  const HOOK = 'OS_SANDBOX_HOOK_TIMEOUT_MS';
  const ACTION = 'OS_SANDBOX_ACTION_TIMEOUT_MS';
  const WALL = 'OS_SANDBOX_WALL_CEILING_MS';
  const origHook = process.env[HOOK];
  const origAction = process.env[ACTION];
  const origWall = process.env[WALL];
  afterEach(() => {
    if (origHook === undefined) delete process.env[HOOK];
    else process.env[HOOK] = origHook;
    if (origAction === undefined) delete process.env[ACTION];
    else process.env[ACTION] = origAction;
    if (origWall === undefined) delete process.env[WALL];
    else process.env[WALL] = origWall;
  });

  it('returns the fallback unchanged when the var is unset', () => {
    delete process.env[HOOK];
    delete process.env[ACTION];
    expect(resolveSandboxTimeoutMs('hook', 250)).toBe(250);
    expect(resolveSandboxTimeoutMs('action', 5000)).toBe(5000);
  });

  it('reads the kind-specific var and parses a positive integer', () => {
    process.env[HOOK] = '10000';
    process.env[ACTION] = '20000';
    expect(resolveSandboxTimeoutMs('hook', 250)).toBe(10000);
    expect(resolveSandboxTimeoutMs('action', 5000)).toBe(20000);
  });

  it('does not cross the wires between the hook and action vars', () => {
    process.env[HOOK] = '999';
    delete process.env[ACTION];
    expect(resolveSandboxTimeoutMs('hook', 250)).toBe(999);
    expect(resolveSandboxTimeoutMs('action', 5000)).toBe(5000); // action unset → fallback
  });

  it('ignores empty / non-numeric / non-positive values and keeps the fallback', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5', 'NaN']) {
      process.env[HOOK] = bad;
      expect(resolveSandboxTimeoutMs('hook', 250), `value=${JSON.stringify(bad)}`).toBe(250);
    }
  });

  it('tolerates a leading integer with trailing junk (parseInt semantics, as resolveOrgLimit)', () => {
    process.env[HOOK] = '3000ms';
    expect(resolveSandboxTimeoutMs('hook', 250)).toBe(3000);
  });

  it("resolves the wall-ceiling kind from OS_SANDBOX_WALL_CEILING_MS (ADR-0102)", () => {
    delete process.env[WALL];
    expect(resolveSandboxTimeoutMs('wallCeiling', 30_000)).toBe(30_000); // unset → fallback
    process.env[WALL] = '60000';
    expect(resolveSandboxTimeoutMs('wallCeiling', 30_000)).toBe(60_000);
    // Independent of the hook/action vars.
    process.env[HOOK] = '111';
    process.env[ACTION] = '222';
    expect(resolveSandboxTimeoutMs('wallCeiling', 30_000)).toBe(60_000);
  });
});

/**
 * The vendor default this exists to displace: better-auth's organization plugin
 * reads `count >= (membershipLimit || 100)`, so leaving the option unset caps
 * every organization at 100 members and reports it as
 * `Organization membership limit reached`. The platform meters AI seats, not
 * membership, so "unset" here has to mean UNSET — never zero, and never a
 * number the auth plugin would forward as a real cap.
 */
describe('resolveOrgMembershipLimit (OS_ORG_MEMBERSHIP_LIMIT)', () => {
  const KEY = 'OS_ORG_MEMBERSHIP_LIMIT';
  const original = process.env[KEY];

  afterEach(() => {
    if (original === undefined) delete process.env[KEY];
    else process.env[KEY] = original;
  });

  it('is undefined when unset — the auth plugin turns that into no cap', () => {
    delete process.env[KEY];
    expect(resolveOrgMembershipLimit()).toBeUndefined();
  });

  it('reads a positive integer as the ceiling a deployment asked for', () => {
    process.env[KEY] = '25';
    expect(resolveOrgMembershipLimit()).toBe(25);
  });

  it('reads unusable values as UNSET, never as a cap — a typo must not lock an organization', () => {
    for (const bad of ['', '   ', 'abc', '0', '-5', 'NaN']) {
      process.env[KEY] = bad;
      expect(resolveOrgMembershipLimit(), `value=${JSON.stringify(bad)}`).toBeUndefined();
    }
  });

  it('is independent of OS_ORG_LIMIT, which caps a different thing', () => {
    process.env.OS_ORG_LIMIT = '3';
    delete process.env[KEY];
    expect(resolveOrgMembershipLimit()).toBeUndefined();
    delete process.env.OS_ORG_LIMIT;
  });
});

/**
 * [#17396] The deployment switch for PACKAGE-AUTHORED SCHEDULED WORK, pinned in
 * the package that owns it.
 *
 * Its accept set is stated in three places an operator reads — the docblock on
 * `resolveScheduledWorkEnabled`, `content/docs/deployment/environment-variables.mdx`
 * and `content/docs/automation/flows.mdx` — and every consumer (both time
 * triggers, the automation engine's binding audit, the AppPlugin job loop,
 * `os doctor`) reads the deployment through these two functions. Pinned here so
 * the vocabulary is a contract of THIS package rather than a side effect
 * observable only from a trigger suite.
 *
 * Shape deliberately COPIED from the sibling switches above
 * (`resolveAllowDegradedTenancy`, `resolveAllowDevPlugin`): defaults off /
 * truthy case-insensitively / anything else off. A third dialect for a fourth
 * switch is how the three drift apart.
 */
describe('resolveScheduledWorkEnabled (#17396, ruling G items 1-2)', () => {
  const original = process.env[SCHEDULED_WORK_ENV];
  const originalMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
  afterEach(() => {
    if (original === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = original;
    if (originalMultiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = originalMultiOrg;
  });

  it('is the variable the docs and `os doctor` name', () => {
    // The constant exists so one spelling reaches every surface; a test that
    // only ever indexes `process.env` BY that constant would pass on a typo.
    expect(SCHEDULED_WORK_ENV).toBe('OS_AUTOMATION_SCHEDULED_WORK_ENABLED');
  });

  it('defaults OFF (unset -> no time trigger arms, no packaged job schedules)', () => {
    delete process.env[SCHEDULED_WORK_ENV];
    expect(resolveScheduledWorkEnabled()).toBe(false);
  });

  it('accepts the documented opt-in vocabulary case-insensitively', () => {
    for (const v of ['1', 'true', 'TRUE', 'True', 'on', 'ON', 'yes', 'Yes', ' true ', ' 1 ']) {
      process.env[SCHEDULED_WORK_ENV] = v;
      expect(resolveScheduledWorkEnabled(), `${JSON.stringify(v)} is documented as truthy`).toBe(true);
    }
  });

  it('treats anything else as off, empty string included', () => {
    for (const v of ['0', 'false', 'FALSE', 'off', 'no', '', '   ', 'maybe', 'enabled', 't', 'y']) {
      process.env[SCHEDULED_WORK_ENV] = v;
      expect(
        resolveScheduledWorkEnabled(),
        `${JSON.stringify(v)} is outside the opt-in vocabulary`,
      ).toBe(false);
    }
  });

  it('is opt-IN, where `resolveMultiOrgEnabled` is opt-OUT — a typo must not arm the workload', () => {
    // The two shapes disagree on exactly this input, and the disagreement is
    // the point: `!== 'false'` reads a typo as ON, which for this switch would
    // arm the clock-driven load the operator meant to refuse.
    process.env[SCHEDULED_WORK_ENV] = 'ture';
    process.env.OS_MULTI_ORG_ENABLED = 'ture';
    expect(resolveScheduledWorkEnabled()).toBe(false);
    expect(resolveMultiOrgEnabled(), 'control: the opt-OUT sibling really does read this as on').toBe(true);
  });

  it('the OFF reason is a deployment-policy sentence, never a binding failure', () => {
    // Ruled item 6 in the package that owns the sentence: it must name the
    // switch the operator has to set, and must NOT read as "binding failed".
    expect(SCHEDULED_WORK_DISABLED_REASON).toContain(SCHEDULED_WORK_ENV);
    expect(SCHEDULED_WORK_DISABLED_REASON).not.toMatch(/binding failed/i);
  });
});

/**
 * [#17396] The three bind states, as one reading.
 *
 * `resolveScheduledWorkPolicy` exists so both time triggers, the binding audit
 * and the packaged-job loop cannot disagree about which of the three a
 * deployment is in; this is the table its docblock states.
 */
describe('resolveScheduledWorkPolicy (#17396 ruling G, #18378 ruling A′ — the four bind states)', () => {
  const originalSwitch = process.env[SCHEDULED_WORK_ENV];
  const originalPosture = process.env.OS_TENANCY_POSTURE;
  const originalMultiOrg = process.env.OS_MULTI_ORG_ENABLED;
  afterEach(() => {
    if (originalSwitch === undefined) delete process.env[SCHEDULED_WORK_ENV];
    else process.env[SCHEDULED_WORK_ENV] = originalSwitch;
    if (originalPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = originalPosture;
    if (originalMultiOrg === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = originalMultiOrg;
  });

  /** The default deployment: nothing set at all. */
  const clean = (): void => {
    delete process.env[SCHEDULED_WORK_ENV];
    delete process.env.OS_TENANCY_POSTURE;
    delete process.env.OS_MULTI_ORG_ENABLED;
  };

  it('row 1 — OFF (the default): nothing binds, and no declaration is demanded either', () => {
    clean();
    expect(resolveScheduledWorkPolicy()).toEqual({
      enabled: false,
      posture: 'single',
      requiresActingOrganization: false,
      runOwnership: 'unscoped',
    });
  });

  it('row 1 holds under a WALL too — the OFF reason is the one to report, not an authoring remedy', () => {
    clean();
    // ⚠️ `runOwnership` still reports the posture's rule while the switch is
    // OFF — it is a fact about the posture, not about the switch — but nothing
    // binds, so no run can reach it. `enabled` is the discriminator, and the
    // pin asserts both rather than letting the pair drift.
    for (const [posture, runOwnership] of [
      ['group', 'per-record'],
      ['isolated', 'declared'],
    ] as const) {
      process.env.OS_TENANCY_POSTURE = posture;
      expect(resolveScheduledWorkPolicy()).toEqual({
        enabled: false,
        posture,
        requiresActingOrganization: false,
        runOwnership,
      });
    }
  });

  it('row 2 — ON under `single`: binds, and requires NO acting organization', () => {
    clean();
    process.env[SCHEDULED_WORK_ENV] = 'true';
    process.env.OS_TENANCY_POSTURE = 'single';
    expect(resolveScheduledWorkPolicy()).toEqual({
      enabled: true,
      posture: 'single',
      requiresActingOrganization: false,
      runOwnership: 'unscoped',
    });
  });

  // [#18378, ruling A′] The row that used to pair `group` with `isolated`.
  //
  // ⚠️ THE DISCRIMINATING ASSERTION IS THAT THE TWO POSTURES DISAGREE. A pin
  // that looped over both and expected one shape is exactly what this card
  // retired, so these are deliberately two cases with two different
  // expectations rather than one parameterised case — a future edit that
  // re-merges them has to delete an assertion to do it.
  it('row 3 — ON under `group`: binds WITHOUT a declaration, owning its writes per record', () => {
    clean();
    process.env[SCHEDULED_WORK_ENV] = 'true';
    process.env.OS_TENANCY_POSTURE = 'group';
    expect(resolveScheduledWorkPolicy()).toEqual({
      enabled: true,
      posture: 'group',
      requiresActingOrganization: false,
      runOwnership: 'per-record',
    });
  });

  it('row 4 — ON under `isolated`: the declaration is required, unchanged', () => {
    clean();
    process.env[SCHEDULED_WORK_ENV] = 'true';
    process.env.OS_TENANCY_POSTURE = 'isolated';
    expect(resolveScheduledWorkPolicy()).toEqual({
      enabled: true,
      posture: 'isolated',
      requiresActingOrganization: true,
      runOwnership: 'declared',
    });
  });

  it('`group` enforces a wall and STILL does not require the declaration — the two axes are independent', () => {
    // The live control for the finding that motivated A′: the separating
    // predicate is read reach (`postureUsesUnionScope`), not the wall
    // (`postureEnforcesWall`), and `group` answers true to BOTH. A resolver
    // that regressed to `enabled && postureEnforcesWall(posture)` passes every
    // other case in this block and fails only here.
    clean();
    process.env[SCHEDULED_WORK_ENV] = 'true';
    process.env.OS_TENANCY_POSTURE = 'group';
    expect(postureEnforcesWall('group')).toBe(true);
    expect(resolveScheduledWorkPolicy().requiresActingOrganization).toBe(false);
  });

  it('reports the REQUESTED posture, derived from the legacy boolean when unset', () => {
    clean();
    process.env[SCHEDULED_WORK_ENV] = 'true';
    process.env.OS_MULTI_ORG_ENABLED = 'true';
    expect(resolveScheduledWorkPolicy()).toEqual({
      enabled: true,
      posture: 'isolated',
      requiresActingOrganization: true,
      runOwnership: 'declared',
    });
  });

  it('throws on a bogus posture rather than resolving to `single` and dropping the requirement', () => {
    // A typo'd posture that fell back to `single` would silently remove the
    // declaration requirement with it — the deployment-layer form of the
    // "declared but unenforced" defect. It throws in BOTH switch states,
    // because the posture is resolved before the switch is consulted.
    clean();
    process.env.OS_TENANCY_POSTURE = 'mutli';
    process.env[SCHEDULED_WORK_ENV] = 'true';
    expect(() => resolveScheduledWorkPolicy()).toThrow(/Invalid OS_TENANCY_POSTURE/);
    delete process.env[SCHEDULED_WORK_ENV];
    expect(() => resolveScheduledWorkPolicy()).toThrow(/Invalid OS_TENANCY_POSTURE/);
  });
});
