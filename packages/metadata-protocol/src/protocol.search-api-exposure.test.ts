// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22640] `searchAll` serves an object only when the spec's one exposure
 * decision, `canServeApiOperation(enable, 'search')`, says the object can
 * serve `search`.
 *
 * The sweep used to spell its own skip predicate and read only the off switch
 * (`apiEnabled === false`) and the `searchable` flag. It never read the
 * `apiMethods` whitelist. In the derivation table (`api-derivation.ts`),
 * `search` derives from `list`, so a whitelist that withholds `list` declares
 * that `search` is not served. Every data route refused such an object, and the
 * sweep served its rows anyway, unless the object also said `searchable: false`.
 *
 * What these pins hold:
 *
 *   - an object whose whitelist withholds `list`, without `searchable: false`,
 *     is not swept: it is never queried, never named and never counted, and an
 *     explicit `objects=` naming it answers like one naming no object at all.
 *     A deny-all whitelist (`[]`) is the same case;
 *   - the existing skips still hold: `apiEnabled: false`, and
 *     `searchable: false` on an object with NO whitelist. The decision does not
 *     read that flag for such an object, which is why the flag keeps its own skip;
 *   - an ordinary object, and one whose whitelist grants `list`, are swept as
 *     before;
 *   - the decision takes no caller: a context-less call skips the same objects,
 *     and the read admission is never asked about a refused object.
 *
 * The negative pins were checked by ablation: restoring the old predicate turns
 * them red and leaves the others green.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { assertEngineFindOnePredicate, type EngineFindOneQueryInput } from '@objectstack/metadata-core';

interface FixtureObject {
    name: string;
    label: string;
    fields: Record<string, { name: string; label: string; type: string }>;
    enable?: Record<string, unknown>;
}

const objectFixture = (name: string, enable?: Record<string, unknown>): FixtureObject => ({
    name,
    label: name,
    fields: { name: { name: 'name', label: 'Name', type: 'text' } },
    ...(enable ? { enable } : {}),
});

function fixtureRegistry(objects: FixtureObject[]) {
    return {
        getObject: (n: string) => objects.find((o) => o.name === n),
        getAllObjects: () => objects,
        getItem: () => undefined,
        listItems: () => [],
        applyNavContributions: (x: unknown) => x,
        isPackageDisabled: () => false,
        getObjectOwner: () => undefined,
        getPackage: () => undefined,
    };
}

const MEMBER = { userId: 'usr_member', tenantId: 'org_1' };

/** An object with no `enable` block at all: the default-open case. */
const plain = objectFixture('plain');
/** The gap: a whitelist without `list`, and no `searchable: false` beside it. */
const getOnly = objectFixture('get_only', { apiMethods: ['get'] });

/**
 * Every object holds one row matching the query, so a swept object always
 * contributes a hit and an unswept one never does.
 */
function harness(objects: FixtureObject[]) {
    const readCalls: string[] = [];
    const engine = {
        registry: fixtureRegistry(objects),
        find: vi.fn(async (object: string) => {
            if (object === 'sys_metadata') return [];
            readCalls.push(object);
            return [{ id: `${object}_1`, name: `Acme ${object}` }];
        }),
        findOne: vi.fn(async (object: string, query?: EngineFindOneQueryInput) => {
            assertEngineFindOnePredicate(object, query);
            return null;
        }),
    };
    const canReadObject = vi.fn(async (_object: string, _context?: unknown) => true);
    const services = new Map<string, unknown>([['security', { canReadObject }]]);
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, any>);
    return { protocol, readCalls, canReadObject };
}

const EMPTY = { query: 'Acme', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false };

describe('searchAll — an object whose declared exposure refuses search is not swept', () => {
    it('a whitelist that withholds list keeps the object out of the sweep: never queried, named or counted', async () => {
        const { protocol, readCalls, canReadObject } = harness([plain, getOnly]);

        const result = await protocol.searchAll({ q: 'Acme', context: MEMBER });

        expect(result.hits.map((h) => h.object)).toEqual(['plain']);
        expect(result.totalObjects).toBe(1);
        expect(result.totalHits).toBe(1);
        expect(readCalls).toEqual(['plain']);
        expect(JSON.stringify(result)).not.toContain('get_only');
        // Decided before anything about the caller is asked.
        expect(canReadObject.mock.calls.map(([o]) => o)).toEqual(['plain']);
    });

    it('an explicit objects= naming it answers exactly like one naming no such object', async () => {
        const { protocol, readCalls } = harness([plain, getOnly]);

        const named = await protocol.searchAll({ q: 'Acme', objects: ['get_only'], context: MEMBER });
        const nonexistent = await protocol.searchAll({ q: 'Acme', objects: ['no_such_object'], context: MEMBER });

        expect(named).toEqual(nonexistent);
        expect(named).toEqual(EMPTY);
        expect(readCalls).toEqual([]);
    });

    it('a deny-all whitelist ([]) is the same case', async () => {
        const { protocol, readCalls } = harness([plain, objectFixture('deny_all', { apiMethods: [] })]);

        const result = await protocol.searchAll({ q: 'Acme', context: MEMBER });

        expect(result.hits.map((h) => h.object)).toEqual(['plain']);
        expect(readCalls).toEqual(['plain']);
    });

    it('the decision takes no caller: a context-less call skips the same object', async () => {
        const { protocol, readCalls } = harness([plain, getOnly]);

        const result = await protocol.searchAll({ q: 'Acme' });

        expect(result.hits.map((h) => h.object)).toEqual(['plain']);
        expect(readCalls).toEqual(['plain']);
    });
});

describe('searchAll — the existing skips still hold', () => {
    it.each([
        ['apiEnabled: false', { apiEnabled: false }],
        ['apiEnabled: false beside a whitelist that grants list', { apiEnabled: false, apiMethods: ['get', 'list'] }],
        ['searchable: false with no whitelist', { searchable: false }],
        ['searchable: false beside a whitelist that grants list', { searchable: false, apiMethods: ['get', 'list'] }],
    ])('%s is not swept', async (_label, enable) => {
        const { protocol, readCalls } = harness([plain, objectFixture('opted_out', enable)]);

        const result = await protocol.searchAll({ q: 'Acme', context: MEMBER });

        expect(result.hits.map((h) => h.object)).toEqual(['plain']);
        expect(result.totalObjects).toBe(1);
        expect(readCalls).toEqual(['plain']);
    });
});

describe('searchAll — an object the decision serves is swept as before', () => {
    it.each([
        ['no enable block', undefined],
        ['an empty enable block', {}],
        ['a whitelist that grants list', { apiMethods: ['get', 'list'] }],
        ['a whitelist of list alone', { apiMethods: ['list'] }],
        ['searchable: true with apiEnabled: true', { searchable: true, apiEnabled: true }],
    ])('%s is swept', async (_label, enable) => {
        const { protocol, readCalls } = harness([objectFixture('served', enable)]);

        const result = await protocol.searchAll({ q: 'Acme', context: MEMBER });

        expect(result.hits.map((h) => [h.object, h.id])).toEqual([['served', 'served_1']]);
        expect(result.totalObjects).toBe(1);
        expect(readCalls).toEqual(['served']);
    });
});
