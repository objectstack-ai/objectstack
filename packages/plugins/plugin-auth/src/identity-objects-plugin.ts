// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * plugin-auth's identity objects, registered without the rest of plugin-auth.
 *
 * A kernel that mounts ObjectQL but not `AuthPlugin` (the reduced kernel an
 * app's or a plugin's own test suite boots) has no `sys_user`, `sys_member` or
 * `sys_organization`. The engine refuses every read and write of a name its
 * registry does not hold, so a `sys_user` fixture insert fails with
 * `OBJECT_NOT_FOUND`, and `SecurityPlugin` refuses to boot because its
 * authorization store reads `sys_user` and `sys_member`. Mount this plugin in
 * place of `AuthPlugin` there:
 *
 * ```ts
 * await kernel.use(new ObjectQLPlugin());
 * await kernel.use(createIdentityObjectsPlugin());
 * await kernel.use(new SecurityPlugin());
 * ```
 *
 * It registers {@link authIdentityManifest}, the same list `AuthPlugin`
 * registers, so a kit never copies plugin-auth's object list or manifest id.
 * It mounts no authentication: no sessions, no routes, no `auth` service.
 *
 * `@objectstack/verify`'s in-process handle (`bootStack`) already mounts
 * `AuthPlugin`, and with it these objects. An app suite that boots through it
 * needs nothing from this module; it is for kits that compose their own kernel.
 *
 * ## Why the objects keep plugin-auth's package id
 *
 * The manifest is registered under `AUTH_PLUGIN_ID`, the id `AuthPlugin` uses,
 * not under an id of this plugin's own. The registry records one owning package
 * per object and refuses a second package that claims it (ADR-0029 D3), so the
 * id decides the objects' provenance. Under a different id the same `sys_user`
 * would belong to one package in a reduced kernel and to another in a full one.
 * The kernel plugin name below is distinct only because the kernel needs one
 * name per plugin.
 *
 * ## Not beside `AuthPlugin`
 *
 * `AuthPlugin` registers the same manifest itself. Mounting both would register
 * the objects twice under one package id, and the second registration replaces
 * the first package record. `init()` refuses that composition instead.
 * `optionalDependencies` orders `AuthPlugin` ahead when it is composed, so its
 * `auth` service is registered by the time this plugin's `init()` asks.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import { authIdentityManifest } from './manifest.js';

/** The kernel plugin name of {@link IdentityObjectsPlugin}. */
export const IDENTITY_OBJECTS_PLUGIN_NAME = 'com.objectstack.auth.identity-objects';

export interface IdentityObjectsPluginOptions {
  /**
   * The datasource that owns the identity tables, with the same meaning as
   * `AuthPluginOptions.manifestDatasource`. Defaults to the manifest header's
   * `defaultDatasource`.
   */
  manifestDatasource?: string;
}

/**
 * Registers plugin-auth's identity objects through the `manifest` service, for
 * a kernel that does not mount `AuthPlugin`. See the module header.
 */
export class IdentityObjectsPlugin implements Plugin {
  name = IDENTITY_OBJECTS_PLUGIN_NAME;
  type = 'standard' as const;
  version = '1.0.0';
  /** ObjectQL registers the `manifest` service this plugin registers through. */
  dependencies: string[] = ['com.objectstack.engine.objectql'];
  /**
   * `AuthPlugin`'s kernel plugin name: ordered ahead when composed, so its
   * `auth` service is registered by the time `init()` asks, and the pair is
   * refused there.
   */
  optionalDependencies: string[] = ['com.objectstack.auth'];
  requiresServices: string[] = ['manifest'];

  private readonly options: IdentityObjectsPluginOptions;

  constructor(options: IdentityObjectsPluginOptions = {}) {
    this.options = options;
  }

  async init(ctx: PluginContext): Promise<void> {
    if (authPluginComposed(ctx)) {
      throw new Error(
        `${IDENTITY_OBJECTS_PLUGIN_NAME}: AuthPlugin is also mounted on this kernel, and it registers `
          + 'the same identity objects under the same package id. Mount createIdentityObjectsPlugin() '
          + 'only on a kernel without AuthPlugin; remove it from this one.',
      );
    }
    ctx.getService<{ register(manifest: unknown): unknown }>('manifest').register(
      authIdentityManifest({ datasource: this.options.manifestDatasource }),
    );
  }
}

/** A new {@link IdentityObjectsPlugin}. */
export function createIdentityObjectsPlugin(
  options: IdentityObjectsPluginOptions = {},
): IdentityObjectsPlugin {
  return new IdentityObjectsPlugin(options);
}

/**
 * Whether `AuthPlugin` is composed. Only its `init()` registers the `auth`
 * service, and `optionalDependencies` puts that `init()` first, so absence
 * here means it is not mounted.
 */
function authPluginComposed(ctx: PluginContext): boolean {
  try {
    return ctx.getService('auth') != null;
  } catch {
    return false;
  }
}
