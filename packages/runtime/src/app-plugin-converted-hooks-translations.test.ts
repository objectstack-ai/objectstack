// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23090: `AppPlugin`'s last two RAW readers, the hook binder's input and
 * `loadTranslations`, take the boot's ONE ADR-0087 forward conversion
 * (`forwardConverted`, #22994), the copy the `manifest` service, the security
 * registrar, job scheduling and the datasource readers already take (#23029).
 *
 * Four major-18 retired entries reach these two readers:
 *
 *   hook-timeout-to-timeout-ms                   hooks[].timeout -> timeoutMs                          (17.3.0)
 *   translation-per-app-settings-removed         translations[].<locale>.settings                      (17.4.0)
 *   translation-component-submit-label-removed   ….pages.<page>.components.<id>.submitLabel           (17.2.0)
 *   translation-widget-sub-caption-removed       ….dashboards.<dashboard>.widgets.<id>.subCaption     (17.6.0)
 *
 * The engine's hook wrapper reads `meta.timeoutMs` only, so a hook handed over
 * raw ran with no time limit and no notice. The i18n service served whatever
 * bundle it was handed, so the three retired translation keys were served, and
 * a per-app `settings` group still filled the gaps the platform's own settings
 * copy left, which its entry says no longer happens.
 *
 * The route these pins take is a `plugins[]` bundle entry, wrapped by the one
 * rule `os serve` and `os migrate` mount it by (`materializeStackPlugin`): the
 * bundle reaches `new AppPlugin(bundle)` as authored, because
 * `loadArtifactBundle` (which converts at load, #23027) is not on that route.
 * The artifact declares no `engines.protocol`, so the D1 handshake admits it
 * with a warning and the conversion window opens (`converted-undeclared`).
 *
 * Measured on `origin/main` 2d21b9c891, before this change, through that
 * route: the hook reached `bindHooks` as `{ …, timeout: 5000 }` and was still
 * pending after any amount of time, and `getTranslations('zh-CN')` served all
 * three retired keys.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createMemoryI18n, materializeStackPlugin } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { AppPlugin } from './app-plugin.js';

const APP_ID = 'com.test.issue-23090';
const MANIFEST = { id: APP_ID, name: 'Hooks And Translations Probe', type: 'app', version: '1.0.0' } as const;
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** A hook declaration with no limit but its own `timeout` / `timeoutMs`; its function never settles. */
const hookOf = (duration: Record<string, number>) => ({
    name: 'audit', object: 'probe_note', events: ['beforeInsert'], handler: 'audit_slow', ...duration,
});
const functions = () => ({ audit_slow: () => new Promise<never>(() => undefined) });

/** The card's `zh-CN` bundle: the three retired keys, each beside a live neighbour. */
const RETIRED_ZH = {
    settings: { mail: { keys: { host: { label: '主机' } } } },
    pages: { home: { components: { f1: { submitLabel: '提交', title: '表单' } } } },
    dashboards: { pulse: { widgets: { w1: { subCaption: '较上季度', title: '赢单' } } } },
    objects: { probe_note: { label: '便笺' } },
};
/** What the converted copy keeps of {@link RETIRED_ZH}: the live keys only. */
const SERVED_ZH = {
    pages: { home: { components: { f1: { title: '表单' } } } },
    dashboards: { pulse: { widgets: { w1: { title: '赢单' } } } },
    objects: { probe_note: { label: '便笺' } },
};

/** Fresh bytes per boot (the functions are code, so built rather than cloned). */
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const retiredArtifact = () => ({
    manifest: { ...MANIFEST },
    functions: functions(),
    hooks: [hookOf({ timeout: 5000 })],
    translations: [{ 'zh-CN': copy(RETIRED_ZH) }],
});
/** The CONTROL: the same app in the current spellings. Nothing to convert. */
const currentArtifact = () => ({
    manifest: { ...MANIFEST },
    functions: functions(),
    hooks: [hookOf({ timeoutMs: 5000 })],
    translations: [{ 'zh-CN': copy(SERVED_ZH) }],
});

/**
 * A kernel context over a REAL ObjectQL engine, capturing the `manifest`
 * payload, what `bindHooks` is handed and what the i18n service loads. With no
 * `i18n` passed, the boot auto-registers the kernel's in-memory fallback, as a
 * `plugins[]` boot with no I18nServicePlugin does.
 */
function capturingBoot(opts: { i18n?: ReturnType<typeof createMemoryI18n> } = {}) {
    const ql = new ObjectQL({ logger: quiet } as any);
    const bound: any[] = [];
    const bindHooks = ql.bindHooks.bind(ql);
    vi.spyOn(ql, 'bindHooks').mockImplementation((hooks, bindOpts) => {
        bound.push(...(hooks ?? []));
        bindHooks(hooks, bindOpts);
    });
    const payloads: any[] = [];
    const services: Record<string, any> = {
        manifest: { register: (payload: unknown) => { payloads.push(payload); } },
        objectql: ql,
        ...(opts.i18n ? { i18n: opts.i18n } : {}),
    };
    const ctx = {
        logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
        registerService: vi.fn((name: string, service: unknown) => { services[name] = service; }),
        getService: vi.fn((name: string) => services[name]),
        getServices: vi.fn(() => new Map()),
        hook: vi.fn(),
        trigger: vi.fn(),
    } as any;
    /** A `plugins[]` bundle entry, wrapped and booted the way `os serve` mounts one. */
    const boot = async (bundle: Record<string, unknown>) => {
        const plugin: any = await materializeStackPlugin(bundle, {
            importSpecifier: async () => { throw new Error('this pin mounts a bundle entry, never a specifier'); },
            wrapBundle: (entry) => new AppPlugin(entry),
        });
        expect(plugin).toBeInstanceOf(AppPlugin);
        await plugin.init(ctx);
        await plugin.start(ctx);
    };
    const i18n = () => services.i18n as ReturnType<typeof createMemoryI18n>;
    return { ql, boot, bound, payloads, i18n };
}

/** An insert on the hook's object: where its `beforeInsert` stands after `ms` of timers. */
async function insertAfter(ql: ObjectQL, steps: number[]): Promise<string[]> {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let outcome = 'pending';
    void ql.triggerHooks('beforeInsert', { object: 'probe_note', event: 'beforeInsert', input: { title: 'x' }, session: {} } as any)
        .then(() => { outcome = 'resolved'; }, (err: Error) => { outcome = `rejected: ${err.message}`; });
    const seen: string[] = [];
    for (const ms of steps) {
        await vi.advanceTimersByTimeAsync(ms);
        seen.push(outcome);
    }
    return seen;
}

afterEach(() => { vi.useRealTimers(); });

describe('#23090: a plugins[] bundle entry authored by 17.x tooling', () => {
    it('hooks[].timeout: the hook binds with that duration as timeoutMs, and a hook that never settles is cut off there', async () => {
        const h = capturingBoot();
        await h.boot(retiredArtifact());

        expect(h.bound).toStrictEqual([hookOf({ timeoutMs: 5000 })]);
        const [before, at] = await insertAfter(h.ql, [4_999, 1]);
        expect(before).toBe('pending');
        expect(at).toBe("rejected: Hook 'audit' timed out after 5000ms");
    });

    it("translations: getTranslations('zh-CN') serves none of the three retired keys", async () => {
        const h = capturingBoot();
        await h.boot(retiredArtifact());

        expect(h.i18n().getTranslations('zh-CN')).toStrictEqual(SERVED_ZH);
    });

    it("the retired per-app settings group no longer fills a gap in the platform's settings copy", async () => {
        const h = capturingBoot();
        await h.boot(retiredArtifact());
        // A platform plugin pushes its own settings copy at `kernel:ready`.
        h.i18n().loadTranslations('zh-CN', { settings: { mail: { title: '邮件投递' } } });

        expect((h.i18n().getTranslations('zh-CN') as any).settings).toStrictEqual({ mail: { title: '邮件投递' } });
        expect(h.i18n().t('settings.mail.keys.host.label', 'zh-CN')).toBe('settings.mail.keys.host.label');
    });

    it('one conversion: the binder and the i18n service are handed the very items the manifest service registered', async () => {
        const i18n = createMemoryI18n();
        const load = vi.spyOn(i18n, 'loadTranslations');
        const h = capturingBoot({ i18n });
        await h.boot(retiredArtifact());

        expect(h.payloads).toHaveLength(1);
        const [payload] = h.payloads;
        // A second pass would hand over equal-looking copies; identity tells them apart.
        expect(h.bound[0]).toBe(payload.hooks[0]);
        expect(load.mock.calls).toHaveLength(1);
        expect(load.mock.calls[0][1]).toBe(payload.translations[0]['zh-CN']);
    });

    it('a legacy nested manifest.hooks / manifest.translations list: converted once, bound and loaded once', async () => {
        // The copy is `{ ...manifest, ...collections }`: where the stack
        // declares no list of its own, the spread lifts the manifest's list to
        // the top level, converted. The raw original is not read beside it.
        const h = capturingBoot();
        await h.boot({
            manifest: { ...MANIFEST, hooks: [hookOf({ timeout: 5000 })], translations: [{ 'zh-CN': copy(RETIRED_ZH) }] },
            functions: functions(),
        });

        expect(h.bound).toStrictEqual([hookOf({ timeoutMs: 5000 })]);
        expect(h.i18n().getTranslations('zh-CN')).toStrictEqual(SERVED_ZH);
    });
});

describe('#23090 control: an artifact authored in the current spellings is read exactly as authored', () => {
    it('the hook and the translation bundle are handed over by reference, and the hook is still bounded', async () => {
        const authored = currentArtifact();
        const i18n = createMemoryI18n();
        const load = vi.spyOn(i18n, 'loadTranslations');
        const h = capturingBoot({ i18n });
        await h.boot(authored);

        expect(h.bound).toHaveLength(1);
        expect(h.bound[0]).toBe(authored.hooks[0]);
        expect(load.mock.calls).toStrictEqual([['zh-CN', authored.translations[0]['zh-CN']]]);
        expect(load.mock.calls[0][1]).toBe(authored.translations[0]['zh-CN']);
        expect(await insertAfter(h.ql, [5_000])).toStrictEqual(["rejected: Hook 'audit' timed out after 5000ms"]);
    });

    it('the merge set: the stack list, then a different manifest list, each once, by reference, on every shape', async () => {
        const zh = (label: string) => ({ 'zh-CN': { objects: { probe_note: { label } } } });
        const stackHook = hookOf({ timeoutMs: 5000 });
        const manifestHook = { ...hookOf({ timeoutMs: 7000 }), name: 'audit_legacy' };
        const shapes: Record<string, { bundle: any; hooks: any[]; bundles: any[] }> = {};
        {
            const t = [zh('flat')];
            const hooks = [stackHook];
            shapes.flat = { bundle: { ...MANIFEST, functions: functions(), hooks, translations: t }, hooks, bundles: t };
        }
        {
            const ts = [zh('stack')];
            const tm = [zh('manifest')];
            const hs = [stackHook];
            const hm = [manifestHook];
            shapes.both = {
                bundle: { manifest: { ...MANIFEST, hooks: hm, translations: tm }, functions: functions(), hooks: hs, translations: ts },
                hooks: [...hs, ...hm],
                bundles: [...ts, ...tm],
            };
        }
        {
            const tm = [zh('manifest only')];
            const hm = [manifestHook];
            shapes.manifestOnly = {
                bundle: { manifest: { ...MANIFEST, hooks: hm, translations: tm }, functions: functions() },
                hooks: hm,
                bundles: tm,
            };
        }

        for (const [shape, expected] of Object.entries(shapes)) {
            const i18n = createMemoryI18n();
            const load = vi.spyOn(i18n, 'loadTranslations');
            const h = capturingBoot({ i18n });
            await h.boot(expected.bundle);

            expect(h.bound.length, shape).toBe(expected.hooks.length);
            expected.hooks.forEach((hook, i) => expect(h.bound[i], `${shape} hook ${i}`).toBe(hook));
            expect(load.mock.calls.length, shape).toBe(expected.bundles.length);
            expected.bundles.forEach((b, i) => expect(load.mock.calls[i][1], `${shape} bundle ${i}`).toBe(b['zh-CN']));
        }
    });
});
