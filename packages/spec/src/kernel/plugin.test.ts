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
