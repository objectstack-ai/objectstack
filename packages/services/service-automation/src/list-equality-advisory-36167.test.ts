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

    function makeFlow(condition: string) {
        return {
            name: 'ticket_flow', label: 'Ticket Flow', type: 'record_change',
            nodes: [
                { id: 'start', type: 'start', label: 'Start', config: { objectName: 'ticket' } },
                { id: 'check', type: 'decision', label: 'Check', config: { condition } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'check' },
                { id: 'e2', source: 'check', target: 'end' },
            ],
        };
    }

    function warningsFor(condition: string): string[] {
        const warns: string[] = [];
        const engine = new AutomationEngine(loggerCapturing(warns));
        engine.setObjectSchemaResolver((name) => (name === 'ticket' ? parseObjectFieldSchema(TICKET_FIELDS) : undefined));
        expect(() => engine.registerFlow('ticket_flow', makeFlow(condition) as any)).not.toThrow();
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

    it.each(["record.stage == 'won'", "record.owner == 'u1'", 'record.watchers != null', "'u1' in record.watchers"])(
        'CONTROL — %s is not reported',
        (condition) => {
            expect(warningsFor(condition)).toEqual([]);
        },
    );
});
