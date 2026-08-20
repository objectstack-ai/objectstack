// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Logger } from '@objectstack/spec/contracts';

/**
 * The DECLARED duplicate-plugin-registration contract — one statement, shared
 * by both kernels (#9864, maintainer ruling 2026-08-19, option B).
 *
 * ## What the contract says
 *
 * Registering a plugin whose `name` is already registered **OVERWRITES** the
 * earlier registration — last-one-wins — and emits ONE `warn` naming the
 * plugin and BOTH versions. It is not an error on either kernel.
 *
 * ## Why it is written down here rather than in each kernel
 *
 * It was previously written twice, and the two copies disagreed:
 * `ObjectKernel.use()` accepted the duplicate silently (a bare
 * `plugins.set(name, meta)` with no check and no distinguishing log line),
 * while `LiteKernel.use()` threw `[Kernel] Plugin '<name>' already registered`.
 * `ObjectKernel` is the kernel `os serve` runs, so the production meaning of a
 * duplicate registration was the silent one — and it is load-bearing: it is
 * exactly what lets an app config's `plugins` entry supersede a plugin the CLI
 * auto-registered earlier in the same boot (#9863's `AuditPlugin` case). That
 * behaviour is PRESERVED here on purpose; what changes is that it is now
 * declared, audible, and pinned against both kernels
 * (`plugin-registration.contract.test.ts`) instead of being an accident of
 * whichever kernel a reader happened to open.
 *
 * This is the fourth measured instance of one contract implemented twice
 * across `ObjectKernel`/`LiteKernel` (#5170 hook-error propagation, #5282
 * `ObjectKernel` not inheriting `ObjectKernelBase`, #8357 adjacent one layer
 * up). `ObjectKernel` still does not extend `ObjectKernelBase`, so a shared
 * base class is not available as the sharing mechanism — a module both kernels
 * import is, and it is the same mechanism `plugin-order.ts` and
 * `hook-dispatch.ts` already use for the contracts they own.
 *
 * ⛔ Deliberately NOT exported from the package barrel. Under the ruling this
 * card declares EXISTING behaviour; it does not mint a public registration or
 * supersede API (that was the shape of the option that was NOT ruled). Both
 * kernels import it by relative path, as they do `plugin-order.js`'s internals.
 */

/**
 * The only members the registration contract reads. Satisfied by both kernels'
 * registry value types — `Plugin` (LiteKernel, `version` optional) and
 * `PluginMetadata` (ObjectKernel, `version` always present because
 * `PluginLoader.toPluginMetadata()` defaults it).
 */
export interface NamedRegistration {
    name: string;
    version?: string;
}

/** Render a version for the warning; a plugin may legitimately carry none. */
function versionLabel(plugin: NamedRegistration): string {
    return plugin.version ? `v${plugin.version}` : 'unversioned';
}

/**
 * The superseding warning's text.
 *
 * ## Why it cannot be confused with a first registration
 *
 * The failure this card exists to end is that a superseding registration was
 * indistinguishable from a first one: `ObjectKernel` logged
 * `Plugin registered: <name>@<version>` for BOTH, so one plugin replacing
 * another read as two plugins running. Four properties keep them apart, and
 * each is pinned by the contract test:
 *
 * 1. **A different verb, first thing on the line** — `Plugin superseded:`, not
 *    `Plugin registered:`. A boot log greps and eyeballs the same way.
 * 2. **A different LEVEL** — `warn`, never `info`. This is not decoration on
 *    the `os serve` path: the CLI's default kernel level is `warn`
 *    (`DEFAULT_LOG_LEVEL`, `packages/cli/src/utils/log-level.ts`), at which
 *    `Plugin registered:` is not emitted at all; and the boot-quiet window
 *    (`BootLogCapture`, `BOOT_DIAGNOSTIC_FLOOR = 'warn'`) DISCARDS in-window
 *    `info` and replays only `warn` and above. An `info`-level supersede notice
 *    would be invisible on precisely the boot path where the defect lives.
 * 3. **BOTH versions, in order** — `(v1.0.0) → (v2.0.0)`. A plugin silently
 *    replaced by a differently-configured instance of ITSELF is the expensive
 *    direction, and there the two names are identical; the versions and the
 *    arrow are what make one line say which instance survived.
 * 4. **The consequence, stated** — the earlier instance is discarded before it
 *    ever boots, so a reader is not left to infer whether two plugins are now
 *    running.
 *
 * `ObjectKernel` additionally SUPPRESSES its `Plugin registered:` line for a
 * superseding registration, so the count of `Plugin registered:` lines in a
 * boot log equals the number of plugins that will actually boot.
 */
export function describeSupersededRegistration(
    previous: NamedRegistration,
    next: NamedRegistration,
): string {
    return (
        `Plugin superseded: '${next.name}' — the later registration (${versionLabel(next)}) ` +
        `REPLACED the earlier one (${versionLabel(previous)}). Only the later instance is ` +
        `initialized and started; the earlier one is discarded without ever running init(). ` +
        `Duplicate registration by name is last-one-wins on both kernels by declared contract ` +
        `(#9864) — register the plugin once if that is not what you meant.`
    );
}

/**
 * Apply the declared contract: write `plugin` into `registry` under its name,
 * warning when that displaces an earlier registration.
 *
 * @returns the displaced registration, or `undefined` for a first registration.
 *          Callers use it to decide whether this was a plain registration —
 *          `ObjectKernel` suppresses its `Plugin registered:` line when it was
 *          not.
 *
 * ## Why no teardown of the displaced plugin (measured, #9864)
 *
 * Both kernels refuse registration outside the `idle` state
 * (`ObjectKernelBase.validateIdle()`; `ObjectKernel.use()`'s own state check),
 * so a supersede can only ever displace a plugin the kernel has **not yet
 * initialized** — `init()`, `start()` and `destroy()` all run from
 * `bootstrap()`/`destroy()`, over the resolved order read out of this very
 * registry, from which the displaced entry is already gone. `PluginLoader.
 * loadPlugin()`, which `ObjectKernel` runs BEFORE this point, is pure
 * validation plus a name-keyed map write of its own (so it drops the displaced
 * metadata for the same reason, rather than accumulating it); it invokes
 * nothing on the plugin.
 *
 * The kernel therefore acquired nothing on the displaced plugin's behalf, and
 * there is nothing here to tear down. Calling `destroy()` on it would be the
 * bug, not the fix: `destroy()` is the paired teardown for `init()`, and
 * running it against a never-initialized instance runs cleanup over state that
 * was never set up. Anything the displaced instance holds was acquired by the
 * CALLER's own `new` before `use()` was reached — a survey of all 52 in-tree
 * `implements Plugin` classes found none that acquires an OS-level resource in
 * its constructor (41 have a constructor body; every one normalizes options or
 * builds in-memory helpers — e.g. `HonoServerPlugin`'s `new HonoHttpServer()`
 * only constructs a `Hono` app, its socket opening at `kernel:listening`).
 */
export function registerPluginByName<T extends NamedRegistration>(
    registry: Map<string, T>,
    plugin: T,
    logger: Pick<Logger, 'warn'>,
): T | undefined {
    const previous = registry.get(plugin.name);

    if (previous !== undefined) {
        // `warn`, not `error`: this is a FUNCTIONAL, fully-visible outcome —
        // the composition the host asked for is the one that boots, and
        // nothing that claims to be persisted fails to land. See AGENTS.md
        // "Degradation log levels" for why that distinction decides the level.
        logger.warn(describeSupersededRegistration(previous, plugin), {
            plugin: plugin.name,
            supersededVersion: previous.version,
            supersedingVersion: plugin.version,
        });
    }

    registry.set(plugin.name, plugin);

    return previous;
}
