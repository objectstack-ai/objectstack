// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `kernel.use()` enforces the DECLARED plugin contract (#16049).
 *
 * WHY THIS FILE EXISTS. `PluginSchema` (`@objectstack/spec`,
 * `kernel/plugin.zod.ts`) had zero runtime callers. The boot path ran three
 * checks — `name`, `init`, semver — and every other constraint the protocol
 * declared was a declaration with nothing behind it. The sharpest single
 * reading from #15638, one input and two answers: `defineStack` accepted
 * `type: 'ui-plugin'` while `PluginSchema.safeParse` refused it, and only one
 * of those answers was on the path a real plugin takes. The maintainer ruled
 * enforce, not remove (2026-09-06, ADR-0049): the protocol is the baseline and
 * the runtime aligns to it.
 *
 * WHAT MAKES THE POSITIVE CASES LOAD-BEARING. A file that only asserted
 * refusals would pass just as well against a `use()` that refused everything.
 * Every refusal case here has a calibration twin one line away — the SAME
 * fixture with the offending key corrected — so a refusal is attributable to
 * the key under test and not to the harness.
 *
 * ⭐ THE PROTOTYPE CASE IS NOT A NICETY. The ruling requires `safeParse` be
 * used for VALIDATION ONLY, because `PluginLoader.toPluginMetadata` is a cast
 * and its comment records why: "Do not use object spread {...plugin} as it
 * destroys the prototype chain for Class-based plugins." Substituting the parse
 * output for the plugin object is the one change that would break every
 * class-based plugin in the ecosystem while leaving every refusal test in this
 * file green. Group C is the falsifier for exactly that mistake: it asserts
 * object IDENTITY, prototype identity, and that a method living only on the
 * prototype is still callable off what the kernel stored.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel } from './kernel.js';
import { PluginLoader } from './plugin-loader.js';
import { ObjectLogger } from './logger.js';
import { PLUGIN_UI_REQUIRED_KEY_MISSING } from '@objectstack/spec/kernel';
import type { Plugin, PluginContext } from './types.js';

/** A kernel that registers plugins and installs no process signal handlers. */
function makeKernel(): ObjectKernel {
    return new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
}

/** What `kernel.use()` left in the kernel's own plugin map. */
function stored(kernel: ObjectKernel, name: string): Record<string, unknown> | undefined {
    return (kernel as unknown as { plugins: Map<string, Record<string, unknown>> })
        .plugins.get(name);
}

/**
 * A plugin object under test. The keys under test (`type`, `slug`, `homepage`,
 * `id`, `staticPath`) used to be declared by `PluginSchema` and NOT by the
 * `Plugin` interface — one reason the repo contained no producer of them, and
 * why this alias once had to widen `Plugin` to spell them. Since #16334
 * `Plugin` inherits every `PluginSchema` key through `PluginDefinition`, so a
 * plain `Plugin` states the whole surface; the alias survives as the name.
 */
type Fixture = Plugin;

/**
 * A `type: 'ui'` fixture owes `staticPath` and `slug` (#16334), so every `ui`
 * fixture below carries both unless the case is ABOUT one of them. Nothing at
 * `kernel.use()` reads the path off disk — the loader validates the object.
 */
const UI_STATIC_PATH = '/srv/os-fixture/ui/dist';

/**
 * The refusal `promise` produced, or a loud failure if it produced none.
 *
 * ⛔ Not `promise.catch((e) => e as Error)`: that resolves to `Kernel | Error`,
 * so a case whose input STOPPED being refused would go on asserting against a
 * kernel and report a confusing property miss instead of "this loaded".
 */
async function refusal(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (e) {
        return e as Error;
    }
    throw new Error('expected the plugin to be refused, but it loaded');
}

function fixture(overrides: Partial<Fixture> & { name: string }): Fixture {
    return {
        version: '1.0.0',
        type: 'standard',
        init: () => { /* a contract fixture registers nothing */ },
        ...overrides,
    };
}

describe('A — the legacy `ui-plugin` value is refused at kernel.use() (#15638, #16049)', () => {
    it('rejects, and the rejection names the stable code, the plugin and the violated key', async () => {
        const kernel = makeKernel();
        const legacy = fixture({
            name: '@os-fixture/legacy-ui',
            // The value #15638 MEASURED as accepted, stored verbatim and mounting
            // routes. It is not a member of `CORE_PLUGIN_TYPES`.
            type: 'ui-plugin' as unknown as Plugin['type'],
            // Both `ui` keys declared (#16334), so the calibration twin below
            // differs from this fixture in `type` and nothing else.
            staticPath: UI_STATIC_PATH,
            slug: 'legacy-ui',
        });

        await expect(kernel.use(legacy)).rejects.toThrow(/PLUGIN_CONTRACT_VIOLATION/);

        // The envelope, not merely "it threw": a bare `toThrow()` would stay
        // green if the kernel started refusing this input for an unrelated
        // reason, which is the failure mode this card was filed about.
        const err = await refusal(kernel.use(legacy));
        expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain('@os-fixture/legacy-ui');
        expect(err.message).toContain("at 'type'");

        // …and nothing was stored, so no later seam can read it off the kernel.
        expect(stored(kernel, '@os-fixture/legacy-ui')).toBeUndefined();
    });

    it('CALIBRATION — the same fixture with the modern `ui` value loads', async () => {
        const kernel = makeKernel();
        const modern = fixture({
            name: '@os-fixture/modern-ui',
            type: 'ui',
            staticPath: UI_STATIC_PATH,
            slug: 'modern-ui',
        });

        await expect(kernel.use(modern)).resolves.toBe(kernel);
        expect(stored(kernel, '@os-fixture/modern-ui')?.type).toBe('ui');
    });

    it('stamps `code` on the error the loader itself raises', async () => {
        // `ObjectKernel.use()` re-wraps a failed load into a fresh `Error`
        // carrying only the message, so the PROPERTY is observable one layer
        // in. Both surfaces are pinned: the property here, the message above.
        const loader = new PluginLoader(new ObjectLogger({ level: 'silent' }));
        const result = await loader.loadPlugin(
            fixture({ name: 'x', type: 'ui-plugin' as unknown as Plugin['type'] }),
        );

        expect(result.success).toBe(false);
        expect((result.error as Error & { code?: string })?.code).toBe('PLUGIN_CONTRACT_VIOLATION');
    });
});

describe('B — a plain `standard` plugin still loads', () => {
    it('registers and is stored verbatim', async () => {
        const kernel = makeKernel();
        const plain = fixture({ name: 'com.example.plain' });

        await expect(kernel.use(plain)).resolves.toBe(kernel);

        const entry = stored(kernel, 'com.example.plain');
        expect(entry).toBeDefined();
        // Identity, not equality: the loader casts rather than copies, and the
        // stored entry must be the caller's own object.
        expect(entry).toBe(plain);
    });

    it('a plugin declaring NO type at all still loads — `type` is optional', async () => {
        const kernel = makeKernel();
        const untyped: Plugin = { name: 'com.example.untyped', version: '1.0.0', init: () => {} };

        await expect(kernel.use(untyped)).resolves.toBe(kernel);
        // ⛔ The parse output is discarded, so `PluginSchema`'s `.default('standard')`
        // must NOT have been written back onto the stored object.
        expect(stored(kernel, 'com.example.untyped')?.type).toBeUndefined();
    });
});

describe('C — ⭐ a CLASS-BASED plugin still loads, prototype chain intact', () => {
    class ClassPlugin implements Plugin {
        name = 'com.example.class-based';
        version = '2.3.4';
        type = 'standard' as const;

        /** Lives on the PROTOTYPE, not on the instance — the whole point. */
        async init(_ctx: PluginContext): Promise<void> { /* no services */ }

        /** Ditto: unreachable through any copy of the instance. */
        describeSelf(): string { return `class:${this.name}`; }
    }

    it('stores the SAME object, with its prototype and prototype methods intact', async () => {
        const kernel = makeKernel();
        const instance = new ClassPlugin();

        await expect(kernel.use(instance)).resolves.toBe(kernel);

        const entry = stored(kernel, 'com.example.class-based');

        // The three independent statements a spread would break. Each fails on
        // its own if `safeParse`'s OUTPUT is ever substituted for the plugin:
        expect(entry).toBe(instance);                                   // identity
        expect(Object.getPrototypeOf(entry)).toBe(ClassPlugin.prototype); // chain
        expect(entry).toBeInstanceOf(ClassPlugin);
        expect((entry as unknown as ClassPlugin).describeSelf())
            .toBe('class:com.example.class-based');                      // callable

        // A parse copy carries own enumerable data properties only, so the
        // control that a spread WOULD have preserved is asserted too — this is
        // what makes the three above attributable to the prototype and not to a
        // fixture that happens to have no data.
        expect(entry?.version).toBe('2.3.4');
    });

    it('a class-based plugin with a REFUSED type is still refused', async () => {
        class BadClassPlugin implements Plugin {
            name = 'com.example.class-bad';
            version = '1.0.0';
            type = 'ui-plugin' as unknown as Plugin['type'];
            async init(): Promise<void> {}
        }

        const kernel = makeKernel();
        await expect(kernel.use(new BadClassPlugin())).rejects.toThrow(/PLUGIN_CONTRACT_VIOLATION/);
    });
});

describe('D — the other two refusals the changeset states', () => {
    it('refuses an invalid `slug`', async () => {
        const kernel = makeKernel();
        const bad = fixture({ name: '@os-fixture/bad-slug', type: 'ui', staticPath: UI_STATIC_PATH, slug: 'Not A Slug' });

        const err = await refusal(kernel.use(bad));
        expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain("at 'slug'");
    });

    it('CALIBRATION — the same fixture with a legal slug loads', async () => {
        const kernel = makeKernel();
        const good = fixture({ name: '@os-fixture/good-slug', type: 'ui', staticPath: UI_STATIC_PATH, slug: 'not-a-slug' });

        await expect(kernel.use(good)).resolves.toBe(kernel);
    });

    it('refuses an invalid `homepage`', async () => {
        const kernel = makeKernel();
        const bad = fixture({ name: '@os-fixture/bad-homepage', homepage: 'not-a-url' });

        const err = await refusal(kernel.use(bad));
        expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain("at 'homepage'");
    });

    it('CALIBRATION — the same fixture with a real URL loads', async () => {
        const kernel = makeKernel();
        const good = fixture({ name: '@os-fixture/good-homepage', homepage: 'https://example.com' });

        await expect(kernel.use(good)).resolves.toBe(kernel);
    });
});

describe('F — a `ui` plugin owes `staticPath` and `slug`, refused at kernel.use() (#16334)', () => {
    /**
     * The spec half of #16049: `PluginSchema` describes both keys as
     * `(Required for type="ui")` and, since #16334, refuses a `ui` plugin
     * missing either — one issue per missing key, `path` naming the key,
     * `PLUGIN_UI_REQUIRED_KEY_MISSING` at the head of the issue message. These
     * pins measure that the boot path SURFACES that code unchanged: the loader
     * re-emits the first issue's `path` and `message`, so the spec's code rides
     * inside `PLUGIN_CONTRACT_VIOLATION`'s envelope. Group B's untyped and
     * `standard` fixtures, which declare neither key and load, are the scope
     * control: only `type: 'ui'` owes them.
     */
    it('refuses a `ui` plugin with no `staticPath`, naming the key and the spec code', async () => {
        const kernel = makeKernel();
        const bad = fixture({ name: '@os-fixture/ui-no-static-path', type: 'ui', slug: 'ui-no-static-path' });

        const err = await refusal(kernel.use(bad));
        expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain("at 'staticPath'");
        expect(err.message).toContain(PLUGIN_UI_REQUIRED_KEY_MISSING);
        expect(stored(kernel, '@os-fixture/ui-no-static-path')).toBeUndefined();
    });

    it('refuses a `ui` plugin with no `slug`, naming the key and the spec code', async () => {
        const kernel = makeKernel();
        const bad = fixture({ name: '@os-fixture/ui-no-slug', type: 'ui', staticPath: UI_STATIC_PATH });

        const err = await refusal(kernel.use(bad));
        expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain("at 'slug'");
        expect(err.message).toContain(PLUGIN_UI_REQUIRED_KEY_MISSING);
    });

    it('CALIBRATION — the same `ui` fixture with both keys loads, stored verbatim', async () => {
        const kernel = makeKernel();
        const good = fixture({ name: '@os-fixture/ui-complete', type: 'ui', staticPath: UI_STATIC_PATH, slug: 'ui-complete' });

        await expect(kernel.use(good)).resolves.toBe(kernel);
        const entry = stored(kernel, '@os-fixture/ui-complete');
        expect(entry).toBe(good);
        expect(entry?.staticPath).toBe(UI_STATIC_PATH);
        expect(entry?.slug).toBe('ui-complete');
    });

    it('SCOPE — a `standard` plugin declaring neither key still loads', async () => {
        const kernel = makeKernel();
        const plain = fixture({ name: '@os-fixture/standard-keyless', type: 'standard' });

        await expect(kernel.use(plain)).resolves.toBe(kernel);
    });

    it('the two keys are members of `Plugin` itself — inherited from PluginDefinition, not restated', () => {
        // Compile-time half of the derivation (#16334): before it `staticPath`
        // and `slug` were not members of `Plugin`, and every fixture in this
        // file needed a widening alias to spell them. A plain `Plugin` now does.
        const declared: Plugin = { name: 'x', type: 'ui', staticPath: UI_STATIC_PATH, slug: 'x', init() {} };
        expect(declared.slug).toBe('x');
        expect(declared.staticPath).toBe(UI_STATIC_PATH);
    });
});

describe('E — `version` is DELIBERATELY not enforced from the schema', () => {
    /**
     * `PluginSchema.version` is `/^\d+\.\d+\.\d+$/` and refuses the prerelease
     * and build-metadata forms SemVer 2.0.0 defines, while the loader's own
     * `isValidSemanticVersion` — the check that has always run — accepts them,
     * and `plugin-loader.test.ts` pins that acceptance deliberately. Enforcing
     * the schema's narrower spelling would retire a pinned capability under a
     * card that ruled on `type`, so the loader's check stays authoritative for
     * this one key. These cases pin the exclusion so a later change to it is a
     * decision rather than an accident.
     */
    it.each(['1.0.0-alpha.1', '1.0.0+20230101', '0.0.0-fixture'])(
        'still loads a plugin versioned %s',
        async (version) => {
            const kernel = makeKernel();
            const pre = fixture({ name: `com.example.v-${version}`, version });

            await expect(kernel.use(pre)).resolves.toBe(kernel);
        },
    );

    it('and a version the LOADER refuses is still refused, by the loader', async () => {
        const kernel = makeKernel();
        const bad = fixture({ name: 'com.example.bad-version', version: 'v1.0.0' });

        // Unchanged message and unchanged owner: this refusal is
        // `validatePluginStructure`'s, not the contract check's.
        const err = await refusal(kernel.use(bad));
        expect(err.message).toContain('Invalid semantic version');
        expect(err.message).not.toContain('PLUGIN_CONTRACT_VIOLATION');
    });
});
