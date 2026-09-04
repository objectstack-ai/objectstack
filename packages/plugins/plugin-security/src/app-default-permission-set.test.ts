// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
import {
  AssembledPackageBodySchema,
  ObjectStackDefinitionSchema,
  composeStacks,
  defineStack,
} from '@objectstack/spec';
import { appDefaultPermissionSetName, appSecurityPluginOptions } from './app-default-permission-set';
import { SecurityPlugin } from './security-plugin';

describe('appDefaultPermissionSetName (ADR-0090 D5)', () => {
  it('returns the name of the first isDefault permission set', () => {
    expect(
      appDefaultPermissionSetName([
        { name: 'read_only' },
        { name: 'member_std', isDefault: true },
        { name: 'member_other', isDefault: true },
      ]),
    ).toBe('member_std');
  });

  it('returns undefined when nothing is marked default', () => {
    expect(appDefaultPermissionSetName([{ name: 'read_only' }])).toBeUndefined();
    expect(appDefaultPermissionSetName(undefined)).toBeUndefined();
    expect(appDefaultPermissionSetName([])).toBeUndefined();
  });

  it('ignores malformed entries', () => {
    expect(
      appDefaultPermissionSetName([null, 42, { isDefault: true }, { name: '', isDefault: true }, { name: 'ok', isDefault: true }]),
    ).toBe('ok');
  });
});

/**
 * [#7001] `appSecurityPluginOptions` — the whole constructor argument, so every
 * boot path spells the wiring once.
 *
 * `appDefaultPermissionSetName` above answers "which profile did the app
 * declare". That left the second half — turning a name into constructor options
 * — open-coded at each call site, and only ONE site ever had it: `objectstack
 * serve`. `@objectstack/verify`'s `bootStack` built a vanilla
 * `new SecurityPlugin()`, so an app's own suite ran against a boot without the
 * profile the CLI gave its users.
 */
describe('appSecurityPluginOptions (#7001)', () => {
  it('reads the declared default off a stack config', () => {
    expect(
      appSecurityPluginOptions({
        permissions: [{ name: 'read_only' }, { name: 'app_member_default', isDefault: true }],
      }),
    ).toEqual({ fallbackPermissionSet: 'app_member_default' });
  });

  it('returns undefined — NOT { fallbackPermissionSet: undefined } — when nothing is declared', () => {
    // The distinction is load-bearing, not stylistic. The constructor reads an
    // ABSENT key as "derive my own default from the built-in sets" and an
    // explicit `null` as "no baseline at all"; returning the object shape works
    // today only because `undefined` happens to hit the same branch, and is one
    // refactor away from silently disabling the platform baseline.
    for (const config of [{ permissions: [{ name: 'plain' }] }, { permissions: [] }, {}, null, undefined, 'nonsense']) {
      expect(appSecurityPluginOptions(config)).toBeUndefined();
    }
  });

  it('reads `permissions` top-level, exactly where serve.ts has always read it', () => {
    // Being cleverer here (also looking inside `manifest`) would re-open the
    // #7001 gap in the other direction: the harness would honour a declaration
    // the CLI ignores, and a suite would again prove something production does
    // not do.
    expect(appSecurityPluginOptions({ manifest: { permissions: [{ name: 'buried', isDefault: true }] } }))
      .toBeUndefined();
  });
});

/**
 * The options do not merely describe the wiring — they land on the plugin. A
 * fake `PluginContext` captures what `init()` publishes as the
 * `security.fallbackPermissionSet` service, which is the value the runtime
 * resolves every authenticated request's additive baseline from (ADR-0090 D5).
 */
describe('the resolved options reach the constructed plugin (#7001)', () => {
  const initAndReadBaseline = async (plugin: SecurityPlugin): Promise<unknown> => {
    const services = new Map<string, unknown>();
    await plugin.init({
      logger: { info() {}, warn() {}, error() {}, debug() {} },
      registerService: (name: string, value: unknown) => services.set(name, value),
      getService: (name: string) => {
        if (name === 'manifest') return { register() {} };
        return undefined;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    return services.get('security.fallbackPermissionSet');
  };

  it('an app-declared default becomes the plugin baseline', async () => {
    const config = { permissions: [{ name: 'app_member_default', isDefault: true }] };
    await expect(initAndReadBaseline(new SecurityPlugin(appSecurityPluginOptions(config))))
      .resolves.toBe('app_member_default');
  });

  it('and no declaration leaves the built-in member_default standing', async () => {
    await expect(initAndReadBaseline(new SecurityPlugin(appSecurityPluginOptions({}))))
      .resolves.toBe('member_default');
  });
});

/**
 * [ADR-0130 D4, #15007] The reader resolves `packages[]`.
 *
 * Reader card 4/4 of the option-B program ruled on #14512. A multi-package
 * artifact carries each definition twice today — flattened at the top level and
 * again under `packages[]` — and option B removes the flattened copy. Every
 * assertion below is about the SAME declaration read out of both shapes, which
 * is what "the artifact stays additive while the readers learn" means.
 *
 * The two shapes are built by the REAL composer (`composeStacks`, the one
 * `examples/app-multi-package` uses) rather than hand-written, so a package
 * entry that stopped looking the way this file assumes fails here instead of
 * passing against a shape the platform never emits. The option-B shape is
 * derived from it by stripping the package-owned keys — and that key set is
 * read off the two schemas, never transcribed, so a collection family added to
 * the stack schema next month is stripped too.
 */
describe('appSecurityPluginOptions over `packages[]` (ADR-0130 D4, #15007)', () => {
  const CORE_ID = 'com.example.security.core';
  const ADDON_ID = 'com.example.security.addon';
  const CORE_PROFILE = 'core_member_default';
  const ADDON_PROFILE = 'addon_member_default';

  const shapeKeys = (schema: unknown): string[] =>
    Object.keys((schema as { shape: Record<string, unknown> }).shape);

  /** Exactly the keys an option-B artifact no longer carries at the top level. */
  const PACKAGE_OWNED_KEYS: readonly string[] = (() => {
    const body = new Set(shapeKeys(AssembledPackageBodySchema));
    return shapeKeys(ObjectStackDefinitionSchema).filter((k) => body.has(k));
  })();

  const permissionSet = (name: string) => ({
    name,
    label: name,
    isDefault: true,
    objects: {},
  });

  const coreStack = () =>
    defineStack({
      manifest: {
        id: CORE_ID, name: 'Security Probe Core', namespace: 'secprobe',
        version: '1.0.0', type: 'app',
      },
      permissions: [permissionSet(CORE_PROFILE)],
    });

  /** Declared SECOND in composition order, and depends on the app package. */
  const addonStack = () =>
    defineStack({
      manifest: {
        id: ADDON_ID, name: 'Security Probe Addon', namespace: 'secprobe',
        version: '1.0.0', type: 'module',
        dependencies: { [CORE_ID]: '^1.0.0' },
      },
    });

  /** Today's emitted shape: flattened top level PLUS `packages[]`. */
  const additive = () => composeStacks([addonStack(), coreStack()], { manifest: 'preserve' });

  /** The ruled shape: `packages[]` only. */
  const optionB = () => {
    const composed = additive() as unknown as Record<string, unknown>;
    const owned = new Set(PACKAGE_OWNED_KEYS);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(composed)) if (!owned.has(key)) out[key] = value;
    return out;
  };

  it('CONTROL — the additive shape really does carry the flattened copy', () => {
    // Without this, the option-B case below could pass because the fixture
    // never had a flattened level to lose.
    const composed = additive() as unknown as Record<string, unknown>;
    expect(Array.isArray(composed.permissions)).toBe(true);
    expect((composed.permissions as unknown[]).length).toBeGreaterThan(0);
    expect((composed.packages as unknown[]).length).toBe(2);
    expect(PACKAGE_OWNED_KEYS).toContain('permissions');
  });

  it('the additive shape answers exactly what it answered before this card', () => {
    expect(appSecurityPluginOptions(additive())).toEqual({ fallbackPermissionSet: CORE_PROFILE });
  });

  it('OPTION B — the flattened level is gone and the packaged declaration is still resolved', () => {
    const stripped = optionB();
    expect(stripped.permissions).toBeUndefined();
    expect((stripped.packages as unknown[]).length).toBe(2);

    // The pre-#15007 reader returned `undefined` here — no throw, no log, and
    // every member of the app silently down to the platform floor alone.
    expect(appSecurityPluginOptions(stripped)).toEqual({ fallbackPermissionSet: CORE_PROFILE });
  });

  it('the flattened level still answers FIRST when both shapes carry a set', () => {
    // The reader half lands while the artifact is still additive, so this
    // function must be a superset of the old read and never a replacement:
    // whatever the top level said, it still says.
    expect(
      appSecurityPluginOptions({
        permissions: [permissionSet('flattened_wins')],
        packages: [{ manifest: { id: CORE_ID, name: 'Core', version: '1.0.0', type: 'app', permissions: [permissionSet(CORE_PROFILE)] } }],
      }),
    ).toEqual({ fallbackPermissionSet: 'flattened_wins' });
  });

  it('package order is `resolveArtifactPackageOrder`\'s, not the array\'s', () => {
    // Both packages declare an `isDefault` set and the DEPENDENT one is listed
    // first. "The first isDefault set" has to mean the same thing here as at
    // every other artifact reader, so the depended-upon package answers —
    // dependency-topological order (ADR-0130 D5), not authoring accident.
    expect(
      appSecurityPluginOptions({
        packages: [
          { manifest: { id: ADDON_ID, name: 'Addon', version: '1.0.0', type: 'module', dependencies: { [CORE_ID]: '^1.0.0' }, permissions: [permissionSet(ADDON_PROFILE)] } },
          { manifest: { id: CORE_ID, name: 'Core', version: '1.0.0', type: 'app', permissions: [permissionSet(CORE_PROFILE)] } },
        ],
      }),
    ).toEqual({ fallbackPermissionSet: CORE_PROFILE });

    // …and with the dependency edge removed, declared order is what is left.
    expect(
      appSecurityPluginOptions({
        packages: [
          { manifest: { id: ADDON_ID, name: 'Addon', version: '1.0.0', type: 'module', permissions: [permissionSet(ADDON_PROFILE)] } },
          { manifest: { id: CORE_ID, name: 'Core', version: '1.0.0', type: 'app', permissions: [permissionSet(CORE_PROFILE)] } },
        ],
      }),
    ).toEqual({ fallbackPermissionSet: ADDON_PROFILE });
  });

  it('a package that declares no default does not shadow one that does', () => {
    expect(
      appSecurityPluginOptions({
        packages: [
          { manifest: { id: ADDON_ID, name: 'Addon', version: '1.0.0', type: 'module', permissions: [{ name: 'addon_read_only', label: 'RO', objects: {} }] } },
          { manifest: { id: CORE_ID, name: 'Core', version: '1.0.0', type: 'app', permissions: [permissionSet(CORE_PROFILE)] } },
        ],
      }),
    ).toEqual({ fallbackPermissionSet: CORE_PROFILE });
  });

  it('an artifact with no `packages` key still reads the top level and NOTHING else', () => {
    // D4's second branch hands `resolveArtifactPackageOrder` the caller's own
    // object back as the single package body, so this path is the pre-#15007
    // read exactly — including its refusal to look inside the singular
    // `manifest` (#7001, pinned above).
    expect(appSecurityPluginOptions({ manifest: { permissions: [permissionSet('buried')] } })).toBeUndefined();
    expect(appSecurityPluginOptions({ packages: [] })).toBeUndefined();
    expect(appSecurityPluginOptions({ permissions: [permissionSet('top')] })).toEqual({ fallbackPermissionSet: 'top' });
  });

  /**
   * The gate travels with the read: `resolveArtifactPackageOrder` refuses a
   * malformed `packages` with an ADR-0112 envelope, and this reader does not
   * catch it. Swallowing it would resolve a permission surface out of an
   * artifact the loader refuses to load.
   */
  describe('a malformed `packages` is refused, not silently skipped', () => {
    const refusalOf = (config: unknown): { code?: string; status?: number; message?: string } => {
      try {
        appSecurityPluginOptions(config);
        return {};
      } catch (e) {
        return e as { code?: string; status?: number; message?: string };
      }
    };

    it('`packages` that is not an array', () => {
      const err = refusalOf({ packages: 'nope' });
      expect(err.code).toBe('INVALID_ARTIFACT_PACKAGES');
      expect(err.status).toBe(422);
    });

    it('an entry inlined instead of wrapped under `manifest:`', () => {
      const err = refusalOf({ packages: [{ id: CORE_ID, name: 'Core', version: '1.0.0', type: 'app', permissions: [permissionSet(CORE_PROFILE)] }] });
      expect(err.code).toBe('INVALID_ARTIFACT_PACKAGE_ENTRY');
      expect(err.status).toBe(422);
    });

    it('the same package id twice', () => {
      const entry = { manifest: { id: CORE_ID, name: 'Core', version: '1.0.0', type: 'app', permissions: [permissionSet(CORE_PROFILE)] } };
      const err = refusalOf({ packages: [entry, entry] });
      expect(err.code).toBe('DUPLICATE_ARTIFACT_PACKAGE');
      expect(err.status).toBe(422);
    });
  });
});
