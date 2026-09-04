// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #15232 — the i18n auto-detect reads `translations` from `packages[]` too.
//
// ── The defect ─────────────────────────────────────────────────────────────
//
// `DevPlugin`'s 3b block decided whether to register the file-based
// `I18nServicePlugin` from `stack.translations` alone. A multi-package artifact
// under ADR-0130 D4's option-B shape carries each definition once, inside
// `packages[]`, with no flattened top level — so the read returned `undefined`,
// the detection said "this app declares no copy", and `os dev` booted on the
// core in-memory i18n fallback. Nothing throws. Nothing logs. The developer
// sees message keys, or last release's strings, where the app declared real
// translations.
//
// ── What is pinned here, and in which direction ────────────────────────────
//
// Both directions, because only the pair is a discrimination:
//
//   - today's ADDITIVE artifact answers exactly as it did before (the flattened
//     level answers FIRST and short-circuits — the caller's original expression
//     is preserved, not re-expressed, which is the trap #15006 measured);
//   - the option-B artifact, whose ONLY copy is under `packages[]`, is now
//     detected — the row this card added to the #15004 ledger and then deleted.
//
// The last case boots the real `DevPlugin` rather than only calling the
// decision, because what a developer experiences is the SERVICE: the plugin has
// to reach `new I18nServicePlugin(...)` with the locales the detection derived.
// `@objectstack/service-i18n` is mocked to a recording double for that arm
// (present and constructible), and every other optional package is mocked
// ABSENT — the #3060 convention in this package's sibling tests, which keeps a
// dev-assembly boot off the vite transform hot path.

import { describe, it, expect, vi } from 'vitest';
import { composeStacks, defineStack, type ObjectStackDefinition } from '@objectstack/spec';

import { devI18nPluginOptions } from './dev-i18n';
import { DevPlugin } from './dev-plugin';

const absent = (name: string): Error =>
  Object.assign(new Error(`Cannot find package '${name}'`), { code: 'ERR_MODULE_NOT_FOUND' });

/** The one package that must be PRESENT: the arm under test constructs it. */
const i18nConstructions = vi.hoisted(() => [] as unknown[]);
vi.mock('@objectstack/service-i18n', () => ({
  I18nServicePlugin: class {
    name = 'com.objectstack.service.i18n';
    type = 'service' as const;
    version = '1.0.0';
    constructor(options: unknown) { i18nConstructions.push(options); }
    async init(): Promise<void> { /* the recorder needs no behaviour */ }
  },
}));

vi.mock('@objectstack/objectql', () => { throw absent('@objectstack/objectql'); });
vi.mock('@objectstack/runtime', () => { throw absent('@objectstack/runtime'); });
// ⛔ NO `@objectstack/driver-memory` mock here, deliberately — do not copy one in
// from the sibling harnesses. `vi.mock` counts as a DECLARATION to
// `scripts/check-driver-memory-census.mjs`, and that package's consumer set is
// locked by maintainer ruling (#5499 froze investment, #5704 / #6664 ruled each
// remaining consumer). A third test consumer is the #6664 defect itself, not a
// bookkeeping chore. Nothing here needs it: every boot below passes
// `services: { driver: false }`, and `dev-plugin.ts`'s ONE
// `import('@objectstack/driver-memory')` sits inside `if (enabled('driver'))`,
// so the specifier is never reached. Measured, not assumed: with the line gone
// this suite is unchanged at 68 passed, both BOOT cases below green in 5ms and
// 1ms — timings a real `import()` of that package would not fit in.
vi.mock('@objectstack/service-storage', () => { throw absent('@objectstack/service-storage'); });
vi.mock('@objectstack/service-realtime', () => { throw absent('@objectstack/service-realtime'); });
vi.mock('@objectstack/plugin-auth', () => { throw absent('@objectstack/plugin-auth'); });
vi.mock('@objectstack/plugin-security', () => { throw absent('@objectstack/plugin-security'); });
vi.mock('@objectstack/plugin-hono-server', () => { throw absent('@objectstack/plugin-hono-server'); });
vi.mock('@objectstack/rest', () => { throw absent('@objectstack/rest'); });
vi.mock('@objectstack/setup', () => { throw absent('@objectstack/setup'); });
vi.mock('@objectstack/account', () => { throw absent('@objectstack/account'); });

// ─── The two-package fixture, in both shapes ────────────────────────────────

const CORE_ID = 'com.example.i18n.core';
const MODULE_ID = 'com.example.i18n.orders';

const corePackage = (): ObjectStackDefinition =>
  defineStack({
    manifest: {
      id: CORE_ID,
      name: 'I18n Probe Core',
      namespace: 'i18nprobe',
      version: '1.0.0',
      type: 'app',
    },
    objects: [
      {
        name: 'i18nprobe_account',
        label: 'Account',
        pluralLabel: 'Accounts',
        sharingModel: 'private',
        fields: { name: { name: 'name', type: 'text', label: 'Name', required: true } },
      },
    ],
    // The whole point: the app's declared COPY lives in a package.
    translations: [
      { en: { objects: { i18nprobe_account: { label: 'Account (translated)' } } } },
    ],
  });

const modulePackage = (): ObjectStackDefinition =>
  defineStack({
    manifest: {
      id: MODULE_ID,
      name: 'I18n Probe Orders',
      namespace: 'i18nprobe',
      version: '1.0.0',
      type: 'module',
      dependencies: { [CORE_ID]: '^1.0.0' },
    },
    objects: [
      {
        name: 'i18nprobe_order',
        label: 'Order',
        pluralLabel: 'Orders',
        sharingModel: 'private',
        fields: { name: { name: 'name', type: 'text', label: 'Number', required: true } },
      },
    ],
  });

/** Today's emitted shape: flattened top level PLUS `packages[]`. */
const additiveProject = (): Record<string, unknown> =>
  composeStacks([modulePackage(), corePackage()], { manifest: 'preserve' }) as unknown as Record<string, unknown>;

/** The ruled option-B shape, for the one collection this reader reads. */
const optionBProject = (): Record<string, unknown> => {
  const composed = additiveProject();
  delete composed.translations;
  return composed;
};

const mockCtx = () => {
  const registered = new Map<string, unknown>();
  const info: string[] = [];
  const ctx = {
    logger: {
      info: (line: unknown) => { if (typeof line === 'string') info.push(line); },
      debug: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    getService: (name: string) => {
      if (registered.has(name)) return registered.get(name);
      throw new Error(`service not found: ${name}`);
    },
    getServices: () => new Map(),
    registerService: (name: string, svc: unknown) => { registered.set(name, svc); },
    hook: () => undefined,
    trigger: () => undefined,
    getKernel: () => undefined,
  };
  return { ctx, info };
};

describe('#15232 — DevPlugin i18n auto-detect over a multi-package stack', () => {
  it('CONTROL — the fixture really carries the translations under `packages[]`', () => {
    // Anti-vacuity: every "detected" below is a READER resolving `packages[]`,
    // never a fixture that quietly kept a flattened copy.
    const optionB = optionBProject();
    expect(optionB.translations).toBeUndefined();
    const bodies = (optionB.packages as Array<{ manifest?: { id?: string; translations?: unknown[] } }>);
    expect(bodies.map((p) => p.manifest?.id).sort()).toEqual([CORE_ID, MODULE_ID]);
    expect(bodies.find((p) => p.manifest?.id === CORE_ID)?.manifest?.translations).toHaveLength(1);
  });

  it("BASELINE — today's additive artifact answers exactly as it did before", () => {
    const additive = additiveProject();
    expect(Array.isArray(additive.translations)).toBe(true);
    expect(devI18nPluginOptions(additive)).toEqual({ defaultLocale: undefined, fallbackLocale: 'en' });
  });

  it('THE FIX — the option-B artifact is detected through `packages[]`', () => {
    expect(devI18nPluginOptions(optionBProject())).toEqual({ defaultLocale: undefined, fallbackLocale: 'en' });
  });

  it('the flattened level answers FIRST — `packages[]` is not even traversed', () => {
    // Two things at once, and the malformed `packages` is what proves the
    // first: the original expression short-circuits, so today's additive
    // artifact cannot start refusing anything it accepted before.
    let reads = 0;
    const stack = {
      manifest: { id: CORE_ID, name: 'x', version: '1.0.0', type: 'app' },
      get translations() { reads += 1; return [{ en: { objects: {} } }]; },
      packages: 'not an array — this would be refused if it were reached',
    };
    expect(devI18nPluginOptions(stack)).toEqual({ defaultLocale: undefined, fallbackLocale: 'en' });
    expect(reads).toBe(1);
  });

  it('a single-package stack reads its `translations` ONCE, and never throws', () => {
    // D4's second branch returns the CALLER'S OWN OBJECT as the single package
    // body, so an unguarded walk would read the same key a second time. The
    // guard is what keeps every single-package stack on exactly the old path.
    let reads = 0;
    const stack = {
      manifest: { id: CORE_ID, name: 'x', version: '1.0.0', type: 'app' },
      get translations() { reads += 1; return []; },
    };
    expect(devI18nPluginOptions(stack)).toBeUndefined();
    expect(reads).toBe(1);
  });

  it('an EMPTY top-level `translations` is not an answer — `packages[]` supplies it', () => {
    // `[]` is falsy for the original expression (`length > 0`), so this is the
    // case where `packages[]` legitimately supplies what the top level lacks.
    const stack = { ...optionBProject(), translations: [] };
    expect(devI18nPluginOptions(stack)).toEqual({ defaultLocale: undefined, fallbackLocale: 'en' });
  });

  it('locales still come from the stack `i18n` config, which option B does not move', () => {
    // `i18n` is an artifact ENVELOPE key, not a package-owned collection, so it
    // stays at the top level in both shapes and this limb loses nothing.
    const stack = { ...optionBProject(), i18n: { defaultLocale: 'zh-CN', fallbackLocale: 'en-US' } };
    expect(devI18nPluginOptions(stack)).toEqual({ defaultLocale: 'zh-CN', fallbackLocale: 'en-US' });
  });

  it('a malformed `packages[]` is REFUSED with an ADR-0112 envelope, not skipped', () => {
    // The gate travels with the read: `resolveArtifactPackageOrder` is also
    // what refuses this artifact at registration, so swallowing it here would
    // resolve an i18n posture out of a package list nothing else accepts.
    const stack = {
      manifest: { id: CORE_ID, name: 'x', version: '1.0.0', type: 'app' },
      // An entry inlined instead of wrapped as `{ manifest: { … } }`.
      packages: [{ id: CORE_ID, name: 'x', version: '1.0.0', type: 'app' }],
    };
    let caught: (Error & { code?: string; status?: number }) | undefined;
    try {
      devI18nPluginOptions(stack);
    } catch (err) {
      caught = err as Error & { code?: string; status?: number };
    }
    expect(caught?.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(caught?.status).toBe(422);
    expect(caught?.message).toContain('packages[0]');
  });

  // ── What the developer actually gets: the SERVICE ─────────────────────────

  const bootWith = async (stack: Record<string, unknown> | undefined) => {
    i18nConstructions.length = 0;
    const { ctx, info } = mockCtx();
    await new DevPlugin({
      seedAdminUser: false,
      stack,
      services: {
        objectql: false, driver: false, auth: false, setup: false, server: false,
        rest: false, dispatcher: false, security: false, storage: false,
        'file-storage': false, realtime: false,
      },
    }).init(ctx as never);
    return { constructions: [...i18nConstructions], info };
  };

  it('BOOT — a multi-package app under option B gets the file-based I18nServicePlugin', async () => {
    const { constructions, info } = await bootWith(optionBProject());
    expect(constructions).toEqual([{ defaultLocale: undefined, fallbackLocale: 'en' }]);
    expect(info.some((l) => l.includes('I18nServicePlugin auto-registered'))).toBe(true);
  });

  it('BOOT — a stack declaring no copy at all still gets no I18nServicePlugin', async () => {
    // The negative control. Without it the assertion above would pass for a
    // detection that fires unconditionally.
    const bare = { manifest: { id: CORE_ID, name: 'x', version: '1.0.0', type: 'app' } };
    const { constructions, info } = await bootWith(bare);
    expect(constructions).toEqual([]);
    expect(info.some((l) => l.includes('I18nServicePlugin auto-registered'))).toBe(false);
  });
});
