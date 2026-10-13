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
 * ## The Default Organization (ADR-0131 D3)
 *
 * Registering `sys_organization` is what makes the engine's ADR-0131 D9 branch
 * refuse a system insert on a tenant-scoped object when the install holds no
 * organization under the `single` posture: a composition that registers no
 * organization object keeps the unstamped branch, one that registers it must
 * hold its Default Organization. So the plugin that registers the object keeps
 * the invariant too: under `single`, `start()` runs the same
 * `ensureDefaultOrganizationExists` `AuthPlugin.start()` runs, and a failure
 * fails the boot. The invariant is not exported for a host to call — a step the
 * host must remember is a step a composition can forget.
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
import type { IDataEngine } from '@objectstack/spec/contracts';
import type { TenancyPosture } from '@objectstack/spec/security';
import { resolveTenancyPosture } from '@objectstack/types';
import { ensureDefaultOrganizationExists } from './default-organization-invariant.js';
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

  /**
   * [ADR-0131 D3] Under the `single` posture, the Default Organization exists
   * before this `start()` returns: found, or created. The same invariant, and
   * the same call, as `AuthPlugin.start()`; see the module header for why this
   * plugin keeps it. A failure throws and fails the boot, never warn-only.
   */
  async start(ctx: PluginContext): Promise<void> {
    if (postureInForce(ctx) !== 'single') return;
    const invariant = await ensureDefaultOrganizationExists(ctx.getService<IDataEngine>('objectql'), {
      logger: ctx.logger,
    });
    if (invariant.ambiguous) {
      ctx.logger.warn(
        `${IDENTITY_OBJECTS_PLUGIN_NAME}: the 'single' tenancy posture holds `
          + `${invariant.ambiguous.organizationCount} organizations and none is the Default Organization `
          + "(slug 'default'), so no owner is derivable: system writes and seed rows that need one are "
          + 'refused (ADR-0131 D9), and each refusal names how to carry the organization instead.',
      );
    }
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

/**
 * The tenancy posture in force, judged the way `AppPlugin` judges whether it
 * loads its seed inline: the `tenancy` service's posture when one is
 * registered, otherwise the posture the deployment requested
 * (`resolveTenancyPosture()`, which throws on an unrecognized value). Without
 * `AuthPlugin` nothing in the platform registers that service, so the request
 * usually decides; a host that registers one decides for both.
 */
function postureInForce(ctx: PluginContext): TenancyPosture {
  try {
    const posture = ctx.getService<{ posture?: TenancyPosture } | undefined>('tenancy')?.posture;
    if (posture) return posture;
  } catch {
    /* no `tenancy` service in this composition */
  }
  return resolveTenancyPosture();
}
