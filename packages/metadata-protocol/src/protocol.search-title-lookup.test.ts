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
            const hidden = opts.hiddenColumns?.[object];
            return out.map((r) => {
                const projected: Row = {};
                for (const [k, v] of Object.entries(r)) {
                    if (hidden?.has(k)) continue;
                    if (Array.isArray(options?.fields) && !options.fields.includes(k)) continue;
                    projected[k] = v;
                }
                return projected;
            });
        }),
    };
    const canReadObject = vi.fn(async (o: string) => admits(o));
    const services = new Map<string, unknown>();
    if (opts.withSecurity !== false) services.set('security', { canReadObject });
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => services as Map<string, any>);
    const targetReads = () => reads.filter(([o]) => o !== 'project_member');
    return { protocol, reads, targetReads, canReadObject };
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
