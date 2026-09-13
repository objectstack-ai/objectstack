// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `kernel.use()` enforces the DECLARED plugin contract (#16049) — on BOTH
 * published kernels (#16721).
 *
 * WHICH KERNEL. Groups A–F drive `ObjectKernel.use()`, the path #16049 wired
 * (`PluginLoader.validatePluginContract`). Group G drives `LiteKernel.use()`,
 * which #16721 converged onto the SAME check — `assertPluginContract` in
 * `plugin-contract.ts`, the one statement both kernels call. G is not a copy
 * of A–F: it pins the cases whose answer DIFFERED between the kernels before
 * #16721, the parity of the envelope for one input, and the two orderings
 * `LiteKernel.use()` owes (state before contract, contract before registry).
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
import { LiteKernel } from './lite-kernel.js';
import { PluginLoader } from './plugin-loader.js';
import { ObjectLogger } from './logger.js';
import { PLUGIN_UI_REQUIRED_KEY_MISSING, PluginSchema } from '@objectstack/spec/kernel';
import type { Plugin, PluginContext } from './types.js';

/** A kernel that registers plugins and installs no process signal handlers. */
function makeKernel(): ObjectKernel {
    return new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
}

/** A `LiteKernel` that registers plugins; it installs no signal handlers of its own. */
function makeLiteKernel(): LiteKernel {
    return new LiteKernel({ logger: { level: 'silent' } });
}

/** What `kernel.use()` left in the kernel's own plugin map — either kernel. */
function stored(kernel: ObjectKernel | LiteKernel, name: string): Record<string, unknown> | undefined {
    return (kernel as unknown as { plugins: Map<string, Record<string, unknown>> })
        .plugins.get(name);
}

/**
 * The synchronous twin of {@link refusal}: `LiteKernel.use()` throws rather
 * than rejects. Same discipline — a case whose input STOPPED being refused
 * reports "it loaded", never a property miss on a kernel.
 */
function refusalSync(register: () => unknown): Error & { code?: string } {
    try {
        register();
    } catch (e) {
        return e as Error & { code?: string };
    }
    throw new Error('expected LiteKernel.use() to refuse the plugin, but it loaded');
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

describe('E — `version` is the NINTH enforced key, and admitting it refused nothing (#16365)', () => {
    /**
     * `version` used to be filtered out of this check. It was, because the two
     * declarations disagreed: `PluginSchema.version` was `/^\d+\.\d+\.\d+$/`
     * and refused the prerelease and build-metadata forms SemVer 2.0.0 defines,
     * while `PluginLoader.isSemverShapedVersion` — the check the boot path has
     * always run — accepted them, deliberately, pinned by `plugin-loader.test.ts`.
     *
     * #16365 settled that in `packages/spec` by WIDENING the schema onto the
     * loader's grammar, character for character, so the exclusion had nothing
     * left to exclude and `assertPluginContract` dropped it. These cases are the
     * measurement that dropping it cost nothing: the three versions that were
     * only loading BECAUSE of the exclusion still load without it.
     */
    it.each(['1.0.0-alpha.1', '1.0.0+20230101', '0.0.0-fixture'])(
        'still loads a plugin versioned %s',
        async (version) => {
            const kernel = makeKernel();
            const pre = fixture({ name: `com.example.v-${version}`, version });

            await expect(kernel.use(pre)).resolves.toBe(kernel);
        },
    );

    it('a version the SCHEMA now accepts is one `PluginSchema` itself accepts — not just the loader', () => {
        // The convergence, read at its source rather than inferred from a boot
        // that has two checks in it. Were the schema still the narrow spelling,
        // this would fail here while `use()` above stayed green on the loader.
        for (const version of ['1.0.0-alpha.1', '1.0.0+20230101', '0.0.0-fixture']) {
            expect(PluginSchema.safeParse({ name: 'x', version, init: () => {} }).success).toBe(true);
        }
    });

    /**
     * #17070 — the two declarations still share ONE grammar, measured over the
     * eight strings SemVer 2.0.0 forbids and both of them accept.
     *
     * ⭐ This is the convergence assertion for the pair, and it is the reason
     * #17070 could repair the CLAIM on both sides from a single card: schema and
     * loader are one accept set with two names on it. If a future edit moves one
     * spelling and not the other, this fails — and both docblocks that promise
     * "character for character" become false at the same moment.
     *
     * ⛔ The direction here is deliberate and frozen. #16365 ruled widen-never-
     * narrow, so these eight are pinned as ACCEPTED, not as a defect awaiting
     * cleanup; `01.1.1` loaded before either card existed. What #17070 changed
     * is the description on the spec key and the name of the loader's predicate
     * (`isSemverShapedVersion`), so that the accept set and the claim about it
     * finally agree.
     */
    const SEMVER_FORBIDS = [
        '01.1.1', '1.01.1', '1.1.01',                                  // §2
        '1.0.0-0123', '1.0.0-alpha..1', '1.0.0-alpha..', '1.0.0-.',    // §9
        '1.0.0+.',                                                     // §10
    ];

    it.each(SEMVER_FORBIDS)('`PluginSchema` accepts %s — the spec half of the shared grammar', (version) => {
        expect(PluginSchema.safeParse({ name: 'x', version, init: () => {} }).success).toBe(true);
    });

    it.each(SEMVER_FORBIDS)('and `kernel.use()` boots it — the loader half agrees on %s', async (version) => {
        const kernel = makeKernel();

        await expect(kernel.use(fixture({ name: `com.example.fringe-${version}`, version }))).resolves.toBe(kernel);
    });

    it('and a malformed version is STILL refused by the loader, with its own message', async () => {
        const kernel = makeKernel();
        const bad = fixture({ name: 'com.example.bad-version', version: 'v1.0.0' });

        // Unchanged message and unchanged owner. `validatePluginStructure` runs
        // BEFORE the contract check, so on this kernel a malformed `version` is
        // still the loader's refusal even though the schema would now refuse it
        // too — the ORDER is the observable thing, and it did not move.
        const err = await refusal(kernel.use(bad));
        expect(err.message).toContain('Invalid semantic version');
        expect(err.message).not.toContain('PLUGIN_CONTRACT_VIOLATION');
    });
});

describe('G — the SAME contract on LiteKernel.use() (#16721)', () => {
    /**
     * Before #16721 every refusal above had an accepting twin on this kernel:
     * `LiteKernel.use()` wrote the object straight into its registry, so the
     * object group A refuses mounted routes here. `AGENTS.md` names this
     * kernel for tests, so "green in vitest, refused at boot" was the shape
     * of the trap. These cases pin the convergence — same code, same key,
     * same message — and the two properties this kernel's `use()` owes that
     * the loader path states elsewhere: the `code` PROPERTY survives (there
     * is no re-wrap here), and a refused plugin never touches the registry.
     */
    it('refuses the legacy `ui-plugin` type, synchronously, with the code on the property AND at the head of the message', () => {
        const kernel = makeLiteKernel();
        const legacy = fixture({
            name: '@os-fixture/lite-legacy-ui',
            type: 'ui-plugin' as unknown as Plugin['type'],
            staticPath: UI_STATIC_PATH,
            slug: 'lite-legacy-ui',
        });

        const err = refusalSync(() => kernel.use(legacy));
        expect(err.code).toBe('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message.startsWith('PLUGIN_CONTRACT_VIOLATION: ')).toBe(true);
        expect(err.message).toContain('@os-fixture/lite-legacy-ui');
        expect(err.message).toContain("at 'type'");

        // …and nothing was stored, so no later seam can read it off the kernel.
        expect(stored(kernel, '@os-fixture/lite-legacy-ui')).toBeUndefined();
    });

    it('CALIBRATION — the same fixture with the modern `ui` value loads, stored verbatim', () => {
        const kernel = makeLiteKernel();
        const modern = fixture({
            name: '@os-fixture/lite-modern-ui',
            type: 'ui',
            staticPath: UI_STATIC_PATH,
            slug: 'lite-modern-ui',
        });

        expect(kernel.use(modern)).toBe(kernel);
        expect(stored(kernel, '@os-fixture/lite-modern-ui')).toBe(modern);
    });

    it.each([
        ['staticPath', { name: '@os-fixture/lite-ui-no-static-path', type: 'ui', slug: 'lite-ui-no-static-path' }],
        ['slug', { name: '@os-fixture/lite-ui-no-slug', type: 'ui', staticPath: UI_STATIC_PATH }],
    ] as const)('refuses a `ui` plugin with no `%s`, naming the key and the spec code (#16334 reaches this kernel now)', (key, overrides) => {
        // The two inputs #16721 was filed on: refused by `ObjectKernel` (group F),
        // and until now stored verbatim here — the hono auto-discovery pin's
        // group F carried the accepting readings and was rewritten with this.
        const kernel = makeLiteKernel();
        const bad = fixture({ ...overrides } as Partial<Fixture> & { name: string });

        const err = refusalSync(() => kernel.use(bad));
        expect(err.code).toBe('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain(`at '${key}'`);
        expect(err.message).toContain(PLUGIN_UI_REQUIRED_KEY_MISSING);
        expect(stored(kernel, overrides.name)).toBeUndefined();
    });

    it('refuses `null` on a declared key — `.optional()` admits absence, never `null`', () => {
        const kernel = makeLiteKernel();
        const bad = fixture({ name: '@os-fixture/lite-null-author', author: null as unknown as string });

        const err = refusalSync(() => kernel.use(bad));
        expect(err.code).toBe('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain("at 'author'");
    });

    it('a plugin declaring NO type still loads and no `type` is written back', () => {
        const kernel = makeLiteKernel();
        const untyped: Plugin = { name: 'com.example.lite-untyped', version: '1.0.0', init: () => {} };

        expect(kernel.use(untyped)).toBe(kernel);
        // The parse output is discarded on this kernel too: `.default('standard')`
        // must NOT have been written back onto the stored object.
        expect(stored(kernel, 'com.example.lite-untyped')).toBe(untyped);
        expect(stored(kernel, 'com.example.lite-untyped')?.type).toBeUndefined();
    });

    it('⭐ a CLASS-BASED plugin keeps its identity, prototype and prototype methods', () => {
        class LiteClassPlugin implements Plugin {
            name = 'com.example.lite-class-based';
            version = '2.3.4';
            type = 'standard' as const;
            async init(_ctx: PluginContext): Promise<void> { /* no services */ }
            describeSelf(): string { return `class:${this.name}`; }
        }

        const kernel = makeLiteKernel();
        const instance = new LiteClassPlugin();

        expect(kernel.use(instance)).toBe(kernel);

        const entry = stored(kernel, 'com.example.lite-class-based');
        expect(entry).toBe(instance);
        expect(Object.getPrototypeOf(entry)).toBe(LiteClassPlugin.prototype);
        expect((entry as unknown as LiteClassPlugin).describeSelf()).toBe('class:com.example.lite-class-based');
    });

    it.each(['1.0.0-alpha.1', '1.0.0+20230101', '0.0.0-fixture'])(
        '`version` is judged here too now, and %s passes it',
        (version) => {
            // The convergence is on the SCHEMA, so #16365 reaches this kernel by
            // the same route as the other eight keys. These three loaded before
            // because `version` was excluded; they load now because the schema
            // was widened onto the grammar that always accepted them.
            const kernel = makeLiteKernel();
            expect(kernel.use(fixture({ name: `com.example.lite-v-${version}`, version }))).toBe(kernel);
        },
    );

    it('⭐ a malformed `version` is refused HERE for the first time — the last key where the kernels disagreed', () => {
        // This is the behaviour change #16365 lands on `LiteKernel`, stated as a
        // test because it is the one thing dropping the exclusion NARROWS.
        //
        // `LiteKernel` never ran `validatePluginStructure`, so while `version`
        // was excluded from the schema check it was the ONE declared key this
        // kernel did not judge at all: `version: 'v1.0.0'` registered here and
        // was refused by `ObjectKernel` at boot — precisely the green-in-vitest,
        // refused-in-production split #16721 converged the other eight keys to
        // close. It now travels the ordinary envelope.
        const kernel = makeLiteKernel();
        const bad = fixture({ name: 'com.example.lite-bad-version', version: 'v1.0.0' });

        const err = refusalSync(() => kernel.use(bad));
        expect(err.message).toContain('PLUGIN_CONTRACT_VIOLATION');
        expect(err.message).toContain("at 'version'");
        expect((err as Error & { code?: string }).code).toBe('PLUGIN_CONTRACT_VIOLATION');
    });

    it('a version-less plugin loads — `version` is among the nine keys, but it is `.optional()`', () => {
        // Absence is not a violation. `version` became the ninth ENFORCED key at
        // #16365, which judges the value an author writes; `.optional()` is what
        // admits writing none. ⇒ this case survived that change unaltered, and
        // says why rather than counting keys.
        const kernel = makeLiteKernel();
        const versionless: Plugin = { name: 'com.example.lite-versionless', init: () => {} };
        expect(kernel.use(versionless)).toBe(kernel);
    });

    it('PARITY — for one input, the ObjectKernel refusal IS the LiteKernel refusal behind the loader\'s prefix', async () => {
        // "An author gets ONE refusal, with the same code and message shape,
        // from either kernel." `ObjectKernel.use()` re-wraps a failed load as
        // `Failed to load plugin: <name> - <message>` for EVERY load failure —
        // its existing wrapper, untouched by #16721 — so the parity to pin is
        // that the LiteKernel message is exactly what follows that prefix.
        const make = () => fixture({ name: '@os-fixture/parity', type: 'ui', staticPath: UI_STATIC_PATH, slug: 'Not A Slug' });

        const lite = refusalSync(() => makeLiteKernel().use(make()));
        const object = await refusal(makeKernel().use(make()));

        expect(lite.code).toBe('PLUGIN_CONTRACT_VIOLATION');
        expect(lite.message).toContain("at 'slug'");
        expect(object.message).toBe(`Failed to load plugin: @os-fixture/parity - ${lite.message}`);
    });

    it('ORDER — a refused plugin never reaches the registry, so it cannot supersede an earlier registration', () => {
        // `registerPluginByName` is last-one-wins by declared contract (#9864).
        // The contract check runs BEFORE it, so a refused object under an
        // already-registered name leaves the earlier registration in place —
        // identity, not equality — rather than displacing it and then failing.
        const kernel = makeLiteKernel();
        const first = fixture({ name: 'com.example.superseded', version: '1.0.0' });
        const refused = fixture({ name: 'com.example.superseded', version: '2.0.0', homepage: 'not-a-url' });

        kernel.use(first);
        const err = refusalSync(() => kernel.use(refused));

        expect(err.code).toBe('PLUGIN_CONTRACT_VIOLATION');
        expect(stored(kernel, 'com.example.superseded')).toBe(first);
    });

    it('ORDER — state is checked before the contract: after bootstrap the refusal is the idle one', async () => {
        // `validateIdle()` first, then the contract — the wiring #16721 step 1
        // measured with. A kernel that can no longer register plugins says so,
        // and does not run the schema over an object it would not store anyway.
        const kernel = makeLiteKernel();
        await kernel.bootstrap();
        try {
            const err = refusalSync(() => kernel.use(fixture({ name: 'com.example.late', homepage: 'not-a-url' })));
            expect(err.message).toContain('Cannot register plugins after bootstrap has started');
            expect(err.message).not.toContain('PLUGIN_CONTRACT_VIOLATION');
            expect(err.code).toBeUndefined();
        } finally {
            await kernel.shutdown();
        }
    });
});
