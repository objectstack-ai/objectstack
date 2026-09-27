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

describe('`version` is SemVer 2.0.0, exactly — the canon for this concept', () => {
  /**
   * The key WAS described `'Semantic Version'`, with no qualifier, and SemVer
   * 2.0.0 defines prerelease and build metadata as PARTS of a semantic version
   * — so the regex that shipped, `/^\d+\.\d+\.\d+$/`, refused strings the
   * key's own declaration called valid. #16365 gave the regex the grammar the
   * describe already claimed: the boot path's, character for character, so the
   * two declarations converged and `packages/core`'s `assertPluginContract`
   * could drop the `version` exclusion it carried while they differed.
   *
   * That grammar was still WIDER than the standard, by eight strings, and
   * #16365's widen-never-narrow ruling left no way to remove them — so #17070
   * moved the CLAIM instead and pinned the eight as accepted.
   *
   * ⭐ The maintainer then ruled the canon: one grammar for "the version of a
   * package or plugin" across all its carriers, and that grammar is SemVer
   * 2.0.0. This key narrows on those eight and on NOTHING else — every valid
   * prerelease and build form it accepts today it still accepts, which is what
   * #16365 protected. Both halves are pinned below, and the second half is the
   * one that keeps the earlier ruling honoured.
   */
  const parses = (version: string) => PluginSchema.safeParse({ version }).success;

  it.each([
    // Every example the SemVer 2.0.0 spec text itself lists as valid that the
    // pre-#16365 regex refused, plus the two the `packages/core` loader pins by
    // name and the string two in-repo class-based plugin fixtures boot with.
    //
    // ⛔ This is the list the canon narrowing may NOT touch. A failure here is
    // not a pin to update: it means a valid prerelease or build form the boot
    // path accepts has been refused, which is the one thing #16365 forbids.
    '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-0A.is.legal',
    '1.0.0-alpha0.valid', '1.0.0-alpha.0valid', '1.2.3-beta',
    '1.0.0+20230101', '1.1.2+meta', '1.0.0+0.build.1-rc.10000aaa-kk-0.1',
    '1.1.2-prerelease+meta', '1.0.0-rc.1+build.1', '2.0.0-rc.1+build.123',
    '0.0.0-fixture',
    // Case-preserving, which the standard requires and one sibling carrier used
    // to refuse.
    '1.0.0-Beta.1', '1.0.0+Build.5',
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

  it('the plain release forms the ORIGINAL regex accepted still parse', () => {
    // The containment #16365 turns on, for the part of the old language the
    // canon keeps. `01.1.1` and its siblings are deliberately absent — they
    // moved to the refusal pin below, which is the whole of what this key lost.
    const original = /^\d+\.\d+\.\d+$/;
    for (const version of ['0.0.4', '1.2.3', '10.20.30', '0.0.0']) {
      expect(original.test(version), `${version} is the ORIGINAL grammar's`).toBe(true);
      expect(parses(version), `${version} must still parse`).toBe(true);
    }
  });

  /**
   * The eight strings SemVer 2.0.0 forbids, all of them, pinned as REFUSED.
   *
   * ⭐ This block IS the narrowing, and it is the whole of it. It replaced an
   * identical list pinned the other way: under #16365's widen-never-narrow
   * ruling the eight could not be removed, so #17070 repaired the
   * declared/enforced mismatch from the only side then free — the key's
   * description — and pinned these as accepted to make the new name true.
   *
   * ⭐ Why refusing them does not reverse #16365. That ruling's subject is what
   * LOADS: nothing which loads today may stop loading. None of these eight is a
   * valid prerelease, and no precedence order exists for any of them —
   * `dependency-resolver.ts` (`@objectstack/core`) can place none of them in an
   * order — so a plugin versioned this way could be published and never
   * compared against its own successor. Every valid prerelease and build form
   * the loader accepts is still accepted, and the block above is where that is
   * asserted rather than claimed.
   *
   * ⛔ Do not widen this key back to make one of these pass. That is a published
   * behaviour change on this schema and on `PluginLoader`, and it needs its own
   * card; this pin is the tripwire in both directions.
   */
  it.each([
    // SemVer 2.0.0 §2 — numeric identifiers MUST NOT include leading zeroes.
    '01.1.1', '1.01.1', '1.1.01',
    // §9 — prerelease identifiers MUST NOT be empty, and numeric ones MUST NOT
    // carry leading zeroes.
    '1.0.0-0123', '1.0.0-alpha..1', '1.0.0-alpha..', '1.0.0-.',
    // §10 — build-metadata identifiers MUST NOT be empty.
    '1.0.0+.',
  ])('refuses %s, which SemVer 2.0.0 forbids and no resolver can order', (version) => {
    expect(parses(version)).toBe(false);
  });

  it('the describe() names the standard, and this time the key implements it', () => {
    // The honesty, enforced instead of narrated — and the assertion had to move
    // with the grammar. It used to require the text DISCLAIM SemVer 2.0.0,
    // because the key exceeded it; requiring the disclaimer now would pin the
    // description to a falsehood in the opposite direction.
    const description = PluginSchema.shape.version.description ?? '';

    expect(description).not.toBe('Semantic Version');
    // Names the standard the key now implements...
    expect(description).toMatch(/SemVer 2\.0\.0/);
    // ...and still states the shape, so an author can predict a verdict.
    expect(description).toContain('major.minor.patch');
    // ...and no longer disclaims conformance it now has.
    expect(description).not.toMatch(/looser than SemVer/i);
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
