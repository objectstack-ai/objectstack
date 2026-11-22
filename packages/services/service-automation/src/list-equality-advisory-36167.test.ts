// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36167] `registerFlow`'s schema-aware pass hands the shared validator the
 * object's list-valued fields: `parseObjectFieldSchema` reads each field
 * through `isMultiValueField` into `multiValueFields`, and the flow-condition
 * hint carries it, so a `record.<list field> == <scalar>` condition — which
 * answers one constant on every row — is reported on the advisory channel
 * (logged, never thrown, like every other finding of that pass).
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import { parseObjectFieldSchema } from './plugin.js';

const TICKET_FIELDS = {
    name: { type: 'text' },
    labels: { type: 'multiselect' },
    stage: { type: 'select' },
    watchers: { type: 'user', multiple: true },
    owner: { type: 'user' },
};

describe('parseObjectFieldSchema — multiValueFields', () => {
    it('lists the inherently-multi types and the multi-capable types declared multiple, nothing else', () => {
        expect(parseObjectFieldSchema(TICKET_FIELDS)?.multiValueFields).toEqual(['labels', 'watchers']);
        expect(parseObjectFieldSchema([{ name: 'tags', type: 'tags' }, { name: 'stage', type: 'select', multiple: false }])?.multiValueFields)
            .toEqual(['tags']);
    });
});

describe('registerFlow — a list compared with a scalar is reported (advisory)', () => {
    function loggerCapturing(warns: string[]) {
        const l: any = {
            info: () => {}, error: () => {}, debug: () => {},
            warn: (m: string) => warns.push(m),
            child: () => l,
        };
        return l;
    }

    /** A record-triggered flow by default; `entrance` swaps in a flow no record write fires. */
    function makeFlow(condition: string, entrance: { type: string; triggerType?: string } = { type: 'record_change', triggerType: 'record-after-update' }) {
        return {
            name: 'ticket_flow', label: 'Ticket Flow', type: entrance.type,
            nodes: [
                {
                    id: 'start', type: 'start', label: 'Start',
                    config: { objectName: 'ticket', ...(entrance.triggerType ? { triggerType: entrance.triggerType } : {}) },
                },
                { id: 'check', type: 'decision', label: 'Check', config: { condition } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                { id: 'e2', source: 'check', target: 'end' },
            ],
        };
    }

    function warningsFor(condition: string, entrance?: { type: string; triggerType?: string }): string[] {
        const warns: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(warns));
        engine.setObjectSchemaResolver((name) => (name === 'ticket' ? parseObjectFieldSchema(TICKET_FIELDS) : undefined));
        expect(() => engine.registerFlow('ticket_flow', makeFlow(condition, entrance) as any)).not.toThrow();
        return warns.filter((m) => /holds a list/.test(m));
    }

    it.each([
        ["record.labels == 'frontend'", 'record.labels'],
        ["record.watchers != 'u1'", 'record.watchers'],
    ])('reports %s, naming the field and `in`', (condition, reference) => {
        const w = warningsFor(condition);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain(`\`${reference}\` holds a list`);
        expect(w[0]).toContain(` in ${reference}`);
    });

    // A bare name at a flow condition is the flattened trigger record's field.
    it.each([
        ["labels == 'frontend'", 'labels'],
        ["'u1' != watchers", 'watchers'],
    ])('reports the bare %s, naming the field and `in`', (condition, reference) => {
        const w = warningsFor(condition);
        expect(w).toHaveLength(1);
        expect(w[0]).toContain(`\`${reference}\` holds a list`);
        expect(w[0]).toContain(` in ${reference}`);
    });

    it('the bare rewrite it prescribes is parenthesised whole, and is not reported itself', () => {
        const [w] = warningsFor("stage == 'won' && labels != 'frontend'");
        expect(w).toContain('write `(labels == null || !("frontend" in labels))`');
        expect(warningsFor("stage == 'won' && (labels == null || !(\"frontend\" in labels))")).toEqual([]);
    });

    // A flow no record write fires runs on what its entrance handed it: the
    // names are not proven to be the ticket's fields, so no verdict.
    it.each([
        ['an API flow', { type: 'api', triggerType: 'api' }],
        ['a scheduled flow', { type: 'schedule', triggerType: 'schedule' }],
        ['a trigger-less autolaunched flow', { type: 'autolaunched' }],
    ])('CONTROL — %s: neither the bare nor the record. read is reported', (_label, entrance) => {
        expect(warningsFor("labels == 'frontend'", entrance)).toEqual([]);
        expect(warningsFor("record.labels == 'frontend'", entrance)).toEqual([]);
    });

    it.each([
        "record.stage == 'won'", "record.owner == 'u1'", 'record.watchers != null', "'u1' in record.watchers",
        "stage == 'won'", "owner == 'u1'", 'labels != null', "'frontend' in labels",
    ])(
        'CONTROL — %s is not reported',
        (condition) => {
            expect(warningsFor(condition)).toEqual([]);
        },
    );
});

describe('the premise at a flow condition — the run flattens the record, and a bare list compared with a scalar is a constant', () => {
    const engine = new AutomationEngine({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as any);
    const run = (source: string, labels: unknown) =>
        engine.evaluateCondition(source, new Map<string, unknown>([['labels', labels], ['record', { labels }]]));
    it.each([[['frontend', 'qa']], [['frontend']], [[]], [null]])('labels = %j', (labels) => {
        expect(run("labels == 'frontend'", labels)).toBe(false);
        expect(run("record.labels == 'frontend'", labels)).toBe(false);
        expect(run("labels != 'frontend'", labels)).toBe(true);
    });
    it('CONTROL — the prescribed bare rewrites answer per row, inside `&&` too', () => {
        const member = '(labels != null && "frontend" in labels)';
        const notMember = '(labels == null || !("frontend" in labels))';
        for (const [labels, isMember] of [[['frontend', 'qa'], true], [['qa'], false], [[], false], [null, false]] as const) {
            expect(run(member, labels)).toBe(isMember);
            expect(run(notMember, labels)).toBe(!isMember);
            expect(run(`true && ${notMember}`, labels)).toBe(!isMember);
            expect(run(`false && ${notMember}`, labels)).toBe(false);
        }
    });
});
