// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0010 · ADR-0130 D4] The build door and the boot agree on which
 * top-level items of a `packages[]` stack are its RESIDUAL, so the owner-stamp
 * judge refuses a residual's foreign `_packageId` at both doors or at neither.
 *
 * The boot's answer is {@link unclaimedTopLevel} (this package), and the
 * metadata door registers exactly those items under the stack's `manifest.id`
 * (`MetadataPlugin.registerUnclaimedTopLevel`), judging each stamp. The build
 * door is the stack schema's refinement (`applyCollectionItemOwnerStampGate`,
 * `@objectstack/spec`), which cannot import this package and so mirrors the
 * rule. This file is where both are reachable, and it holds the mirror equal:
 *
 *  - collection by collection over `OWNER_STAMP_JUDGED_COLLECTIONS`, one
 *    foreign-stamped top-level item that no body declares: the build door
 *    raises the judge's issue exactly when `unclaimedTopLevel` lists the item,
 *    and the metadata door refuses exactly those;
 *  - view containers, body shape by top-level shape: a container is claimed by
 *    the object it binds to however the binding is spelled.
 */

import { describe, it, expect } from 'vitest';
import { composeStacks, defineStack, ObjectStackDefinitionSchema } from '@objectstack/spec';
import { OWNER_STAMP_JUDGED_COLLECTIONS, type OwnerStampJudgedCollection } from '@objectstack/spec/kernel';
import { MetadataPlugin, unclaimedTopLevel } from './plugin.js';

const CRM = 'com.probe.crm';
const ORDERS = 'com.probe.orders';
const FOREIGN = 'com.probe.foreign';

const manifest = (id: string, namespace: string) => ({ id, name: namespace, namespace, version: '1.0.0', type: 'module' as const });

const PROBE_OBJECT = {
    name: 'probe_thing',
    label: 'Thing',
    sharingModel: 'private',
    ownership: 'user',
    fields: { title: { type: 'text', label: 'Title' } },
};
const OTHER_OBJECT = { ...PROBE_OBJECT, name: 'probe_other', label: 'Other' };

const probeFlow = {
    name: 'probe_flow',
    label: 'Flow',
    type: 'autolaunched',
    nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
};
const probeDataset = {
    name: 'probe_ds',
    label: 'Dataset',
    object: 'probe_thing',
    dimensions: [{ name: 'title', field: 'title', type: 'string' }],
    measures: [{ name: 'row_count', aggregate: 'count' }],
};
const probeQueue = { name: 'probe_queue', label: 'Queue', members: [] };
const listOf = (object: string) => ({ type: 'grid', data: { provider: 'object', object }, columns: ['title'] });

/**
 * One spec-valid item per judged collection, and what else the stack needs for
 * it to resolve. Keyed by the constant's member type, so a collection added to
 * the constant does not compile here until it has a fixture.
 */
const JUDGED_FIXTURES: Record<OwnerStampJudgedCollection, { item: Record<string, unknown>; context?: Record<string, unknown> }> = {
    objects: { item: { ...PROBE_OBJECT, name: 'probe_extra', label: 'Extra' } },
    apps: { item: { name: 'probe_app', label: 'App', navigation: [{ id: 'nav_1', type: 'object', objectName: 'probe_thing', label: 'Thing' }] } },
    picklists: { item: { name: 'probe_pick', label: 'Pick', options: [{ value: 'aa', label: 'A' }] } },
    actions: { item: { name: 'probe_go', label: 'Go', type: 'script', target: 'go' } },
    views: { item: { object: 'probe_thing', list: listOf('probe_thing') } },
    pages: { item: { name: 'probe_page', label: 'Page', type: 'app', regions: [] } },
    dashboards: { item: { name: 'probe_dash', label: 'Dash', widgets: [] } },
    reports: {
        item: { name: 'probe_report', label: 'Report', type: 'summary', dataset: 'probe_ds', rows: ['title'], values: ['row_count'] },
        context: { datasets: [probeDataset] },
    },
    datasets: { item: probeDataset },
    flows: { item: probeFlow },
    webhooks: {
        item: { name: 'probe_webhook', label: 'Webhook', object: 'probe_thing', triggers: ['create'], url: 'https://example.com/hook' },
        context: { requires: ['webhooks', 'realtime'] },
    },
    jobs: { item: { name: 'probe_job', label: 'Job', schedule: { type: 'interval', intervalMs: 60000 }, body: { language: 'js', source: 'return 1;', capabilities: [] } } },
    positions: { item: { name: 'probe_pos', label: 'Pos' } },
    permissions: { item: { name: 'probe_perm', label: 'Perm', objects: {} } },
    capabilities: { item: { name: 'probe.export', label: 'Export' } },
    sharingRules: { item: { name: 'probe_share', label: 'Share', object: 'probe_thing', type: 'criteria', condition: 'true', sharedWith: { type: 'team', value: 'team_ops' } } },
    queues: { item: probeQueue },
    assignmentRules: {
        item: { name: 'probe_route', object: 'probe_thing', entries: [{ name: 'to_queue', assignTo: { type: 'queue', value: 'probe_queue' } }] },
        context: { queues: [probeQueue] },
    },
    agents: { item: { name: 'probe_agent', label: 'Agent', role: 'Assistant', instructions: 'Triage the request.' } },
    tools: { item: { name: 'probe_tool', label: 'Tool', description: 'tool', parameters: { type: 'object', properties: {} } } },
    skills: { item: { name: 'probe_skill', label: 'Skill', description: 'skill', instructions: 'x', tools: [] } },
    apis: {
        item: { name: 'probe_api', description: 'api', path: '/api/v1/apps/probeorders/p1', method: 'GET', type: 'flow', target: 'probe_flow' },
        context: { flows: [probeFlow] },
    },
    hooks: { item: { name: 'probe_hook', label: 'Hook', object: 'probe_thing', events: ['beforeInsert'], handler: () => {} } },
    mappings: { item: { name: 'probe_map', label: 'Map', targetObject: 'probe_thing', fieldMapping: [{ source: 'a', target: 'title' }] } },
    analyticsCubes: { item: { name: 'probe_cube', title: 'Cube', description: 'cube', sql: 'probe_thing', measures: {}, dimensions: {} } },
    connectors: { item: { name: 'probe_conn', label: 'Probe', type: 'api', provider: 'openapi', providerConfig: { spec: './specs/billing.json' } } },
    emailTemplates: { item: { name: 'probe_mail', label: 'Mail', subject: 'Hi', bodyHtml: '<p>Hello</p>' } },
    docs: { item: { name: 'probe_doc', label: 'Doc', content: '# Doc' } },
    books: { item: { name: 'probe_book', label: 'Book', groups: [] } },
    data: { item: { object: 'probe_thing', records: [] } },
};

/** Two packages composed as `os build` does; the artifact's own id is the orders module's. */
function artifactOf(crmBody: Record<string, unknown> = {}): Record<string, unknown> {
    return composeStacks([
        defineStack({ manifest: manifest(CRM, 'probecrm'), objects: [PROBE_OBJECT, OTHER_OBJECT], ...crmBody } as never, { strict: false }),
        defineStack({ manifest: manifest(ORDERS, 'probeorders') } as never),
    ], { manifest: 'preserve' }) as unknown as Record<string, unknown>;
}

/** The artifact with `items` appended to the top level of `key`, and the index the first lands at. */
function withTopLevel(artifact: Record<string, unknown>, key: string, items: unknown[], context: Record<string, unknown> = {}) {
    const stack: Record<string, unknown> = { ...artifact, ...context };
    const existing = Array.isArray(stack[key]) ? (stack[key] as unknown[]) : [];
    stack[key] = [...existing, ...items];
    return { stack, at: existing.length };
}

/** The build door: does the parse raise an issue at `<key>.<at>._packageId`? */
function buildJudges(stack: unknown, key: string, at: number): boolean {
    const result = ObjectStackDefinitionSchema.safeParse(stack);
    if (result.success) return false;
    return result.error.issues.some((i) => i.path.join('.') === `${key}.${at}._packageId` && i.code === 'custom');
}

/** The boot's residual rule: does `unclaimedTopLevel` list the item at `<key>[at]`? */
function bootListsResidual(stack: unknown, key: string, at: number): boolean {
    return unclaimedTopLevel(stack)?.items.some((entry) => entry.field === key && entry.index === at) === true;
}

/** The metadata door: does the residual registration refuse on a stamp? */
async function bootRefusesStamp(stack: unknown): Promise<boolean> {
    try {
        await MetadataPlugin.registerUnclaimedTopLevel(
            { register: () => undefined, warn: () => undefined },
            stack,
            { door: 'config', label: 'probe' },
        );
        return false;
    } catch (e: any) {
        return e?.code === 'VALIDATION_ERROR' && Array.isArray(e.issues) && e.issues.some((i: any) => i?.path === '_packageId');
    }
}

describe('[ADR-0010 · ADR-0130 D4] a residual\'s foreign stamp: refused at the build door exactly when the boot files it as residual', () => {
    it('the fixture table covers exactly the judged collections', () => {
        expect(Object.keys(JUDGED_FIXTURES).sort()).toEqual([...OWNER_STAMP_JUDGED_COLLECTIONS].sort());
    });

    it('collection by collection over OWNER_STAMP_JUDGED_COLLECTIONS', async () => {
        const notResidual: string[] = [];
        for (const key of OWNER_STAMP_JUDGED_COLLECTIONS) {
            const { item, context } = JUDGED_FIXTURES[key];
            // CONTROL: the unstamped stack parses, so a missing issue below is the gate's verdict.
            const plain = withTopLevel(artifactOf(), key, [{ ...item }], context);
            const control = ObjectStackDefinitionSchema.safeParse(plain.stack);
            expect(control.success, `${key} CONTROL: ${control.success ? '' : JSON.stringify(control.error.issues.slice(0, 2))}`).toBe(true);

            const { stack, at } = withTopLevel(artifactOf(), key, [{ ...item, _packageId: FOREIGN }], context);
            const listed = bootListsResidual(stack, key, at);
            expect(buildJudges(stack, key, at), `${key}: build verdict == unclaimedTopLevel lists it (${listed})`).toBe(listed);
            expect(await bootRefusesStamp(stack), `${key}: the metadata door refuses what it lists`).toBe(listed);
            if (!listed) notResidual.push(key);
        }
        // The reading, so the equality above is not vacuous: the two judged
        // collections the residual rule does not walk. Seed `data` is applied
        // by the seed loader and `jobs` are scheduled, both straight off the
        // stack, never registered as items. `datasets` left this list when the
        // rule began registering a residual dataset under the stack's id.
        expect(notResidual.sort()).toEqual(['data', 'jobs']);
    });
});

describe('[ADR-0010 · ADR-0130 D4] a view container is claimed by the object it binds to, at both doors', () => {
    const shapes: Record<string, Record<string, unknown>> = {
        'own object': { object: 'probe_thing', list: listOf('probe_thing') },
        'list binding only': { list: listOf('probe_thing') },
        'form binding only': { form: { type: 'simple', data: { provider: 'object', object: 'probe_thing' }, sections: [{ fields: ['title'] }] } },
        'another object, list binding only': { list: listOf('probe_other') },
        'another object, own object': { object: 'probe_other', list: listOf('probe_other') },
    };
    const cases = Object.keys(shapes).flatMap((body) => Object.keys(shapes).map((top) => [body, top] as const));

    it.each(cases)('body container (%s) × top-level container (%s), stamped foreign', async (body, top) => {
        const artifact = artifactOf({ views: [shapes[body]] });
        const { stack, at } = withTopLevel(artifact, 'views', [{ ...shapes[top], _packageId: FOREIGN }]);
        const listed = bootListsResidual(stack, 'views', at);
        expect(buildJudges(stack, 'views', at)).toBe(listed);
        expect(await bootRefusesStamp(stack)).toBe(listed);
        // Claimed exactly when both bind the same object.
        expect(listed).toBe(body.startsWith('another') !== top.startsWith('another'));
    });
});
