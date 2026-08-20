// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The DECLARED duplicate-plugin-registration contract (#9864, maintainer
 * ruling 2026-08-19, option B), pinned against BOTH kernels out of ONE table
 * of cases.
 *
 * ⭐ The dual-kernel shape of this file is the deliverable, not a convenience.
 * The card is the FOURTH measured instance of one contract implemented twice
 * across `ObjectKernel`/`LiteKernel` and diverging unnoticed (#5170, #5282,
 * #8357 adjacent), every one of them found by a human reading both files side
 * by side. So the cases below are written ONCE and executed against both
 * kernels through a thin adapter: a fifth divergence has to reproduce the
 * bug in a case that already exists, rather than waiting to be noticed.
 *
 * ⛔ Do not "simplify" this into two sibling `describe`s with copied bodies —
 * that is the shape the seam keeps growing back through, and a case added to
 * one copy is exactly how the two contracts drifted the previous four times.
 * The adapter exists so that adding a case cannot cover only one kernel.
 *
 * What the contract says, in full:
 *   1. A duplicate `name` OVERWRITES — it is not an error on either kernel.
 *   2. Last-one-wins: only the later instance boots.
 *   3. The registry does not accumulate: one entry per name.
 *   4. Exactly one `warn` is emitted, and it says *superseded*, names the
 *      plugin and BOTH versions.
 *   5. A supersede never announces a second FIRST registration — the failure
 *      the ruling names ("`Plugin registered:` prints twice and reads as two
 *      plugins").
 *   6. The displaced instance is never initialized, started or destroyed —
 *      the kernel acquired nothing for it, so there is nothing to tear down.
 */

import { describe, it, expect, vi } from 'vitest';
import { LiteKernel } from './lite-kernel.js';
import { ObjectKernel } from './kernel.js';
import { describeSupersededRegistration } from './plugin-registration.js';
import type { Plugin } from './types.js';

const DUPLICATE_NAME = 'com.objectstack.test.duplicate';

/** Lifecycle calls a plugin instance received, in order. */
type LifecycleLog = string[];

function makePlugin(
    name: string,
    version: string,
    tag: string,
    log: LifecycleLog,
): Plugin & { healthCheck(): Promise<{ healthy: boolean; message: string }> } {
    return {
        name,
        version,
        init: () => { log.push(`${tag}:init`); },
        start: () => { log.push(`${tag}:start`); },
        destroy: () => { log.push(`${tag}:destroy`); },
        healthCheck: async () => ({ healthy: true, message: tag }),
    };
}

/**
 * The uniform surface the cases below drive. Everything kernel-specific — the
 * sync/async `use()` split, and the fact that the two kernels expose their
 * registry through different public accessors — is absorbed here, so no case
 * can accidentally be written for one kernel only.
 */
interface KernelUnderTest {
    use(plugin: Plugin): Promise<void>;
    bootstrap(): Promise<void>;
    shutdown(): Promise<void>;
    /** Registered plugin names, read through the kernel's own public API. */
    registeredNames(): Promise<string[]>;
    /** Every message passed to `logger.warn`, in order. */
    warnings(): string[];
    /** Every message passed to `logger.info`, in order. */
    infos(): string[];
}

/** The `logger` field both kernels keep on the instance (see `kernel.test.ts`). */
type WithLogger = { logger: Record<'info' | 'warn', (...args: unknown[]) => void> };

function captureLogs(kernel: unknown): { warnings: string[]; infos: string[] } {
    const warnings: string[] = [];
    const infos: string[] = [];
    const logger = (kernel as WithLogger).logger;
    // Spied at the METHOD, so the records are captured whatever level the
    // logger is configured to emit at — the level filter lives downstream.
    vi.spyOn(logger, 'warn').mockImplementation((message: unknown) => {
        warnings.push(String(message));
    });
    vi.spyOn(logger, 'info').mockImplementation((message: unknown) => {
        infos.push(String(message));
    });
    return { warnings, infos };
}

const KERNELS: Array<{ label: string; create(): KernelUnderTest }> = [
    {
        label: 'LiteKernel',
        create() {
            const kernel = new LiteKernel({ logger: { level: 'error' } });
            const captured = captureLogs(kernel);
            return {
                use: async (plugin) => { kernel.use(plugin); },
                bootstrap: () => kernel.bootstrap(),
                shutdown: () => kernel.shutdown(),
                registeredNames: async () => [...kernel.getPlugins().keys()],
                warnings: () => captured.warnings,
                infos: () => captured.infos,
            };
        },
    },
    {
        label: 'ObjectKernel',
        create() {
            const kernel = new ObjectKernel({
                skipSystemValidation: true,
                gracefulShutdown: false,
                logger: { level: 'error' },
            });
            const captured = captureLogs(kernel);
            return {
                use: async (plugin) => { await kernel.use(plugin); },
                bootstrap: () => kernel.bootstrap(),
                shutdown: () => kernel.shutdown(),
                // `checkAllPluginsHealth()` walks the KERNEL's registry keys and
                // resolves each name through the PluginLoader's own map, so this
                // read covers both name-keyed maps a registration writes.
                registeredNames: async () => [...(await kernel.checkAllPluginsHealth()).keys()],
                warnings: () => captured.warnings,
                infos: () => captured.infos,
            };
        },
    },
];

describe.each(KERNELS)('duplicate plugin registration — $label', ({ create }) => {
    it('OVERWRITES instead of refusing: a duplicate name does not throw', async () => {
        const log: LifecycleLog = [];
        const kernel = create();

        await kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log));

        // The convergence itself. `LiteKernel.use()` threw
        // `[Kernel] Plugin '<name>' already registered` here while
        // `ObjectKernel` overwrote silently — one input, two meanings.
        await expect(
            kernel.use(makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log)),
        ).resolves.toBeUndefined();
    });

    it('is LAST-one-wins: only the later instance boots, and the registry does not accumulate', async () => {
        const log: LifecycleLog = [];
        const kernel = create();

        await kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log));
        await kernel.use(makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log));
        await kernel.use(makePlugin('com.objectstack.test.control', '1.0.0', 'control', log));

        await kernel.bootstrap();

        // The displaced instance never boots; the later one does.
        expect(log).toContain('second:init');
        expect(log).toContain('second:start');
        expect(log).not.toContain('first:init');
        expect(log).not.toContain('first:start');

        // Three `use()` calls, two names: the earlier entry is DROPPED, not
        // shadowed behind the later one.
        expect((await kernel.registeredNames()).sort()).toEqual([
            'com.objectstack.test.control',
            DUPLICATE_NAME,
        ]);

        await kernel.shutdown();
    });

    it('warns EXACTLY once, saying superseded and naming the plugin and BOTH versions', async () => {
        const log: LifecycleLog = [];
        const kernel = create();
        const first = makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log);
        const second = makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log);

        await kernel.use(first);
        await kernel.use(second);

        const superseding = kernel.warnings().filter((line) => line.includes(DUPLICATE_NAME));
        expect(superseding).toHaveLength(1);

        // The whole line, from the one function that renders it — so a
        // reworded warning has to be reworded here too, deliberately.
        expect(superseding[0]).toBe(describeSupersededRegistration(first, second));

        // …and the properties that wording has to keep, asserted against the
        // RUNTIME string rather than against the source that produces it.
        expect(superseding[0]).toContain('superseded');
        expect(superseding[0]).toContain(DUPLICATE_NAME);
        expect(superseding[0]).toContain('v1.0.0');   // the one being replaced
        expect(superseding[0]).toContain('v2.0.0');   // the one that survives
    });

    it('cannot be read as a first registration: different verb, and never at info level', async () => {
        const log: LifecycleLog = [];
        const kernel = create();

        await kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log));
        await kernel.use(makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log));

        const superseding = kernel.warnings().filter((line) => line.includes('superseded'));
        expect(superseding).toHaveLength(1);

        // Leads with a different verb than the registration line, so the two
        // are told apart by the first token of the message.
        expect(superseding[0].startsWith('Plugin superseded:')).toBe(true);
        expect(superseding[0].startsWith('Plugin registered:')).toBe(false);

        // Level is part of the contract, not a preference. The CLI's default
        // kernel level is `warn` and its boot-quiet window
        // (`BOOT_DIAGNOSTIC_FLOOR`) discards in-window `info` while replaying
        // `warn` — an `info` supersede notice would be invisible on the very
        // boot path (`os serve`) where the defect was measured.
        expect(kernel.infos().filter((line) => line.includes('superseded'))).toEqual([]);
    });

    it('the displaced instance is never initialized, started or destroyed — nothing to tear down', async () => {
        // #9864 asked this to be ANSWERED, not assumed: the displaced plugin
        // has been through `pluginLoader.loadPlugin()` on `ObjectKernel`, so if
        // registration acquired anything on its behalf, "overwrite" would also
        // be a leak. It does not. Registration is legal only while the kernel
        // is `idle`, and every lifecycle call is made from `bootstrap()` /
        // `destroy()` over the resolved order read out of the registry the
        // displaced entry has already left.
        const log: LifecycleLog = [];
        const kernel = create();

        await kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log));
        await kernel.use(makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log));

        await kernel.bootstrap();
        await kernel.shutdown();

        // A FULL lifecycle has run — so the absence below is a measurement,
        // not an empty log. `destroy()` in particular is the teardown that a
        // leak would have needed and, correctly, never runs for `first`:
        // running it would tear down state `init()` never set up.
        expect(log).toEqual(
            expect.arrayContaining(['second:init', 'second:start', 'second:destroy']),
        );
        expect(log.filter((entry) => entry.startsWith('first:'))).toEqual([]);
    });
});

/**
 * The half of the contract that has no LiteKernel counterpart, and is scoped
 * here rather than being forced into the shared table above.
 *
 * `ObjectKernel` announces every registration (`Plugin registered:
 * <name>@<version>`) and keeps a second name-keyed map inside `PluginLoader`.
 * `LiteKernel` does neither — it logs nothing on registration and owns one
 * map. Writing these two cases into the shared table would make them assert
 * `0 === 0` on LiteKernel: a case that cannot fail there, reading as coverage
 * it does not have. What is genuinely shared is above; this is the rest.
 */
describe('duplicate plugin registration — ObjectKernel-only surface', () => {
    function objectKernel() {
        const kernel = new ObjectKernel({
            skipSystemValidation: true,
            gracefulShutdown: false,
            logger: { level: 'error' },
        });
        return { kernel, captured: captureLogs(kernel) };
    }

    /** `Plugin registered: <name>@<version>` — the line that says "this is in the registry now". */
    const registrationAnnouncements = (infos: string[]) =>
        infos.filter((line) => line.startsWith('Plugin registered:') && line.includes(DUPLICATE_NAME));

    it('a supersede does not announce a SECOND first-registration', async () => {
        // The ruling's exact complaint: `Plugin registered: <name>@<version>`
        // printed twice for ONE surviving plugin and so read as two plugins
        // running. The single-registration run below is the control — it
        // expects ONE announcement, so this case fails if the announcement
        // stops being emitted at all, not only if it is emitted twice.
        const log: LifecycleLog = [];

        const once = objectKernel();
        await once.kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'only', log));
        expect(registrationAnnouncements(once.captured.infos)).toHaveLength(1);

        const twice = objectKernel();
        await twice.kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log));
        await twice.kernel.use(makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log));
        expect(registrationAnnouncements(twice.captured.infos)).toHaveLength(1);

        // The surviving announcement is the FIRST one, chronologically — the
        // duplicate's is suppressed. Which instance actually boots is stated
        // by the `warn` that immediately follows it, and that pairing is the
        // whole readable sequence a boot log now carries:
        //
        //   INFO Plugin registered: <name>@1.0.0
        //   WARN Plugin superseded: '<name>' — the later registration (v2.0.0)
        //        REPLACED the earlier one (v1.0.0). …
        expect(registrationAnnouncements(twice.captured.infos)[0]).toContain('@1.0.0');
        expect(twice.captured.warnings.filter((l) => l.includes('superseded'))).toHaveLength(1);
    });

    it('the PluginLoader keeps the surviving instance, not the displaced one', async () => {
        // `ObjectKernel` writes TWO name-keyed maps per registration: its own
        // `plugins`, and `PluginLoader.loadedPlugins` (written inside
        // `loadPlugin()`, before the kernel's map). The second is invisible to
        // the shared cases above, and it is the map `checkPluginHealth()`
        // reads — so a supersede that updated only one of them would answer a
        // health probe from the DISPLACED instance.
        const log: LifecycleLog = [];
        const { kernel } = objectKernel();

        // Control first: one registration answers from the instance that was
        // registered, so a `second` below is a real displacement rather than
        // this probe answering the same way whatever is in the map.
        await kernel.use(makePlugin(DUPLICATE_NAME, '1.0.0', 'first', log));
        expect((await kernel.checkPluginHealth(DUPLICATE_NAME)).message).toBe('first');

        await kernel.use(makePlugin(DUPLICATE_NAME, '2.0.0', 'second', log));
        expect((await kernel.checkPluginHealth(DUPLICATE_NAME)).message).toBe('second');
    });
});
