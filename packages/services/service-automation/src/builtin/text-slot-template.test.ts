// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22110 — the flow TEXT slots read ADR-0032 §3's `{{ }}` delimiter.
 *
 * A notify `title` / `message`, a screen `title` / `description` and a refusing
 * `end` node's `message` render through ONE renderer, `renderTextSlot`: the
 * formula template engine's `{{ path }}` / `{{ path | formatter }}` holes over
 * the flow's variables. A single-brace `{token}` left from the 17.x dialect is
 * refused at registration with its hole spelling — never converted: the two
 * renderers answer differently for some value of every token spelling (a
 * `Date` rendered JSON-quoted, a whole-slot object `[object Object]`), which
 * the renderer pins below hold.
 *
 * The card's three pins are the first describe block. #22477's — a hole over
 * a `$` root the engine does not bind is refused, and the spec judge's list of
 * the roots it does bind misses none of them — are the last.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AutomationContext } from '@objectstack/spec/contracts';
import { TEXT_SLOT_TEMPLATE_REFUSAL, textSlotTemplateRefusal } from '@objectstack/spec/automation';

import { AutomationEngine } from '../engine.js';
import { InMemorySuspendedRunStore } from '../suspended-run-store.js';
import { isGuardRefusal } from '../guard-refusal.js';
import { installBuiltinNodes } from './index.js';
import type { MessagingServiceSurface } from './notify-node.js';
import {
    FlowTextTemplateError,
    interpolateString,
    renderTextSlot,
    stringifyForTemplate,
    textTemplateScope,
    type VariableMap,
} from './template.js';

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

function harness() {
    const emitted: Array<Parameters<MessagingServiceSurface['emit']>[0]> = [];
    const messaging: MessagingServiceSurface = {
        async emit(n) {
            emitted.push(n);
            return { notificationId: 'evt_1', delivered: n.audience.length, failed: 0 };
        },
    };
    const engine = new AutomationEngine(createTestLogger(), new InMemorySuspendedRunStore());
    installBuiltinNodes(engine, {
        logger: createTestLogger(),
        getService: (name: string) => (name === 'messaging' ? messaging : undefined),
    } as never);
    return { engine, emitted };
}

function notifyFlow(name: string, config: Record<string, unknown>) {
    return {
        name,
        label: name,
        type: 'autolaunched',
        nodes: [
            { id: 'start', type: 'start', label: 'Start' },
            { id: 'notify', type: 'notify', label: 'Notify', config: { recipients: ['user_1'], ...config } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [
            { id: 'e1', source: 'start', target: 'notify' },
            { id: 'e2', source: 'notify', target: 'end' },
        ],
    };
}

const ACME = { id: 'rec_1', name: 'Acme Corp', amount: 1234.5, tags: ['vip', 'eu'], meta: { tier: 'gold' } };
const ctx = (record: Record<string, unknown> = ACME) =>
    ({ event: 'manual', object: 'account', record, userId: 'usr_7' }) as unknown as AutomationContext;

/** The message `registerFlow` threw, or `undefined` when it registered. */
function registrationRefusal(engine: AutomationEngine, name: string, flow: unknown): string | undefined {
    try {
        engine.registerFlow(name, flow as never);
        return undefined;
    } catch (err) {
        return (err as Error).message;
    }
}

describe('#22110 — the card\'s pins', () => {
    it('a notify title `Hello {{ record.name }}` renders the name', async () => {
        const { engine, emitted } = harness();
        engine.registerFlow('hello', notifyFlow('hello', { title: 'Hello {{ record.name }}' }) as never);
        const result = await engine.execute('hello', ctx());
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(emitted).toHaveLength(1);
        expect(emitted[0]!.payload).toMatchObject({ title: 'Hello Acme Corp' });
    });

    it('a stored `Hello {record.name}` is REFUSED at registration with its hole spelling — no spelling converts', () => {
        const { engine } = harness();
        const refusal = registrationRefusal(engine, 'legacy', notifyFlow('legacy', { title: 'Hello {record.name}' }));
        expect(refusal).toBeDefined();
        expect(refusal).toContain("node 'notify' (notify) notify title at config.title");
        expect(refusal).toContain(TEXT_SLOT_TEMPLATE_REFUSAL);
        expect(refusal).toContain('`Hello {{ record.name }}`');
    });

    it('control: `{{ }}` pasted into a CEL predicate still fails to parse, loudly, at registration', () => {
        const { engine } = harness();
        const flow = notifyFlow('pasted', { title: 'Hello {{ record.name }}' });
        (flow.edges[0] as Record<string, unknown>).condition = "{{ record.name }} == 'Acme Corp'";
        const refusal = registrationRefusal(engine, 'pasted', flow);
        expect(refusal).toBeDefined();
        expect(refusal).toContain('condition');
    });
});

describe('#22110 — the doors around a text slot', () => {
    it('refuses a single-brace token in every text slot at registration — a screen title / description and an end message too', () => {
        const { engine } = harness();
        const screen = {
            name: 's', label: 's', type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'ask', type: 'screen', label: 'Ask', config: { waitForInput: true, title: 'Hi {name}', description: 'About {record.name}' } },
            ],
            edges: [{ id: 'e0', source: 'start', target: 'ask' }],
        };
        const screenRefusal = registrationRefusal(engine, 's', screen)!;
        expect(screenRefusal).toContain('`Hi {{ name }}`');
        expect(screenRefusal).toContain('`About {{ record.name }}`');
        const end = {
            name: 'e', label: 'e', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'finish', type: 'end', label: 'Finish', config: { outcome: 'refused', message: 'No: {record.name}' } },
            ],
            edges: [{ id: 'e0', source: 'start', target: 'finish' }],
        };
        expect(registrationRefusal(engine, 'e', end)).toContain('`No: {{ record.name }}`');
    });

    it('compiles a text slot at registration — a hole holding logic or an unknown formatter is refused there, not mid-run', () => {
        const { engine } = harness();
        for (const title of ['Total {{ amount * 2 }}', 'Total {{ amount | bogus }}', 'Total {{ amount']) {
            const refusal = registrationRefusal(engine, 'compile', notifyFlow('compile', { title }));
            expect(refusal, title).toContain('notify title at config.title');
            expect(refusal, title).toContain('invalid template');
        }
    });

    it('past the doors, the executor refuses the single-brace token at its contract parse, and a hole that does not compile as a guard — nothing is sent', async () => {
        for (const [title, expected] of [
            ['Hello {record.name}', TEXT_SLOT_TEMPLATE_REFUSAL],
            ['Hello {{ record.name | bogus }}', 'invalid template hole'],
        ] as const) {
            const { engine, emitted } = harness();
            const stored = engine.registerFlow('past', notifyFlow('past', { title: 'Hello' }) as never);
            const node = stored.nodes.find((n) => n.id === 'notify')!;
            node.config = { ...node.config, title };
            const result = await engine.execute('past', ctx());
            expect(result.success, title).toBe(false);
            expect(String(result.error), title).toContain(expected);
            expect(emitted, title).toHaveLength(0);
        }
    });

    it('a fault handler names the caught error with `{{ $error.message }}` — a `$`-named variable is a hole path', async () => {
        const { engine, emitted } = harness();
        engine.registerNodeExecutor({
            type: 'boom',
            async execute() {
                return { success: false, error: 'connection refused' };
            },
        } as never);
        engine.registerFlow('faulty', {
            name: 'faulty', label: 'faulty', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'push', type: 'boom', label: 'Push' },
                { id: 'notify', type: 'notify', label: 'Notify', config: { recipients: ['user_1'], title: 'Push failed for {{ record.name }}', message: 'Reason: {{ $error.message }}' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'push' },
                { id: 'e2', source: 'push', target: 'end' },
                { id: 'e3', source: 'push', target: 'notify', type: 'fault' },
            ],
        } as never);
        await engine.execute('faulty', ctx());
        expect(emitted).toHaveLength(1);
        expect(emitted[0]!.payload).toMatchObject({ title: 'Push failed for Acme Corp', body: 'Reason: connection refused' });
    });

    it('a screen renders its title / description holes, and its `recordId` keeps the single-brace dialect', async () => {
        const { engine } = harness();
        engine.registerFlow('edit', {
            name: 'edit', label: 'edit', type: 'screen',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'form', type: 'screen', label: 'Edit', config: { objectName: 'account', mode: 'edit', recordId: '{record.id}', title: 'Edit {{ record.name }}', description: 'Tier {{ record.meta.tier | upper }}' } },
            ],
            edges: [{ id: 'e0', source: 'start', target: 'form' }],
        } as never);
        const paused = await engine.execute('edit', ctx());
        expect(paused.screen).toMatchObject({ title: 'Edit Acme Corp', description: 'Tier GOLD', recordId: 'rec_1' });
    });
});

describe('#22110 — renderTextSlot, the one text renderer', () => {
    const vars = (entries: Record<string, unknown>): VariableMap => new Map(Object.entries(entries));

    it('reads every flow variable as a root, a node output by its dotted key, an index either way', () => {
        const variables = vars({ record: ACME, 'lookup.result': 'found', rows: [{ subject: 'S0' }] });
        expect(renderTextSlot('{{ record.name }}|{{ lookup.result }}|{{ rows.0.subject }}|{{ rows[0].subject }}', variables))
            .toBe('Acme Corp|found|S0|S0');
    });

    it('lets a declared variable win over a flat key sharing its head, and never writes into a variable\'s object', () => {
        const record = { name: 'Acme Corp' };
        const scope = textTemplateScope(vars({ record, 'record.name': 'shadow', 'n1.out': 1 }));
        expect(renderTextSlot('{{ record.name }}', vars({ record, 'record.name': 'shadow' }))).toBe('Acme Corp');
        expect(record).toEqual({ name: 'Acme Corp' });
        expect(scope.n1).toEqual({ out: 1 });
    });

    it('renders absent in, absent out — and a slot rendering no text at all as nothing', () => {
        expect(renderTextSlot(undefined, vars({}))).toBeUndefined();
        expect(renderTextSlot('{{ missing }}', vars({}))).toBeUndefined();
        expect(renderTextSlot('[{{ missing }}]', vars({}))).toBe('[]');
    });

    it('measured against the 17.x interpolator: SAME on a string, number, boolean, null and an ISO date string, DIFF on a Date and a whole-slot object', () => {
        const old = (source: string, variables: VariableMap) =>
            stringifyForTemplate(interpolateString(source, variables, {} as AutomationContext));
        for (const value of ['Acme', 1234.5, 0, true, null, '2026-10-08']) {
            const variables = vars({ x: value });
            expect(renderTextSlot('v={{ x }}', variables), String(value)).toBe(old('v={x}', variables));
        }
        // The two inputs that make the path spelling lossy (ADR-0087 D2), so no
        // conversion rewrites `{x}` to `{{ x }}`: a Date rendered JSON-quoted…
        const date = new Date('2026-10-08T09:30:00.000Z');
        expect(old('v={x}', vars({ x: date }))).toBe('v="2026-10-08T09:30:00.000Z"');
        expect(renderTextSlot('v={{ x }}', vars({ x: date }))).toBe('v=2026-10-08T09:30:00.000Z');
        // …and a screen / end text that was one token holding an object rendered `String(value)`.
        expect(String(interpolateString('{x}', vars({ x: { a: 1 } }), {} as AutomationContext))).toBe('[object Object]');
        expect(renderTextSlot('{{ x }}', vars({ x: { a: 1 } }))).toBe('{"a":1}');
    });

    it('refuses a template that does not compile with a guard refusal, never a half-filled text', () => {
        for (const source of ['{{ a + b }}', '{{ x | bogus }}', '{{ x']) {
            let thrown: unknown;
            try {
                renderTextSlot(source, vars({ a: 1, b: 2, x: 'v' }));
            } catch (err) {
                thrown = err;
            }
            expect(thrown, source).toBeInstanceOf(FlowTextTemplateError);
            expect(isGuardRefusal(thrown), source).toBe(true);
        }
    });

    it('leaves a single-brace token as literal text — the doors refuse it before a run, so the renderer never reads it', () => {
        expect(renderTextSlot('Hello {record.name}', vars({ record: ACME }))).toBe('Hello {record.name}');
    });
});

/** This package's `src` — the runtime whose `$` variables the spec judge lists. */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A `$`-named variable bound by its literal name: `variables.set('$error', …)`. */
const DOLLAR_BINDING = /\.set\(\s*(['"`])(\$[A-Za-z_][\w$]*)\1/g;

/** Every `$`-named variable this package's runtime sources bind by literal name, with the file binding it. */
function engineBoundDollarVariables(): Map<string, string> {
    const out = new Map<string, string>();
    const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const path = join(dir, entry.name);
            if (entry.isDirectory()) walk(path);
            else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
                for (const match of readFileSync(path, 'utf8').matchAll(DOLLAR_BINDING)) {
                    if (!out.has(match[2]!)) out.set(match[2]!, path.slice(SRC.length + 1));
                }
            }
        }
    };
    walk(SRC);
    return out;
}

describe('#22477 — a text-slot hole may root only at a `$` variable the engine binds', () => {
    const bound = engineBoundDollarVariables();

    // A `$`-named variable this runtime starts binding must be admitted by the
    // spec's one list (`FLOW_ENGINE_VARIABLES` in `@objectstack/spec`'s
    // `flow-text-slot-template.ts`), or a text slot could not name it — add it
    // THERE. And one it stops binding must leave that list too, or a hole over
    // it would be admitted and render blank: that is what the floor below is
    // for — it fails on a removal, so delete the name from both places.
    it('the scan is not vacuous: it finds every `$` variable bound today', () => {
        expect([...bound.keys()].sort()).toEqual(
            expect.arrayContaining(['$error', '$flowLabel', '$flowName', '$loopIndex', '$loopItems', '$record', '$runId']),
        );
    });

    it('the spec judge admits a hole over every `$` variable this runtime binds — its list misses none', () => {
        for (const [name, file] of bound) {
            expect(textSlotTemplateRefusal(`{{ ${name} }}`), `${name}, bound in ${file}`).toBeUndefined();
        }
        // Control: the judge is not admitting every `$` hole.
        expect(bound.has('$User')).toBe(false);
        expect(textSlotTemplateRefusal('{{ $User.Id }}')).toBeDefined();
    });

    it('an admitted root renders its value — `$flowName`, `$flowLabel`, `$record` are bound for every run', async () => {
        const { engine, emitted } = harness();
        engine.registerFlow('roots', notifyFlow('roots', { title: '{{ $flowName }} / {{ $flowLabel }} / {{ $record.name }}' }) as never);
        const result = await engine.execute('roots', ctx());
        expect(result.success, JSON.stringify(result)).toBe(true);
        expect(emitted[0]!.payload).toMatchObject({ title: 'roots / roots / Acme Corp' });
    });

    it('registerFlow refuses `By {{ $User.Id }}` in a text slot with the remedy `{$User.Id}` gets — it would render `By `', () => {
        const { engine } = harness();
        const refusal = registrationRefusal(engine, 'by_user', notifyFlow('by_user', { title: 'Closed', message: 'By {{ $User.Id }}' }));
        expect(refusal).toBeDefined();
        expect(refusal).toContain("node 'notify' (notify) notify message at config.message");
        expect(refusal).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
        // The renderer it no longer reaches: the hole resolves to nothing.
        expect(renderTextSlot('By {{ $User.Id }}', new Map([['userId', 'usr_7']]))).toBe('By ');
    });

    // #19939 pass 2: the value slots refuse `{$User.Id}`, so the remedy above
    // computes the run user with the CEL scope's `current_user` — and it
    // renders the user, and nothing in a run with none (as the template did).
    it('the remedy renders the run user: an assignment of `current_user.id`, then `By {{ v }}`', async () => {
        const flow = (source: string) => ({
            name: 'by_user', label: 'by_user', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'who', type: 'assignment', label: 'Who', config: { assignments: { v: { dialect: 'cel', source } } } },
                { id: 'notify', type: 'notify', label: 'Notify', config: { recipients: ['user_1'], title: 'Closed', message: 'By {{ v }}' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'who' },
                { id: 'e2', source: 'who', target: 'notify' },
                { id: 'e3', source: 'notify', target: 'end' },
            ],
        });
        const withUser = harness();
        withUser.engine.registerFlow('by_user', flow('current_user.id') as never);
        expect((await withUser.engine.execute('by_user', ctx())).success).toBe(true);
        expect(withUser.emitted[0]!.payload).toMatchObject({ message: 'By usr_7' });

        const userless = harness();
        userless.engine.registerFlow('by_user', flow('current_user != null ? current_user.id : null') as never);
        const noUser = { event: 'manual', object: 'account', record: ACME } as unknown as AutomationContext;
        expect((await userless.engine.execute('by_user', noUser)).success).toBe(true);
        expect(userless.emitted[0]!.payload).toMatchObject({ message: 'By ' });
    });
});
