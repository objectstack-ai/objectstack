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
 *      expect `invalid_metadata` + status 422 + structured `issues[]`, and
 *      (#19586) the refusal must be the SCHEMA's, naming the broken field —
 *      never an author-time gate rule, which throws the same envelope.
 *
 * Types without a Zod schema in the central registry (today only
 * `rag_pipeline` among the URL-map kinds — `theme`/`webhook` and their
 * siblings all resolve schemas via `UNREGISTERED_KIND_SCHEMAS` since
 * #6245/#10194) are still expected to pass through unvalidated — that is
 * the documented fall-through, not a regression. We pin it explicitly so any
 * future coverage gap is visible in the report.
 *
 * [#5271] `api` LEFT that bucket. It was the specimen this paragraph named
 * while `PUT /meta/api/:name` stored arbitrary JSON (#5206); it became a
 * registered kind with `ApiEndpointSchema` bound, and was swept like any other
 * runtime-creatable type.
 *
 * [#5488] `api` has now left this SUITE altogether, and by a different door:
 * the maintainer ruling of 2026-08-07 flipped its registry entry to
 * `allowRuntimeCreate: false` (a runtime-created endpoint was never served —
 * the matcher reads `listForIndex('api')`, a runtime write lands in
 * `sys_metadata`). Since `creatable` below is DERIVED from that flag, the type
 * drops out on its own and its fixture was removed with it. Nothing about the
 * fall-through rule changed; the set it applies to did.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import {
    DEFAULT_METADATA_TYPE_REGISTRY,
    getMetadataTypeSchema,
} from '@objectstack/spec/kernel';

function makeProtocol() {
    const registry = new SchemaRegistry({ multiTenant: false });
    // [#19542] The live resolution universe this harness hands the runtime
    // publish gate. `find` is mocked to `[]` and nothing is ever read back, so
    // without this seed the universe is permanently EMPTY — and since the
    // report door opened, a `report` fixture must bind a dataset (ReportSchema
    // refines it to required) that something can actually resolve. Seeding it
    // here rather than saving it first is deliberate and matches the landed
    // pattern in `protocol.dashboard-dataset-publish-gate.test.ts`: `creatable`
    // below is SORTED, so a saved-first arrangement would silently depend on
    // alphabetical order, and this harness never reads saves back anyway.
    //
    // ⛔ This is a TENANT the fixtures are judged against, not a relaxation:
    // a report binding a dataset nobody declares is still refused, which is the
    // #19542 door working. The dimension and measure names are exactly what the
    // `report` fixture's `rows` / `values` select.
    //
    // [#19586] The OBJECT that dataset is over joins it, for the same reason
    // one door further on: since the dataset door opened (#19143) a dataset's
    // `object` resolves against this universe, and with nothing registered the
    // `dataset` fixture was refused `object-reference-unknown` on
    // `datasets.sweep_account_metrics.object` — the refusal that kept this
    // type's row at `no fixture (skipped)`. Both seeds are the `valid` fixtures
    // themselves, cloned, so the tenant cannot drift from what the `object` and
    // `dataset` rows publish: the rows judge a document, the seeds are the
    // tenant it is judged in. ⛔ Still not a relaxation: a dataset over an object
    // this tenant does not declare is refused exactly as before.
    registry.registerObject(structuredClone(FIXTURES.object.valid));
    registry.registerItem('dataset', structuredClone(FIXTURES.dataset.valid));
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
    /**
     * The field the invalid payload breaks. ASSERTED, not just printed
     * (#19586): the 422 counts only when the schema's own issue names this
     * field, at the top level or as the last segment of a nested path.
     */
    invalidatedField: string;
}

const FIXTURES: Record<string, Fixture> = {
    object: {
        valid: {
            name: 'sweep_account',
            label: 'Account',
            // [#8310] The runtime object door requires an authored OWD
            // (`security-owd-unset` refuses absence), so a "valid" object
            // fixture must author its posture.
            sharingModel: 'private',
            // [#19542] `stage` joins `amount` so the dataset seeded into this
            // harness's live universe is COHERENT with the object this tenant
            // declares — its one dimension is over a field `sweep_account` really
            // has. The `report` fixture groups by that dimension.
            fields: {
                amount: { name: 'amount', label: 'Amount', type: 'number' },
                stage: { name: 'stage', label: 'Stage', type: 'text' },
            },
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
        // The invalid probe breaks `label`, not `name`: an ungrammatical item
        // name is refused by the #12194 grammar door (INVALID_REQUEST 400)
        // BEFORE the central Zod registry runs, so a bad name can no longer
        // prove the schema gate this sweep exists to prove. The name-grammar
        // refusal has its own pins in metadata-protocol.
        invalid: { name: 'sweep_app_bad', label: 123 },
        invalidatedField: 'label',
    },
    action: {
        valid: { name: 'sweep_action', label: 'Do it', type: 'script', target: 'do_it' },
        invalid: { label: 'No name' },
        invalidatedField: 'name',
    },
    // [#19586] Runtime-creatable since the #19143 door, and until this fixture
    // its row printed `no fixture (skipped)`. The valid document is the
    // tenant's own dataset over `sweep_account`. `makeProtocol` seeds that
    // object, and seeds this dataset from this fixture for the `report`
    // row. The invalid one is the same document minus `measures`, so the only
    // thing the schema can refuse it for is `measures`, and `runOne` asserts
    // that it is the schema refusing, never a gate rule on `object`.
    dataset: {
        valid: {
            name: 'sweep_account_metrics',
            label: 'Account Metrics',
            object: 'sweep_account',
            dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
            measures: [{ name: 'amount_sum', label: 'Amount', aggregate: 'sum', field: 'amount' }],
        },
        invalid: {
            name: 'sweep_account_metrics',
            label: 'Account Metrics',
            object: 'sweep_account',
            dimensions: [{ name: 'stage', label: 'Stage', field: 'stage', type: 'string' }],
        },
        invalidatedField: 'measures',
    },
    report: {
        // ADR-0021 single-form: a report binds a dataset + selects values by name.
        // The bound dataset is the fixture directly above (seeded from it into
        // every harness's universe by `makeProtocol`), and its dimension and
        // measure names are what `rows` / `values` select.
        valid: {
            name: 'sweep_report',
            label: 'Sweep',
            type: 'summary',
            dataset: 'sweep_account_metrics',
            rows: ['stage'],
            values: ['amount_sum'],
        },
        invalid: { name: 'sweep_report', label: 'Sweep' },
        invalidatedField: 'dataset',
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
    // ADR-0020: `workflow` retired as a metadata type — record state
    // machines are now a `state_machine` validation rule on the object
    // (covered by rule-validator.test.ts), so there is no standalone
    // `workflow` fixture here.
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
            locale: 'en',
            apps: { sweep_app: { label: 'Sweep' } },
            messages: { hello: 'Hello' },
        },
        // `locale` is required — omitting it is the realistic authoring miss
        // (the sync silently skips a locale-less item, so the door catches it).
        invalid: { apps: { sweep_app: { label: 'Sweep' } } },
        invalidatedField: 'locale',
    },
    // [#5488] The `api` fixture (#5271) was REMOVED here, deliberately, rather
    // than left in place. This suite sweeps `DEFAULT_METADATA_TYPE_REGISTRY
    // .filter((e) => e.allowRuntimeCreate)`, so flipping `api` to
    // `allowRuntimeCreate: false` (maintainer ruling 2026-08-07) drops the type
    // out of `creatable` by itself — and a fixture for a type the sweep no
    // longer visits is never executed. It would have gone on sitting here
    // looking like coverage while asserting nothing, which is the failure mode
    // this file exists to detect in others. `api`'s write door now has explicit
    // pins of its own: the 403 `NOT_CREATABLE` refusal in
    // `protocol-meta.test.ts` and `sys-metadata-repository.test.ts` (this
    // package), and the retirement pins in `metadata-protocol`.
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
        valid: { name: 'sweep_profile', label: 'Sweep', objects: {} },
        invalid: { label: 'No name', objects: {} },
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
        // [#19586] `tools`, not `description`: the payload drops both, but
        // `description` is optional on a skill, and the schema's only issue is
        // at `tools`. The label named a field whose absence refuses nothing,
        // and nothing read it until the assertion above started to.
        invalidatedField: 'tools',
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
        if (e?.code === 'INVALID_METADATA' && e?.status === 422 && Array.isArray(e?.issues)) {
            // [#19586] The envelope alone cannot say WHICH door refused: the
            // runtime author-time gate throws the very same `INVALID_METADATA` /
            // 422 / `issues[]`. A broken fixture refused there — say for an
            // `object-reference-unknown` in this harness's small universe —
            // would read `ok` while proving nothing about the schema. So the
            // refusal counts only when it is the SCHEMA's and names the field
            // the fixture broke: a gate issue always carries its `rule` and a
            // stack-rooted path (`datasets.NAME.object`), a schema issue carries
            // neither.
            const issues: any[] = e.issues;
            const gateRules = issues.map((i) => i?.rule).filter(Boolean);
            const named = issues.some(
                (i) => !i?.rule
                    && typeof i?.path === 'string'
                    && (i.path === fx.invalidatedField || i.path.endsWith(`.${fx.invalidatedField}`)),
            );
            if (gateRules.length === 0 && named) invalidRejected = 'ok';
            else invalidNote = `422 is not the schema refusing \`${fx.invalidatedField}\`: ${JSON.stringify(issues)}`;
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
