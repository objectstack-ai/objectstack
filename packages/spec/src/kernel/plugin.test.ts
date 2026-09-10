import { describe, it, expect } from 'vitest';
import * as pluginZod from './plugin.zod';
import {
  PluginContextSchema,
  PluginSchema,
  isConsumerInstallable,
  CONSUMER_INSTALLABLE_TYPES,
  type PluginContextData,
  type PluginDefinition,
} from './plugin.zod';

describe('isConsumerInstallable (ADR-0019 — App as the consumer unit)', () => {
  it('only `app` is consumer-installable', () => {
    expect(CONSUMER_INSTALLABLE_TYPES).toEqual(['app']);
    expect(isConsumerInstallable('app')).toBe(true);
    for (const t of ['plugin', 'driver', 'server', 'ui', 'theme', 'agent', 'objectql', 'module', 'adapter']) {
      expect(isConsumerInstallable(t)).toBe(false);
    }
  });

  it('handles undefined', () => {
    expect(isConsumerInstallable(undefined)).toBe(false);
  });
});

describe('PluginContextSchema', () => {
  const validContext = (): PluginContextData => ({
    ql: {
      object: () => ({}),
      query: async () => ({}),
    },
    os: {
      getCurrentUser: async () => ({ id: 'test-user' }),
      getConfig: async () => 'test-config',
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    storage: {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
    },
    i18n: {
      t: () => '',
      getLocale: () => 'en',
    },
    metadata: {},
    events: {},
    app: {
      router: {
        get: () => {},
        post: () => {},
        use: () => {},
      },
    },
    drivers: {
      register: () => {},
    },
  });

  it('should accept valid plugin context', () => {
    expect(() => PluginContextSchema.parse(validContext())).not.toThrow();
    expect(PluginContextSchema.safeParse(validContext()).success).toBe(true);
  });

  it('should accept context with actual implementations', () => {
    const context = {
      ...validContext(),
      metadata: {
        getObject: async () => ({}),
        getFields: async () => [],
      },
      events: {
        on: () => {},
        emit: () => {},
      },
    };
    expect(() => PluginContextSchema.parse(context)).not.toThrow();
  });
});

describe('PluginSchema (descriptor only)', () => {
  it('should accept plugin with minimal metadata', () => {
    const plugin: PluginDefinition = {};
    expect(() => PluginSchema.parse(plugin)).not.toThrow();
  });

  it('should accept plugin with id and version', () => {
    const plugin: PluginDefinition = {
      id: 'com.example.plugin',
      version: '1.0.0',
    };
    expect(() => PluginSchema.parse(plugin)).not.toThrow();
  });
});

describe('`version` accepts the whole of the SemVer 2.0.0 grammar (#16365)', () => {
  /**
   * The key is described `'Semantic Version'`, with no qualifier, and SemVer
   * 2.0.0 defines prerelease and build metadata as PARTS of a semantic version
   * — so the regex that shipped, `/^\d+\.\d+\.\d+$/`, refused strings the
   * key's own declaration called valid. #16365 gave the regex the grammar the
   * describe already claimed.
   *
   * ⭐ The grammar adopted is `PluginLoader.isValidSemanticVersion`'s
   * (`packages/core`), character for character, and NOT a third spelling: that
   * is the check the boot path has always run, so the two declarations now
   * converge exactly and `packages/core`'s `assertPluginContract` could drop the
   * `version` exclusion it carried while they differed.
   */
  const parses = (version: string) => PluginSchema.safeParse({ version }).success;

  it.each([
    // Every example the SemVer 2.0.0 spec text itself lists as valid that the
    // old regex refused, plus the two the `packages/core` loader pins by name
    // and the string two in-repo class-based plugin fixtures actually boot with.
    '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-0A.is.legal',
    '1.0.0-alpha0.valid', '1.0.0-alpha.0valid', '1.2.3-beta',
    '1.0.0+20230101', '1.1.2+meta', '1.0.0+0.build.1-rc.10000aaa-kk-0.1',
    '1.1.2-prerelease+meta', '1.0.0-rc.1+build.1', '2.0.0-rc.1+build.123',
    '0.0.0-fixture',
  ])('accepts %s, which the pre-#16365 regex refused', (version) => {
    expect(parses(version)).toBe(true);
  });

  it.each(['0.0.4', '1.2.3', '10.20.30', '1.0.0'])(
    'still accepts the plain release form %s — this was a widening, not a swap',
    (version) => {
      expect(parses(version)).toBe(true);
    },
  );

  it.each(['1.0', '1', 'v1.0.0', 'invalid', '1.0.0-', '1.0.0+', ''])(
    'still refuses %s',
    (version) => {
      expect(parses(version)).toBe(false);
    },
  );

  it('is a strict SUPERSET of the regex it replaced — nothing that parsed stops parsing', () => {
    // The property the #16365 ruling turns on, asserted rather than asserted
    // ABOUT: the old grammar's language is contained in the new one. Both
    // spellings are written out here so the containment is checked, not
    // narrated — a future tightening of the key fails this line.
    const before = /^\d+\.\d+\.\d+$/;
    const after = /^\d+\.\d+\.\d+(-[a-zA-Z0-9.-]+)?(\+[a-zA-Z0-9.-]+)?$/;
    for (const version of ['0.0.4', '1.2.3', '10.20.30', '01.1.1', '1.01.1', '1.1.01', '0.0.0']) {
      expect(before.test(version), `${version} is the OLD grammar's`).toBe(true);
      expect(after.test(version), `${version} must survive the widening`).toBe(true);
      expect(parses(version), `${version} must still parse`).toBe(true);
    }
  });

  it('⚠️ and is wider than SemVer 2.0.0 itself, in a fringe #16365 did not introduce', () => {
    // Stated so the next reader does not mistake this key for the official
    // SemVer grammar. Leading zeroes in the numeric core were accepted by BOTH
    // spellings before this change — tightening to the official regex would
    // have NARROWED the key, which is what #16365 forbade — and the prerelease
    // and build classes the loader's grammar admits are looser than SemVer's
    // dot-separated-identifier rules. Closing this fringe is its own card, on
    // this key and `isValidSemanticVersion` together.
    for (const version of ['01.1.1', '1.0.0-alpha..1', '1.0.0-0123', '1.0.0+.']) {
      expect(parses(version)).toBe(true);
    }
  });
});

describe('the lifecycle-hook family stays retired (#4212)', () => {
  it('PluginSchema declares none of the five hooks', () => {
    // The kernel's plugin contract is `init`/`start`/`destroy`
    // (`packages/core/src/types.ts`). The `onInstall` family was declared here
    // for years with no invocation site anywhere in the runtime — a plugin
    // authoring them shipped code that never ran. If one of these names comes
    // back it must arrive WITH a kernel that calls it, and this test is where
    // that conversation starts.
    const declared = new Set(Object.keys(PluginSchema.shape));
    for (const hook of ['onInstall', 'onEnable', 'onDisable', 'onUninstall', 'onUpgrade']) {
      expect(declared, `'${hook}' is back on PluginSchema — is there a caller this time?`).not.toContain(hook);
    }
  });

  it('an authored hook is stripped by the parse, not honoured', () => {
    // Non-strict schema → unknown keys strip silently. Pin the strip so the
    // retirement's observable behaviour (the value goes nowhere) is stated
    // rather than assumed. The authoring-side diagnostic for this family
    // lives in the stack-level lint (`lintUnknownStackKeys`), which reports
    // `onDisable` and friends as undeclared keys.
    const parsed = PluginSchema.parse({
      id: 'com.example.plugin',
      onInstall: async () => {},
      onUpgrade: async () => {},
    });
    expect(parsed).not.toHaveProperty('onInstall');
    expect(parsed).not.toHaveProperty('onUpgrade');
  });

  it('the retired exports are gone from the module', () => {
    // `PluginLifecycleSchema`, `PluginLifecycleHooks` and `UpgradeContextSchema`
    // existed solely for the five hooks (`UpgradeContext` served `onUpgrade`).
    // Their only importer repo-wide was this very test file — which is the
    // measure of how dead the surface was.
    expect(pluginZod).not.toHaveProperty('PluginLifecycleSchema');
    expect(pluginZod).not.toHaveProperty('UpgradeContextSchema');
  });
});
