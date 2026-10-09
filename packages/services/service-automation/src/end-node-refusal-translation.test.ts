// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22450 — a refusing `end` node's message renders in the run's locale.
 *
 * `flows.<flow>.refusals.<node_id>.message` is the key; this file pins its
 * reader. The run stores the refusal ALREADY rendered (`refusalMessage` on the
 * result and on the terminal history row), so the engine picks the translated
 * TEMPLATE before it fills the `{{ }}` holes, through the `i18n` service the
 * automation plugin bridges (`setI18nServiceSource`), in
 * `AutomationContext.locale` — the door's already-resolved
 * `ExecutionContext.locale`. The producer half (the two doors forwarding it) is
 * `flow-run-locale.test.ts` in `@objectstack/runtime`; the contexts below are
 * the literal shape those doors hand the engine.
 *
 * The i18n service here is the REAL in-memory implementation
 * (`createMemoryI18n`, `@objectstack/core`), loaded the way `AppPlugin` loads a
 * stack's bundles — not a double that answers whatever the test wants.
 *
 * ⚠️ Direction, predicted before running: every "translated" pin is RED on the
 * unfixed engine (it rendered the authored English template whatever the
 * locale); every "authored" pin is green on both sides on purpose — they fence
 * the fallback.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { flowRefusalMessageKey } from '@objectstack/spec/system';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { installBuiltinNodes } from './builtin/index.js';
import { i18nServiceReader } from './plugin.js';

interface LogLine { level: string; message: string }

function createTestLogger(lines: LogLine[] = []): any {
    const at = (level: string) => (message: unknown) => { lines.push({ level, message: String(message) }); };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => createTestLogger(lines) };
}

const AUTHORED = 'Refused: {{ record.name }} is a confirmed duplicate';
const ZH_TEMPLATE = '已拒绝:{{ record.name }} 是已确认的重复记录';
const ACME = { id: 'rec_1', name: 'Acme Corp' } as const;

/** The context a door hands the engine — `locale` is the request's resolved one. */
function doorContext(locale?: string): AutomationContext {
    return {
        event: 'manual', object: 'account', record: { ...ACME }, userId: 'usr_1',
        ...(locale ? { locale } : {}),
    } as unknown as AutomationContext;
}

/** `start → finish`, the finish an `end` declaring `outcome: 'refused'`. */
function refusingFlow(name = 'dedupe') {
    return {
        name, label: name, type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: AUTHORED } },
        ],
        edges: [{ id: 'e0', source: 'start', target: 'finish' }],
    };
}

/** A stack's bundles, loaded the way `AppPlugin.loadTranslations` hands them to the service. */
function i18nWith(bundles: Record<string, Record<string, unknown>>) {
    const i18n = createMemoryI18n();
    for (const [locale, data] of Object.entries(bundles)) i18n.loadTranslations(locale, data);
    return i18n;
}

const ZH_BUNDLE = { flows: { dedupe: { refusals: { finish: { message: ZH_TEMPLATE } } } } };

function engineWith(i18n: unknown, lines: LogLine[] = []) {
    const store = new InMemorySuspendedRunStore();
    const engine = new AutomationEngine(createTestLogger(lines), store);
    // The plugin's own reader, over a kernel whose `i18n` service is `i18n`.
    engine.setI18nServiceSource(i18nServiceReader({
        getService: (<T>(name: string) => {
            if (name === 'i18n' && i18n) return i18n as T;
            throw new Error(`service '${name}' not registered`);
        }) as never,
    }));
    return { engine, store };
}

describe('#22450 — the key the reader asks for', () => {
    it('is `flows.<flow>.refusals.<node_id>.message`', () => {
        expect(flowRefusalMessageKey('dedupe', 'finish')).toBe('flows.dedupe.refusals.finish.message');
    });
});

describe('#22450 — a zh-CN run of a refused flow stores the translated message', () => {
    it('renders the zh-CN template with its hole filled, on the result and on the history row', async () => {
        const { engine, store } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('dedupe', refusingFlow() as never);

        const result = await engine.execute('dedupe', doorContext('zh-CN'));

        expect(result.success).toBe(true);
        expect(result.status).toBe('refused');
        expect(result.refusalMessage).toBe('已拒绝:Acme Corp 是已确认的重复记录');

        const runs = await engine.listRuns('dedupe', { limit: 1 });
        const record = await store.loadTerminal!(runs[0]!.id);
        expect(record?.status).toBe('refused');
        expect(record?.refusalMessage).toBe('已拒绝:Acme Corp 是已确认的重复记录');
    });

    it('negotiates the requested tag the way the bundle readers do: `zh` reaches the `zh-CN` bundle', async () => {
        const { engine } = engineWith(i18nWith({ en: {}, 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('dedupe', refusingFlow() as never);

        const result = await engine.execute('dedupe', doorContext('zh'));

        expect(result.refusalMessage).toBe('已拒绝:Acme Corp 是已确认的重复记录');
    });
});

describe('#22450 — the authored message renders whenever no translation is picked', () => {
    it('CONTROL — a locale with no entry falls back to the source message', async () => {
        const { engine } = engineWith(i18nWith({ en: {}, 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('dedupe', refusingFlow() as never);

        const result = await engine.execute('dedupe', doorContext('fr-FR'));

        expect(result.status).toBe('refused');
        expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });

    it('a run with no locale (no person started it) stores the authored message', async () => {
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('dedupe', refusingFlow() as never);

        const result = await engine.execute('dedupe', doorContext());

        expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });

    it('a composition with no `i18n` service renders the authored message', async () => {
        const { engine } = engineWith(undefined);
        engine.registerFlow('dedupe', refusingFlow() as never);

        const result = await engine.execute('dedupe', doorContext('zh-CN'));

        expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });

    it('a translation that does not compile leaves the refusal a refusal, in the authored text, and says why', async () => {
        const lines: LogLine[] = [];
        const broken = { flows: { dedupe: { refusals: { finish: { message: '已拒绝:{{ record.name | no_such_formatter }}' } } } } };
        const { engine } = engineWith(i18nWith({ 'zh-CN': broken }), lines);
        engine.registerFlow('dedupe', refusingFlow() as never);

        const result = await engine.execute('dedupe', doorContext('zh-CN'));

        expect(result.status).toBe('refused');
        expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
        const warning = lines.find((l) => l.level === 'warn' && l.message.includes('flows.dedupe.refusals.finish.message'));
        expect(warning?.message).toContain("the 'zh-CN' translation");
    });
});

describe('#22450 — a door-started run carries its locale into a resumed leg', () => {
    /** `start → ask (screen) → finish (refused)`: the refusal renders on the RESUMED leg. */
    function reviewFlow() {
        return {
            name: 'review', label: 'review', type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'ask', type: 'screen', label: 'Ask',
                    config: { waitForInput: true, title: 'Confirm', fields: [{ name: 'ok', label: 'OK', type: 'checkbox' }] },
                },
                { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: AUTHORED } },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'ask' },
                { id: 'e1', source: 'ask', target: 'finish' },
            ],
        };
    }
    const REVIEW_ZH = { flows: { review: { refusals: { finish: { message: ZH_TEMPLATE } } } } };

    it('a hot resume renders in the locale the run was STARTED in — the resume carries none', async () => {
        const { engine } = engineWith(i18nWith({ 'zh-CN': REVIEW_ZH }));
        installBuiltinNodes(engine, { logger: createTestLogger(), getService: () => undefined } as never);
        engine.registerFlow('review', reviewFlow() as never);

        const paused = await engine.execute('review', doorContext('zh-CN'));
        expect(paused.status).toBe('paused');

        const resumed = await engine.resume(paused.runId!, { variables: { ok: true } } as never);

        expect(resumed.status).toBe('refused');
        expect(resumed.refusalMessage).toBe('已拒绝:Acme Corp 是已确认的重复记录');
    });

    it('a cold resume — a second engine over the same store — reads the locale persisted with the run', async () => {
        const i18n = i18nWith({ 'zh-CN': REVIEW_ZH });
        const first = engineWith(i18n);
        installBuiltinNodes(first.engine, { logger: createTestLogger(), getService: () => undefined } as never);
        first.engine.registerFlow('review', reviewFlow() as never);
        const paused = await first.engine.execute('review', doorContext('zh-CN'));
        expect(paused.status).toBe('paused');
        expect((await first.store.load(paused.runId!))?.context?.locale).toBe('zh-CN');

        // A restart: a new engine, nothing in memory, the store the only carrier.
        const second = new AutomationEngine(createTestLogger(), first.store);
        second.setI18nServiceSource(() => i18n as never);
        installBuiltinNodes(second, { logger: createTestLogger(), getService: () => undefined } as never);
        second.registerFlow('review', reviewFlow() as never);

        const resumed = await second.resume(paused.runId!, { variables: { ok: true } } as never);

        expect(resumed.status).toBe('refused');
        expect(resumed.refusalMessage).toBe('已拒绝:Acme Corp 是已确认的重复记录');
    });
});

describe('#22450 — the plugin\'s reader is lazy', () => {
    it('asks the kernel at question time: an `i18n` service registered after the reader was made is read', () => {
        const services = new Map<string, unknown>();
        const reader = i18nServiceReader({
            getService: (<T>(name: string) => {
                if (!services.has(name)) throw new Error(`service '${name}' not registered`);
                return services.get(name) as T;
            }) as never,
        });
        expect(reader()).toBeUndefined();
        const i18n = i18nWith({});
        services.set('i18n', i18n);
        expect(reader()).toBe(i18n);
    });

    it('a service with no `t()` answers nothing', () => {
        const reader = i18nServiceReader({ getService: (() => ({ getLocales: () => [] })) as never });
        expect(reader()).toBeUndefined();
    });
});
