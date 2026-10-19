// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23712, ADR-0029 D9.9 — a DRAFT save naming no package of an object its
 * package-less definition owns (the `'sys_metadata'` sentinel) is judged at the
 * draft address its write lands in, and refused before writing when that
 * address is a package's draft, with a way out that reaches the package-less
 * draft.
 *
 * ## The defect
 *
 * The save door asked `classifyObjectContribution` with the request's package,
 * which a draft save naming no package leaves empty (the repository resolves
 * its binding, #11087), so the sentinel owner read `own`. The write then landed
 * at the draft address (`packagelessDraftAddress`, `resolveWriteHead`'s rule):
 * over active rows `[package-less, Q]` (the rows #23514's defect stored) that
 * is Q's draft, a new one, the stored one, or the package-unbound draft adopted
 * into Q; over `[package-less]` with only Q's draft stored it is Q's draft too.
 * The save answered `200` for a draft no publish can serve: the promote door
 * refuses it (#23514).
 *
 * ## The answer, and its way out
 *
 * Refused `422 OBJECT_OVERLAY_PACKAGE_MISMATCH` with nothing written, as the
 * publish-mode save naming no package is over the same rows. The text names,
 * in order, Q's row delete (by naming Q) and, with no package-unbound draft
 * stored, each package draft's discard (by naming its package): deleting the
 * row alone leaves Q's draft, which the address then still names. Each pin
 * parses those steps from the text itself, sends them, and boots: the same
 * draft save lands in the package-less draft, and the table, its records and
 * the served definition are unchanged.
 *
 * ## The pins
 *
 *  - the four draft states over `[package-less, Q]` (none, package-unbound,
 *    Q's, both), the lone Q draft over `[package-less]`, and a row with two
 *    packages' drafts over `[package-less, Q]`;
 *  - CONTROL: over the package-less owner with no package row and no package
 *    draft, the draft save writes the package-unbound draft, unchanged;
 *  - CONTROL: an object a code package owns answers what it answered before.
 *
 * The publish-mode saves and the promote doors over the same rows are pinned
 * by `protocol-sentinel-owner-package-save-refusal.test.ts`.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL, type EngineReadOptions } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/**
 * In-memory driver, copied from `protocol-sentinel-owner-package-save-refusal.test.ts`;
 * equality-only WHERE. `dropTable` records the tables a run drops, so a pin can
 * say none was.
 */
function makeMemoryDriver(stores: Stores, drops: string[]) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them.
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            const id = (data.id as string) ?? `r_${randomUUID()}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
        async dropTable(object: string) { drops.push(object); stores.delete(object); },
    };
    return driver;
}

const P = 'com.qa.p';
const Q = 'com.qa.q';
const NAME = 'qa_probe_gadget';
const SENTINEL = 'sys_metadata';
const PATH = `/api/v1/meta/object/${NAME}`;
/** The data plane's reads and writes in these pins run as the system. */
const SYSTEM: EngineReadOptions = { context: { isSystem: true } };

/** A runtime object body; `label` tells the writes apart. */
const gadgetBody = (label: string) => ({
    name: NAME,
    label,
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
    },
});

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    protocol: any;
}

/** One request a refusal text names, as the protocol call the REST door makes for it. */
type Step = { op: 'delete'; packageId?: string; state?: string } | { op: 'resend' };

/**
 * The steps a refusal text names, in its order: `DELETE PATH?QUERY`, each
 * `then ?QUERY` after it (the same DELETE with that query), and
 * `send this save again`. A text that names a request this does not know
 * fails the pin, never skips it.
 */
function stepsOf(message: string): Step[] {
    const steps: Step[] = [];
    const re = new RegExp(
        `DELETE ${PATH.replace(/\//g, '\\/')}\\?(\\S+?)(?=,| \\(|$)|then \\?(\\S+?)(?=,| \\(|$)|(send this save again)`, 'g',
    );
    for (const m of message.matchAll(re)) {
        if (m[3]) { steps.push({ op: 'resend' }); continue; }
        const query = new URLSearchParams(m[1] ?? m[2]);
        const known = [...query.keys()].every((key) => key === 'package' || key === 'state');
        expect(known, `a step names an unknown parameter: ${m[0]}`).toBe(true);
        steps.push({
            op: 'delete',
            ...(query.get('package') ? { packageId: query.get('package')! } : {}),
            ...(query.get('state') ? { state: query.get('state')! } : {}),
        });
    }
    return steps;
}

describe('#23712 — a draft save naming no package of an object its package-less definition owns', () => {
    const live: ObjectKernel[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
    });

    /** One boot over `stores`: a kernel, a fresh engine, and `loadMetaFromDb` run by the plugin's start. */
    async function boot(stores: Stores, drops: string[]): Promise<Booted> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores, drops), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        return { kernel, engine, protocol: kernel.getService('protocol') };
    }

    /** The object's stored rows as `state:binding:label`, sorted. */
    const storedRows = (stores: Stores, table: 'sys_metadata' | 'sys_metadata_history' = 'sys_metadata') =>
        Array.from(stores.get(table)?.values() ?? [])
            .filter((r) => r.type === 'object' && r.name === NAME)
            .map((r) => {
                const body = typeof r.metadata === 'string' ? JSON.parse(r.metadata as string) : r.metadata as any;
                return `${r.state ?? ''}:${r.package_id ?? '-'}:${body?.label ?? ''}`;
            })
            .sort();

    const draftSave = (k: Booted, packageId?: string) => k.protocol.saveMetaItem({
        type: 'object', name: NAME, mode: 'draft', ...(packageId ? { packageId } : {}), item: gadgetBody('Draft sent'),
    });

    /** The registry's owner, the data plane's definition, the metadata read's served row, and the records. */
    async function served(k: Booted) {
        const read = await k.protocol.getMetaItem({ type: 'object', name: NAME });
        const records = await k.engine.find(NAME, {}, SYSTEM);
        return {
            owner: k.engine.registry.getObjectOwner(NAME)?.packageId,
            dataPlaneLabel: (k.engine.registry.getObject(NAME) as { label?: string } | undefined)?.label,
            metaReadLabel: (read?.item ?? read)?.label,
            records: records.length,
        };
    }

    /**
     * The object saved naming no package, with two records in its table; then
     * each package's active row and each draft stored beside it as earlier
     * doors stored them; then a boot over those rows.
     */
    async function seed(
        stores: Stores, drops: string[], rows: readonly string[], drafts: ReadonlyArray<string | null>,
    ): Promise<Booted> {
        const k0 = await boot(stores, drops);
        expect((await k0.protocol.saveMetaItem({ type: 'object', name: NAME, item: gadgetBody('Gadget unbound') })).success)
            .toBe(true);
        await k0.engine.insert(NAME, { name: 'rec-1' }, SYSTEM);
        await k0.engine.insert(NAME, { name: 'rec-2' }, SYSTEM);
        await k0.kernel.shutdown();
        const table = stores.get('sys_metadata')!;
        const unbound = Array.from(table.values()).find((r) => r.type === 'object' && r.name === NAME)!;
        const store = (id: string, pkg: string | null, state: string, label: string) => {
            const body = typeof unbound.metadata === 'string'
                ? JSON.parse(unbound.metadata as string)
                : { ...(unbound.metadata as Record<string, unknown>) };
            body.label = label;
            table.set(id, {
                ...unbound, id, package_id: pkg, state,
                metadata: typeof unbound.metadata === 'string' ? JSON.stringify(body) : body,
            });
        };
        for (const pkg of rows) store(`legacy_row_${pkg}`, pkg, 'active', `Gadget ${pkg} legacy`);
        for (const pkg of drafts) store(`draft_${pkg ?? 'unbound'}`, pkg, 'draft', `Draft ${pkg ?? 'unbound'}`);
        // The boot names the way out for each package row in a warn; these pins read the save's.
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const k = await boot(stores, drops);
            expect(k.engine.registry.getObjectOwner(NAME)?.packageId).toBe(SENTINEL);
            return k;
        } finally {
            warn.mockRestore();
        }
    }

    const CELLS: ReadonlyArray<{
        title: string;
        rows: string[];
        drafts: Array<string | null>;
        /** The package the write was addressed to. */
        into: string;
        /** The steps the text names, in order, before `send this save again`. */
        steps: Step[];
        /** Package drafts the walk leaves stored, beside the package-less draft it writes. */
        left: string[];
    }> = [
        {
            title: '`[package-less, Q]`, no draft (the save wrote a new Q draft)',
            rows: [Q], drafts: [], into: Q, left: [],
            steps: [{ op: 'delete', packageId: Q }],
        },
        {
            title: '`[package-less, Q]`, the package-unbound draft (the save adopted it into Q)',
            rows: [Q], drafts: [null], into: Q, left: [],
            steps: [{ op: 'delete', packageId: Q }],
        },
        {
            title: '`[package-less, Q]`, Q\'s draft (deleting Q\'s row alone leaves it addressed)',
            rows: [Q], drafts: [Q], into: Q, left: [],
            steps: [{ op: 'delete', packageId: Q }, { op: 'delete', packageId: Q, state: 'draft' }],
        },
        {
            title: '`[package-less, Q]`, the package-unbound draft and Q\'s (the address keeps the unbound one once Q\'s row is gone)',
            rows: [Q], drafts: [null, Q], into: Q, left: [`draft:${Q}:Draft ${Q}`],
            steps: [{ op: 'delete', packageId: Q }],
        },
        {
            title: '`[package-less]`, Q\'s draft alone (no package row: the address is the one package\'s draft)',
            rows: [], drafts: [Q], into: Q, left: [],
            steps: [{ op: 'delete', packageId: Q, state: 'draft' }],
        },
        {
            title: '`[package-less, Q]`, P\'s and Q\'s drafts (each package draft is discarded by its package)',
            rows: [Q], drafts: [P, Q], into: Q, left: [],
            steps: [
                { op: 'delete', packageId: Q },
                { op: 'delete', packageId: P, state: 'draft' },
                { op: 'delete', packageId: Q, state: 'draft' },
            ],
        },
    ];

    for (const cell of CELLS) {
        it(`${cell.title}: refused before writing, and the steps its text names land the package-less draft, across a boot`, async () => {
            const stores: Stores = new Map();
            const drops: string[] = [];
            const k = await seed(stores, drops, cell.rows, cell.drafts);
            const rowsBefore = storedRows(stores);
            const historyBefore = storedRows(stores, 'sys_metadata_history');

            const err = await draftSave(k).then(() => null, (e: any) => e);
            expect(err).toBeInstanceOf(Error);
            expect(err.code).toBe('OBJECT_OVERLAY_PACKAGE_MISMATCH');
            expect(err.status).toBe(422);
            expect(err.packageId).toBe(cell.into);
            expect(err.ownerPackageId).toBeNull();
            expect(err.message).toMatch(new RegExp(
                `^A draft save naming no package of object '${NAME}' writes a draft bound to `
                + `'${cell.into.replace(/\./g, '\\.')}', which no publish can serve`,
            ));
            expect(err.message).toMatch(/ Nothing was written\.$/);
            // The REST door bounds a 4xx message at 500 characters, tail truncated.
            expect(err.message.length).toBeLessThanOrEqual(500);
            // Nothing written: no row, no history entry.
            expect(storedRows(stores)).toEqual(rowsBefore);
            expect(storedRows(stores, 'sys_metadata_history')).toEqual(historyBefore);

            // The way out, parsed from the text and sent in its order.
            const steps = stepsOf(err.message);
            expect(steps).toEqual([...cell.steps, { op: 'resend' }]);
            for (const step of steps) {
                const res = step.op === 'resend'
                    ? await draftSave(k)
                    : await k.protocol.deleteMetaItem({
                        type: 'object', name: NAME,
                        ...(step.packageId ? { packageId: step.packageId } : {}),
                        ...(step.state ? { state: step.state } : {}),
                    });
                expect(res.success, JSON.stringify(step)).toBe(true);
            }

            const landed = [`active:-:Gadget unbound`, `draft:-:Draft sent`, ...cell.left].sort();
            expect(storedRows(stores)).toEqual(landed);
            expect(await served(k)).toEqual({
                owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
            });

            await k.kernel.shutdown();
            const k2 = await boot(stores, drops);
            expect(storedRows(stores)).toEqual(landed);
            expect(await served(k2)).toEqual({
                owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
            });
            // The draft save goes on as before after the boot, into the package-less draft.
            expect((await draftSave(k2)).success).toBe(true);
            expect(storedRows(stores)).toEqual(landed);
            expect(drops).toEqual([]);
        });
    }

    it('CONTROL: over the package-less owner with no package row and no package draft, the draft save writes the package-unbound draft', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await seed(stores, drops, [], []);

        expect((await draftSave(k)).success).toBe(true);
        expect(storedRows(stores)).toEqual(['active:-:Gadget unbound', 'draft:-:Draft sent']);

        await k.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(storedRows(stores)).toEqual(['active:-:Gadget unbound', 'draft:-:Draft sent']);
        expect(await served(k2)).toEqual({
            owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
        });
    });

    it('CONTROL: an object a code package owns answers the draft save naming no package as before', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        // The package's object as `registerApp` registers it: contributors only,
        // with the package provenance a loader stamps.
        k.engine.registry.registerObject(
            { ...gadgetBody('Gadget code'), _packageId: P, _provenance: 'package' } as any,
            P,
        );
        expect(k.engine.registry.getPackagedObjectOwner(NAME)?.packageId).toBe(P);

        const err = await draftSave(k).then(() => null, (e: any) => e);
        // [ADR-0131 D6] Managed content is sealed, so the package door answers
        // ahead of the D9.9 check (measured with the new question removed too).
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('NOT_OVERRIDABLE');
        expect(err.status).toBe(403);
        expect(storedRows(stores)).toEqual([]);
        expect(k.engine.registry.getPackagedObjectOwner(NAME)?.packageId).toBe(P);
    });
});
