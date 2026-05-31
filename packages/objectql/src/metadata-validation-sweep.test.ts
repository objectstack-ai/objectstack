// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Metadata validation sweep — proves that every overlay-writable metadata
 * type is now gated by its canonical Zod schema (the single registry that
 * lives in `@objectstack/spec/kernel/metadata-type-schemas`).
 *
 * For each type listed in `DEFAULT_METADATA_TYPE_REGISTRY` with
 * `allowRuntimeCreate: true`, we run two save attempts through the SAME
 * code path the browser hits (REST → `saveMetaItem` → `resolveOverlaySchema`):
 *
 *   1. A spec-conformant payload  →  expect `success: true`.
 *   2. A deliberately broken payload (missing required field) →
 *      expect `invalid_metadata` + status 422 + structured `issues[]`.
 *
 * Types without a Zod schema in the central registry (`function`,
 * `service`, `router`, plugin-only types like `theme`/`api`/`webhook`) are
 * still expected to pass through unvalidated — that is the documented
 * fall-through, not a regression. We pin it explicitly so any future
 * coverage gap is visible in the report.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SchemaRegistry } from './registry.js';
import {
    DEFAULT_METADATA_TYPE_REGISTRY,
    getMetadataTypeSchema,
} from '@objectstack/spec/kernel';

function makeProtocol() {
    const registry = new SchemaRegistry({ multiTenant: false });
    const mockEngine: any = {
        registry,
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue({ id: 'new-uuid' }),
        update: vi.fn().mockResolvedValue({ id: 'existing-uuid' }),
        delete: vi.fn().mockResolvedValue({ deleted: 1 }),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue([]),
    };
    return new ObjectStackProtocolImplementation(mockEngine);
}

interface Fixture {
    valid: any;
    invalid: any;
    /** Field name the invalid payload removes (for human-readable assertion). */
    invalidatedField: string;
}

const FIXTURES: Record<string, Fixture> = {
    object: {
        valid: {
            name: 'sweep_account',
            label: 'Account',
            fields: { amount: { name: 'amount', label: 'Amount', type: 'number' } },
        },
        invalid: { label: 'No Name' },
        invalidatedField: 'name',
    },
    field: {
        valid: { name: 'sweep_amount', label: 'Amount', type: 'number' },
        invalid: { name: 'sweep_amount', label: 'Amount' },
        invalidatedField: 'type',
    },
    hook: {
        valid: {
            name: 'sweep_hook',
            object: 'sweep_account',
            events: ['beforeInsert'],
        },
        invalid: { name: 'sweep_hook', object: 'sweep_account' },
        invalidatedField: 'events',
    },
    validation: {
        valid: {
            name: 'sweep_rule',
            type: 'script',
            message: 'Amount must be positive',
            condition: 'record.amount < 0',
        },
        invalid: { name: 'sweep_rule', message: 'X' },
        invalidatedField: 'type',
    },
    view: {
        valid: {
            list: {
                type: 'grid',
                data: { provider: 'object', object: 'sweep_account' },
                columns: [{ field: 'amount' }],
            },
        },
        invalid: {
            list: {
                type: 'grid',
                data: { provider: 'object', object: 'sweep_account' },
            },
        },
        invalidatedField: 'columns',
    },
    page: {
        valid: {
            name: 'sweep_page',
            label: 'Sweep Page',
            type: 'record',
            regions: [{ name: 'main', components: [] }],
        },
        invalid: { label: 'No Name' },
        invalidatedField: 'name',
    },
    dashboard: {
        valid: { name: 'sweep_dash', label: 'Sweep', widgets: [] },
        invalid: { name: 'sweep_dash', label: 'Sweep', widgets: 'not-an-array' },
        invalidatedField: 'widgets',
    },
    app: {
        valid: { name: 'sweep_app', label: 'Sweep' },
        invalid: { name: 'BadCaseApp', label: 'Bad' },
        invalidatedField: 'name',
    },
    action: {
        valid: { name: 'sweep_action', label: 'Do it', type: 'script', target: 'do_it' },
        invalid: { label: 'No name' },
        invalidatedField: 'name',
    },
    report: {
        valid: {
            name: 'sweep_report',
            label: 'Sweep',
            objectName: 'sweep_account',
            columns: [{ field: 'amount', label: 'Amount' }],
        },
        invalid: { name: 'sweep_report', label: 'Sweep' },
        invalidatedField: 'objectName',
    },
    flow: {
        valid: {
            name: 'sweep_flow',
            label: 'Sweep',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        },
        invalid: { name: 'sweep_flow', label: 'Sweep' },
        invalidatedField: 'type',
    },
    workflow: {
        // `workflow` is the state-machine schema (StateMachineSchema): id +
        // initial + states. (The legacy workflow-rule shape was retired.)
        valid: {
            name: 'sweep_wf',
            id: 'sweep_wf',
            initial: 'open',
            states: { open: { type: 'final' } },
        },
        invalid: { name: 'sweep_wf', id: 'sweep_wf', initial: 'open' },
        invalidatedField: 'states',
    },
    approval: {
        valid: {
            name: 'sweep_approval',
            label: 'Sweep',
            object: 'sweep_account',
            steps: [
                {
                    name: 's1',
                    label: 'Step 1',
                    approvers: [{ type: 'user', value: 'u1' }],
                },
            ],
        },
        invalid: { name: 'sweep_approval', label: 'Sweep' },
        invalidatedField: 'object',
    },
    job: {
        valid: {
            name: 'sweep_job',
            label: 'Sweep',
            schedule: { type: 'cron', expression: '0 * * * *' },
            handler: 'do_it',
        },
        invalid: { name: 'sweep_job', label: 'Sweep' },
        invalidatedField: 'handler',
    },
    translation: {
        valid: {
            app: { sweep_app: { label: 'Sweep' } },
            messages: { hello: 'Hello' },
        },
        invalid: { app: 'not-a-record' },
        invalidatedField: 'app',
    },
    email_template: {
        valid: {
            name: 'sweep.welcome',
            label: 'Welcome',
            subject: 'Hi',
            bodyHtml: '<p>Hello</p>',
        },
        invalid: { name: 'sweep.welcome', label: 'Welcome' },
        invalidatedField: 'subject',
    },
    permission: {
        valid: { name: 'sweep_perm', label: 'Sweep', objects: {} },
        invalid: { label: 'No name', objects: {} },
        invalidatedField: 'name',
    },
    profile: {
        valid: { name: 'sweep_profile', label: 'Sweep', isProfile: true, objects: {} },
        invalid: { label: 'No name', isProfile: true, objects: {} },
        invalidatedField: 'name',
    },
    role: {
        valid: { name: 'sweep_role', label: 'Sweep' },
        invalid: { label: 'No name' },
        invalidatedField: 'name',
    },
    agent: {
        valid: {
            name: 'sweep_agent',
            label: 'Sweep',
            role: 'Sweep test agent',
            instructions: 'be helpful',
            model: { provider: 'openai', model: 'gpt-4o-mini' },
        },
        invalid: { name: 'sweep_agent', label: 'Sweep' },
        invalidatedField: 'instructions',
    },
    tool: {
        valid: {
            name: 'sweep_tool',
            label: 'Sweep',
            description: 'Sweep tool',
            parameters: { type: 'object', properties: {} },
        },
        invalid: { name: 'sweep_tool', label: 'Sweep' },
        invalidatedField: 'description',
    },
    skill: {
        valid: {
            name: 'sweep_skill',
            label: 'Sweep',
            description: 'Sweep skill',
            tools: ['sweep_tool'],
        },
        invalid: { name: 'sweep_skill', label: 'Sweep' },
        invalidatedField: 'description',
    },
};

interface Row {
    type: string;
    hasSchema: boolean;
    validOk: 'ok' | 'fail' | '-';
    invalidRejected: 'ok' | 'fail' | '-';
    note?: string;
}

async function runOne(type: string, fx: Fixture | undefined): Promise<Row> {
    const protocol = makeProtocol();
    const schema = getMetadataTypeSchema(type);
    const hasSchema = !!schema;

    if (!fx) {
        return { type, hasSchema, validOk: '-', invalidRejected: '-', note: 'no fixture (skipped)' };
    }

    let validOk: Row['validOk'] = 'fail';
    let validNote = '';
    try {
        const res = await protocol.saveMetaItem({
            type,
            name: fx.valid.name ?? `sweep_${type}`,
            item: fx.valid,
        });
        if (res?.success) validOk = 'ok';
        else validNote = `save returned ${JSON.stringify(res)}`;
    } catch (e: any) {
        validNote = `${e?.code ?? 'error'}: ${e?.message ?? String(e)}`;
    }

    let invalidRejected: Row['invalidRejected'] = 'fail';
    let invalidNote = '';
    try {
        await protocol.saveMetaItem({
            type,
            name: fx.invalid.name ?? 'sweep_invalid',
            item: fx.invalid,
        });
        invalidNote = hasSchema ? 'expected 422 but save succeeded' : 'no schema → fall-through (OK)';
        invalidRejected = hasSchema ? 'fail' : 'ok';
    } catch (e: any) {
        if (e?.code === 'invalid_metadata' && e?.status === 422 && Array.isArray(e?.issues)) {
            invalidRejected = 'ok';
        } else {
            invalidNote = `unexpected error: ${e?.code ?? 'unknown'} ${e?.status ?? ''} ${e?.message ?? ''}`;
        }
    }

    const note = [validNote && `valid: ${validNote}`, invalidNote && `invalid: ${invalidNote}`]
        .filter(Boolean)
        .join(' | ');
    return { type, hasSchema, validOk, invalidRejected, note: note || undefined };
}

describe('Metadata validation sweep — every type honours the central Zod registry', () => {
    const creatable = DEFAULT_METADATA_TYPE_REGISTRY
        .filter((e) => e.allowRuntimeCreate)
        .map((e) => e.type)
        .sort();

    const results: Row[] = [];

    it('runs all runtime-creatable types and prints a coverage table', async () => {
        for (const type of creatable) {
            const row = await runOne(type, FIXTURES[type]);
            results.push(row);
        }

        const header = ['type', 'schema', 'valid→200', 'invalid→422', 'note'];
        const widths = header.map((h) => h.length);
        const rows = results.map((r) => [
            r.type,
            r.hasSchema ? 'yes' : 'no',
            r.validOk,
            r.invalidRejected,
            r.note ?? '',
        ]);
        for (const r of rows) r.forEach((c, i) => (widths[i] = Math.max(widths[i], c.length)));
        const fmt = (cells: string[]) =>
            cells.map((c, i) => c.padEnd(widths[i])).join('  ');

        // eslint-disable-next-line no-console
        console.log('\n' + fmt(header));
        // eslint-disable-next-line no-console
        console.log(widths.map((w) => '-'.repeat(w)).join('  '));
        // eslint-disable-next-line no-console
        for (const r of rows) console.log(fmt(r));

        const failed = results.filter(
            (r) => r.validOk === 'fail' || r.invalidRejected === 'fail',
        );
        expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    });
});
