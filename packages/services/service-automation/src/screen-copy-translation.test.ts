// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22507 — a screen's heading and body text render in the run's locale.
 *
 * `flows.<flow>.screens.<node_id>.title` / `.description` are the keys; this
 * file pins their reader. Both slots are `{{ }}` templates the screen executor
 * renders per run, and the client receives the rendered strings, so the
 * maintainer's ruling A states the rule once: a user-read flow string the
 * server renders per run is translated where it is rendered, in the run's
 * locale, before its holes are filled. The executor therefore asks the engine
 * for the translated TEMPLATE (`AutomationEngine.renderFlowTextSlot`, the pick
 * the refusing `end` node makes, `end-node-refusal-translation.test.ts`)
 * through the one `i18n` channel `setI18nServiceSource` attaches, in
 * `AutomationContext.locale`, and only then fills the holes.
 *
 * The i18n service here is the REAL in-memory implementation
 * (`createMemoryI18n`, `@objectstack/core`), loaded the way `AppPlugin` loads a
 * stack's bundles — not a double that answers whatever the test wants.
 *
 * ⚠️ Direction, predicted before running: every "translated" pin is RED on the
 * unfixed executor (it rendered the authored English template whatever the
 * locale); every "authored" pin is green on both sides on purpose — they fence
 * the fallback.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { flowScreenCopyKey } from '@objectstack/spec/system';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { installBuiltinNodes } from './builtin/index.js';
import { i18nServiceReader } from './plugin.js';

interface LogLine { level: string; message: string }

function createTestLogger(lines: LogLine[] = []): any {
    const at = (level: string) => (message: unknown) => { lines.push({ level, message: String(message) }); };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => createTestLogger(lines) };
}

const ACME = { id: 'rec_1', name: 'Acme Corp' } as const;

/** The context a door hands the engine — `locale` is the request's resolved one. */
function doorContext(locale?: string): AutomationContext {
    return {
        event: 'manual', object: 'account', record: { ...ACME }, userId: 'usr_1',
        ...(locale ? { locale } : {}),
    } as unknown as AutomationContext;
}

/**
 * `start → confirm (screen) → done (screen)`: two message-only screens, the
 * first with a heading and body text that carry holes, the second reached on
 * the RESUMED leg.
 */
function intakeFlow() {
    return {
        name: 'intake', label: 'Intake', type: 'screen',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            {
                id: 'confirm', type: 'screen', label: 'Confirm Step',
                config: {
                    waitForInput: true,
                    title: 'Confirm {{ record.name }}',
                    description: 'Review {{ record.name }} before you continue.',
                },
            },
            {
                id: 'done', type: 'screen', label: 'Done',
                config: { waitForInput: true, title: 'Finished', description: 'All set for {{ record.name }}.' },
            },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'confirm' },
            { id: 'e1', source: 'confirm', target: 'done' },
        ],
    };
}

const ZH_BUNDLE = {
    flows: {
        intake: {
            screens: {
                confirm: { title: '确认 {{ record.name }}', description: '继续之前请核对 {{ record.name }}。' },
                done: { title: '已完成', description: '{{ record.name }} 已就绪。' },
            },
        },
    },
};

/** A stack's bundles, loaded the way `AppPlugin.loadTranslations` hands them to the service. */
function i18nWith(bundles: Record<string, Record<string, unknown>>) {
    const i18n = createMemoryI18n();
    for (const [locale, data] of Object.entries(bundles)) i18n.loadTranslations(locale, data);
    return i18n;
}

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
    installBuiltinNodes(engine, { logger: createTestLogger(lines), getService: () => undefined } as never);
    return { engine, store };
}

describe('#22507 — the keys the screen executor asks for', () => {
    it('is `flows.<flow>.screens.<node_id>.title` / `.description`', () => {
        expect(flowScreenCopyKey('intake', 'confirm', 'title')).toBe('flows.intake.screens.confirm.title');
        expect(flowScreenCopyKey('intake', 'confirm', 'description')).toBe('flows.intake.screens.confirm.description');
    });
});

describe('#22507 — a zh-CN run serves the screen translated, its holes filled', () => {
    it('renders the zh-CN heading and body text templates with the run\'s values', async () => {
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.status).toBe('paused');
        expect(paused.screen).toMatchObject({
            nodeId: 'confirm',
            title: '确认 Acme Corp',
            description: '继续之前请核对 Acme Corp。',
        });
    });

    it('negotiates the requested tag the way the bundle readers do: `zh` reaches the `zh-CN` bundle', async () => {
        const { engine } = engineWith(i18nWith({ en: {}, 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('zh'));

        expect(paused.screen?.title).toBe('确认 Acme Corp');
        expect(paused.screen?.description).toBe('继续之前请核对 Acme Corp。');
    });

    it('a resumed leg renders the next screen in the locale the run was STARTED in', async () => {
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));
        const next = await engine.resume(paused.runId!, { variables: {} } as never);

        expect(next.status).toBe('paused');
        expect(next.screen).toMatchObject({ nodeId: 'done', title: '已完成', description: 'Acme Corp 已就绪。' });
    });

    it('the one `title` key covers the node label a screen with no `config.title` shows', async () => {
        const flow = intakeFlow();
        delete (flow.nodes[1]!.config as { title?: string }).title;
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', flow as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.screen?.title).toBe('确认 Acme Corp');
    });

    it('translates an object-form screen\'s heading and body text the same way', async () => {
        const flow = {
            name: 'intake', label: 'Intake', type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'confirm', type: 'screen', label: 'Confirm Step',
                    config: {
                        objectName: 'account',
                        title: 'Confirm {{ record.name }}',
                        description: 'Review {{ record.name }} before you continue.',
                    },
                },
            ],
            edges: [{ id: 'e0', source: 'start', target: 'confirm' }],
        };
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', flow as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.screen).toMatchObject({
            kind: 'object-form',
            title: '确认 Acme Corp',
            description: '继续之前请核对 Acme Corp。',
        });
    });
});

describe('#22507 — the authored template renders whenever no translation is picked', () => {
    it('CONTROL — a locale with no entry renders the authored heading and body text', async () => {
        const { engine } = engineWith(i18nWith({ en: {}, 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('fr-FR'));

        expect(paused.screen).toMatchObject({
            title: 'Confirm Acme Corp',
            description: 'Review Acme Corp before you continue.',
        });
    });

    it('a default-locale run is unchanged — the source text it always rendered', async () => {
        const { engine } = engineWith(i18nWith({ en: {}, 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('en'));

        expect(paused.screen).toMatchObject({
            title: 'Confirm Acme Corp',
            description: 'Review Acme Corp before you continue.',
        });
    });

    it('a run with no locale (no person started it) renders the authored text', async () => {
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext());

        expect(paused.screen?.title).toBe('Confirm Acme Corp');
        expect(paused.screen?.description).toBe('Review Acme Corp before you continue.');
    });

    it('a composition with no `i18n` service renders the authored text', async () => {
        const { engine } = engineWith(undefined);
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.screen?.title).toBe('Confirm Acme Corp');
        expect(paused.screen?.description).toBe('Review Acme Corp before you continue.');
    });

    it('an empty skeleton slot is no translation — the authored text renders', async () => {
        const skeleton = { flows: { intake: { screens: { confirm: { title: '', description: '' } } } } };
        const { engine } = engineWith(i18nWith({ 'zh-CN': skeleton }));
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.screen?.title).toBe('Confirm Acme Corp');
        expect(paused.screen?.description).toBe('Review Acme Corp before you continue.');
    });

    it('a bundle never ADDS body text to a screen that authors none', async () => {
        const flow = intakeFlow();
        delete (flow.nodes[1]!.config as { description?: string }).description;
        const { engine } = engineWith(i18nWith({ 'zh-CN': ZH_BUNDLE }));
        engine.registerFlow('intake', flow as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.screen?.title).toBe('确认 Acme Corp');
        expect(paused.screen?.description).toBeUndefined();
    });

    it('a translation that does not compile leaves the screen a screen, in the authored text, and says why', async () => {
        const lines: LogLine[] = [];
        const broken = {
            flows: { intake: { screens: { confirm: { description: '核对 {{ record.name | no_such_formatter }}' } } } },
        };
        const { engine } = engineWith(i18nWith({ 'zh-CN': broken }), lines);
        engine.registerFlow('intake', intakeFlow() as never);

        const paused = await engine.execute('intake', doorContext('zh-CN'));

        expect(paused.status).toBe('paused');
        expect(paused.screen?.description).toBe('Review Acme Corp before you continue.');
        const warning = lines.find((l) => l.level === 'warn' && l.message.includes('flows.intake.screens.confirm.description'));
        expect(warning?.message).toContain("the 'zh-CN' translation");
        expect(warning?.message).toContain("flow 'intake' screen 'confirm'");
    });
});
