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
    /** [#21944] The kernel services the protocol resolves — the host's code-datasource set among them. */
    services?: Map<string, unknown>;
    /**
     * [#21922] A registry that keeps what is registered under the bare key and
     * lists it, as the real one does, so a stored row the hydrator registers
     * (the boot pull, an unscoped list) is read back. Off: the registry lists
     * nothing, as the other cases assume.
     */
    hydrating?: boolean;
} = {}) {
    const rows = new Map<string, Row>();
    for (const r of opts.seed ?? []) rows.set(r.id, r);
    const historyRows: Array<Record<string, unknown>> = [];
    /** [#21922] The bare-key entries a hydrating registry holds, per type. */
    const registered = new Map<string, Map<string, Record<string, unknown>>>();

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
        async find(table: string, o?: { where?: Record<string, unknown>; limit?: number }) {
            if (table === 'sys_metadata_history') return historyRows;
            if (table !== 'sys_metadata') return [];
            // [#21922] The caller's predicate, as the real engine applies it:
            // the list reads one type's ACTIVE rows, so a draft row of the
            // same name must not reach it. `check:objectql-double-limit` —
            // the caller's bound, applied after the filter.
            const matched = Array.from(rows.values()).filter((row) => matchesWhere(row as any, o?.where ?? {}));
            return o?.limit === undefined ? matched : matched.slice(0, o.limit);
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
            registerItem: (type: string, item: Record<string, unknown>, keyField = 'name') => {
                if (!opts.hydrating) return;
                if (!registered.has(type)) registered.set(type, new Map());
                registered.get(type)!.set(String(item[keyField]), item);
            },
            registerObject: () => {},
            listItems: (type: string) => [...(registered.get(type)?.values() ?? [])],
            // The real registry answers the bare slot first; with nothing
            // registered there, the served code definition, as the runtime's
            // in-memory registration serves it on a read.
            getItem: (type: string, name: string) => registered.get(type)?.get(name)
                ?? (type === 'datasource' && name === CODE_DS && (opts.packages ?? []).length > 0
                    ? { ...body(CODE_DS, 'External Analytics (SQLite)'), origin: 'code' }
                    : undefined),
            isPackageDisabled: () => false,
            applyNavContributions: (app: unknown) => app,
            // A code-defined datasource is never a SchemaRegistry item — the
            // artifact-only lookup misses it, exactly as on a booted showcase.
            getArtifactItem: () => undefined,
            getAllPackages: () => opts.packages ?? [],
            removeRuntimeShadow: () => false,
            removeOverlayEntry: () => {},
        },
    };

    const protocol = new ObjectStackProtocolImplementation(engine, () => opts.services ?? new Map(), opts.environmentId) as any;
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
        // The host's `default` is declared by no package: with no host
        // code-datasource set registered, the packages alone do not see it
        // ([#21944] the set is what does — see the block at the foot of this file).
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

/**
 * [#21944] The host's `default` datasource, which no package declares. The
 * runtime registers it from code (`DefaultDatasourcePlugin`) and adds it to the
 * host's code-datasource set — the kernel service `'code-datasource-names'` —
 * in Phase 1; the resolver reads that set beside the packages, so the door
 * answers `default` as the admin door does: read-only.
 */
const CODE_NAMES_SERVICE = 'code-datasource-names';
const DEFAULT_SAVE_VERDICT = "Datasource 'default' is code-defined and cannot be edited at runtime: it is read-only.";
const DEFAULT_DELETE_VERDICT = "Datasource 'default' is code-defined and cannot be removed at runtime: it is read-only.";
const hostServices = (names: string[]) => new Map<string, unknown>([[CODE_NAMES_SERVICE, new Set(names)]]);
/**
 * The remedy `default`'s refusal must carry: no `*.datasource.ts` declares
 * `default` — the host defines it from the database the server starts with —
 * so the sentence names that, and never the source-file remedy.
 */
const HOST_REMEDY = "It is defined by the host's database configuration";
const expectHostRemedy = (message: unknown) => {
    const text = String(message);
    expect(text).toContain(HOST_REMEDY);
    expect(text).toContain('restart the server');
    expect(text).not.toContain('.datasource.ts');
    expect(text).not.toContain('OS_METADATA_WRITABLE');
};

describe('[#21944] the resolver reads the host\'s code-datasource set', () => {
    it('sees a name the host registers from code, and only the `datasource` type', () => {
        const { protocol } = makeSession({ packages: [SHOWCASE_PACKAGE], services: hostServices(['default']) });
        expect(protocol.isArtifactBacked('datasource', 'default')).toBe(true);
        expect(protocol.isArtifactBacked('datasources', 'default')).toBe(true);
        expect(protocol.isArtifactBacked('object', 'default')).toBe(false);
        // The packages' answer is unchanged beside it.
        expect(protocol.isArtifactBacked('datasource', CODE_DS)).toBe(true);
        expect(protocol.isArtifactBacked('datasource', RUNTIME_DS)).toBe(false);
    });

    it('a service under that name with no `has` is not read as a set (nothing is guessed)', () => {
        const { protocol } = makeSession({ services: new Map<string, unknown>([[CODE_NAMES_SERVICE, ['default']]]) });
        expect(protocol.isArtifactBacked('datasource', 'default')).toBe(false);
    });
});

for (const { label, environmentId } of KERNELS) {
    describe(`[#21944] the /meta door on the host's \`default\` datasource — ${label}`, () => {
        beforeEach(resetEnvHatch);
        afterEach(resetEnvHatch);

        const session = (seed?: Row[]) => makeSession({
            ...(environmentId ? { environmentId } : {}),
            packages: [SHOWCASE_PACKAGE],
            services: hostServices(['default']),
            ...(seed ? { seed } : {}),
        });

        it('PUT is refused NOT_OVERRIDABLE / 403 with the admin door\'s verdict, and stores nothing', async () => {
            const { protocol, rows, historyRows } = session();

            const err = await refusalOf(protocol.saveMetaItem({ type: 'datasource', name: 'default', item: body('default', 'Meta Renamed default') }));

            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(String(err?.message).startsWith(`${DEFAULT_SAVE_VERDICT} `), String(err?.message)).toBe(true);
            expectHostRemedy(err?.message);
            expect(rows.size).toBe(0);
            expect(historyRows).toEqual([]);
        });

        it('DELETE with no stored row is refused the same way, naming the removal', async () => {
            const { protocol, rows } = session();

            const err = await refusalOf(protocol.deleteMetaItem({ type: 'datasource', name: 'default' }));

            expect({ code: err?.code, status: err?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect(String(err?.message).startsWith(`${DEFAULT_DELETE_VERDICT} `), String(err?.message)).toBe(true);
            expectHostRemedy(err?.message);
            expect(rows.size).toBe(0);
        });

        it('DELETE of a pre-existing stored row of `default` answers 200 and removes it (repair)', async () => {
            const { protocol, rows } = session([shadowRow('default')]);

            const res = await protocol.deleteMetaItem({ type: 'datasource', name: 'default' });

            expect(res).toMatchObject({ success: true, reset: true });
            expect(Array.from(rows.values()).filter((r) => r.name === 'default')).toEqual([]);
        });

        it('side by side: `default` names the host\'s configuration, a package-declared datasource still names its source', async () => {
            const { protocol } = session();

            const host = await refusalOf(protocol.saveMetaItem({ type: 'datasource', name: 'default', item: body('default', 'x') }));
            const packaged = await refusalOf(protocol.saveMetaItem({ type: 'datasource', name: CODE_DS, item: body(CODE_DS, 'x') }));

            expect({ code: host?.code, status: host?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expect({ code: packaged?.code, status: packaged?.status }).toEqual({ code: 'NOT_OVERRIDABLE', status: 403 });
            expectHostRemedy(host?.message);
            expectVerdict(packaged?.message, SAVE_VERDICT);
            expect(String(packaged?.message)).not.toContain(HOST_REMEDY);
        });

        it('control: a runtime datasource still saves with the set registered', async () => {
            const { protocol, rows } = session();
            const saved = await protocol.saveMetaItem({ type: 'datasource', name: RUNTIME_DS, item: body(RUNTIME_DS, 'Runtime') });
            expect(saved).toMatchObject({ success: true });
            expect(Array.from(rows.values()).filter((r) => r.name === RUNTIME_DS)).toHaveLength(1);
        });
    });
}

/**
 * [#21922] The active reads DECLINE a stored row under a code-defined
 * datasource name (triage's answer A, the #20946 shape).
 *
 * A row the `/meta` door saved before it refused these names, or one an earlier
 * runtime write left, sits under a name the host registers from code. The boot
 * restore no longer registers it over the code definition, so the
 * MetadataService holds the code definition. But the by-name read still served
 * the row first (ADR-0005's read order, `findServedOverlayRow`), and the list
 * did too, because its stored rows are the higher layer over the
 * MetadataService's. Now the one predicate the reads already asked of a shipped
 * flow name (`declinesStoredRow`) answers for these names too:
 *
 *  - (a) the by-name read, the list and the layered read's `effective` serve
 *    the code definition while the row exists — the list also after the row
 *    was hydrated into the registry's bare slot (the registry half);
 *  - (b) the row stays FOUND, so `deletable` still offers the repair, and the
 *    `/meta` DELETE still removes it;
 *  - (c) a runtime datasource's stored row is served exactly as before;
 *  - (d) a draft is answered as a draft.
 *
 * The MetadataService double is the composition's: the in-memory registrations
 * the runtime made at boot, read first (`MetadataManager.get` / `list`).
 */
const CODE_LABEL = 'External Analytics (SQLite)';
const DEFAULT_LABEL = 'Host Default 21922';
const SHADOW_LABEL = 'Shadow 21922';
const RUNTIME_ROW_LABEL = 'Runtime 21922 (stored row)';
const DRAFT_LABEL = 'Draft 21922';

/** A row an earlier runtime write left under `name`: it asserts `origin: 'runtime'` and its own file. */
const residueRow = (name: string, overrides: { label?: string; state?: string } = {}): Row => ({
    id: `row_residue_${name}_${overrides.state ?? 'active'}`,
    type: 'datasource',
    name,
    organization_id: null,
    package_id: null,
    state: overrides.state ?? 'active',
    metadata: JSON.stringify({
        ...body(name, overrides.label ?? SHADOW_LABEL),
        origin: 'runtime',
        config: { filename: `shadow-${name}.db` },
    }),
    checksum: `sha256_residue_${name}`,
});

/** The `metadata` service: what the runtime registered in memory, read first. */
const metadataServiceOf = (items: Array<Record<string, unknown>>) => {
    const byName = new Map(items.map((it) => [String(it.name), it] as const));
    const read = (type: string, name: string) => (type === 'datasource' ? byName.get(name) : undefined);
    return {
        get: async (type: string, name: string) => read(type, name),
        getDiagnosed: async (type: string, name: string) => ({ data: read(type, name), degraded: false, errors: [] as string[] }),
        list: async (type: string) => (type === 'datasource' ? [...byName.values()] : []),
    };
};

/**
 * The two code definitions (`AppPlugin`, `DefaultDatasourcePlugin`), and the
 * runtime datasource as the restore registered it, under a label its row does
 * not carry, so the control can tell which layer answered.
 */
const IN_MEMORY: Array<Record<string, unknown>> = [
    { ...body(CODE_DS, CODE_LABEL), origin: 'code', _packageId: PACKAGE_ID },
    { name: 'default', label: DEFAULT_LABEL, driver: 'sqlite', config: { filename: 'host.db' }, origin: 'code' },
    { ...body(RUNTIME_DS, 'Runtime 21922 (MetadataService copy)'), origin: 'runtime' },
];

for (const { label, environmentId } of KERNELS) {
    describe(`[#21922] the active reads decline a stored row under a code-defined datasource name — ${label}`, () => {
        beforeEach(resetEnvHatch);
        afterEach(resetEnvHatch);

        const session = (seed: Row[]) => makeSession({
            ...(environmentId ? { environmentId } : {}),
            packages: [SHOWCASE_PACKAGE],
            services: new Map<string, unknown>([
                [CODE_NAMES_SERVICE, new Set([CODE_DS, 'default'])],
                ['metadata', metadataServiceOf(IN_MEMORY)],
            ]),
            seed,
            hydrating: true,
        });
        const byName = (protocol: any, request: Record<string, unknown>) =>
            protocol.getMetaItem({ type: 'datasource', ...request });
        const listed = async (protocol: any, name: string): Promise<Array<Record<string, any>>> =>
            ((await protocol.getMetaItems({ type: 'datasource' })).items as Array<Record<string, any>>)
                .filter((it) => it.name === name);
        /** The boot pull's call (`loadMetaFromDb`): the row, hydrated under the registry's bare key. */
        const hydrate = (protocol: any, row: Row) => {
            protocol.hydrateOverlayIntoRegistry('datasource', JSON.parse(row.metadata), { organizationId: null });
            expect(protocol.engine.registry.getItem('datasource', row.name)?.label).toBe(SHADOW_LABEL);
        };

        it('(a) by name: the code definition is served while the row exists, and the envelope still offers the repair', async () => {
            const { protocol, rows } = session([residueRow(CODE_DS)]);

            for (const type of ['datasource', 'datasources']) {
                const read = await byName(protocol, { type, name: CODE_DS });
                expect(read.item, type).toMatchObject({ origin: 'code', label: CODE_LABEL, _packageId: PACKAGE_ID });
                expect(read.item.config, type).toEqual({ filename: `${CODE_DS}.db` });
                expect({ editable: read.editable, deletable: read.deletable }, type).toEqual({ editable: false, deletable: true });
            }
            expect(rows.size).toBe(1);
        });

        it('(a) in the list: one entry under the name, the code definition, before and after the row is hydrated into the registry', async () => {
            const row = residueRow(CODE_DS);
            const { protocol } = session([row]);

            const before = await listed(protocol, CODE_DS);
            hydrate(protocol, row);
            const after = await listed(protocol, CODE_DS);

            for (const list of [before, after]) {
                expect(list.map((it) => it.label)).toEqual([CODE_LABEL]);
                expect(list[0]).toMatchObject({ origin: 'code', _packageId: PACKAGE_ID });
            }
            // The by-name read agrees with the list after the hydration too.
            expect((await byName(protocol, { name: CODE_DS })).item.label).toBe(CODE_LABEL);
        });

        it('(a) the host\'s `default`, which no package declares, the same way', async () => {
            const row = residueRow('default');
            const { protocol } = session([row]);

            expect((await byName(protocol, { name: 'default' })).item).toMatchObject({ origin: 'code', label: DEFAULT_LABEL });
            hydrate(protocol, row);
            expect((await listed(protocol, 'default')).map((it) => it.label)).toEqual([DEFAULT_LABEL]);
        });

        it('(a) the layered read: `effective` is the code definition, and the row is still reported in `overlay`', async () => {
            const { protocol } = session([residueRow(CODE_DS)]);

            const layered = await protocol.getMetaItemLayered({ type: 'datasource', name: CODE_DS });

            expect(layered.effective).toMatchObject({ origin: 'code', label: CODE_LABEL });
            expect(layered.code).toMatchObject({ origin: 'code', label: CODE_LABEL });
            expect(layered.overlay).toMatchObject({ origin: 'runtime', label: SHADOW_LABEL });
            expect(layered.overlayScope).toBe('env');
            expect({ editable: layered.editable, deletable: layered.deletable }).toEqual({ editable: false, deletable: true });
        });

        it('(b) the /meta DELETE still removes the row (the repair), and the reads serve the code definition after it', async () => {
            const { protocol, rows } = session([residueRow(CODE_DS)]);

            const res = await protocol.deleteMetaItem({ type: 'datasource', name: CODE_DS });

            expect(res).toMatchObject({ success: true, reset: true });
            expect(rows.size).toBe(0);
            const read = await byName(protocol, { name: CODE_DS });
            expect(read.item).toMatchObject({ origin: 'code', label: CODE_LABEL });
            expect(read.deletable).toBe(false);
            expect((await listed(protocol, CODE_DS)).map((it) => it.label)).toEqual([CODE_LABEL]);
        });

        it('(c) control: a runtime datasource\'s stored row is still served, by name and in the list', async () => {
            const row = residueRow(RUNTIME_DS, { label: RUNTIME_ROW_LABEL });
            const { protocol } = session([row]);

            expect((await byName(protocol, { name: RUNTIME_DS })).item).toMatchObject({ label: RUNTIME_ROW_LABEL });
            expect((await listed(protocol, RUNTIME_DS)).map((it) => it.label)).toEqual([RUNTIME_ROW_LABEL]);
            const layered = await protocol.getMetaItemLayered({ type: 'datasource', name: RUNTIME_DS });
            expect(layered.effective).toMatchObject({ label: RUNTIME_ROW_LABEL });
        });

        it('(d) a draft is answered as a draft: the strict draft read and the preview arm serve the draft row', async () => {
            const { protocol } = session([residueRow(CODE_DS), residueRow(CODE_DS, { state: 'draft', label: DRAFT_LABEL })]);

            expect((await byName(protocol, { name: CODE_DS, state: 'draft' })).item).toMatchObject({ label: DRAFT_LABEL });
            expect((await byName(protocol, { name: CODE_DS, previewDrafts: true })).item).toMatchObject({ label: DRAFT_LABEL, _draft: true });
            // The active read beside them still serves the code definition.
            expect((await byName(protocol, { name: CODE_DS })).item).toMatchObject({ label: CODE_LABEL });
        });
    });
}
