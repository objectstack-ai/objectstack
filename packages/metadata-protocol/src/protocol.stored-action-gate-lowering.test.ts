// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#26723] An action the metadata save door stores is stored as its
 * `ActionSchema` parse, so a declared `requiresFeature` /
 * `requiresMembershipReach` is lowered into `visible` — on an object's own
 * `actions` and on a standalone `action` item, in draft and in active saves.
 *
 * The door already judged the body by that parse (`ObjectSchema`'s `actions`
 * is `ActionSchema[]`), then stored the request body as written: the gate keys
 * rode along raw and no `visible` was stored, so the console — which reads
 * `visible` alone — offered the button to every caller. The code-package
 * registration door has stored the parse since #25981; this is the save-door
 * sibling of that fix.
 */
import { describe, expect, it } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
import { ActionSchema } from '@objectstack/spec/ui';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The engine surface the repository write path touches (as the external-binding harness). */
function makeProtocol() {
    const rows: Record<string, unknown>[] = [];
    let nextId = 0;
    const engine: any = {
        async findOne(object: string, query?: EngineFindOneQueryInput) {
            assertEngineFindOnePredicate(object, query); return null; },
        async find() { return []; },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            if (table === 'sys_metadata') rows.push(data);
            return { id: `r_${nextId}` };
        },
        async update(_t: string, data: Record<string, unknown>, opts?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, opts);
            return { id: null };
        },
        async delete(_t: string, opts?: Record<string, unknown>) {
            assertEngineDeleteDispatch(opts);
            return { deleted: 0 };
        },
        registry: { registerItem: () => {}, registerObject: () => {}, getItem: () => undefined },
    };
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { protocol, rows };
}

/** The body of the one `sys_metadata` row a save wrote, as stored. */
function storedBody(rows: Record<string, unknown>[], type: string, name: string): any {
    const hits = rows.filter((r) => r.type === type && r.name === name);
    expect(hits).toHaveLength(1);
    const metadata = hits[0].metadata;
    return typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
}

const SSO_ONLY = {
    name: 'sso_only', label: 'SSO only', type: 'url' as const, target: 'https://example.com/sso',
    locations: ['record_header' as const], requiresFeature: 'ssoEnforced' as const,
};
const OWNER_ONLY = {
    name: 'owner_only', label: 'Owner only', type: 'url' as const, target: 'https://example.com/owner',
    locations: ['record_header' as const], visible: "record.name != ''",
    requiresMembershipReach: 'delete_organization' as const,
};
const PLAIN = {
    name: 'plain', label: 'Plain', type: 'url' as const, target: 'https://example.com/plain',
    locations: ['record_header' as const],
};

const order = (actions: unknown[]) => ({
    name: 'gap_order',
    label: 'Order',
    sharingModel: 'private',
    fields: { name: { name: 'name', label: 'Name', type: 'text' } },
    actions,
});

/** What the spec's own parse makes of the same declaration. */
const parsedAction = (action: unknown) => ActionSchema.parse(action) as any;

describe('#26723 the save door stores an action as its ActionSchema parse', () => {
    it.each(['draft', 'publish'] as const)(
        'an object saved in %s mode stores its gated actions lowered into `visible`',
        async (mode) => {
            const { protocol, rows } = makeProtocol();
            const result = await protocol.saveMetaItem({
                type: 'object', name: 'gap_order', mode,
                item: order([structuredClone(SSO_ONLY), structuredClone(OWNER_ONLY)]),
            });
            expect(result.success).toBe(true);

            const stored = storedBody(rows, 'object', 'gap_order');
            const [sso, owner] = stored.actions;
            expect(sso).not.toHaveProperty('requiresFeature');
            // `ssoEnforced` is an opt-in flag, so its gate reads `== true`.
            expect(sso.visible).toEqual({ dialect: 'cel', source: 'features.ssoEnforced == true' });
            expect(owner).not.toHaveProperty('requiresMembershipReach');
            expect(owner.visible).toEqual(parsedAction(OWNER_ONLY).visible);
            // The same actions `ObjectSchema.create` gives the same declaration.
            const authored: any = ObjectSchema.create(order([SSO_ONLY, OWNER_ONLY]) as any);
            expect(stored.actions).toEqual(authored.actions);
        },
    );

    it('control: an action without the gate keys is stored as its parse, and the rest of the body as written', async () => {
        const { protocol, rows } = makeProtocol();
        const item = order([structuredClone(PLAIN)]);
        await protocol.saveMetaItem({ type: 'object', name: 'gap_order', item });

        const stored = storedBody(rows, 'object', 'gap_order');
        expect(stored.actions).toEqual([parsedAction(PLAIN)]);
        expect(stored.actions[0]).not.toHaveProperty('visible');
        expect(stored.fields).toEqual(item.fields);
    });

    it('re-saving a stored body is a no-op: the parse is idempotent over its own output', async () => {
        const first = makeProtocol();
        await first.protocol.saveMetaItem({ type: 'object', name: 'gap_order', item: order([structuredClone(SSO_ONLY)]) });
        const once = storedBody(first.rows, 'object', 'gap_order');

        const second = makeProtocol();
        await second.protocol.saveMetaItem({ type: 'object', name: 'gap_order', item: structuredClone(once) });
        expect(storedBody(second.rows, 'object', 'gap_order').actions).toEqual(once.actions);
    });

    it('an object with no `actions` key is stored without one', async () => {
        const { protocol, rows } = makeProtocol();
        const { actions: _none, ...bare } = order([]);
        await protocol.saveMetaItem({ type: 'object', name: 'gap_order', item: bare });
        expect(storedBody(rows, 'object', 'gap_order')).not.toHaveProperty('actions');
    });

    it.each(['draft', 'publish'] as const)(
        'a standalone action saved in %s mode is stored lowered',
        async (mode) => {
            const { protocol, rows } = makeProtocol();
            const result = await protocol.saveMetaItem({
                type: 'action', name: 'sso_only', mode,
                item: { ...structuredClone(SSO_ONLY), objectName: 'gap_order' },
            });
            expect(result.success).toBe(true);

            const stored = storedBody(rows, 'action', 'sso_only');
            expect(stored).not.toHaveProperty('requiresFeature');
            expect(stored.visible).toEqual({ dialect: 'cel', source: 'features.ssoEnforced == true' });
            expect(stored).toEqual(parsedAction({ ...SSO_ONLY, objectName: 'gap_order' }));
        },
    );
});
