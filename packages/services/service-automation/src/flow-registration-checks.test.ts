// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';

/**
 * The registration pass's advisory schema check (#1928) types a flow's
 * conditions against ONE object. For a time-relative flow that object is the
 * one the run binds — `config.timeRelative.object` when it is a string, the
 * start node's `config.objectName` only otherwise (`deriveTriggerBinding`) —
 * because the sweep launches each run with a row of THAT object as its record
 * (#30396). A start whose `objectName` names another object is refused at
 * publish (`flow-time-relative-object-mismatch`), but a flow stored before
 * that rule still registers, so the advisory must point at the scanned object.
 */
function loggerCapturing(warns: string[]) {
    const l: any = {
        info: () => {}, error: () => {}, debug: () => {},
        warn: (m: string) => warns.push(m),
        child: () => l,
    };
    return l;
}

const SCHEMAS: Record<string, { fields: string[]; fieldTypes: Record<string, string> }> = {
    // The start node's objectName in the two-object flow — NOT what the run binds.
    crm_account: { fields: ['industry'], fieldTypes: { industry: 'text' } },
    // The swept object: every run's record is one of its rows.
    crm_contract: { fields: ['end_date', 'renewal_status'], fieldTypes: { end_date: 'date', renewal_status: 'select' } },
};

function timeRelativeFlow(condition: string, startObject: string | undefined) {
    return {
        name: 'renewal_alert', label: 'Renewal Alert', type: 'schedule',
        nodes: [
            {
                id: 'start', type: 'start', label: 'Start',
                config: {
                    ...(startObject ? { objectName: startObject } : {}),
                    timeRelative: { object: 'crm_contract', dateField: 'end_date', offsetDays: [30] },
                    schedule: { type: 'cron', expression: '0 8 * * *' },
                },
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

function register(flow: unknown): string[] {
    const warns: string[] = [];
    const engine = new AutomationEngine(loggerCapturing(warns));
    engine.setObjectSchemaResolver((name) => SCHEMAS[name]);
    expect(() => engine.registerFlow('renewal_alert', flow as never)).not.toThrow();
    return warns.filter((m) => /unknown field|did you mean|type mismatch/i.test(m));
}

describe('registration advisory: a time-relative flow is typed against the swept object (#30396)', () => {
    it('a stored two-object flow: a field of the swept object passes', () => {
        expect(register(timeRelativeFlow('record.renewal_status == "pending"', 'crm_account'))).toEqual([]);
    });

    it('a stored two-object flow: a field only the start node\'s objectName has warns', () => {
        const warns = register(timeRelativeFlow('record.industry == "tech"', 'crm_account'));
        expect(warns).toHaveLength(1);
        expect(warns[0]).toMatch(/unknown field `industry`/);
    });

    it('a one-object flow (objectName equals timeRelative.object) is unchanged', () => {
        expect(register(timeRelativeFlow('record.renewal_status == "pending"', 'crm_contract'))).toEqual([]);
        expect(register(timeRelativeFlow('record.renewl_status == "pending"', 'crm_contract')).join('\n'))
            .toMatch(/unknown field `renewl_status`/);
    });

    it('a sweep-only flow (no objectName) is typed against the swept object', () => {
        expect(register(timeRelativeFlow('record.renewal_status == "pending"', undefined))).toEqual([]);
        expect(register(timeRelativeFlow('record.industry == "tech"', undefined)).join('\n'))
            .toMatch(/unknown field `industry`/);
    });
});
