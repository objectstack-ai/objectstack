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
// Two more, added after an adversarial contract review measured the first draft
// of this file claiming more than it pinned:
//
//   - a composed multi-package stack with NO i18n anywhere DOES reach
//     `resolveArtifactPackageOrder` (counted, not argued). The short-circuit is
//     real only for a stack whose flattened `translations` is non-empty.
//   - therefore the gate's refusals are reachable on the ORDINARY path, so a
//     project the gate refuses — one whose package manifest still carries
//     authoring globs — must keep booting. It does, loudly.
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

/**
 * The SAME composition with no i18n anywhere — no `translations` at any level,
 * no `i18n` config, no `manifest.translations`. This is the ordinary
 * multi-package app that simply does not translate, and it is the shape the
 * reachability claim turns on.
 */
const additiveNoI18nProject = (): Record<string, unknown> => {
  const composed = composeStacks(
    [modulePackage(), { ...corePackage(), translations: undefined } as ObjectStackDefinition],
    { manifest: 'preserve' },
  ) as unknown as Record<string, unknown>;
  delete composed.translations;
  for (const entry of composed.packages as Array<{ manifest?: Record<string, unknown> }>) {
    delete entry.manifest?.translations;
  }
  return composed;
};

/** The ruled option-B shape, for the one collection this reader reads. */
const optionBProject = (): Record<string, unknown> => {
  const composed = additiveProject();
  delete composed.translations;
  return composed;
};

const mockCtx = () => {
  const registered = new Map<string, unknown>();
  const info: string[] = [];
  const errors: string[] = [];
  const ctx = {
    logger: {
      info: (line: unknown) => { if (typeof line === 'string') info.push(line); },
      debug: () => undefined,
      warn: () => undefined,
      error: (line: unknown) => { if (typeof line === 'string') errors.push(line); },
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
  return { ctx, info, errors };
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

  it('the flattened level answers FIRST **when it has something to say** — `packages[]` is not traversed then', () => {
    // ⚠️ Scope, stated because an earlier draft of this file read this case as
    // proof of something wider: it pins the short-circuit for a stack whose top
    // level ALREADY declares translations. It says nothing about a stack that
    // declares none — that case is the one below, and it reaches the gate.
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

  it('a composed multi-package stack with NO i18n DOES reach the artifact gate — and answers undefined without throwing', () => {
    // The measurement that falsified this PR's first draft ("for every artifact
    // the platform produces today the packages[] pass is not even reached").
    // It is reached, on the ordinary path, for every multi-package app that
    // does not translate — so the walk is real work and its refusals are
    // reachable in ordinary use, which is why `DevPlugin` degrades on them.
    //
    // `packages` is read TWICE when the gate is reached and ZERO times when the
    // flattened level short-circuits: once by this reader's own absent-key
    // guard, once inside `resolveArtifactPackageOrder`. That second read is the
    // discriminator, so the assertion is on it and not on "at least one".
    let packagesReads = 0;
    const project = additiveNoI18nProject();
    const counted = new Proxy(project, {
      get(target, key, recv) {
        if (key === 'packages') packagesReads += 1;
        return Reflect.get(target, key, recv);
      },
    });

    expect(project.translations).toBeUndefined();
    expect((project.packages as unknown[]).length).toBe(2);
    expect(() => devI18nPluginOptions(counted)).not.toThrow();
    expect(devI18nPluginOptions(counted)).toBeUndefined();
    expect(packagesReads).toBeGreaterThanOrEqual(2);
  });

  it('a stack that already declares its locales is answered WITHOUT walking `packages[]`', () => {
    // The limbs are asked cheapest-first: an `i18n` config answers the question
    // on its own, so a `packages` list that answer never needed cannot refuse
    // it. Before the reorder this threw INVALID_ARTIFACT_PACKAGES.
    const stack = {
      ...additiveNoI18nProject(),
      i18n: { defaultLocale: 'zh-CN' },
      packages: 'not an array — would be refused if this limb were reached',
    };
    expect(devI18nPluginOptions(stack)).toEqual({ defaultLocale: 'zh-CN', fallbackLocale: 'zh-CN' });
  });

  it('a dependency CYCLE between two packages throws a BARE Error — no `code`, no `status`', () => {
    // Documented under @throws because it is the one refusal here that does not
    // carry the ADR-0112 envelope: it comes from `resolvePluginOrder`, the
    // platform's one topological sorter, not from the artifact gate. A caller
    // matching on `code` alone would miss it — `DevPlugin`'s catch does not.
    const cyclic = {
      manifest: { id: 'a', name: 'A', version: '1.0.0', type: 'app' },
      packages: [
        { manifest: { id: 'a', name: 'A', version: '1.0.0', type: 'app', dependencies: { b: '^1.0.0' } } },
        { manifest: { id: 'b', name: 'B', version: '1.0.0', type: 'module', dependencies: { a: '^1.0.0' } } },
      ],
    };
    let caught: (Error & { code?: unknown; status?: unknown }) | undefined;
    try {
      devI18nPluginOptions(cyclic);
    } catch (err) {
      caught = err as Error & { code?: unknown; status?: unknown };
    }
    expect(caught).toBeInstanceOf(Error);
    expect(caught?.message).toContain('Circular dependency detected');
    expect(caught?.code).toBeUndefined();
    expect(caught?.status).toBeUndefined();
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
    const { ctx, info, errors } = mockCtx();
    await new DevPlugin({
      seedAdminUser: false,
      stack,
      services: {
        objectql: false, driver: false, auth: false, setup: false, server: false,
        rest: false, dispatcher: false, security: false, storage: false,
        'file-storage': false, realtime: false,
      },
    }).init(ctx as never);
    return { constructions: [...i18nConstructions], info, errors };
  };

  it('BOOT — a multi-package app under option B gets the file-based I18nServicePlugin', async () => {
    const { constructions, info } = await bootWith(optionBProject());
    expect(constructions).toEqual([{ defaultLocale: undefined, fallbackLocale: 'en' }]);
    expect(info.some((l) => l.includes('I18nServicePlugin auto-registered'))).toBe(true);
  });

  it('BOOT — a project the ADR-0130 D4 gate REFUSES still boots, loudly, on the fallback', async () => {
    // The regression this posture exists to prevent, reproduced: one package's
    // authoring manifest still declares glob `objects` (`ManifestSchema`'s
    // written form, and the repo's own CONFIG_GLOBS fixture in
    // packages/cli/test/build-multi-package-artifact.e2e.test.ts). Such a body
    // is refused by `ArtifactPackageSchema` BY DESIGN
    // (packages/spec/src/assembled-package-body.test.ts). That project boots
    // today; a reader that threw here would have stopped it booting — and from
    // the block whose only job is deciding whether to register a translation
    // service, while `new AppPlugin(...)` twenty lines above degrades the very
    // same refusal to a log line.
    const refused = additiveNoI18nProject();
    (refused.packages as Array<{ manifest: Record<string, unknown> }>)[0]
      .manifest.objects = ['./src/objects/*.object.ts'];

    // The reader itself still refuses — the gate travels with the read.
    expect(() => devI18nPluginOptions(refused)).toThrow();

    // The PLUGIN does not. It boots, says exactly what is wrong, and registers
    // nothing.
    const { constructions, info, errors } = await bootWith(refused);
    expect(constructions).toEqual([]);
    expect(info.some((l) => l.includes('I18nServicePlugin auto-registered'))).toBe(false);
    const line = errors.find((l) => l.includes('i18n auto-detect could not read'));
    expect(line, `no diagnosis line; errors were:\n${errors.join('\n')}`).toBeDefined();
    // ⛔ Never silent, and never mis-attributed to a missing package (#7926):
    // the line names the metadata defect and carries the refusal verbatim.
    expect(line).toContain('PACKAGE LIST is malformed');
    expect(line).toContain('INVALID_ARTIFACT_PACKAGE_ENTRY');
    expect(line).toContain('packages[0]');
    expect(line).not.toContain('not installed');
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
