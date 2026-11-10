// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31801, #31895, cloud#3862] The declared-rename planner, in one place: the
 * plan the install-local door reads at its step 2c″ and the read-only
 * {@link INSTALL_RENAME_PLANNER_SERVICE} a hosted install asks before it
 * writes. Two mounts register that service, both from here:
 *
 * - {@link MarketplaceInstallRenamePlannerPlugin}, the planner alone: no
 *   install door, no route, no file ledger, no rehydrate. A kernel that does
 *   not mount `MarketplaceInstallLocalPlugin` mounts this one.
 * - `MarketplaceInstallLocalPlugin`, the install door, which registers the
 *   same planner beside its door service, so a host that mounts only the door
 *   keeps it.
 *
 * Mounted together, in either order, the service is registered once
 * ({@link registerInstallRenamePlanner}): the kernel refuses a second
 * registration of a name, and both mounts register this module's planner, so
 * whichever initializes first answers for both.
 *
 * The planner reads the data engine (`objectql`) and its driver when it is
 * asked, never at init, and writes nothing.
 */

import type { Plugin, PluginContext } from '@objectstack/core';
import { resolveStackCollection } from '@objectstack/core';
import { comparePackageVersions, type PackageUpgradeSide } from '@objectstack/metadata-core';
import {
    INSTALL_RENAME_PLANNER_SERVICE,
    planInstallDeclaredRenames,
    type InstallRenameEngine,
    type InstallRenamePlanner,
    type InstallRenameRefusal,
    type InstallRenameTable,
} from './marketplace-install-declared-renames.js';

/**
 * A package body converted forward through the data engine's ADR-0087
 * conversion chain (`convertPackageBodyForward`), as the registry reads it;
 * the body unchanged when this runtime has no engine or the engine has no
 * such member.
 */
export function convertPackageBodyForward(ctx: PluginContext, manifest: unknown): any {
    let ql: { convertPackageBodyForward?: (body: unknown) => unknown } | undefined;
    try { ql = ctx.getService('objectql') as typeof ql; } catch { /* no data engine */ }
    return typeof ql?.convertPackageBodyForward === 'function' ? ql.convertPackageBodyForward(manifest) : manifest;
}

/** One side of a package version comparison, a multi-package artifact folded as `planUpgrade` folds it. */
export function packageUpgradeSideOf(artifact: unknown): PackageUpgradeSide {
    return { objects: resolveStackCollection(artifact, 'objects'), data: resolveStackCollection(artifact, 'data') };
}

/**
 * [#30885, #31801] The declared-rename plan of `converted` over `installed`
 * (both converted forward; `installed` `null` on a fresh install, `undefined`
 * when none can be read): the type changes the package upgrade plan lists,
 * judged with the tables by {@link planInstallDeclaredRenames}. The ONE entry:
 * step 2c″ of the install door and the planner service both call it. It
 * writes nothing; a table that cannot be read throws.
 */
export async function planDeclaredRenames(
    ctx: PluginContext,
    manifestId: string,
    converted: unknown,
    installed: unknown,
): Promise<{ tables: InstallRenameTable[]; refusals: InstallRenameRefusal[] }> {
    let engine: InstallRenameEngine | undefined;
    try { engine = ctx.getService('objectql') as InstallRenameEngine | undefined; } catch { /* no data engine */ }
    const typeChanges = installed === null || installed === undefined
        ? []
        : comparePackageVersions(packageUpgradeSideOf(installed), packageUpgradeSideOf(converted)).typeChanges;
    return planInstallDeclaredRenames({ manifestId, incoming: converted, installed, engine, typeChanges });
}

/**
 * The read-only planner over `ctx`'s kernel: what step 2c″ of the door would
 * carry and refuse for the same two versions, each converted forward as the
 * door converts it.
 */
export function createInstallRenamePlanner(ctx: PluginContext): InstallRenamePlanner {
    return {
        plan: async ({ manifestId, incoming, installed }) => {
            const plan = await planDeclaredRenames(
                ctx,
                manifestId,
                convertPackageBodyForward(ctx, incoming),
                installed === null || installed === undefined ? installed : convertPackageBodyForward(ctx, installed),
            );
            return {
                carries: plan.tables.flatMap((t) => t.carries.map((c) => ({ object: t.object, table: c.table, from: c.from, to: c.to }))),
                refusals: plan.refusals,
            };
        },
    };
}

/**
 * Register the planner under {@link INSTALL_RENAME_PLANNER_SERVICE} unless the
 * kernel already holds that service. Both mounts call this from `init()`: the
 * first to initialize registers, the second finds it and leaves it, so the
 * two never collide on the kernel's refusal of a second registration.
 */
export function registerInstallRenamePlanner(ctx: PluginContext): void {
    if (typeof ctx.getServices === 'function' && ctx.getServices().has(INSTALL_RENAME_PLANNER_SERVICE)) return;
    ctx.registerService?.(INSTALL_RENAME_PLANNER_SERVICE, createInstallRenamePlanner(ctx));
}

/**
 * [#31895, cloud#3862] The declared-rename planner with no install door: it
 * registers {@link INSTALL_RENAME_PLANNER_SERVICE} and nothing else. No route
 * is mounted, no install ledger is read or written, nothing is rehydrated.
 * The planner asks the kernel's data engine (`objectql`) and its driver when
 * it is called, so compose it with the engine:
 *
 * ```ts
 * await kernel.use(new ObjectQLPlugin());
 * await kernel.use(new MarketplaceInstallRenamePlannerPlugin());
 * // later: ctx.getService<InstallRenamePlanner>(INSTALL_RENAME_PLANNER_SERVICE).plan({ … })
 * ```
 *
 * Mounting it beside `MarketplaceInstallLocalPlugin` is harmless in either
 * order: the service is registered once, by this module's one planner.
 */
export class MarketplaceInstallRenamePlannerPlugin implements Plugin {
    readonly name = 'com.objectstack.runtime.marketplace-install-rename-planner';
    readonly version = '1.0.0';

    /** The one service init() leaves registered on every path (ADR-0116). */
    readonly providesServices = [INSTALL_RENAME_PLANNER_SERVICE];

    init = async (ctx: PluginContext): Promise<void> => {
        registerInstallRenamePlanner(ctx);
    };
}
