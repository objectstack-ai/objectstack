// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33435] A `publish-drafts` batch that carries a draft of a flow's or hook's
 * own object: `mergePendingDeclarations` replaces the served object with the
 * draft body, which is stored without the injected system columns, so the
 * gate judges the flow or hook over the object as authored. The lint's
 * flow/hook null guard now adds the injected columns such an object does not
 * carry, so the batch refuses the same unguarded ordering the single-item
 * publish refuses over the served object (it accepted it before).
 */

import { describe, expect, it } from 'vitest';
import { applyInjectedSystemColumns } from '@objectstack/metadata-core';
import { evaluateRuntimeAuthoringGate } from './runtime-authoring-gate.js';

const account = {
    name: 'crm_account',
    label: 'Account',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
};
const served = applyInjectedSystemColumns(account);

const flowOn = (condition: string) => ({
    name: 'route_owner',
    label: 'Route owner',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_account', triggerType: 'record-after-create', condition } },
        { id: 'done', type: 'end', label: 'Done' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'done' }],
});
const hookOn = (condition: string) => ({
    name: 'stamp_probe', object: 'crm_account', events: ['beforeInsert'], condition,
    body: { language: 'js', source: 'return;' },
});

type Write = { type: 'flow' | 'hook'; body: { name: string } };
const judge = ({ type, body }: Write, pendingObjects?: unknown[]) => {
    const err = evaluateRuntimeAuthoringGate({
        type, name: body.name, state: 'active', body,
        objects: [served],
        ...(pendingObjects ? { pending: { objects: pendingObjects } } : {}),
    }).error as (Error & { issues?: Array<{ message: string }> }) | null;
    return (err?.issues ?? []).map((i) => i.message).filter((m) => m.includes('declares as nullable'));
};

describe('[#33435] a publish-drafts batch holding the object\'s own draft judges the injected columns as the single-item publish does', () => {
    const cases: Array<[string, Write, string]> = [
        ['a flow start condition over `owner_id`', { type: 'flow', body: flowOn("record.owner_id > 'a'") }, '`record.owner_id`'],
        ['a `beforeInsert` hook condition over `created_at`', { type: 'hook', body: hookOn("record.created_at > timestamp('2025-01-01T00:00:00Z')") }, '`record.created_at`'],
    ];
    for (const [title, write, column] of cases) {
        it(`${title}: refused with the object's draft in the batch, as over the served object`, () => {
            const single = judge(write);
            expect(single, 'the single-item publish refuses it over the served object').toHaveLength(1);
            expect(single[0]).toContain(column);
            expect(judge(write, [structuredClone(account)])).toEqual(single);
        });
    }

    it('CONTROL: the guarded spelling publishes with the object\'s draft in the batch', () => {
        const write: Write = { type: 'flow', body: flowOn("record.owner_id != null && record.owner_id > 'a'") };
        expect(judge(write, [structuredClone(account)])).toEqual([]);
    });
});
