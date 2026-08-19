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
 * Harness: the real repository write path over a stub engine, the same shape as
 * `protocol.dashboard-dataset-publish-gate.test.ts`.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
// The producer's OWN write-verb dispatch decisions, so the fake engine cannot
// accept a call ObjectQL refuses. From `@objectstack/metadata-core`, never from
// `@objectstack/objectql` — that import would close a cycle turbo rejects.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
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
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        for (const [k, r] of rows) {
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
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            listItems: (type: string) =>
                type === 'object'
                    ? [object('crm_account', OWN), object('core_user', DEP), object('other_widget', STRANGER)]
                    : [],
            getItem: () => undefined,
            getPackage: (id: string) => packages[id],
        },
    };
    return { engine, rows };
}

function makeProtocol() {
    const { engine, rows } = makeStubEngine();
    return { protocol: new ObjectStackProtocolImplementation(engine, () => new Map(), 'env_test') as any, rows };
}

const save = (protocol: any, item: any, extra: Record<string, unknown> = {}) =>
    protocol.saveMetaItem({ type: 'flow', name: item.name, item, ...extra });

const triggerAdvisories = (result: any): string[] =>
    (result.advisories ?? []).map((a: any) => a.rule).filter((r: string) => r === 'flow-trigger-unknown-object');

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

    it('reports a reference into a package the written one never declared', async () => {
        // ⭐ The ruling's intended consequence, pinned as a decision rather than
        // left to surprise someone: a package's declared `dependencies` bound
        // what it MAY reference, so a flow reaching into `com.other.analytics`
        // is not resolvable BY DECLARATION. Advisory severity — it reports, it
        // does not refuse.
        const { protocol } = makeProtocol();

        const result = await save(protocol, flowOn('crm_on_stranger', 'other_widget'), { packageId: OWN });

        expect(triggerAdvisories(result)).toEqual(['flow-trigger-unknown-object']);
        expect(result.success).toBe(true);
    });

    it('narrows NOTHING when the write names no package', async () => {
        // ⛔ The fallback direction, and the whole reason this is not a size
        // threshold: an unstated package buys MORE validation input, never
        // less. The identical body that reports above is silent here, because
        // the gate is handed the whole collection exactly as before #9612.
        const { protocol } = makeProtocol();

        const result = await save(protocol, flowOn('crm_on_stranger', 'other_widget'));

        expect(triggerAdvisories(result)).toEqual([]);
    });

    it('narrows NOTHING when the registry cannot produce the written package', async () => {
        // Its `manifest.dependencies` is the ONLY declaration of what it may
        // reference; without it there is no bound, and an unbounded closure is
        // the whole collection.
        const { protocol } = makeProtocol();

        const result = await save(protocol, flowOn('crm_on_stranger', 'other_widget'), {
            packageId: 'com.never.installed',
        });

        expect(triggerAdvisories(result)).toEqual([]);
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
