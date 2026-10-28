// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9612 — the publish gate resolves the write's PACKAGE closure from the
 * registry, end to end through `saveMetaItem`.
 *
 * The maintainer's ruling is the product decision under test, verbatim:
 *
 * > 大客户(420 个对象),就不应该出现在一个软件包中啊,这就是划分软件包的价值。
 * > 客户开发开发,校验是否也应该基于软件包
 * > 当然这里面要考虑系统对象
 *
 * `runtime-gate.package-closure.test.ts` pins the closure FUNCTION. This file
 * pins the half that lives here: reading the written package's declared
 * `manifest.dependencies` off the registry and handing the result to the gate.
 * The two halves fail differently — a correct closure function reached with no
 * scope narrows nothing, silently, forever — so both are pinned.
 *
 * ## The discriminating test is the one that expects SILENCE
 *
 * Asserting only that an out-of-closure reference gets reported would also pass
 * if the closure were empty, i.e. if narrowing had gone too far and every
 * reference dangled. So the load-bearing case here is the flow into a DECLARED
 * DEPENDENCY: it must stay clean, which it can only do if the dependency walk
 * really ran and really put `com.acme.core` in the closure. That is the #4449
 * wired-and-running-on-nothing shape, in the other direction.
 *
 * ## #24669 — the out-of-closure trigger object is REFUSED, not advised
 *
 * A flow written into a package whose trigger object (`config.objectName`, or
 * a sweep's `config.timeRelative.object`) is outside that package's closure is
 * refused `422 INVALID_METADATA` with `flow-trigger-unknown-object` at
 * `error`: the verdict the dataset and view doors give the same reference
 * under the same closure. A write that names no package, the sentinel and an
 * unreadable package state no closure and keep the advisory; a draft save is
 * not gated, and its promotion is.
 *
 * Harness: the real repository write path over a stub engine, the same shape as
 * `protocol.dashboard-dataset-publish-gate.test.ts`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine cannot
// accept a call ObjectQL refuses. From `@objectstack/metadata-core`, never from
// `@objectstack/objectql` — that import would close a cycle turbo rejects.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const OWN = 'com.acme.crm';
const DEP = 'com.acme.core';
const STRANGER = 'com.other.analytics';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
}

const keyOf = (w: Record<string, unknown>) =>
    `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}`;

const object = (name: string, packageId: string) => ({
    name,
    label: name,
    _packageId: packageId,
    fields: [{ name: 'title', type: 'text', label: 'Title' }],
});

/** A Zod-valid daily time-relative sweep over `object` — the rule's second position. */
const sweepOf = (name: string, object: string) => ({
    name,
    label: name,
    description: `sweeps ${object}`,
    version: 1,
    status: 'active',
    type: 'schedule',
    runAs: 'system',
    variables: [],
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'Daily sweep',
            config: { timeRelative: { object, dateField: 'title', withinDays: 7 } },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end', type: 'default', isDefault: false }],
});

/** A Zod-valid autolaunched flow whose start node fires on `objectName`. */
const flowOn = (name: string, objectName: string) => ({
    name,
    label: name,
    description: `fires on ${objectName}`,
    version: 1,
    status: 'active',
    type: 'autolaunched',
    variables: [],
    nodes: [
        {
            id: 'start',
            type: 'start',
            label: 'On update',
            config: { objectName, triggerType: 'record-after-update' },
        },
        { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end', type: 'default', isDefault: false }],
});

function makeStubEngine() {
    // ⚠️ Keyed BY TABLE, and that is a correctness property of this harness
    // rather than tidiness. One flat row map answers a read of `sys_metadata`
    // with rows the protocol wrote to `sys_metadata_history` and
    // `sys_metadata_commit`: a DRAFT save appends a history row carrying no
    // `state`, the declared `defaultValue: 'active'` modelled below fills it
    // in, and the draft comes back as an ACTIVE metadata row. Measured in
    // #16223, where one assertion's polarity was the only thing that caught it.
    const tables = new Map<string, Map<string, Row>>();
    const tableOf = (table: string): Map<string, Row> => {
        const existing = tables.get(table);
        if (existing) return existing;
        const created = new Map<string, Row>();
        tables.set(table, created);
        return created;
    };
    /** The store table these tests assert on; the journals get their own. */
    const rows = tableOf('sys_metadata');
    let nextId = 0;
    const findRow = (table: string, w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of tableOf(table)) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of tableOf(table)) {
            if (w.type !== undefined && r.type !== w.type) continue;
            if (w.name !== undefined && r.name !== w.name) continue;
            if (w.organization_id !== undefined && r.organization_id !== w.organization_id) continue;
            if (w.state !== undefined && r.state !== w.state) continue;
            return { key: k, row: r };
        }
        return null;
    };
    /** Three packages: the written one, the one it declares, and a stranger. */
    const packages: Record<string, { manifest: Record<string, unknown> }> = {
        [OWN]: { manifest: { name: OWN, version: '1.0.0', dependencies: { [DEP]: '^1.0.0' } } },
        [DEP]: { manifest: { name: DEP, version: '1.0.0' } },
        [STRANGER]: { manifest: { name: STRANGER, version: '1.0.0' } },
    };
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            return findRow(table, opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown> }) {
            return Array.from(tableOf(table).values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(table: string, data: Record<string, unknown>) {
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            tableOf(table).set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(table, opts.where);
            if (!found) return { id: null };
            tableOf(table).set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(table, opts.where);
            if (!found) return { deleted: 0 };
            tableOf(table).delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: (type: string) =>
                type === 'object'
                    ? [
                        object('crm_account', OWN),
                        object('core_user', DEP),
                        object('other_widget', STRANGER),
                        // [#24669] A platform object a stranger package registers,
                        // kept by the closure's `isSystem` limb.
                        { ...object('platform_ledger', STRANGER), isSystem: true },
                    ]
                    : [],
            getItem: () => undefined,
            getPackage: (id: string) => packages[id],
        },
    };
    return { engine, rows, packages };
}

function makeProtocol() {
    const { engine, rows, packages } = makeStubEngine();
    return { protocol: new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any, rows, packages };
}

const save = (protocol: any, item: any, extra: Record<string, unknown> = {}) =>
    protocol.saveMetaItem({ type: 'flow', name: item.name, item, ...extra });

const triggerAdvisories = (result: any): string[] =>
    (result.advisories ?? []).map((a: any) => a.rule).filter((r: string) => r === 'flow-trigger-unknown-object');

const activeFlowRows = (rows: Map<string, Row>) =>
    Array.from(rows.values()).filter((r) => r.type === 'flow' && r.state === 'active');

/**
 * [#24669] A refused publish-mode flow write: the ADR-0112 envelope (`code`
 * AND `status`), carrying the one closure issue at the trigger position.
 */
const expectRefusedOutsideClosure = (err: any, path: string, what: string) => {
    expect(err, `${what}: the write resolved — the door still only advises on the out-of-closure trigger`)
        .toBeInstanceOf(Error);
    expect({ code: err.code, status: err.status }).toEqual({ code: 'INVALID_METADATA', status: 422 });
    const issues = (err.issues ?? []).filter((i: any) => i.rule === 'flow-trigger-unknown-object');
    expect(issues, JSON.stringify(err.issues)).toHaveLength(1);
    expect(issues[0]).toMatchObject({ severity: 'error', path });
    // The fix names the remedy and the package it applies to.
    expect(issues[0].hint).toContain(OWN);
    expect(issues[0].hint).toContain('dependencies');
};

describe('the write package closure reaches the gate (#9612)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('keeps a DECLARED DEPENDENCY inside the closure — the discriminating case', async () => {
        const { protocol } = makeProtocol();

        const result = await save(protocol, flowOn('crm_on_core_user', 'core_user'), { packageId: OWN });

        expect(
            triggerAdvisories(result),
            `'${DEP}' is declared in '${OWN}'’s manifest.dependencies, so 'core_user' MUST be in the `
                + `closure. A report here means the dependency walk never ran and the gate is judging a `
                + `package against a closure that holds only itself — narrowing gone too far, which reads `
                + `as a phantom to every author in the product.`,
        ).toEqual([]);
        expect(result.success).toBe(true);
    });

    it('keeps the written package itself inside the closure', async () => {
        const { protocol } = makeProtocol();
        const result = await save(protocol, flowOn('crm_on_own', 'crm_account'), { packageId: OWN });
        expect(triggerAdvisories(result)).toEqual([]);
    });

    it('REFUSES a trigger object of a package the written one never declared — config.objectName', async () => {
        // ⭐ The ruling's intended consequence, pinned as a decision rather than
        // left to surprise someone: a package's declared `dependencies` bound
        // what it MAY reference, so a flow reaching into `com.other.analytics`
        // is not resolvable BY DECLARATION. [#24669] It is REFUSED — the
        // verdict the dataset and view doors give the same reference; it used
        // to be a save advisory on a 2xx.
        const { protocol, rows } = makeProtocol();

        const err = await save(protocol, flowOn('crm_on_stranger', 'other_widget'), { packageId: OWN })
            .catch((e: any) => e);

        expectRefusedOutsideClosure(err, 'flows[0].nodes[0].config.objectName', 'stranger object');
        // A gate that refuses after persisting is a log line.
        expect(activeFlowRows(rows)).toEqual([]);
    });

    it('REFUSES a sweep over an object of a package the written one never declared — config.timeRelative.object', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await save(protocol, sweepOf('crm_sweep_stranger', 'other_widget'), { packageId: OWN })
            .catch((e: any) => e);

        expectRefusedOutsideClosure(err, 'flows[0].nodes[0].config.timeRelative.object', 'stranger sweep');
        expect(activeFlowRows(rows)).toEqual([]);
    });

    it('REFUSES a trigger object that exists nowhere the same way — the closure is all the gate sees', async () => {
        const { protocol, rows } = makeProtocol();

        const err = await save(protocol, flowOn('crm_on_ghost', 'nosuch_obj'), { packageId: OWN })
            .catch((e: any) => e);

        expectRefusedOutsideClosure(err, 'flows[0].nodes[0].config.objectName', 'nosuch_obj');
        expect(activeFlowRows(rows)).toEqual([]);
    });

    it('admits the own package, a declared dependency, a platform object and a `sys_` name, at both positions', async () => {
        // `platform_ledger` is registered by the stranger package but carries
        // `isSystem: true`, so the closure keeps it; a `sys_` name is never
        // judged, carried or not — the exception is unchanged, never widened.
        for (const target of ['crm_account', 'core_user', 'platform_ledger', 'sys_user']) {
            for (const body of [flowOn(`crm_on_${target}`, target), sweepOf(`crm_sweep_${target}`, target)]) {
                const { protocol } = makeProtocol();
                const result = await save(protocol, body, { packageId: OWN });
                expect(result.success, `${body.name}`).toBe(true);
                expect(triggerAdvisories(result), `${body.name}`).toEqual([]);
            }
        }
    });

    it('a DRAFT save of the refused body is not gated — its promotion is', async () => {
        const { protocol, rows } = makeProtocol();

        const draft = await save(protocol, flowOn('crm_on_stranger', 'other_widget'), { packageId: OWN, mode: 'draft' });
        expect(draft.success).toBe(true);
        expect(activeFlowRows(rows)).toEqual([]);

        const err = await protocol.publishMetaItem({ type: 'flow', name: 'crm_on_stranger', packageId: OWN })
            .catch((e: any) => e);
        expectRefusedOutsideClosure(err, 'flows[0].nodes[0].config.objectName', 'draft promotion');
        expect(activeFlowRows(rows)).toEqual([]);
    });

    it('narrows NOTHING when the write names no package', async () => {
        // ⛔ The fallback direction, and the whole reason this is not a size
        // threshold: an unstated package buys MORE validation input, never
        // less. The identical body that is refused above is silent here,
        // because the gate is handed the whole collection exactly as before
        // #9612.
        const { protocol } = makeProtocol();

        const result = await save(protocol, flowOn('crm_on_stranger', 'other_widget'));

        expect(triggerAdvisories(result)).toEqual([]);
    });

    it('keeps the ADVISORY when the write names no package and the object exists nowhere', async () => {
        // [#24669] The overlay door states no closure, so the hedge stands:
        // advised on a 2xx, never refused, at both positions.
        for (const body of [flowOn('crm_on_ghost', 'nosuch_obj'), sweepOf('crm_sweep_ghost', 'nosuch_obj')]) {
            const { protocol } = makeProtocol();
            const result = await save(protocol, body);
            expect(result.success, body.name).toBe(true);
            expect(triggerAdvisories(result), body.name).toEqual(['flow-trigger-unknown-object']);
            expect(result.advisories.find((a: any) => a.rule === 'flow-trigger-unknown-object').severity)
                .toBe('warning');
        }
    });

    it('a promotion into a package the registry cannot produce is refused before the closure gate', async () => {
        // Its `manifest.dependencies` is the ONLY declaration of what it may
        // reference; without it there is no bound. [#20863] A flow SAVE can no
        // longer name a package the registry does not hold, and [#26921] nor
        // can the promotion: a draft stored into an installed package and
        // promoted after that package left the registry would go live bound
        // to a package that does not exist, so the named-base rule refuses it
        // first. This pinned an unnarrowed promotion there until then; the
        // same promotion with the package still installed is the
        // discriminating control, and the closure still refuses it.
        const promoted = async (uninstall: boolean) => {
            const { protocol, packages } = makeProtocol();
            await save(protocol, flowOn('crm_on_stranger', 'other_widget'), { packageId: OWN, mode: 'draft' });
            if (uninstall) delete packages[OWN];
            return protocol.publishMetaItem({ type: 'flow', name: 'crm_on_stranger', packageId: OWN });
        };

        // [#24669] Installed, the closure is in force and the promotion is
        // refused by it.
        expectRefusedOutsideClosure(
            await promoted(false).catch((e: any) => e),
            'flows[0].nodes[0].config.objectName',
            'promotion into the installed package',
        );
        const uninstalled = await promoted(true).catch((e: any) => e);
        expect({ code: uninstalled?.code, status: uninstalled?.status, packageId: uninstalled?.packageId })
            .toEqual({ code: 'WRITABLE_PACKAGE_REQUIRED', status: 422, packageId: OWN });
    });

    it('narrows NOTHING for the `sys_metadata` overlay sentinel', async () => {
        // Not a package id — the registry itself tests for exactly this string
        // before treating an item as artifact-backed.
        const { protocol } = makeProtocol();

        const result = await save(protocol, flowOn('crm_on_stranger', 'other_widget'), {
            packageId: 'sys_metadata',
        });

        expect(triggerAdvisories(result)).toEqual([]);
    });
});
