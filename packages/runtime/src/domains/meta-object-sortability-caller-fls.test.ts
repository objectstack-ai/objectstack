// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22250] The dispatcher's `/metadata/object/:name` item read — the only
 * answer on a host that mounts just the `${prefix}/*` catch-all — serves the
 * `sortability` projection beside the schema through the SAME item chain as
 * `RestServer` (`createMetaItemAnswer`), so it follows the caller's field
 * permission per caller class exactly as the REST suite pins it
 * (`meta-object-sortability-caller-fls.test.ts` in `@objectstack/rest`).
 *
 * D4 still serves the two admin classes the DEFINITION whole (authoring); what
 * changed is that their `sortability` no longer offers a field their own field
 * permission withholds, which the data route refuses them with `403`. The
 * member is the control: masked definition, same projection as before.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { HttpDispatcher } from '../http-dispatcher.js';

const OPPORTUNITY = {
    name: 'crm_opportunity',
    label: 'Opportunity',
    fields: {
        name: { type: 'text' },
        amount: { type: 'currency' },
        secret_margin: { type: 'currency' },
        expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
    },
};
const ALL_FIELDS = Object.keys(OPPORTUNITY.fields);
/** Every class below holds the same field permission: `secret_margin` is unreadable. */
const READABLE = ['name', 'amount', 'expected_revenue'];
const EXPECTED_SORTABILITY = resolveObjectSortability({
    ...OPPORTUNITY,
    fields: Object.fromEntries(Object.entries(OPPORTUNITY.fields).filter(([name]) => READABLE.includes(name))),
});

const CLASSES = {
    'platform admin': { userId: 'u_platform_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    'organization admin': { userId: 'u_org_admin', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'] },
    member: { userId: 'u_member', systemPermissions: [] as string[] },
} as const;
type CallerClass = keyof typeof CLASSES;

const clone = () => JSON.parse(JSON.stringify(OPPORTUNITY));

/** The two lookups the item read serves an object from: the scoped protocol, and the registry fallback. */
const EXITS: Record<string, () => Record<string, unknown>> = {
    'protocol-backed (scoped kernel)': () => ({
        protocol: {
            getProjectId: () => 'env_1',
            getMetaItem: vi.fn(async ({ name }: any) => ({ type: 'object', name, item: clone(), lock: 'none' })),
        },
    }),
    'registry-backed fallback': () => ({ objectql: { registry: { getObject: vi.fn(() => clone()) } } }),
};

async function read(exit: string, caller: Record<string, unknown>, readable: readonly string[]) {
    const services: Record<string, any> = {
        ...EXITS[exit](),
        security: {
            getReadableFields: async () => [...readable],
            getMetadataReadableFields: async () => [...readable],
        },
    };
    const kernel = {
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    } as any;
    const res = await new HttpDispatcher(kernel).handleMetadata(
        '/object/crm_opportunity',
        { request: {}, environmentId: 'platform', executionContext: { ...caller } } as any,
        'GET',
    );
    const response = res.response;
    if (!response) throw new Error('the dispatcher answered /object/crm_opportunity with no response');
    return { status: response.status, data: response.body?.data };
}

for (const exit of Object.keys(EXITS)) {
    describe(`[#22250] /metadata/object/:name — ${exit}: sortability follows the caller's field permission`, () => {
        for (const cls of Object.keys(CLASSES) as CallerClass[]) {
            const exempt = cls !== 'member';
            it(`${cls}: the definition is ${exempt ? 'served whole' : 'masked'}; sortability never offers the unreadable field`, async () => {
                const { status, data } = await read(exit, CLASSES[cls], READABLE);
                expect(status).toBe(200);
                expect(Object.keys(data.item.fields)).toEqual(exempt ? ALL_FIELDS : READABLE);
                expect(data.sortability.fields.secret_margin).toBeUndefined();
                expect(data.sortability).toEqual(EXPECTED_SORTABILITY);
                expect(data.sortability.fields.amount).toEqual({ sortable: true });
            });
        }

        it('an unrestricted exempt caller is served every field sortable, as before', async () => {
            const { data } = await read(exit, CLASSES['platform admin'], ALL_FIELDS);
            expect(data.sortability).toEqual(resolveObjectSortability(OPPORTUNITY));
        });
    });
}
