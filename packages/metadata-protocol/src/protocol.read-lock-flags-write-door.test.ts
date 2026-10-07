// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21670, ADR-0010 §5, ADR-0126 §2] The read envelope's `lock` / `editable` /
 * `deletable` say what the write doors do with the same item.
 *
 * Both metadata reads (`getMetaItem`, `getMetaItemLayered`) publish the
 * ADR-0010 protection envelope beside the document. It was resolved from the
 * document's own `_lock` alone, so an item a code package ships, on a type
 * with no overlay channel, read `lock: 'none'`, `editable: true`,
 * `deletable: true` while every write door refused it in place (`403
 * NOT_OVERRIDABLE`, or `ITEM_LOCKED` when the write names the read-only
 * package). A client, an MCP author or an agent reading `editable` was told
 * the opposite of what the server enforces.
 *
 * The envelope now folds in `packagedBaseRefusal` — the locked-base verdict the
 * `/meta` doors and the `/automation` doors already share — so this file pins
 * the READ against the DOORS, never against that predicate (which would be
 * the predicate agreeing with itself):
 *
 *  1. a packaged flow and a packaged action read locked and not editable, on
 *     both reads and both kernels;
 *  2. an org-owned item of the same types reads unlocked and editable;
 *  3. every type in `DEFAULT_METADATA_TYPE_REGISTRY` agrees with its write
 *     doors, table-driven, on an environment kernel (the protocol's own doors,
 *     end to end) and on a host-config kernel (where the same refusal is the
 *     repository's `assertAllowed`, the first statement of `put` / `delete`);
 *  4. a lit control: the table measured refusals AND admissions for both
 *     verbs on both kernels, over the whole registry roster — so it cannot
 *     pass by measuring nothing.
 *
 * A door that ADMITS is proven to have got past every lock limb rather than
 * failing early for some other reason: on the environment kernel the ADR-0010
 * `_lock` gate (the last lock limb) was reached and answered no refusal; on
 * the host-config kernel the engine was touched, which happens only after the
 * repository's gate passed. Anything else afterwards (validation, a double
 * that does not persist) is not a lock verdict and is not read as one.
 *
 * Out of the table, deliberately: the six code-only types (`allowRuntimeCreate`
 * and `allowOrgOverride` both false) have no org-owned arm, because no runtime
 * door can author an item of those types (`NOT_CREATABLE`). Their packaged arm
 * is in the table like every other type's.
 *
 * `@objectstack/objectql` cannot be imported here: it depends on this package.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { assertEngineFindOnePredicate, isCodeArtifactBody } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';
import { SysMetadataRepository, resetEnvWritableMetadataTypes } from './sys-metadata-repository.js';
import { isOriginGatedType } from './packaged-base-regime.js';

const PACKAGE_ID = 'com.example.pkg';
const ENV_ID = 'env_1';

type Kernel = 'environment' | 'host-config';
type Arm = 'packaged' | 'org-owned';
type Verdict = 'refused' | 'admitted';

interface Flags { lock: unknown; editable: unknown; deletable: unknown }

interface StoredRow {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

/** `field` artifacts are nested in their object (`isNestedArtifactField`), so the packaged field is the object's own. */
const nameFor = (type: string, arm: Arm): string =>
    arm === 'packaged'
        ? (type === 'field' ? 'pkg_object.title' : `pkg_${type}`)
        : (type === 'field' ? 'org_object.title' : `org_${type}`);

/** What a code package's loader registered: one artifact per registry type, package-stamped. */
function artifactsFor(extra: Record<string, Record<string, unknown>> = {}): Map<string, Map<string, Record<string, unknown>>> {
    const out = new Map<string, Map<string, Record<string, unknown>>>();
    for (const { type } of DEFAULT_METADATA_TYPE_REGISTRY) {
        if (type === 'field') continue; // shipped inside `pkg_object`, below
        const name = nameFor(type, 'packaged');
        const body: Record<string, unknown> = {
            name,
            label: name,
            _packageId: PACKAGE_ID,
            _provenance: 'package',
            ...(type === 'object' ? { fields: { title: { type: 'text', label: 'Title' } } } : {}),
            ...(extra[type] ?? {}),
        };
        out.set(type, new Map([[name, body]]));
    }
    return out;
}

/** A tenant-authored row the store holds — what an org author's save leaves behind. */
const orgRow = (type: string): StoredRow => {
    const name = nameFor(type, 'org-owned');
    return {
        id: `r_${type}`,
        type,
        name,
        organization_id: null,
        package_id: null,
        state: 'active',
        metadata: JSON.stringify({ name, label: name, _provenance: 'org' }),
    };
};

/**
 * The engine double: `find` / `findOne` over `sys_metadata` rows, a registry
 * whose artifact lookup answers what the loader registered, and an `insert`
 * that keeps nothing (the `_lock` gate records its denial through it).
 */
function harness(environmentId: string | undefined, rows: StoredRow[] = [], extra: Record<string, Record<string, unknown>> = {}) {
    const artifacts = artifactsFor(extra);
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
        getPackage: () => undefined,
        isPackageDisabled: () => false,
        applyNavContributions: (app: unknown) => app,
    };
    const matching = (where: Record<string, unknown>) => {
        for (const k of Object.keys(where)) {
            if (k.startsWith('$')) throw new Error(`[test double] unsupported WHERE combinator '${k}'`);
        }
        return rows.filter((r) =>
            Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
        );
    };
    const engine: any = {
        async find(table: string, opts?: { where?: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = matching(opts?.where ?? {});
            // `check:objectql-double-limit` — the caller's bound, applied after the filter.
            return opts?.limit === undefined ? matched : matched.slice(0, opts.limit);
        },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            // `check:engine-double-contract` — refuses what the real engine refuses.
            assertEngineFindOnePredicate(table, opts);
            if (table !== 'sys_metadata') return null;
            return matching(opts?.where ?? {})[0] ?? null;
        },
        async insert() {
            return {};
        },
        registry,
    };
    return new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
}

const isLockRefusal = (e: any): boolean =>
    e instanceof Error && (e as any).status === 403
    && ((e as any).code === 'NOT_OVERRIDABLE' || (e as any).code === 'ITEM_LOCKED');

const settle = (run: Promise<unknown>) => run.then(() => null, (e: unknown) => e);

/**
 * The environment kernel's door, end to end: `saveMetaItem` / `deleteMetaItem`.
 * Admitted ⇔ the ADR-0010 `_lock` gate — reached only past the code-only, the
 * org-scope and the package refusals — was reached and refused nothing.
 */
async function environmentDoor(
    protocol: ObjectStackProtocolImplementation, type: string, name: string, operation: 'save' | 'delete',
): Promise<Verdict> {
    const gate = vi.spyOn(protocol as any, operation === 'save' ? 'assertLockAllowsWrite' : 'assertLockAllowsDelete');
    try {
        const outcome = await settle(operation === 'save'
            ? protocol.saveMetaItem({ type, name, item: { name, label: name } })
            : protocol.deleteMetaItem({ type, name }));
        if (isLockRefusal(outcome)) return 'refused';
        expect(gate, `${type}/${name} ${operation}: not refused, yet the _lock gate was never reached`).toHaveBeenCalledTimes(1);
        expect(await gate.mock.results[0]?.value).toBeNull();
        return 'admitted';
    } finally {
        gate.mockRestore();
    }
}

/**
 * The host-config kernel's door: `saveMetaItem` skips its own package door
 * there (`environmentId === undefined`) because the repository's
 * `assertAllowed` / `assertDeleteAllowed` — the first statement of `put` /
 * `delete` — answers the same refusal at the write itself. Admitted ⇔ the
 * engine was touched, which only happens past that gate.
 */
async function hostConfigDoor(type: string, name: string, operation: 'save' | 'delete', artifactBacked: boolean): Promise<Verdict> {
    const pastTheGate = new Error('past the repository gate');
    const engine: any = {
        async find() { throw pastTheGate; },
        async findOne(table: string, opts?: { where?: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            throw pastTheGate;
        },
        async transaction() { throw pastTheGate; },
    };
    const repo = new SysMetadataRepository({ engine });
    const ref = { type, name, org: 'env' } as Parameters<typeof repo.put>[0];
    const intent = artifactBacked ? 'override-artifact' : 'runtime-only';
    const outcome = await settle(operation === 'save'
        ? repo.put(ref, { name, label: name }, { parentVersion: null, actor: null, intent })
        : repo.delete(ref, { parentVersion: 'sha256:x', actor: null, intent }));
    if (isLockRefusal(outcome)) return 'refused';
    expect(outcome, `${type}/${name} ${operation}: neither refused nor past the gate`).toBe(pastTheGate);
    return 'admitted';
}

/**
 * [#21899] The host-config kernel's REMOVAL door for a packaged item of an
 * origin-gated type (`datasource`): the protocol's own delete. The repository
 * gate that {@link hostConfigDoor} measures is reached only with a stored row
 * (whose removal is repair, and admitted); with none, the protocol answers the
 * removal at its row probe, before the repository is asked — on this kernel as
 * on an environment one. Refused ⇔ that answer is a lock refusal.
 */
async function hostConfigOriginGatedRemoval(type: string, name: string, rows: StoredRow[]): Promise<Verdict> {
    const outcome = await settle(harness(undefined, rows).deleteMetaItem({ type, name }));
    if (isLockRefusal(outcome)) return 'refused';
    expect(outcome, `${type}/${name} delete: neither refused nor answered`).toBeNull();
    return 'admitted';
}

async function readFlags(protocol: ObjectStackProtocolImplementation, type: string, name: string): Promise<{ layered: Flags; byName: Flags }> {
    const pick = (r: any): Flags => ({ lock: r.lock, editable: r.editable, deletable: r.deletable });
    return {
        layered: pick(await protocol.getMetaItemLayered({ type, name })),
        byName: pick(await protocol.getMetaItem({ type, name })),
    };
}

interface Row {
    kernel: Kernel;
    arm: Arm;
    type: string;
    name: string;
    read: Flags;
    byName: Flags;
    save: Verdict;
    del: Verdict;
}

const CODE_ONLY = new Set(
    DEFAULT_METADATA_TYPE_REGISTRY.filter((e) => !e.allowOrgOverride && !e.allowRuntimeCreate).map((e) => e.type),
);

async function measure(kernel: Kernel, arm: Arm, type: string): Promise<Row> {
    const name = nameFor(type, arm);
    const rows = arm === 'org-owned' ? [orgRow(type)] : [];
    const reader = harness(kernel === 'environment' ? ENV_ID : undefined, rows);
    const { layered, byName } = await readFlags(reader, type, name);
    let save: Verdict;
    let del: Verdict;
    if (kernel === 'environment') {
        save = await environmentDoor(harness(ENV_ID, rows), type, name, 'save');
        del = await environmentDoor(harness(ENV_ID, rows), type, name, 'delete');
    } else {
        save = await hostConfigDoor(type, name, 'save', arm === 'packaged');
        del = arm === 'packaged' && isOriginGatedType(type)
            ? await hostConfigOriginGatedRemoval(type, name, rows)
            : await hostConfigDoor(type, name, 'delete', arm === 'packaged');
    }
    return { kernel, arm, type, name, read: layered, byName, save, del };
}

afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('[#21670] packaged items read locked, org-owned items read editable', () => {
    for (const environmentId of [ENV_ID, undefined]) {
        const kernel = environmentId ? 'an environment' : 'a host-config';
        it(`a packaged flow and a packaged action read lock ≠ none, editable false, deletable false (${kernel} kernel)`, async () => {
            for (const type of ['flow', 'action']) {
                const { layered, byName } = await readFlags(harness(environmentId), type, nameFor(type, 'packaged'));
                for (const flags of [layered, byName]) {
                    expect(flags.lock).not.toBe('none');
                    expect(flags.editable).toBe(false);
                    expect(flags.deletable).toBe(false);
                }
            }
        });

        it(`an org-owned flow and an org-owned action read unlocked and editable (${kernel} kernel)`, async () => {
            for (const type of ['flow', 'action']) {
                const { layered } = await readFlags(harness(environmentId, [orgRow(type)]), type, nameFor(type, 'org-owned'));
                expect(layered).toEqual({ lock: 'none', editable: true, deletable: true });
            }
        });
    }
});

describe('[#21670] every metadata type: the read envelope agrees with its write doors', () => {
    const table: Row[] = [];
    const cases: Array<{ kernel: Kernel; arm: Arm; type: string }> = [];
    for (const kernel of ['environment', 'host-config'] as const) {
        for (const { type } of DEFAULT_METADATA_TYPE_REGISTRY) {
            cases.push({ kernel, arm: 'packaged', type });
            if (!CODE_ONLY.has(type)) cases.push({ kernel, arm: 'org-owned', type });
        }
    }

    beforeAll(async () => {
        for (const c of cases) table.push(await measure(c.kernel, c.arm, c.type));
    }, 120_000);

    const row = (c: { kernel: Kernel; arm: Arm; type: string }) =>
        table.find((r) => r.kernel === c.kernel && r.arm === c.arm && r.type === c.type)!;

    for (const c of cases) {
        it(`${c.type} (${c.arm}, ${c.kernel} kernel)`, () => {
            const r = row(c);
            expect({ editable: r.read.editable, deletable: r.read.deletable })
                .toEqual({ editable: r.save === 'admitted', deletable: r.del === 'admitted' });
            // The spec's own algebra for the three fields (`MetadataProtectionEnvelopeFields`):
            // `editable` is false iff `lock` is `no-overlay` or `full`, `deletable` iff `no-delete` or `full`.
            expect(r.read.editable).toBe(!['no-overlay', 'full'].includes(r.read.lock as string));
            expect(r.read.deletable).toBe(!['no-delete', 'full'].includes(r.read.lock as string));
            // The two reads are produced by one derivation, so they cannot disagree.
            expect(r.byName).toEqual(r.read);
        });
    }

    it('lit control: the whole registry roster was measured, and each verb was both refused and admitted on each kernel', () => {
        // A floor on the roster, so a table that iterates nothing cannot pass.
        expect(DEFAULT_METADATA_TYPE_REGISTRY.length).toBeGreaterThanOrEqual(28);
        for (const kernel of ['environment', 'host-config'] as const) {
            const packaged = table.filter((r) => r.kernel === kernel && r.arm === 'packaged');
            expect(packaged.map((r) => r.type)).toEqual(DEFAULT_METADATA_TYPE_REGISTRY.map((e) => e.type));
            const onKernel = table.filter((r) => r.kernel === kernel);
            for (const verb of ['save', 'del'] as const) {
                expect(onKernel.filter((r) => r[verb] === 'refused').length, `${kernel} ${verb} refused`).toBeGreaterThan(0);
                expect(onKernel.filter((r) => r[verb] === 'admitted').length, `${kernel} ${verb} admitted`).toBeGreaterThan(0);
            }
            // …and the read answered each of the three lock states the
            // registry's flags can produce for a packaged item with no `_lock`
            // (`no-delete` needs a `_lock`; the controls below cover it).
            expect(new Set(packaged.map((r) => r.read.lock))).toEqual(new Set(['none', 'no-overlay', 'full']));
        }
    });
});

describe('[#21670] controls', () => {
    it('the operator hatch opens the packaged base, and the read says so — the same predicate the door reads', async () => {
        process.env.OS_METADATA_WRITABLE = 'flow,action';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        for (const type of ['flow', 'action']) {
            const name = nameFor(type, 'packaged');
            const { layered } = await readFlags(harness(ENV_ID), type, name);
            expect(layered).toEqual({ lock: 'none', editable: true, deletable: true });
            expect(await environmentDoor(harness(ENV_ID), type, name, 'save')).toBe('admitted');
        }
    });

    it('an item\'s own `_lock` still reads through, and joins the package verdict rather than being replaced by it', async () => {
        const extra = { view: { _lock: 'no-delete' }, flow: { _lock: 'no-delete' } };
        const view = await readFlags(harness(ENV_ID, [], extra), 'view', 'pkg_view');
        expect(view.layered).toEqual({ lock: 'no-delete', editable: true, deletable: false });
        expect(await environmentDoor(harness(ENV_ID, [], extra), 'view', 'pkg_view', 'save')).toBe('admitted');
        expect(await environmentDoor(harness(ENV_ID, [], extra), 'view', 'pkg_view', 'delete')).toBe('refused');
        const flow = await readFlags(harness(ENV_ID, [], extra), 'flow', 'pkg_flow');
        expect(flow.layered).toEqual({ lock: 'full', editable: false, deletable: false });
    });
});
