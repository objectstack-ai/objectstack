// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22220, #8184] The package door answers BEFORE the checks that judge the
 * body, on both kernel topologies — one request, one refusal.
 *
 * `saveMetaItem`'s package door (`refusePackagedBaseOverride`) refuses an
 * in-place write onto an item a code package ships, on a type with no per-org
 * overlay channel (`allowOrgOverride: false`). It used to be asked only on an
 * environment kernel (`environmentId !== undefined`); a host-config kernel —
 * the CLI's assembler, the showcase's boot shape — met the same predicate only
 * at the repository write (`SysMetadataRepository.assertAllowed`, the first
 * statement of `repo.put`), which is that method's last act. So on that kernel
 * every refusal in between answered first: a publish of a packaged object
 * whose body the runtime authoring gate refuses answered `422
 * INVALID_METADATA`, while an environment kernel answered `403
 * NOT_OVERRIDABLE` for the same request; a body the spec-conformance parse
 * refuses did the same in draft and publish mode. The author was told to fix
 * findings no write through this door could ever land.
 *
 * This file pins the request against BOTH kernels, row by row, asserting the
 * ADR-0112 envelope (`code` + `status`) per kernel:
 *
 *  1. a packaged `object`, `position` and `permission` — whatever the body —
 *     answers the package door's refusal on both kernels, and the gate that
 *     would have judged the body is never reached;
 *  2. controls, unchanged: an environment-local object with a gate-refused or
 *     a spec-refused body still answers `422 INVALID_METADATA` on both
 *     kernels; a packaged item of a type that allows overlays
 *     (`allowOrgOverride: true`) and a packaged object with the
 *     `OS_METADATA_WRITABLE` hatch open are still judged by the gates;
 *  3. every type in `DEFAULT_METADATA_TYPE_REGISTRY`: the same packaged
 *     publish gives the same envelope on both kernels, and every type the
 *     door governs answers it.
 *
 * Nothing in a refused row is persisted. `@objectstack/objectql` cannot be
 * imported here: it depends on this package.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';

const PACKAGE_ID = 'com.example.pkg';
const ENV_ID = 'env_1';

type Kernel = 'environment' | 'host-config';
const KERNELS: ReadonlyArray<readonly [Kernel, string | undefined]> = [
    ['environment', ENV_ID],
    ['host-config', undefined],
];

interface Envelope { code: unknown; status: unknown }

/** `field` artifacts are nested in their object, so the packaged field is the packaged object's own. */
const packagedName = (type: string): string => (type === 'field' ? 'pkg_object.title' : `pkg_${type}`);

/** What a code package's loader registered: one artifact per registry type, package-stamped. */
function packagedArtifacts(): Map<string, Map<string, Record<string, unknown>>> {
    const out = new Map<string, Map<string, Record<string, unknown>>>();
    for (const { type } of DEFAULT_METADATA_TYPE_REGISTRY) {
        if (type === 'field') continue; // shipped inside `pkg_object`, below
        const name = packagedName(type);
        out.set(type, new Map([[name, {
            name,
            label: name,
            ...(type === 'object' ? { fields: { title: { type: 'text', label: 'Title' } } } : {}),
            _packageId: PACKAGE_ID,
            _provenance: 'package',
        }]]));
    }
    return out;
}

/**
 * The engine double: the registry answers what the loader registered; the
 * store holds nothing; `insert` records every row it is handed, so a refused
 * row can be proven unpersisted. `manifests` holds the booted code package,
 * which makes it a read-only base (`isWritablePackage`).
 */
function harness(environmentId: string | undefined) {
    const artifacts = packagedArtifacts();
    const inserted: Array<{ table: string; data: Record<string, unknown> }> = [];
    const registry = {
        getArtifactItem(type: string, name: string) {
            const hit = artifacts.get(type)?.get(name);
            return hit && isCodeArtifactBody(hit) ? hit : undefined;
        },
        getItem(type: string, name: string) {
            return artifacts.get(type)?.get(name);
        },
        listItems(type: string) {
            return [...(artifacts.get(type)?.values() ?? [])];
        },
        getObject: () => undefined,
        registerObject: () => undefined,
        registerItem: () => undefined,
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const engine: any = {
        async find(_table: string, opts?: { limit?: number }) {
            // `check:objectql-double-limit` — the caller's bound, applied after the (empty) filter.
            const matched: unknown[] = [];
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            return null;
        },
        async insert(table: string, data: Record<string, unknown>) {
            inserted.push({ table, data });
            return { id: `r_${inserted.length}` };
        },
        manifests: new Map([[PACKAGE_ID, {}]]),
        registry,
    };
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
    const persisted = () => inserted.filter((r) => r.table === 'sys_metadata');
    return { protocol, persisted };
}

/** A body the runtime authoring gate refuses and the spec parse accepts: the autonumber names a field the object lacks. */
const gateRefusedObject = (name: string) => ({
    name,
    label: name,
    sharingModel: 'private',
    fields: {
        title: { type: 'text', label: 'Title' },
        task_no: { type: 'autonumber', label: 'Task No', autonumberFormat: '{plan_no}{000}' },
    },
});

/** A body the spec-conformance parse refuses: an undeclared top-level key. */
const specRefused = (body: Record<string, unknown>) => ({ ...body, zz_undeclared_key: 1 });

/** A body every check before the store accepts (the `sharingModel` keeps `security-owd-unset` quiet). */
const servedObject = (name: string) => ({
    name,
    label: name,
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
});

interface Probe {
    envelope: Envelope;
    issues: unknown;
    gateReached: boolean;
    persistedRows: number;
}

async function probe(
    environmentId: string | undefined,
    request: { type: string; name: string; item: unknown; mode?: 'draft' | 'publish'; packageId?: string },
): Promise<Probe> {
    const { protocol, persisted } = harness(environmentId);
    const gate = vi.spyOn(protocol as any, 'assertRuntimeAuthoringRules');
    try {
        const outcome = await protocol.saveMetaItem(request).then(
            () => null,
            (e: unknown) => e as Record<string, unknown>,
        );
        expect(outcome, `${request.type}/${request.name}: the save was ADMITTED`).not.toBeNull();
        return {
            envelope: { code: outcome!.code, status: outcome!.status },
            issues: outcome!.issues,
            gateReached: gate.mock.calls.length > 0,
            persistedRows: persisted().length,
        };
    } finally {
        gate.mockRestore();
    }
}

const NOT_OVERRIDABLE: Envelope = { code: 'NOT_OVERRIDABLE', status: 403 };
const ITEM_LOCKED: Envelope = { code: 'ITEM_LOCKED', status: 403 };
const INVALID_METADATA: Envelope = { code: 'INVALID_METADATA', status: 422 };

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('[#22220] a packaged publish answers the package door on both kernels', () => {
    interface Row {
        label: string;
        request: { type: string; name: string; item: unknown; mode?: 'draft' | 'publish'; packageId?: string };
        expected: Envelope;
    }
    const rows: Row[] = [
        {
            label: 'packaged object, the served body, publish',
            request: { type: 'object', name: 'pkg_object', item: servedObject('pkg_object') },
            expected: NOT_OVERRIDABLE,
        },
        {
            label: 'packaged object, a body the authoring gate refuses, publish',
            request: { type: 'object', name: 'pkg_object', item: gateRefusedObject('pkg_object') },
            expected: NOT_OVERRIDABLE,
        },
        {
            label: 'packaged object, a body the authoring gate refuses, draft (drafts stay ungated)',
            request: { type: 'object', name: 'pkg_object', item: gateRefusedObject('pkg_object'), mode: 'draft' },
            expected: NOT_OVERRIDABLE,
        },
        {
            label: 'packaged object, a body the spec parse refuses, publish',
            request: { type: 'object', name: 'pkg_object', item: specRefused(servedObject('pkg_object')) },
            expected: NOT_OVERRIDABLE,
        },
        {
            label: 'packaged object, a body the spec parse refuses, draft',
            request: { type: 'object', name: 'pkg_object', item: specRefused(servedObject('pkg_object')), mode: 'draft' },
            expected: NOT_OVERRIDABLE,
        },
        {
            label: 'packaged object named under its read-only package, a body the authoring gate refuses, publish',
            request: { type: 'object', name: 'pkg_object', item: gateRefusedObject('pkg_object'), packageId: PACKAGE_ID },
            expected: ITEM_LOCKED,
        },
        {
            label: 'packaged position (security domain), a body the spec parse refuses, publish',
            request: { type: 'position', name: 'pkg_position', item: specRefused({ name: 'pkg_position', label: 'Pkg' }) },
            expected: NOT_OVERRIDABLE,
        },
        {
            label: 'packaged permission (security domain), a body the spec parse refuses, publish',
            request: { type: 'permission', name: 'pkg_permission', item: specRefused({ name: 'pkg_permission', label: 'Pkg' }) },
            expected: NOT_OVERRIDABLE,
        },
    ];

    for (const row of rows) {
        for (const [kernel, environmentId] of KERNELS) {
            it(`${row.label} → ${row.expected.status} ${row.expected.code} (${kernel} kernel)`, async () => {
                const result = await probe(environmentId, row.request);
                expect(result.envelope).toEqual(row.expected);
                expect(result.gateReached, 'the door answers before the authoring gate').toBe(false);
                expect(result.persistedRows, 'a refusal persists nothing').toBe(0);
            });
        }
    }
});

describe('[#22220] controls: the gates still judge what the door does not refuse', () => {
    it('an environment-local object with a body the authoring gate refuses → 422 INVALID_METADATA, gate reached (both kernels)', async () => {
        for (const [kernel, environmentId] of KERNELS) {
            const result = await probe(environmentId, { type: 'object', name: 'local_object', item: gateRefusedObject('local_object') });
            expect(result.envelope, kernel).toEqual(INVALID_METADATA);
            expect(result.gateReached, kernel).toBe(true);
            // The ONE finding, so the rest of the body is gate-clean: the packaged rows above are refused for the door alone.
            const rules = (result.issues as Array<{ rule?: string }>).map((i) => i.rule);
            expect(rules, kernel).toEqual(['autonumber-references-unknown-field']);
            expect(result.persistedRows, kernel).toBe(0);
        }
    });

    it('an environment-local object with a body the spec parse refuses → 422 INVALID_METADATA (both kernels)', async () => {
        for (const [kernel, environmentId] of KERNELS) {
            const result = await probe(environmentId, { type: 'object', name: 'local_object', item: specRefused(servedObject('local_object')) });
            expect(result.envelope, kernel).toEqual(INVALID_METADATA);
            const codes = (result.issues as Array<{ code?: string }>).map((i) => i.code);
            expect(codes, kernel).toContain('unrecognized_keys');
            expect(result.persistedRows, kernel).toBe(0);
        }
    });

    it('a packaged item of a type that allows overlays (view) with a body the spec parse refuses → 422 INVALID_METADATA (both kernels)', async () => {
        for (const [kernel, environmentId] of KERNELS) {
            const result = await probe(environmentId, {
                type: 'view', name: 'pkg_view', item: specRefused({ name: 'pkg_view', label: 'Pkg' }),
            });
            expect(result.envelope, kernel).toEqual(INVALID_METADATA);
            expect(result.persistedRows, kernel).toBe(0);
        }
    });

    it('a packaged object with the OS_METADATA_WRITABLE hatch open and a body the spec parse refuses → 422 INVALID_METADATA (both kernels)', async () => {
        process.env.OS_METADATA_WRITABLE = 'object';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        for (const [kernel, environmentId] of KERNELS) {
            const result = await probe(environmentId, { type: 'object', name: 'pkg_object', item: specRefused(servedObject('pkg_object')) });
            expect(result.envelope, kernel).toEqual(INVALID_METADATA);
            expect(result.persistedRows, kernel).toBe(0);
        }
    });
});

describe('[#22220] every registry type: one packaged publish, one envelope, on both kernels', () => {
    const governed = new Set(
        DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => !e.allowOrgOverride && e.allowRuntimeCreate).map((e) => e.type),
    );

    for (const { type } of DEFAULT_METADATA_TYPE_REGISTRY) {
        it(`${type}${governed.has(type) ? ' (the door governs it)' : ''}`, async () => {
            const name = packagedName(type);
            const request = { type, name, item: specRefused({ name, label: name }) };
            const byKernel: Record<string, Envelope> = {};
            for (const [kernel, environmentId] of KERNELS) {
                const result = await probe(environmentId, request);
                byKernel[kernel] = result.envelope;
                expect(result.persistedRows, `${type} (${kernel})`).toBe(0);
            }
            expect(byKernel['host-config'], `${type}: the kernels disagree`).toEqual(byKernel.environment);
            if (governed.has(type)) expect(byKernel.environment, type).toEqual(NOT_OVERRIDABLE);
        });
    }

    it('lit control: the door governs object, position and permission, and leaves view to the gates', () => {
        expect([...governed]).toEqual(expect.arrayContaining(['object', 'position', 'permission']));
        expect(governed.has('view')).toBe(false);
    });
});
