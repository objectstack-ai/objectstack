// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `searchAll` leaves out the objects of a disabled package, the answer every
 * data route already gives.
 *
 * A disable takes a package's records off the data plane: `GET /data/:object`
 * and the by-id read answer `404 OBJECT_PACKAGE_DISABLED`. The schema stays
 * resolvable on purpose, so `registry.getAllObjects()` still lists the object,
 * and the sweep, which walks that list, used to search its rows and return
 * them with their titles and matched text.
 *
 * What these pins hold:
 *
 *   - an object of a disabled package is not swept: never queried, never named
 *     and never counted in `totalObjects`, and the read admission is never
 *     asked about it;
 *   - an explicit `objects=` naming it answers exactly like one naming no
 *     object at all (a sweep, not a by-name read: no 404);
 *   - a disabled package's object as the TARGET of an enabled object's
 *     reference-typed title lends it no titles: the hit keeps the bare id, the
 *     answer an unreadable target gives;
 *   - CONTROLS: the same object re-enabled is swept and titles again, an
 *     enabled object's hits do not move, and a registry that cannot answer the
 *     question (no `isObjectPackageDisabled`) hides nothing.
 */

import { describe, it, expect, vi } from 'vitest';
// `protocol.ts` reaches `@objectstack/lint` through a dynamic import; loaded
// here at module scope so the first load lands during collection, not inside a
// clocked window (`pnpm check:test-source-alias`).
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

type Row = Record<string, unknown>;
type ObjectMeta = Record<string, unknown> & { name: string };

const text = (name: string) => ({ name, type: 'text' });

const MEMBER = { userId: 'usr_member', tenantId: 'org_1' };

/** The enabled package's object: always swept. */
const account: ObjectMeta = { name: 'account', nameField: 'name', fields: { name: text('name') } };
/** The object the disable takes offline. */
const crmCase: ObjectMeta = { name: 'crm_case', nameField: 'subject', fields: { subject: text('subject') } };
/** An enabled object titled by a lookup INTO the disabled package's object. */
const caseNote: ObjectMeta = {
    name: 'case_note',
    nameField: 'case_id',
    fields: {
        case_id: { name: 'case_id', type: 'lookup', reference: 'crm_case' },
        body: text('body'),
    },
    searchableFields: ['body'],
};

const ROWS: Record<string, Row[]> = {
    account: [{ id: 'acc_1', name: 'PDF Printing Ltd' }],
    crm_case: [{ id: 'case_5', subject: 'PDF export fails' }],
    case_note: [{ id: 'note_1', case_id: 'case_5', body: 'PDF attached' }],
};

function harness(opts: { disabled: Set<string>; objects?: ObjectMeta[]; registryAnswers?: boolean }) {
    const objects = opts.objects ?? [account, crmCase];
    const reads: Array<[string, Record<string, any>]> = [];
    const registry: Record<string, unknown> = {
        getObject: (n: string) => objects.find((o) => o.name === n),
        getAllObjects: () => objects,
        listItems: () => [],
        isPackageDisabled: () => false,
    };
    if (opts.registryAnswers !== false) {
        registry.isObjectPackageDisabled = (n: string) => opts.disabled.has(n);
    }
    const engine = {
        registry,
        find: vi.fn(async (object: string, options: Record<string, any>) => {
            if (object === 'sys_metadata') return [];
            reads.push([object, options]);
            let out = ROWS[object] ?? [];
            const ids = options?.where?.id?.$in;
            if (Array.isArray(ids)) out = out.filter((r) => ids.includes(r.id));
            return out;
        }),
    };
    const canReadObject = vi.fn(async (_object: string, _context?: unknown) => true);
    const services = new Map<string, unknown>([['security', { canReadObject }]]);
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, any>);
    const readObjects = () => reads.map(([o]) => o);
    return { protocol, readObjects, canReadObject };
}

const EMPTY = { query: 'PDF', hits: [], pages: [], totalObjects: 0, totalHits: 0, truncated: false };

describe('searchAll — an object of a disabled package is outside the sweep', () => {
    it('THE PIN — a disabled package\'s records are not hits: never queried, named or counted', async () => {
        const { protocol, readObjects, canReadObject } = harness({ disabled: new Set(['crm_case']) });

        const result = await protocol.searchAll({ q: 'PDF', context: MEMBER });

        expect(result.hits.map((h) => [h.object, h.id])).toEqual([['account', 'acc_1']]);
        expect(result.totalObjects).toBe(1);
        expect(result.totalHits).toBe(1);
        expect(readObjects()).toEqual(['account']);
        expect(JSON.stringify(result)).not.toContain('crm_case');
        expect(canReadObject.mock.calls.map(([o]) => o)).toEqual(['account']);
    });

    it('a context-less in-process call leaves it out too', async () => {
        const { protocol, readObjects } = harness({ disabled: new Set(['crm_case']) });

        const result = await protocol.searchAll({ q: 'PDF' });

        expect(result.hits.map((h) => h.object)).toEqual(['account']);
        expect(readObjects()).toEqual(['account']);
    });

    it('an explicit objects= naming it answers exactly like one naming no such object', async () => {
        const { protocol, readObjects } = harness({ disabled: new Set(['crm_case']) });

        const named = await protocol.searchAll({ q: 'PDF', objects: ['crm_case'], context: MEMBER });
        const nonexistent = await protocol.searchAll({ q: 'PDF', objects: ['no_such_object'], context: MEMBER });

        expect(named).toEqual(nonexistent);
        expect(named).toEqual(EMPTY);
        expect(readObjects()).toEqual([]);
    });

    it('a disabled package\'s object as a title TARGET lends no title: the enabled hit keeps the bare id', async () => {
        const { protocol, readObjects } = harness({
            disabled: new Set(['crm_case']),
            objects: [caseNote, crmCase],
        });

        const result = await protocol.searchAll({ q: 'PDF', objects: ['case_note'], context: MEMBER });

        expect(result.hits.map((h) => [h.id, h.title])).toEqual([['note_1', 'case_5']]);
        expect(readObjects()).toEqual(['case_note']);
        expect(JSON.stringify(result)).not.toContain('PDF export fails');
    });
});

describe('searchAll — controls: what the disable does not touch', () => {
    it('CONTROL — the same package re-enabled: its record is a hit again', async () => {
        const { protocol, readObjects } = harness({ disabled: new Set() });

        const result = await protocol.searchAll({ q: 'PDF', context: MEMBER });

        expect(result.hits.map((h) => [h.object, h.id])).toEqual([['account', 'acc_1'], ['crm_case', 'case_5']]);
        expect(result.totalObjects).toBe(2);
        expect(readObjects()).toEqual(['account', 'crm_case']);
    });

    it('CONTROL — re-enabled, the reference title reads through to the target again', async () => {
        const { protocol } = harness({ disabled: new Set(), objects: [caseNote, crmCase] });

        const result = await protocol.searchAll({ q: 'PDF', objects: ['case_note'], context: MEMBER });

        expect(result.hits.map((h) => [h.id, h.title])).toEqual([['note_1', 'PDF export fails']]);
    });

    it('CONTROL — an enabled object\'s hits are the same with and without the disable', async () => {
        const off = await harness({ disabled: new Set(['crm_case']) }).protocol
            .searchAll({ q: 'PDF', objects: ['account'], context: MEMBER });
        const on = await harness({ disabled: new Set() }).protocol
            .searchAll({ q: 'PDF', objects: ['account'], context: MEMBER });

        expect(off).toEqual(on);
        expect(off.hits.map((h) => [h.object, h.id, h.title])).toEqual([['account', 'acc_1', 'PDF Printing Ltd']]);
    });

    it('CONTROL — a registry that cannot answer the question hides nothing', async () => {
        const { protocol } = harness({ disabled: new Set(['crm_case']), registryAnswers: false });

        const result = await protocol.searchAll({ q: 'PDF', context: MEMBER });

        expect(result.hits.map((h) => h.object)).toEqual(['account', 'crm_case']);
    });
});
