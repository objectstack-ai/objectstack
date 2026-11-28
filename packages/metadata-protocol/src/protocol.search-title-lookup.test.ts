// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `searchAll` titles a hit whose object's primary-title pointer (ADR-0079
// `nameField`) is a REFERENCE field by the referenced record's own title, not
// by the stored foreign key.
//
// ## The defect
//
// `renderTitle` returned `row[nameField]` as stored. For a reference-typed
// pointer (`lookup` / `master_detail` / `user`) the stored value is the target
// record's id, so the palette and global search titled such a hit by a raw key
// while the record header (`$expand`) and the activity timeline already named
// the target.
//
// ## Whose read it is
//
// The SEARCHER's. The target title is read through the engine's own `find`
// with the caller's context, so the target object's read gate, row scope and
// field-level security apply exactly as they do to a direct read or to
// `$expand`. A reader refused the target — the object, the row or the title
// column — keeps the bare id, the same answer `$expand` gives such a reader.
//
// ## What these pins hold
//
//   - the title follows the reference to the target's title (each reference
//     type, `user` included, whose target is fixed by the type);
//   - one target read per swept object, never one per hit;
//   - the hit's wire shape does not move: `record` still carries the stored id;
//   - each refusal leg keeps the bare id, and a refused object is never read;
//   - a target whose declared exposure does not serve `get` is never read;
//   - a target read that FAILS (not a refusal) fails the search, envelope
//     intact, as a failing record read already does in this sweep;
//   - a non-reference pointer pays no extra read.
//
// The engine double stands in for the middleware: it filters the target read
// by its `id $in` predicate, applies its projection, and throws the typed
// denial for an object the fake security layer refuses.

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

/** The engine middleware's typed object-level denial, as `PermissionDeniedError` carries it. */
const readDenied = () =>
    Object.assign(new Error('You do not have permission to perform this action.'), {
        name: 'PermissionDeniedError',
        code: 'PERMISSION_DENIED',
        status: 403,
        statusCode: 403,
    });

/** A source object titled by a lookup to `person`, scannable through `role`. */
const projectMember: ObjectMeta = {
    name: 'project_member',
    nameField: 'member_id',
    fields: {
        member_id: { name: 'member_id', type: 'lookup', reference: 'person' },
        role: text('role'),
    },
    searchableFields: ['role'],
};

const person: ObjectMeta = {
    name: 'person',
    nameField: 'display_name',
    fields: { display_name: text('display_name') },
};

const MEMBER_ROWS: Row[] = [
    { id: 'pm_1', member_id: 'per_1', role: 'Lead engineer' },
    { id: 'pm_2', member_id: 'per_2', role: 'Lead designer' },
    { id: 'pm_3', member_id: 'per_1', role: 'Lead reviewer' },
];

const PEOPLE: Row[] = [
    { id: 'per_1', display_name: 'Ada Lovelace' },
    { id: 'per_2', display_name: 'Grace Hopper' },
];

function harness(opts: {
    objects?: ObjectMeta[];
    rows?: Record<string, Row[]>;
    /** Objects the fake security layer admits; `'all'` admits every one. */
    readable?: Set<string> | 'all';
    /** Ids of each object the caller's row scope lets through (default: all). */
    rowScope?: Record<string, Set<string>>;
    /** Columns of each object field-level security strips from the caller's read. */
    hiddenColumns?: Record<string, Set<string>>;
    /** Leave the `security` service out, so only `find` itself can refuse. */
    withSecurity?: boolean;
    failRead?: { object: string; error: unknown };
}) {
    const objects = opts.objects ?? [projectMember, person];
    const rows = opts.rows ?? { project_member: MEMBER_ROWS, person: PEOPLE };
    const admits = (o: string) => (opts.readable ?? 'all') === 'all' || (opts.readable as Set<string>).has(o);
    const reads: Array<[string, Record<string, any>]> = [];
    const engine = {
        registry: {
            getObject: (n: string) => objects.find((o) => o.name === n),
            getAllObjects: () => objects,
            listItems: () => [],
        },
        find: vi.fn(async (object: string, options: Record<string, any>) => {
            reads.push([object, options]);
            if (!admits(object)) throw readDenied();
            if (opts.failRead?.object === object) throw opts.failRead.error;
            let out = rows[object] ?? [];
            const scope = opts.rowScope?.[object];
            if (scope) out = out.filter((r) => scope.has(String(r.id)));
            const ids = options?.where?.id?.$in;
            if (Array.isArray(ids)) out = out.filter((r) => ids.includes(r.id));
            // The engine's `$search` expansion over an object that declares
            // its searchable columns: those columns, case-folded substring
            // (ADR-0061), nothing else. An object declaring none is answered
            // whole, as these pins never search one by its auto default.
            const cols = objects.find((o) => o.name === object)?.searchableFields as string[] | undefined;
            if (typeof options?.search === 'string' && cols) {
                const needle = options.search.toLowerCase();
                out = out.filter((r) => cols.some((c) => typeof r[c] === 'string' && (r[c] as string).toLowerCase().includes(needle)));
            }
            const hidden = opts.hiddenColumns?.[object];
            const projectedRows = out.map((r) => {
                const projected: Row = {};
                for (const [k, v] of Object.entries(r)) {
                    if (hidden?.has(k)) continue;
                    if (Array.isArray(options?.fields) && !options.fields.includes(k)) continue;
                    projected[k] = v;
                }
                return projected;
            });
            // The engine's `$expand` (objectql `expandRelatedRecords`): a target
            // the caller may read is expanded; one it is refused stays the bare
            // id, unless the field declares `referenceNameVisible`, which
            // `serveReferenceNames` answers `{ id, name, readRefused: true }`,
            // the name floored to `Record #<id>` when field-level security keeps
            // the name column from the caller.
            for (const [field, nested] of Object.entries((options?.expand ?? {}) as Record<string, any>)) {
                const source = objects.find((o) => o.name === object);
                const def = (source?.fields as Record<string, any> | undefined)?.[field];
                const target: string | undefined = nested?.object ?? def?.reference ?? (def?.type === 'user' ? 'sys_user' : undefined);
                if (!def || !target) continue;
                const targetMeta = objects.find((o) => o.name === target);
                const nameColumn = targetMeta?.nameField as string | undefined;
                const answer = (id: unknown): unknown => {
                    if (id == null || typeof id === 'object') return id;
                    const row = (rows[target] ?? []).find((r) => String(r.id) === String(id));
                    if (!row) return id;
                    const inScope = !opts.rowScope?.[target] || opts.rowScope[target].has(String(id));
                    if (admits(target) && inScope) return { id: row.id };
                    if (def.referenceNameVisible !== true) return id;
                    const hiddenName = !nameColumn || opts.hiddenColumns?.[target]?.has(nameColumn);
                    const name = hiddenName ? `Record #${String(id)}` : String(row[nameColumn!]);
                    return { id: String(id), name, readRefused: true };
                };
                for (const r of projectedRows) {
                    const v = r[field];
                    r[field] = Array.isArray(v) ? v.map(answer) : answer(v);
                }
            }
            return projectedRows;
        }),
    };
    const canReadObject = vi.fn(async (o: string) => admits(o));
    const services = new Map<string, unknown>();
    if (opts.withSecurity !== false) services.set('security', { canReadObject });
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, any>);
    const targetReads = () => reads.filter(([o]) => o !== 'project_member');
    return { protocol, reads, targetReads, canReadObject, engine };
}

/** Sweeps the source object only, so every hit is a `project_member` row. */
const SWEEP = { q: 'lead', objects: ['project_member'], perObject: 5, context: MEMBER };

const titles = (hits: Array<{ id: string; title: string }>) => Object.fromEntries(hits.map((h) => [h.id, h.title]));

describe('searchAll titles a reference-typed nameField by the target record title', () => {
    it('THE PIN — a lookup pointer titles each hit by the target title, not the stored id', async () => {
        const { protocol } = harness({});

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'Ada Lovelace', pm_2: 'Grace Hopper', pm_3: 'Ada Lovelace' });
    });

    it('reads every target title in ONE read per swept object, as the searcher, id and title only', async () => {
        const { protocol, targetReads } = harness({});

        await protocol.searchAll(SWEEP);

        expect(targetReads()).toHaveLength(1);
        const [object, options] = targetReads()[0];
        expect(object).toBe('person');
        expect([...options.where.id.$in].sort()).toEqual(['per_1', 'per_2']);
        expect(options.fields).toEqual(['id', 'display_name']);
        expect(options.context).toBe(MEMBER);
    });

    it('the hit wire shape does not move: record keeps the stored id and no key is added', async () => {
        const { protocol } = harness({});

        const { hits } = await protocol.searchAll(SWEEP);

        const hit = hits.find((h) => h.id === 'pm_1')!;
        expect(Object.keys(hit).sort()).toEqual(['id', 'object', 'record', 'snippet', 'title']);
        expect(hit.record).toEqual({ id: 'pm_1', member_id: 'per_1', role: 'Lead engineer' });
    });

    it('master_detail and user pointers follow too; user reads the sys_user title with no reference declared', async () => {
        const task: ObjectMeta = {
            name: 'task_line',
            nameField: 'parent_id',
            fields: { parent_id: { name: 'parent_id', type: 'master_detail', reference: 'person' }, note: text('note') },
            searchableFields: ['note'],
        };
        const assignment: ObjectMeta = {
            name: 'assignment',
            nameField: 'owner',
            fields: { owner: { name: 'owner', type: 'user' }, note: text('note') },
            searchableFields: ['note'],
        };
        const sysUser: ObjectMeta = { name: 'sys_user', nameField: 'name', fields: { name: text('name') } };
        const { protocol, targetReads } = harness({
            objects: [task, assignment, person, sysUser],
            rows: {
                task_line: [{ id: 'tl_1', parent_id: 'per_2', note: 'review' }],
                assignment: [{ id: 'as_1', owner: 'usr_9', note: 'review' }],
                person: PEOPLE,
                sys_user: [{ id: 'usr_9', name: 'Katherine Johnson' }],
            },
        });

        const { hits } = await protocol.searchAll({ q: 'review', objects: ['task_line', 'assignment'], context: MEMBER });

        expect(titles(hits)).toEqual({ tl_1: 'Grace Hopper', as_1: 'Katherine Johnson' });
        expect(targetReads().map(([o]) => o).filter((o) => o !== 'task_line' && o !== 'assignment')).toEqual(['person', 'sys_user']);
    });

    it('REFUSED — an object-level refusal keeps the bare id, and the target is never read', async () => {
        const { protocol, targetReads, canReadObject } = harness({ readable: new Set(['project_member']) });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
        expect(canReadObject).toHaveBeenCalledWith('person', MEMBER);
        expect(targetReads()).toEqual([]);
    });

    it('REFUSED — a refusal thrown by the read itself keeps the bare id and the search answers', async () => {
        // No security service to ask first: the engine middleware's typed
        // denial on the target read is the only refusal there is.
        const { protocol, targetReads } = harness({ readable: new Set(['project_member']), withSecurity: false });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
        expect(targetReads().map(([o]) => o)).toEqual(['person']);
    });

    it('REFUSED — a row outside the caller row scope keeps its bare id; the readable one is titled', async () => {
        const { protocol } = harness({ rowScope: { person: new Set(['per_1']) } });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'Ada Lovelace', pm_2: 'per_2', pm_3: 'Ada Lovelace' });
    });

    it('REFUSED — a title column field-level security strips keeps the bare id', async () => {
        const { protocol } = harness({ hiddenColumns: { person: new Set(['display_name']) } });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
    });

    it('a target whose declared exposure does not serve get is never read and keeps the bare id', async () => {
        const listOnly: ObjectMeta = { ...person, enable: { apiMethods: ['list'] } };
        const { protocol, targetReads } = harness({ objects: [projectMember, listOnly] });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
        expect(targetReads()).toEqual([]);
    });

    it('a target read that FAILS fails the search with its own envelope', async () => {
        const outage = Object.assign(new Error('connection reset'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const { protocol } = harness({ failRead: { object: 'person', error: outage } });

        let caught: any;
        try {
            await protocol.searchAll(SWEEP);
        } catch (e) {
            caught = e;
        }
        expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
        expect(caught?.status).toBe(503);
    });

    it('CONTROL — a text pointer is titled as stored and pays no target read', async () => {
        const note: ObjectMeta = {
            name: 'project_note',
            nameField: 'headline',
            fields: { headline: text('headline') },
        };
        const { protocol, reads } = harness({
            objects: [note, person],
            rows: { project_note: [{ id: 'pn_1', headline: 'Lead time review' }], person: PEOPLE },
        });

        const { hits } = await protocol.searchAll({ q: 'lead', objects: ['project_note'], context: MEMBER });

        expect(titles(hits)).toEqual({ pn_1: 'Lead time review' });
        expect(reads.map(([o]) => o)).toEqual(['project_note']);
    });
});

// [#35308] Ruling 7077827375 (letter B): a pointer declaring
// `referenceNameVisible` titles a hit whose target the searcher is REFUSED by
// the name the engine's `$expand` serves such a reader, never by a read of the
// protocol's own. The engine double above answers the expansion as objectql's
// `serveReferenceNames` does; `packages/rest/src/search-title-reference-name-visible.test.ts`
// holds the same pins over the real security layer and driver.
describe('searchAll titles a refused target by the name referenceNameVisible serves', () => {
    const memberVisible: ObjectMeta = {
        ...projectMember,
        fields: {
            member_id: { name: 'member_id', type: 'lookup', reference: 'person', referenceNameVisible: true },
            role: text('role'),
        },
    };
    /** The reads of the SOURCE object that carry an `expand`: the name ask. */
    const nameAsks = (reads: Array<[string, Record<string, any>]>) =>
        reads.filter(([o, options]) => o === 'project_member' && options?.expand !== undefined);

    it('PIN 1 — the switch and an object-level refusal: the hit is titled by the target name', async () => {
        const { protocol, reads } = harness({ objects: [memberVisible, person], readable: new Set(['project_member']) });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'Ada Lovelace', pm_2: 'Grace Hopper', pm_3: 'Ada Lovelace' });
        // One ask, as the searcher, of the source rows holding the refused ids,
        // `id` and the pointer only, expanding the pointer: the engine names them.
        const asks = nameAsks(reads);
        expect(asks).toHaveLength(1);
        const [, options] = asks[0];
        expect([...options.where.id.$in].sort()).toEqual(['pm_1', 'pm_2', 'pm_3']);
        expect(options.fields).toEqual(['id', 'member_id']);
        expect(options.expand).toEqual({ member_id: { object: 'person', fields: ['id'] } });
        expect(options.context).toBe(MEMBER);
        // No read of the target is made by the protocol itself, and none without the caller's context.
        expect(reads.filter(([o]) => o === 'person')).toEqual([]);
        expect(reads.every(([, o]) => o.context === MEMBER)).toBe(true);
    });

    it('PIN 1 — the switch and a row-scope refusal: only the refused id is asked and named', async () => {
        const { protocol, reads } = harness({ objects: [memberVisible, person], rowScope: { person: new Set(['per_1']) } });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'Ada Lovelace', pm_2: 'Grace Hopper', pm_3: 'Ada Lovelace' });
        expect(nameAsks(reads).map(([, o]) => o.where.id.$in)).toEqual([['pm_2']]);
    });

    it('PIN 2 — without the switch, a refused target keeps the bare id and no name is asked', async () => {
        const { protocol, reads } = harness({ readable: new Set(['project_member']) });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
        expect(nameAsks(reads)).toEqual([]);
    });

    it('PIN 3 — a name column field-level security keeps from the searcher is the engine floor, never the name', async () => {
        const { protocol } = harness({
            objects: [memberVisible, person],
            readable: new Set(['project_member']),
            hiddenColumns: { person: new Set(['display_name']) },
        });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'Record #per_1', pm_2: 'Record #per_2', pm_3: 'Record #per_1' });
    });

    it('PIN 4 — a search by the target name finds nothing: the name is display only', async () => {
        const { protocol, reads } = harness({ objects: [memberVisible, person], readable: new Set(['project_member']) });

        const { hits, totalHits } = await protocol.searchAll({ ...SWEEP, q: 'Grace' });

        expect(hits).toEqual([]);
        expect(totalHits).toBe(0);
        expect(nameAsks(reads)).toEqual([]);
    });

    it('the hit wire shape does not move: record keeps the stored id, the name only titles it', async () => {
        const { protocol } = harness({ objects: [memberVisible, person], readable: new Set(['project_member']) });

        const { hits } = await protocol.searchAll(SWEEP);

        const hit = hits.find((h) => h.id === 'pm_2')!;
        expect(Object.keys(hit).sort()).toEqual(['id', 'object', 'record', 'snippet', 'title']);
        expect(hit.record).toEqual({ id: 'pm_2', member_id: 'per_2', role: 'Lead designer' });
    });

    it('CONTROL — a readable target is titled by the searcher read and is not asked again', async () => {
        const { protocol, reads } = harness({ objects: [memberVisible, person] });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'Ada Lovelace', pm_2: 'Grace Hopper', pm_3: 'Ada Lovelace' });
        expect(nameAsks(reads)).toEqual([]);
    });

    it('CONTROL — a readable target whose title column is stripped keeps the bare id: the switch lifts no field rule', async () => {
        const { protocol } = harness({ objects: [memberVisible, person], hiddenColumns: { person: new Set(['display_name']) } });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
    });

    it('CONTROL — a target whose declared exposure does not serve get is never named and keeps the bare id', async () => {
        const listOnly: ObjectMeta = { ...person, enable: { apiMethods: ['list'] } };
        const { protocol, reads } = harness({ objects: [memberVisible, listOnly], readable: new Set(['project_member']) });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ pm_1: 'per_1', pm_2: 'per_2', pm_3: 'per_1' });
        expect(nameAsks(reads)).toEqual([]);
    });

    it('a name ask that FAILS (not a refusal) fails the search with its own envelope', async () => {
        const outage = Object.assign(new Error('connection reset'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const { protocol, engine } = harness({ objects: [memberVisible, person], readable: new Set(['project_member']) });
        const find = engine.find.getMockImplementation()!;
        engine.find.mockImplementation(async (object: string, options: Record<string, any>) => {
            if (options?.expand !== undefined) throw outage;
            return find(object, options);
        });

        let caught: any;
        try {
            await protocol.searchAll(SWEEP);
        } catch (e) {
            caught = e;
        }
        expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
        expect(caught?.status).toBe(503);
    });
});
