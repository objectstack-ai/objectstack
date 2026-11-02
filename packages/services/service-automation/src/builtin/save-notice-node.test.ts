// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28251 — the `save_notice` executor.
 *
 * The node renders its message and sets it on the run's
 * `AutomationContext.saveNotice` channel, which the record-change trigger
 * hands a run that executes INSIDE the write that fired it (its integration
 * pin is `record-change-integration.test.ts` in `trigger-record-change`).
 * Here the channel is the literal shape that trigger hands the engine, so each
 * pin reads what the executor did with it:
 *
 * - the sentence is picked from `flows.<flow>.notices.<node_id>.message` in
 *   the WRITER's locale (the channel's), through the REAL in-memory i18n
 *   service, and the authored template renders when nothing is picked;
 * - a run holding no channel, a closed channel and a subflow child are each
 *   refused by name — never a silent no-op.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import type { AutomationContext, SaveNoticeChannel } from '@objectstack/spec/contracts';

import { AutomationEngine } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { i18nServiceReader } from '../plugin.js';
import { installBuiltinNodes } from './index.js';

function createTestLogger(): any {
    const noop = () => {};
    return { info: noop, warn: noop, error: noop, debug: noop, child: () => createTestLogger() };
}

const AUTHORED = 'Sent {{ record.name }} to your manager for approval';
const ZH_TEMPLATE = '已将 {{ record.name }} 提交给经理审批';
const DEAL = { id: 'deal_1', name: 'Acme renewal' } as const;

const START = {
    id: 'start', type: 'start', label: 'Start',
    config: { objectName: 'deal', triggerType: 'record-after-update' },
};

function noticeFlow(name = 'deal_submit', message = AUTHORED) {
    return {
        name, label: name, type: 'record_change',
        nodes: [
            START,
            { id: 'tell', type: 'save_notice', label: 'Tell', config: { message } },
            { id: 'done', type: 'end', label: 'Done' },
        ],
        edges: [
            { id: 'e0', source: 'start', target: 'tell' },
            { id: 'e1', source: 'tell', target: 'done' },
        ],
    };
}

/** The channel the record-change trigger hands the run: the write's listener. */
function channel(locale?: string) {
    const heard: string[] = [];
    let closed = false;
    const saveNotice: SaveNoticeChannel = {
        set(message: string) {
            if (closed) throw new Error('the write that started this run has already answered');
            heard.push(message);
        },
        ...(locale ? { locale } : {}),
    };
    return { heard, saveNotice, close: () => { closed = true; } };
}

function triggerContext(saveNotice?: SaveNoticeChannel): AutomationContext {
    return {
        event: 'record-after-update', object: 'deal', record: { ...DEAL },
        ...(saveNotice ? { saveNotice } : {}),
    } as unknown as AutomationContext;
}

function engineWith(bundles?: Record<string, Record<string, unknown>>) {
    const engine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
    const i18n = bundles ? createMemoryI18n() : undefined;
    for (const [locale, data] of Object.entries(bundles ?? {})) i18n!.loadTranslations(locale, data);
    engine.setI18nServiceSource(i18nServiceReader({
        getService: (<T>(name: string) => {
            if (name === 'i18n' && i18n) return i18n as T;
            throw new Error(`service '${name}' not registered`);
        }) as never,
    }));
    installBuiltinNodes(engine, { logger: createTestLogger(), getService: () => undefined } as never);
    return engine;
}

const ZH_BUNDLE = { flows: { deal_submit: { notices: { tell: { message: ZH_TEMPLATE } } } } };

describe('#28251 — save_notice sets the rendered sentence on the write\'s channel', () => {
    it('renders the authored template with its holes filled', async () => {
        const engine = engineWith();
        engine.registerFlow('deal_submit', noticeFlow() as never);
        const tap = channel();

        const result = await engine.execute('deal_submit', triggerContext(tap.saveNotice));

        expect(result.success).toBe(true);
        expect(tap.heard).toEqual(['Sent Acme renewal to your manager for approval']);
    });

    it('picks the zh-CN translation in the WRITER\'s locale, the channel\'s', async () => {
        const engine = engineWith({ 'zh-CN': ZH_BUNDLE });
        engine.registerFlow('deal_submit', noticeFlow() as never);
        const tap = channel('zh-CN');

        await engine.execute('deal_submit', triggerContext(tap.saveNotice));

        expect(tap.heard).toEqual(['已将 Acme renewal 提交给经理审批']);
    });

    it('CONTROL — a writer locale with no entry renders the authored template', async () => {
        const engine = engineWith({ 'zh-CN': ZH_BUNDLE });
        engine.registerFlow('deal_submit', noticeFlow() as never);
        const tap = channel('fr-FR');

        await engine.execute('deal_submit', triggerContext(tap.saveNotice));

        expect(tap.heard).toEqual(['Sent Acme renewal to your manager for approval']);
    });
});

describe('#28251 — save_notice is refused by name where no write waits', () => {
    it('refuses a run holding no channel', async () => {
        const engine = engineWith();
        engine.registerFlow('deal_submit', noticeFlow() as never);

        const result = await engine.execute('deal_submit', triggerContext());

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/save_notice 'tell': this run holds no record write to answer/);
    });

    it('refuses a channel the trigger closed, carrying the channel\'s own sentence', async () => {
        const engine = engineWith();
        engine.registerFlow('deal_submit', noticeFlow() as never);
        const tap = channel();
        tap.close();

        const result = await engine.execute('deal_submit', triggerContext(tap.saveNotice));

        expect(result.success).toBe(false);
        expect(result.error).toContain("save_notice 'tell': the write that started this run has already answered");
        expect(tap.heard).toEqual([]);
    });

    it('gives a subflow child no channel, so the child\'s node is refused and the parent\'s write hears nothing', async () => {
        const engine = engineWith();
        engine.registerFlow('child_notice', noticeFlow('child_notice', 'From the child') as never);
        engine.registerFlow('parent', {
            name: 'parent', label: 'parent', type: 'record_change',
            nodes: [
                START,
                { id: 'call', type: 'subflow', label: 'Call', config: { flowName: 'child_notice' } },
                { id: 'done', type: 'end', label: 'Done' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'call' },
                { id: 'e1', source: 'call', target: 'done' },
            ],
        } as never);
        const tap = channel();

        const result = await engine.execute('parent', triggerContext(tap.saveNotice));

        expect(tap.heard).toEqual([]);
        expect(result.success).toBe(false);
        expect(result.error).toContain("save_notice 'tell': this run holds no record write to answer");
    });

    it('gives a map child no channel either, so the parent\'s write hears nothing from it', async () => {
        const engine = engineWith();
        engine.registerFlow('child_notice', noticeFlow('child_notice', 'From the child') as never);
        engine.registerFlow('parent_map', {
            name: 'parent_map', label: 'parent_map', type: 'record_change',
            nodes: [
                START,
                {
                    id: 'each', type: 'map', label: 'Each',
                    config: { collection: { dialect: 'cel', source: '[1]' }, flowName: 'child_notice', iteratorVariable: 'item' },
                },
                { id: 'done', type: 'end', label: 'Done' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'each' },
                { id: 'e1', source: 'each', target: 'done' },
            ],
        } as never);
        const tap = channel();

        await engine.execute('parent_map', triggerContext(tap.saveNotice));

        expect(tap.heard).toEqual([]);
    });
});
