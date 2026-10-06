// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21899] The `/meta` door answers a CODE-DEFINED datasource the way the
 * datasource-admin door does: read-only. Edits are refused; a stored row under
 * the name is removable as repair, and nothing else is.
 *
 * ## The defect
 *
 * A code-defined datasource (`*.datasource.ts`, `origin: 'code'`) is
 * registered by the runtime in the MetadataService, in memory only — never as
 * a SchemaRegistry item — so `isArtifactBacked` answered false for every one.
 * The save took the `runtime-only` intent, `datasource` declares
 * `allowRuntimeCreate: true`, and `PUT /api/v1/meta/datasource/showcase_external`
 * answered 200 and persisted an edit of a datasource the published contract
 * (`DatasourceSchema.origin`: "code — … read-only in the UI") and the admin
 * service both call read-only. Its `DELETE` answered 200 too.
 *
 * ## The ruling this file pins (triage, Q1-A and Q2-B)
 *
 *  - Q1-A: `isArtifactBacked` sees the datasources the installed packages
 *    declare (a second non-standalone-artifact resolver, beside #7743's
 *    `field` one), so the EXISTING package door and the repository's write
 *    intent refuse the save — `NOT_OVERRIDABLE` / 403, this door's own code,
 *    with a sentence naming the admin door's verdict and remedy.
 *  - Q2-B: a `DELETE` that would remove nothing is refused with that verdict;
 *    a `DELETE` of a stored row under the name stays possible, as repair.
 *  - A runtime datasource (a name no package declares) saves and deletes as
 *    before.
 *
 * Every case runs on both kernel shapes: the package door answers on an
 * environment kernel, and `SysMetadataRepository` — the same refusal one layer
 * down — on a host-config one (the showcase's shape).
 *
 * Harness: the real write path over a stub engine, the shape of
 * `protocol.legacy-overlay-delete.test.ts`, with the engine registry carrying
 * the installed package records the resolver reads.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses. From `@objectstack/metadata-core`,
// not `@objectstack/objectql`, which depends on this package.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository, resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

/** The showcase's code-defined datasource and the package that declares it. */
const CODE_DS = 'showcase_external';
const PACKAGE_ID = 'com.example.showcase';
/** A name no package declares: a runtime datasource. */
const RUNTIME_DS = 'dogfood_rt_21899';

/**
 * What the two refusals say: the admin door's verdict as the first sentence, in
 * the admin door's words, then the remedy — the wording triage ruled the
 * refusal must carry, so it is asserted beside the code and status, never
 * instead of them. Spelled out, never read back from the table under test.
 */
const SAVE_VERDICT = `Datasource '${CODE_DS}' is code-defined and cannot be edited at runtime: it is read-only.`;
const DELETE_VERDICT = `Datasource '${CODE_DS}' is code-defined and cannot be removed at runtime: it is read-only.`;
const REMEDY = 'Edit the *.datasource.ts source that declares it and redeploy.';
/** The verdict first, the remedy after it, and no operator hatch prescribed. */
const expectVerdict = (message: unknown, verdict: string) => {
    const text = String(message);
    expect(text.startsWith(`${verdict} `), text).toBe(true);
    expect(text).toContain(REMEDY);
    expect(text).not.toContain('OS_METADATA_WRITABLE');
};

/** A schema-valid datasource body, so a refusal is the door's and never a 422. */
const body = (name: string, label: string) => ({ name, label, driver: 'sqlite', config: { filename: `${name}.db` } });

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
    checksum: string;
}

/** A row a `/meta` save persisted before this refusal existed — the residue Q2-B keeps removable. */
const shadowRow = (name: string): Row => ({
    id: `row_datasource_${name}`,
    type: 'datasource',
    name,
    organization_id: null,
    package_id: null,
    state: 'active',
    metadata: JSON.stringify({ ...body(name, 'Meta Renamed before the fix'), origin: 'code' }),
    checksum: 'sha256_pre_fix_shadow',
});

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where ?? {}).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null || v === undefined) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/**
 * One kernel. `packages` are the installed package records the engine registry
 * holds — what makes a datasource code-defined; `seed` is a stored row a
 * previous process persisted.
 */
function makeSession(opts: {
    environmentId?: string;
    packages?: Array<{ manifest: Record<string, unknown> }>;
    seed?: Row[];
} = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const historyRows: Array<Record<string, unknown>> = [];

    const engine: any = {
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table === 'sys_metadata_history') {
                return historyRows.find((h) => matchesWhere(h, o.where)) ?? null;
            }
            if (table !== 'sys_metadata') return null;
            for (const row of rows.values()) if (matchesWhere(row as any, o.where)) return row;
            return null;
        },
        async find(table: string) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            return Array.from(rows.values());
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_history') {
                historyRows.push({ ...data });
                return { id: String(data.id ?? `h_${historyRows.length}`) };
            }
            if (table !== 'sys_metadata') return { id: 'side_effect_skip' };
            const row = { id: `r_${rows.size + 1}`, ...(data as any) } as Row;
            rows.set(row.id, row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const id = (o as any)?.where?.id;
            const row = rows.get(id);
            if (row) rows.set(id, { ...row, ...(data as any) });
            return { id: id ?? null };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            // [#4550] The producer's own delete-verb dispatch contract.
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const id = (o as any)?.where?.id;
            const existed = rows.delete(id);
            return { deleted: existed ? 1 : 0 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: () => [],
            // The served code definition, as the runtime's in-memory
            // registration serves it on a read.
            getItem: (type: string, name: string) =>
                (type === 'datasource' && name === CODE_DS && (opts.packages ?? []).length > 0
                    ? { ...body(CODE_DS, 'External Analytics (SQLite)'), origin: 'code' }
                    : undefined),
            applyNavContributions: (app: unknown) => app,
            // A code-defined datasource is never a SchemaRegistry item — the
            // artifact-only lookup misses it, exactly as on a booted showcase.
            getArtifactItem: () => undefined,
            getAllPackages: () => opts.packages ?? [],
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), opts.environmentId) as any;
    return { protocol, rows, historyRows };
}

/** The showcase's installed package record, in the canonical shape `registerApp` installs it. */
const SHOWCASE_PACKAGE = {
    manifest: {
        id: PACKAGE_ID,
        namespace: 'showcase',
        datasources: [{ name: CODE_DS, label: 'External Analytics (SQLite)', driver: 'sqlite', config: { filename: 'x.db' } }],
    },
};

const KERNELS: Array<{ label: string; environmentId?: string }> = [
    { label: 'host-config kernel (no environmentId)' },
    { label: 'environment kernel (environmentId set)', environmentId: 'env_test' },
];

const refusalOf = (run: Promise<unknown>) => run.then(() => null, (e: any) => e);

const resetEnvHatch = () => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
};

describe('[#21899] the resolver — a datasource an installed package declares is artifact-backed', () => {
    it('sees the declared datasource, and nothing a package does not declare', () => {
        const { protocol } = makeSession({ packages: [SHOWCASE_PACKAGE] });
        expect(protocol.isArtifactBacked('datasource', CODE_DS)).toBe(true);
        // The plural spelling folds before the read (#4432).
        expect(protocol.isArtifactBacked('datasources', CODE_DS)).toBe(true);
        expect(protocol.isArtifactBacked('datasource', RUNTIME_DS)).toBe(false);
        // The host's `default` is declared by no package: the named gap, pinned
        // as what this resolver answers so a change to it is seen.
        expect(protocol.isArtifactBacked('datasource', 'default')).toBe(false);
    });

    it('reads only the `datasource` type — another type of the same name is not made artifact-backed', () => {
        const { protocol } = makeSession({ packages: [SHOWCASE_PACKAGE] });
        expect(protocol.isArtifactBacked('object', CODE_DS)).toBe(false);
        expect(protocol.isArtifactBacked('external_catalog', CODE_DS)).toBe(false);
    });

    it('a registry with no package records answers false (nothing is guessed)', () => {
        expect(makeSession().protocol.isArtifactBacked('datasource', CODE_DS)).toBe(false);
    });

    it('both refusals arrive whole through the REST door\'s 500-character bound for an 88-character name', () => {
        // `truncateClientMessage` (packages/rest/src/error-response.ts) keeps a
        // message only while it is SHORTER than 500 characters.
        const longName = `ds_${'x'.repeat(85)}`;
        expect(longName).toHaveLength(88);
        const { protocol } = makeSession({
            packages: [{ manifest: { id: PACKAGE_ID, datasources: [{ name: longName, driver: 'sqlite', config: {} }] } }],
        });
        for (const operation of ['save', 'delete'] as const) {
            const message = String(protocol.packagedBaseRefusal({ type: 'datasource', name: longName, operation })?.message);
            expect(message.length, operation).toBeLessThan(500);
            expect(message.endsWith('See docs/adr/0062-external-datasource-runtime.md.'), operation).toBe(true);
        }
    });
});

for (const { label, environmentId } of KERNELS) {
    describe(`[#21899] the /meta door on a code-defined datasource — ${label}`, () => {
        beforeEach(resetEnvHatch);
        afterEach(resetEnvHatch);

        const session = (seed?: Row[]) => makeSession({
            ...(environmentId ? { environmentId } : {}),
            packages: [SHOWCASE_PACKAGE],
            ...(seed ? { seed } : {}),
        });

        it('PUT is refused NOT_OVERRIDABLE / 403 with the admin door\'s verdict and remedy, and stores nothing', async () => {
            const { protocol, rows, historyRows } = session();

            const err = await refusalOf(protocol.saveMetaItem({ type: 'datasource', name: CODE_DS, item: body(CODE_DS, 'Meta Renamed 21899') }));

            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expectVerdict(err.message, SAVE_VERDICT);
            expect(rows.size).toBe(0);
            expect(historyRows).toEqual([]);
        });

        it('PUT through the plural spelling is refused the same way', async () => {
            const { protocol, rows } = session();
            const err = await refusalOf(protocol.saveMetaItem({ type: 'datasources', name: CODE_DS, item: body(CODE_DS, 'x') }));
            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(rows.size).toBe(0);
        });

        it('PUT is refused whatever `origin` the body asserts (the caller sets it; the resolver never reads it)', async () => {
            const { protocol, rows } = session();
            const err = await refusalOf(protocol.saveMetaItem({
                type: 'datasource', name: CODE_DS, item: { ...body(CODE_DS, 'x'), origin: 'runtime' },
            }));
            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(rows.size).toBe(0);
        });

        it('DELETE with no stored row is refused with the same verdict, naming the removal', async () => {
            const { protocol, rows, historyRows } = session();

            const err = await refusalOf(protocol.deleteMetaItem({ type: 'datasource', name: CODE_DS }));

            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expectVerdict(err.message, DELETE_VERDICT);
            expect(rows.size).toBe(0);
            expect(historyRows).toEqual([]);
        });

        it('DELETE of a pre-existing stored row answers 200 and removes it, with its tombstone (repair)', async () => {
            const { protocol, rows, historyRows } = session([shadowRow(CODE_DS)]);

            const res = await protocol.deleteMetaItem({ type: 'datasource', name: CODE_DS });

            expect(res).toMatchObject({ success: true, reset: true });
            expect(Array.from(rows.values()).filter((r) => r.name === CODE_DS)).toEqual([]);
            expect(historyRows.some((h) => h.name === CODE_DS && h.operation_type === 'delete')).toBe(true);

            // …and the removal is not repeatable: with the row gone, the next
            // DELETE would remove nothing and is refused.
            const again = await refusalOf(protocol.deleteMetaItem({ type: 'datasource', name: CODE_DS }));
            expect({ code: again?.code, status: again?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        });

        it('the read envelope agrees with the doors: never editable, deletable only while a stored row exists', async () => {
            const flags = (r: any) => ({ lock: r.lock, editable: r.editable, deletable: r.deletable, resettable: r.resettable });
            const read = async (protocol: any) => ({
                byName: flags(await protocol.getMetaItem({ type: 'datasource', name: CODE_DS })),
                layered: flags(await protocol.getMetaItemLayered({ type: 'datasource', name: CODE_DS })),
            });

            // No stored row: PUT and DELETE are both refused (above).
            const none = await read(session().protocol);
            expect(none.byName).toEqual({ lock: 'full', editable: false, deletable: false, resettable: true });
            expect(none.layered).toEqual(none.byName);

            // A pre-existing stored row: PUT is refused, DELETE removes it (above).
            const residue = await read(session([shadowRow(CODE_DS)]).protocol);
            expect(residue.byName).toEqual({ lock: 'no-overlay', editable: false, deletable: true, resettable: true });
            expect(residue.layered).toEqual(residue.byName);
        });

        it('control: a runtime datasource still saves and deletes through this door', async () => {
            const { protocol, rows } = session();

            const saved = await protocol.saveMetaItem({ type: 'datasource', name: RUNTIME_DS, item: body(RUNTIME_DS, 'Runtime') });
            expect(saved).toMatchObject({ success: true });
            expect(Array.from(rows.values()).filter((r) => r.name === RUNTIME_DS)).toHaveLength(1);

            const updated = await protocol.saveMetaItem({ type: 'datasource', name: RUNTIME_DS, item: body(RUNTIME_DS, 'Runtime 2') });
            expect(updated).toMatchObject({ success: true });

            const removed = await protocol.deleteMetaItem({ type: 'datasource', name: RUNTIME_DS });
            expect(removed).toMatchObject({ success: true, reset: true });
            expect(Array.from(rows.values()).filter((r) => r.name === RUNTIME_DS)).toEqual([]);

            // A DELETE that removes nothing on a RUNTIME name keeps its no-op answer.
            const none = await protocol.deleteMetaItem({ type: 'datasource', name: RUNTIME_DS });
            expect(none).toMatchObject({ success: true, reset: false });
        });

        it('control: a runtime datasource whose body asserts `origin: code` is still a runtime datasource', async () => {
            const { protocol, rows } = session();
            const saved = await protocol.saveMetaItem({
                type: 'datasource', name: RUNTIME_DS, item: { ...body(RUNTIME_DS, 'Runtime'), origin: 'code' },
            });
            expect(saved).toMatchObject({ success: true });
            expect(rows.size).toBe(1);
        });

        it('[GUARD] the operator hatch opens the lock exactly as before (not this card\'s to move)', async () => {
            process.env.OS_METADATA_WRITABLE = 'datasource';
            ObjectStackProtocolImplementation.resetEnvWritableCache();
            resetEnvWritableMetadataTypes();
            const { protocol, rows } = session();
            const saved = await protocol.saveMetaItem({ type: 'datasource', name: CODE_DS, item: body(CODE_DS, 'Hatch') });
            expect(saved).toMatchObject({ success: true });
            expect(rows.size).toBe(1);
        });
    });
}

describe('[#21899] the repository delete gate lifts the origin-gated type only', () => {
    beforeEach(resetEnvHatch);
    afterEach(resetEnvHatch);

    const repoOver = (row: Row) => {
        const rows = new Map<string, Row>([[row.id, row]]);
        const engine: any = {
            async findOne(table: string, o: { where: Record<string, unknown> }) {
                assertEngineFindOnePredicate(table, o);
                if (table !== 'sys_metadata') return null;
                for (const r of rows.values()) if (matchesWhere(r as any, o.where)) return r;
                return null;
            },
            async find() { return []; },
            async insert() { return { id: 'h' }; },
            async update(_t: string, data: Record<string, unknown>, o?: Record<string, unknown>) {
                assertEngineUpdateDispatch(data, o);
                return { id: null };
            },
            async delete(table: string, o?: Record<string, unknown>) {
                assertEngineDeleteDispatch(o);
                if (table !== 'sys_metadata') return { deleted: 0 };
                return { deleted: rows.delete((o as any)?.where?.id) ? 1 : 0 };
            },
        };
        return { rows, repo: new SysMetadataRepository({ engine, organizationId: null, orgLabel: 'env' }) };
    };

    it('removes a stored row under a code-defined datasource on the override-artifact intent', async () => {
        const { rows, repo } = repoOver(shadowRow(CODE_DS));
        await repo.delete(
            { org: 'env', type: 'datasource', name: CODE_DS },
            { parentVersion: 'sha256_pre_fix_shadow', actor: null, intent: 'override-artifact' },
        );
        expect(rows.size).toBe(0);
    });

    it('[GUARD] `object`, with the same registry flags, keeps its refusal', async () => {
        const { rows, repo } = repoOver({ ...shadowRow('showcase_task'), type: 'object' });
        const err = await refusalOf(repo.delete(
            { org: 'env', type: 'object', name: 'showcase_task' },
            { parentVersion: 'sha256_pre_fix_shadow', actor: null, intent: 'override-artifact' },
        ));
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expect(rows.size).toBe(1);
    });

    it('a save of a code-defined datasource is refused at the repository with the same sentence', async () => {
        const { repo } = repoOver(shadowRow('unrelated'));
        const err = await refusalOf(repo.put(
            { org: 'env', type: 'datasource', name: CODE_DS },
            body(CODE_DS, 'x'),
            { parentVersion: null, actor: null, intent: 'override-artifact' },
        ));
        expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
        expectVerdict(err.message, SAVE_VERDICT);
    });
});
