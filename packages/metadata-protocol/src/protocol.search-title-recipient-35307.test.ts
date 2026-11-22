// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `searchAll` titles a hit whose object's primary-title pointer (ADR-0079
// `nameField`) is a RECIPIENT id — a text column declared
// `widget: 'recipient-picker'` with `dependsOn: ['recipient_type']`, the
// declaration `sys_record_share.recipient_id` carries — by the recipient the
// id names, not by the stored id.
//
// ## The defect
//
// The reference-pointer follow (`readReferenceTitles`) reaches only a pointer
// `referenceTargetOf` answers for. A recipient id is a plain text column whose
// target varies per row with `recipient_type`, so the palette titled every
// record-share hit by a raw user id while the console's record page and list
// (its `recipient-picker` face) already named the user.
//
// ## Whose read it is
//
// The SEARCHER's, as for a reference pointer: the ids are grouped by the
// directory object their row's kind names (`user` → `sys_user`,
// `unit_and_subordinates` → `sys_business_unit`, …) and each directory is read
// once through the same gates. A refused reader keeps the bare id; a read that
// fails (not a refusal) fails the search, envelope intact; a kind with no
// record directory (`group`, `position`) keeps the bare id and pays no read.
//
// The engine double stands in for the middleware, as in
// `protocol.search-title-lookup.test.ts`: it filters by `id $in`, applies its
// projection, and throws the typed denial for an object the fake security
// layer refuses.

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

/** The recipient-id declaration `sys_record_share.recipient_id` carries. */
const recipientId = { name: 'recipient_id', type: 'text', widget: 'recipient-picker', dependsOn: ['recipient_type'] };

/** A grant table titled by its recipient, scannable through `reason`. */
const recordShare = (overrides: Record<string, unknown> = {}): ObjectMeta => ({
    name: 'sys_record_share',
    nameField: 'recipient_id',
    fields: {
        recipient_type: { name: 'recipient_type', type: 'select' },
        recipient_id: { ...recipientId, ...overrides },
        reason: text('reason'),
    },
    searchableFields: ['reason'],
});

const sysUser: ObjectMeta = { name: 'sys_user', nameField: 'name', fields: { name: text('name') } };
const sysBusinessUnit: ObjectMeta = { name: 'sys_business_unit', nameField: 'name', fields: { name: text('name') } };

const SHARE_ROWS: Row[] = [
    { id: 'rs_1', recipient_type: 'user', recipient_id: 'usr_1', reason: 'audit review' },
    { id: 'rs_2', recipient_type: 'user', recipient_id: 'usr_2', reason: 'audit handover' },
    { id: 'rs_3', recipient_type: 'unit_and_subordinates', recipient_id: 'bu_1', reason: 'audit scope' },
    { id: 'rs_4', recipient_type: 'group', recipient_id: 'grp_1', reason: 'audit group' },
    { id: 'rs_5', recipient_type: 'position', recipient_id: 'sales_rep', reason: 'audit position' },
];

const DIRECTORY_ROWS: Record<string, Row[]> = {
    sys_user: [
        { id: 'usr_1', name: 'Ada Lovelace' },
        { id: 'usr_2', name: 'Grace Hopper' },
    ],
    sys_business_unit: [{ id: 'bu_1', name: 'EMEA Sales' }],
};

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
    const objects = opts.objects ?? [recordShare(), sysUser, sysBusinessUnit];
    const rows = opts.rows ?? { sys_record_share: SHARE_ROWS, ...DIRECTORY_ROWS };
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
    const directoryReads = () => reads.filter(([o]) => o !== 'sys_record_share');
    return { protocol, reads, directoryReads, canReadObject };
}

/** Sweeps the grant table only, so every hit is a `sys_record_share` row. */
const SWEEP = { q: 'audit', objects: ['sys_record_share'], perObject: 10, context: MEMBER };

const titles = (hits: Array<{ id: string; title: string }>) => Object.fromEntries(hits.map((h) => [h.id, h.title]));

const BARE = { rs_1: 'usr_1', rs_2: 'usr_2', rs_3: 'bu_1', rs_4: 'grp_1', rs_5: 'sales_rep' };

describe('searchAll titles a recipient-id nameField by the recipient its kind names', () => {
    it('THE PIN — a user and a business-unit recipient are titled by name; group and position keep the stored value', async () => {
        const { protocol } = harness({});

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({
            rs_1: 'Ada Lovelace',
            rs_2: 'Grace Hopper',
            rs_3: 'EMEA Sales',
            rs_4: 'grp_1',
            rs_5: 'sales_rep',
        });
    });

    it('reads each directory ONCE, as the searcher, id and title only; a kind with no directory pays no read', async () => {
        const { protocol, directoryReads } = harness({});

        await protocol.searchAll(SWEEP);

        expect(directoryReads().map(([o]) => o)).toEqual(['sys_user', 'sys_business_unit']);
        const [, userRead] = directoryReads()[0];
        expect([...userRead.where.id.$in].sort()).toEqual(['usr_1', 'usr_2']);
        expect(userRead.fields).toEqual(['id', 'name']);
        expect(userRead.context).toBe(MEMBER);
        expect(directoryReads()[1][1].where.id.$in).toEqual(['bu_1']);
    });

    it('the hit wire shape does not move: record keeps the stored id and no key is added', async () => {
        const { protocol } = harness({});

        const { hits } = await protocol.searchAll(SWEEP);

        const hit = hits.find((h) => h.id === 'rs_1')!;
        expect(Object.keys(hit).sort()).toEqual(['id', 'object', 'record', 'snippet', 'title']);
        expect(hit.record).toEqual(SHARE_ROWS[0]);
    });

    it('REFUSED — a reader refused the directory object keeps the bare id, and it is never read', async () => {
        const { protocol, directoryReads, canReadObject } = harness({
            readable: new Set(['sys_record_share', 'sys_business_unit']),
        });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ ...BARE, rs_3: 'EMEA Sales' });
        expect(canReadObject).toHaveBeenCalledWith('sys_user', MEMBER);
        expect(directoryReads().map(([o]) => o)).toEqual(['sys_business_unit']);
    });

    it('REFUSED — a refusal thrown by the directory read itself keeps the bare id and the search answers', async () => {
        const { protocol } = harness({ readable: new Set(['sys_record_share']), withSecurity: false });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual(BARE);
    });

    it('REFUSED — a recipient outside the row scope or behind field-level security keeps its bare id', async () => {
        const { protocol } = harness({
            rowScope: { sys_user: new Set(['usr_1']) },
            hiddenColumns: { sys_business_unit: new Set(['name']) },
        });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ ...BARE, rs_1: 'Ada Lovelace' });
    });

    it('a row whose recipient_type the searcher may not read names no kind: bare id, no directory read', async () => {
        const { protocol, directoryReads } = harness({ hiddenColumns: { sys_record_share: new Set(['recipient_type']) } });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual(BARE);
        expect(directoryReads()).toEqual([]);
    });

    it('a directory whose table was never provisioned titles nothing; every hit is still answered', async () => {
        const { protocol } = harness({ failRead: { object: 'sys_user', error: new Error('no such table: sys_user') } });

        const { hits } = await protocol.searchAll(SWEEP);

        expect(titles(hits)).toEqual({ ...BARE, rs_3: 'EMEA Sales' });
    });

    it('a directory read that FAILS fails the search with its own envelope — never answered as untitled', async () => {
        const outage = Object.assign(new Error('connection reset'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const { protocol } = harness({ failRead: { object: 'sys_user', error: outage } });

        let caught: any;
        try {
            await protocol.searchAll(SWEEP);
        } catch (e) {
            caught = e;
        }
        expect(caught?.code).toBe('SERVICE_UNAVAILABLE');
        expect(caught?.status).toBe(503);
    });

    it('the declaration decides, not the object name: another object carrying it is titled the same way', async () => {
        const grant: ObjectMeta = { ...recordShare(), name: 'project_grant' };
        const { protocol } = harness({
            objects: [grant, sysUser, sysBusinessUnit],
            rows: { project_grant: SHARE_ROWS.slice(0, 1), ...DIRECTORY_ROWS },
        });

        const { hits } = await protocol.searchAll({ ...SWEEP, objects: ['project_grant'] });

        expect(titles(hits)).toEqual({ rs_1: 'Ada Lovelace' });
    });

    it('CONTROL — a text pointer without the recipient-picker declaration is titled as stored and pays no read', async () => {
        for (const overrides of [{ widget: undefined }, { dependsOn: undefined }]) {
            const { protocol, directoryReads } = harness({ objects: [recordShare(overrides), sysUser, sysBusinessUnit] });

            const { hits } = await protocol.searchAll(SWEEP);

            expect(titles(hits)).toEqual(BARE);
            expect(directoryReads()).toEqual([]);
        }
    });

    it('CONTROL — a reference-typed nameField still follows its declared target', async () => {
        const assignment: ObjectMeta = {
            name: 'assignment',
            nameField: 'owner',
            fields: { owner: { name: 'owner', type: 'user' }, note: text('note') },
            searchableFields: ['note'],
        };
        const { protocol } = harness({
            objects: [assignment, sysUser],
            rows: { assignment: [{ id: 'as_1', owner: 'usr_2', note: 'audit' }], ...DIRECTORY_ROWS },
        });

        const { hits } = await protocol.searchAll({ ...SWEEP, objects: ['assignment'] });

        expect(titles(hits)).toEqual({ as_1: 'Grace Hopper' });
    });
});
