// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  _resetEnvDeprecationWarnings,
  collectConfiguredLocales,
  readEnvWithDeprecation,
  resolveAllowDegradedTenancy,
  resolveAllowDevPlugin,
  resolveSearchPinyinEnabled,
  resolveSandboxTimeoutMs,
  resolveOrgMembershipLimit,
  isMcpServerEnabled,
  resolveMcpStdioAutoStart,
  stampSearchPinyinEnabled,
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
