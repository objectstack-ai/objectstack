// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #28054 — a flow's `successMessage` / `errorMessage` are TEXT slots: `{{ }}`
 * holes over the run's variables, rendered at every terminal exit.
 *
 * Until this change every terminal exit copied `flow.successMessage` onto the
 * result as written, so `'{{enrolledCount}} contacts enrolled'` reached the
 * caller with its hole raw (the card's probe). The precedent followed for
 * every choice is a refusing `end` node's `message`: the same renderer
 * (`renderTextSlot`), the same translation pick (`renderFlowTextSlot`, in the
 * run's locale, before the holes are filled), and the same doors
 * (`registerFlow` refuses a single-brace token and a hole that does not
 * compile with the very words a node's text slot gets).
 *
 * ⚠️ Direction, predicted before running: every "rendered" pin is RED on the
 * unfixed engine (it answered the template verbatim), and so are the door
 * pins (nothing judged the two keys). The no-hole controls are green on both
 * sides on purpose — they fence the change: a message without `{{` is
 * byte-identical.
 */

import { describe, it, expect } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { validateExpression } from '@objectstack/formula';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { textSlotTemplateRefusal } from '@objectstack/spec/automation';
import { defineActionDescriptor } from '@objectstack/spec/automation';
import { flowTerminalMessageKey } from '@objectstack/spec/system';

import { AutomationEngine } from './engine.js';
import { InMemorySuspendedRunStore } from './suspended-run-store.js';
import { i18nServiceReader } from './plugin.js';
import { renderTextSlot } from './builtin/template.js';
import { withLoaderSetFromPull } from './loader-set.test-support.js';

interface LogLine { level: string; message: string }

function createTestLogger(lines: LogLine[] = []): any {
    const at = (level: string) => (message: unknown) => { lines.push({ level, message: String(message) }); };
    return { info: at('info'), warn: at('warn'), error: at('error'), debug: at('debug'), child: () => createTestLogger(lines) };
}

/** The card's probe template. */
const ENROLLED = '{{enrolledCount}} contacts enrolled';

/**
 * `start → enrol → end`. The `enrol` node binds `enrolledCount = 3` and
 * `attempted = 3`, then succeeds or fails as `fails` says. `pause` puts a
 * pausing gate before it, so the counting leg runs on the RESUME.
 */
function enrolFlow(opts: { successMessage?: string; errorMessage?: string; pause?: boolean; errorHandling?: unknown } = {}) {
    return {
        name: 'enrol', label: 'Enrol', type: 'autolaunched',
        ...(opts.successMessage !== undefined ? { successMessage: opts.successMessage } : {}),
        ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
        ...(opts.errorHandling ? { errorHandling: opts.errorHandling } : {}),
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            ...(opts.pause ? [{ id: 'gate', type: 'approval_pause', label: 'Gate' }] : []),
            { id: 'enrol', type: 'enrol_contacts', label: 'Enrol' },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: opts.pause
            ? [
                { id: 'e0', source: 'start', target: 'gate' },
                { id: 'e1', source: 'gate', target: 'enrol' },
                { id: 'e2', source: 'enrol', target: 'end' },
            ]
            : [
                { id: 'e0', source: 'start', target: 'enrol' },
                { id: 'e1', source: 'enrol', target: 'end' },
            ],
    };
}

function engineWith(opts: { fails?: boolean; i18n?: unknown; lines?: LogLine[] } = {}) {
    const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger(opts.lines), new InMemorySuspendedRunStore()));
    const runs = { count: 0 };
    engine.registerNodeExecutor({
        type: 'enrol_contacts',
        async execute(_node: unknown, variables: Map<string, unknown>) {
            runs.count++;
            variables.set('enrolledCount', 3);
            variables.set('attempt', runs.count);
            return opts.fails ? { success: false, error: 'mailing service down' } : { success: true };
        },
    } as never);
    engine.registerNodeExecutor({
        type: 'approval_pause',
        descriptor: defineActionDescriptor({
            type: 'approval_pause', version: '1.0.0', name: 'approval_pause', supportsPause: true, resumeAuthority: 'any',
        }),
        async execute() {
            return { success: true, suspend: true, correlation: 'approval:req' };
        },
    } as never);
    if (opts.i18n) {
        engine.setI18nServiceSource(i18nServiceReader({
            getService: (<T>(name: string) => {
                if (name === 'i18n') return opts.i18n as T;
                throw new Error(`service '${name}' not registered`);
            }) as never,
        }));
    }
    return { engine, runs };
}

/** The message `registerFlow` threw, or `undefined` when it registered. */
function registrationRefusal(engine: AutomationEngine, flow: unknown): string | undefined {
    try {
        engine.registerFlow('enrol', flow as never);
        return undefined;
    } catch (err) {
        return (err as Error).message;
    }
}

/** A refusing `end` node carrying `message` — the node slot the flow-level pair is judged alike with. */
function refusingEndFlow(message: string) {
    return {
        name: 'gatekeeper', label: 'Gatekeeper', type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message } },
        ],
        edges: [{ id: 'e0', source: 'start', target: 'finish' }],
    };
}

describe('#28054 — the card\'s probe: the hole is filled on the result', () => {
    it('the first-run path answers "3 contacts enrolled"', async () => {
        const { engine } = engineWith();
        engine.registerFlow('enrol', enrolFlow({ successMessage: ENROLLED }) as never);

        const result = await engine.execute('enrol');

        expect(result.success).toBe(true);
        expect(result.successMessage).toBe('3 contacts enrolled');
    });

    it('the resume path answers "3 contacts enrolled" — the count is bound on the resumed leg', async () => {
        const { engine } = engineWith();
        engine.registerFlow('enrol', enrolFlow({ successMessage: ENROLLED, pause: true }) as never);

        const paused = await engine.execute('enrol');
        expect(paused.status).toBe('paused');
        expect(paused.successMessage).toBeUndefined();

        const done = await engine.resume(paused.runId as string, { output: { verdict: 'approved' } } as never);

        expect(done.success).toBe(true);
        expect(done.successMessage).toBe('3 contacts enrolled');
    });

    it('a run that succeeds on a later attempt renders over that attempt\'s variables', async () => {
        const engine = withLoaderSetFromPull(new AutomationEngine(createTestLogger()));
        let count = 0;
        engine.registerNodeExecutor({
            type: 'enrol_contacts',
            async execute(_node: unknown, variables: Map<string, unknown>) {
                count++;
                variables.set('attempt', count);
                return count === 1 ? { success: false, error: 'flaky' } : { success: true };
            },
        } as never);
        engine.registerFlow('enrol', enrolFlow({
            successMessage: 'Enrolled on attempt {{ attempt }}',
            errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 },
        }) as never);

        const result = await engine.execute('enrol');

        expect(result.success).toBe(true);
        expect(result.successMessage).toBe('Enrolled on attempt 2');
    });
});

describe('#28054 — errorMessage renders over the variables at the failure point', () => {
    it('a failing run answers the filled errorMessage beside the raw error', async () => {
        const { engine } = engineWith({ fails: true });
        engine.registerFlow('enrol', enrolFlow({ errorMessage: 'Could not finish enrolling {{ enrolledCount }} contacts.' }) as never);

        const result = await engine.execute('enrol');

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Could not finish enrolling 3 contacts.');
        expect(result.error).toContain('mailing service down');
    });

    it('the engine\'s own `$error` is a root the errorMessage can name', async () => {
        const { engine } = engineWith({ fails: true });
        engine.registerFlow('enrol', enrolFlow({ errorMessage: 'Enrolment failed: {{ $error.message }}' }) as never);

        const result = await engine.execute('enrol');

        expect(result.errorMessage).toContain('Enrolment failed: ');
        expect(result.errorMessage).toContain('mailing service down');
        expect(result.errorMessage).not.toContain('{{');
    });

    it('the retry-exhausted exit answers the LAST attempt\'s rendering', async () => {
        const { engine, runs } = engineWith({ fails: true });
        engine.registerFlow('enrol', enrolFlow({
            errorMessage: 'Gave up after attempt {{ attempt }}.',
            errorHandling: { strategy: 'retry', maxRetries: 1, backoffMs: 0 },
        }) as never);

        const result = await engine.execute('enrol');

        expect(runs.count).toBe(2);
        expect(result.status).toBe('failed');
        expect(result.errorMessage).toBe('Gave up after attempt 2.');
    });
});

describe('#28054 — a hole over a variable the run never bound behaves as in a node text slot', () => {
    it('renders the blank fragment `renderTextSlot` renders for any text slot', async () => {
        const { engine } = engineWith();
        const template = '{{ nobodyBoundThis }} contacts enrolled';
        engine.registerFlow('enrol', enrolFlow({ successMessage: template }) as never);

        const result = await engine.execute('enrol');

        expect(result.success).toBe(true);
        expect(result.successMessage).toBe(' contacts enrolled');
        // The node slots' one renderer answers the same for the same template.
        expect(result.successMessage).toBe(renderTextSlot(template, new Map()));
    });
});

describe('#28054 — the doors judge the pair as they judge a node text slot', () => {
    it('registerFlow refuses a single-brace token with the node slot\'s refusal and its `{{ }}` spelling', () => {
        const { engine } = engineWith();
        const text = '{enrolledCount} contacts enrolled';

        const flowLevel = registrationRefusal(engine, enrolFlow({ successMessage: text }));
        const nodeLevel = registrationRefusal(engine, refusingEndFlow(text));

        const refusal = textSlotTemplateRefusal(text)!;
        expect(refusal).toContain('`{{ enrolledCount }} contacts enrolled`');
        expect(flowLevel).toContain('flow successMessage at successMessage');
        expect(flowLevel).toContain(refusal);
        expect(nodeLevel).toContain(refusal);
    });

    it('registerFlow refuses a hole that does not compile with the compile step\'s own words', () => {
        const { engine } = engineWith();
        const text = 'Enrolled {{ enrolledCount + 1 }} contacts';
        const compiled = validateExpression('template', text).errors[0]!.message;

        const flowLevel = registrationRefusal(engine, enrolFlow({ errorMessage: text }));
        const nodeLevel = registrationRefusal(engine, refusingEndFlow(text));

        expect(flowLevel).toContain('flow errorMessage at errorMessage');
        expect(flowLevel).toContain(compiled);
        expect(nodeLevel).toContain(compiled);
    });

    it('registers the well-formed template and the plain sentence', () => {
        const { engine } = engineWith();
        expect(registrationRefusal(engine, enrolFlow({ successMessage: ENROLLED, errorMessage: 'Enrolment failed.' }))).toBeUndefined();
    });
});

describe('#28054 — the controls: a message with no hole is byte-identical', () => {
    it('success and failure text without `{{` reach the result as written', async () => {
        const plain = 'Enrolment complete — 100% done: see the "Contacts" tab.';
        const { engine } = engineWith();
        engine.registerFlow('enrol', enrolFlow({ successMessage: plain }) as never);
        expect((await engine.execute('enrol')).successMessage).toBe(plain);

        const failing = engineWith({ fails: true });
        failing.engine.registerFlow('enrol', enrolFlow({ errorMessage: 'Enrolment did not finish.' }) as never);
        expect((await failing.engine.execute('enrol')).errorMessage).toBe('Enrolment did not finish.');
    });

    it('a flow that declares neither gets neither', async () => {
        const { engine } = engineWith();
        engine.registerFlow('enrol', enrolFlow() as never);
        const result = await engine.execute('enrol');
        expect(result.successMessage).toBeUndefined();
        expect(result.errorMessage).toBeUndefined();
    });
});

describe('#28054 — translated where it is rendered, in the run\'s locale', () => {
    const ZH = { flows: { enrol: { successMessage: '已登记 {{ enrolledCount }} 位联系人', errorMessage: '登记失败:{{ enrolledCount }}' } } };
    function i18nWith(bundles: Record<string, Record<string, unknown>>) {
        const i18n = createMemoryI18n();
        for (const [locale, data] of Object.entries(bundles)) i18n.loadTranslations(locale, data);
        return i18n;
    }
    const zhRun = { event: 'manual', locale: 'zh-CN' } as unknown as AutomationContext;

    it('is keyed `flows.<flow>.successMessage` / `.errorMessage`', () => {
        expect(flowTerminalMessageKey('enrol', 'successMessage')).toBe('flows.enrol.successMessage');
        expect(flowTerminalMessageKey('enrol', 'errorMessage')).toBe('flows.enrol.errorMessage');
    });

    it('a zh-CN run answers the translated template with its hole filled', async () => {
        const { engine } = engineWith({ i18n: i18nWith({ 'zh-CN': ZH }) });
        engine.registerFlow('enrol', enrolFlow({ successMessage: ENROLLED }) as never);

        const result = await engine.execute('enrol', zhRun);

        expect(result.successMessage).toBe('已登记 3 位联系人');
    });

    it('a zh-CN failing run answers the translated errorMessage filled at the failure point', async () => {
        const { engine } = engineWith({ fails: true, i18n: i18nWith({ 'zh-CN': ZH }) });
        engine.registerFlow('enrol', enrolFlow({ errorMessage: 'Could not enrol {{ enrolledCount }}' }) as never);

        const result = await engine.execute('enrol', zhRun);

        expect(result.errorMessage).toBe('登记失败:3');
    });

    it('a run with no locale, or a locale the bundle lacks, renders the authored template', async () => {
        const { engine } = engineWith({ i18n: i18nWith({ 'zh-CN': ZH }) });
        engine.registerFlow('enrol', enrolFlow({ successMessage: ENROLLED }) as never);

        expect((await engine.execute('enrol')).successMessage).toBe('3 contacts enrolled');
        expect((await engine.execute('enrol', { event: 'manual', locale: 'ja-JP' } as never)).successMessage)
            .toBe('3 contacts enrolled');
    });
});

describe('#28054 — a terminal text that cannot render leaves the verdict standing', () => {
    it('a `{{ x | currency }}` hole with no tenant default currency: success stands, no message, one warning', async () => {
        const lines: LogLine[] = [];
        const { engine } = engineWith({ lines });
        engine.registerFlow('enrol', enrolFlow({ successMessage: 'Charged {{ enrolledCount | currency }}' }) as never);

        const result = await engine.execute('enrol');

        expect(result.success).toBe(true);
        expect(result.successMessage).toBeUndefined();
        expect(lines.filter((l) => l.level === 'warn' && l.message.includes("flow 'enrol': its successMessage did not render"))).toHaveLength(1);
    });
});
