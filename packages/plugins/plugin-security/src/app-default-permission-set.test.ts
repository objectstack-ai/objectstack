// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
import { describe, it, expect } from 'vitest';
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
