// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22661] The data door's `$expand` asks every level's TARGET object the
 * spec's one exposure decision (`canServeApiOperation(enable, 'get')`,
 * ADR-0049), and withholds an entry it does not serve, so the field answers as
 * an unexpanded lookup — its stored id.
 *
 * Asserted on what the door hands the engine: a withheld entry never reaches
 * `engine.find` / `engine.findOne`, so nothing of the target is read. Each
 * withheld shape is paired with a CONTROL the decision serves, which must reach
 * the engine unchanged — a door that dropped every expansion would pass every
 * "withheld" case and serve nothing. The decision takes no caller, so a system
 * context is withheld from too. The rows themselves (the stored id where the
 * record would have been, for an administrator and a member alike) are pinned
 * on a real stack in `@objectstack/dogfood`.
 */

import { describe, expect, it, vi } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });

const target = (name: string, enable?: Record<string, unknown>): ServiceObject => ({
    name,
    label: name,
    ...(enable ? { enable } : {}),
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
    },
} as unknown as ServiceObject);

/** Every exposure shape the decision distinguishes for `get`, one lookup each. */
const SOURCE: ServiceObject = {
    name: 'xt_source',
    label: 'Source',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        // `apiEnabled: false` is judged FIRST: a whitelist granting `get` beside it changes nothing.
        hidden: lookup('hidden', 'xt_hidden'),
        closed: lookup('closed', 'xt_closed'),
        denyall: lookup('denyall', 'xt_denyall'),
        listonly: lookup('listonly', 'xt_listonly'),
        getonly: lookup('getonly', 'xt_getonly'),
        open: lookup('open', 'xt_open'),
    },
} as unknown as ServiceObject;

/** Exposed, with a lookup into the off-switched object one hop further on. */
const OPEN: ServiceObject = {
    name: 'xt_open',
    label: 'Open',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' },
        name: { name: 'name', label: 'Name', type: 'text' },
        inner: lookup('inner', 'xt_hidden'),
        peer: lookup('peer', 'xt_getonly'),
    },
} as unknown as ServiceObject;

const SCHEMAS: Record<string, unknown> = {
    xt_source: SOURCE,
    xt_open: OPEN,
    xt_hidden: target('xt_hidden', { apiEnabled: false, apiMethods: ['get'] }),
    xt_closed: target('xt_closed', { apiMethods: ['create'] }),
    xt_denyall: target('xt_denyall', { apiMethods: [] }),
    xt_listonly: target('xt_listonly', { apiMethods: ['list'] }),
    xt_getonly: target('xt_getonly', { apiMethods: ['get'] }),
};

function makeProtocol() {
    const find = vi.fn(async (_object: string, _o: any) => [{ id: 's1', name: 'source' }]);
    const findOne = vi.fn(async (object: string, o: any) => {
        assertEngineFindOnePredicate(object, o);
        return { id: 's1', name: 'source' };
    });
    const count = vi.fn(async () => 1);
    const engine: any = { registry: { getObject: (n: string) => SCHEMAS[n] }, find, findOne, count };
    return { p: new ObjectStackProtocolImplementation(engine), find, findOne };
}

/** The `expand` the door handed the engine's list read. */
async function expandHandedToFind(query: Record<string, unknown>, context?: unknown): Promise<unknown> {
    const { p, find } = makeProtocol();
    await p.findData({ object: 'xt_source', query, ...(context ? { context } : {}) });
    expect(find).toHaveBeenCalledTimes(1);
    return (find.mock.calls[0]![1] as { expand?: unknown }).expand;
}

const WITHHELD = ['hidden', 'closed', 'denyall', 'listonly'] as const;
const SERVED = ['getonly', 'open'] as const;

describe('[#22661] the data door withholds an $expand entry whose target the API does not serve', () => {
    for (const rel of WITHHELD) {
        it(`${rel}: withheld on the comma list, the engine reads nothing of the target`, async () => {
            expect(await expandHandedToFind({ $expand: rel })).toBeUndefined();
        });
        it(`${rel}: withheld from the POST relation map, beside a served entry that is kept`, async () => {
            const expand = await expandHandedToFind({ expand: { [rel]: { object: rel, fields: ['name'] }, open: { object: 'open' } } });
            expect(expand).toEqual({ open: { object: 'open' } });
        });
    }

    for (const rel of SERVED) {
        it(`CONTROL ${rel}: served, handed to the engine unchanged`, async () => {
            const map = { [rel]: { object: rel, fields: ['name'] } };
            expect(await expandHandedToFind({ expand: map })).toEqual(map);
            expect(await expandHandedToFind({ $expand: rel })).toEqual({ [rel]: { object: rel } });
        });
    }

    it('every level is judged against its own target: a second-level entry into an unexposed object is withheld', async () => {
        const expand = await expandHandedToFind({
            expand: {
                open: {
                    object: 'open',
                    fields: ['name'],
                    expand: { inner: { object: 'inner' }, peer: { object: 'peer' } },
                },
            },
        });
        expect(expand).toEqual({ open: { object: 'open', fields: ['name'], expand: { peer: { object: 'peer' } } } });
    });

    it('a level left with nothing to expand carries no expand of its own', async () => {
        const expand = await expandHandedToFind({ expand: { open: { object: 'open', expand: { inner: { object: 'inner' } } } } });
        expect(expand).toEqual({ open: { object: 'open' } });
    });

    it('the caller\'s relation map is never mutated', async () => {
        const map = { hidden: { object: 'hidden' }, open: { object: 'open', expand: { inner: { object: 'inner' } } } };
        const before = JSON.stringify(map);
        await expandHandedToFind({ expand: map });
        expect(JSON.stringify(map)).toBe(before);
    });

    it('the decision takes no caller: a system context is withheld from too', async () => {
        expect(await expandHandedToFind({ $expand: 'hidden,open' }, { isSystem: true })).toEqual({ open: { object: 'open' } });
    });

    it('the single-record read withholds the same entries, and keeps the served ones', async () => {
        const { p, findOne } = makeProtocol();
        await p.getData({ object: 'xt_source', id: 's1', expand: 'hidden,listonly,getonly,open' });
        expect((findOne.mock.calls[0]![1] as { expand?: unknown }).expand).toEqual({
            getonly: { object: 'getonly' },
            open: { object: 'open' },
        });
        await p.getData({ object: 'xt_source', id: 's1', expand: ['closed', 'denyall'] });
        expect((findOne.mock.calls[1]![1] as { expand?: unknown }).expand).toBeUndefined();
    });
});
