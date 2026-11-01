// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28448] The save door refuses a tenant's copy of a packaged validation rule
 * that changes what the package owns — ADR-0029 D9.2a, 2026-10-30 note; ruling
 * of record 6524229156 (letter C′: `message` and `active` are the tenant's,
 * everything else is the package's) and ruling of record 6545641964 (letter B:
 * the loud refusal sits at the save door, the load path only reports).
 *
 * The shape that reaches it: a tenant's own object, which a code package extends
 * with a rule through `objectExtensions`. The Studio GET serves the folded
 * object, so the PUT that follows carries a copy of the extension's rule. A
 * reworded or switched-off copy is the tenant's to save; a copy that changes the
 * condition or the type is refused with the ruling's prescription, and nothing
 * is written.
 *
 * Both halves are real: the `SchemaRegistry` whose `tenantRuleCopyRefusal` the
 * load report also reads, and the `ObjectStackProtocolImplementation` save
 * door, whose runtime authoring gate asks it. It lives in this package for the
 * reason its `meta-object-*-roundtrip` siblings do: `@objectstack/objectql`
 * depends on `@objectstack/metadata-protocol`, never the reverse.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#5619] The producer's OWN write-verb dispatch decisions, so the fake engine
// below cannot accept a call ObjectQL refuses.
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { SchemaRegistry } from './registry.js';
import { assertEngineFindOnePredicate } from './engine-findone-predicate.js';

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

const OBJ = 'vr_duty';
const EXT_PKG = 'com.objectstack.test.vr-extension';
const BLOCKED = "record.status == 'blocked' && record.note == null";
const PRESCRIPTION = 'To change the condition, add a rule under a new name, or change it in the package.';

/** The tenant's own object, as first saved. */
const AUTHORED = {
    name: OBJ,
    label: 'Duty',
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        status: { name: 'status', label: 'Status', type: 'text' },
        note: { name: 'note', label: 'Note', type: 'text' },
    },
};

/** The rule a code package contributes through `objectExtensions`. */
const extRule = () => ({
    type: 'script',
    name: 'ext_blocked_needs_reason',
    message: 'Say what is blocking the duty.',
    condition: BLOCKED,
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function matches(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (v === undefined) continue;
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

/** A `sys_metadata` store over a REAL {@link SchemaRegistry}. */
function makeHost() {
    const registry = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matches(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(_t: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(_t, o);
            return findRow(o.where)?.row ?? null;
        },
        async find(_t: string, o: { where: Record<string, unknown>; limit?: number }) {
            const found = Array.from(rows.values()).filter((r) => matches(r, o.where));
            return typeof o?.limit === 'number' ? found.slice(0, o.limit) : found;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: 'side_table' };
            const row = { id: `r_${++nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            return { deleted: 0 };
        },
        async transaction<T>(cb: (c: any, i: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        async syncObjectSchema() { /* no DDL in this stub */ },
        async count() { return 0; },
        async aggregate() { return []; },
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, () => new Map() as never);
    const storedBody = () => {
        const r = Array.from(rows.values()).find((row) => row.name === OBJ && row.type === 'object');
        return r ? (JSON.parse(r.metadata) as Record<string, any>) : undefined;
    };
    return { protocol, registry, storedBody };
}

/** The tenant's object saved, then extended by a code package with one rule. */
async function seeded() {
    const host = makeHost();
    await host.protocol.saveMetaItem({ type: 'object', name: OBJ, item: clone(AUTHORED) } as never);
    host.registry.registerObject({ name: OBJ, validations: [extRule()] } as never, EXT_PKG, undefined, 'extend');
    return host;
}

/**
 * The served object, as Studio holds it before the PUT: a copy, as the wire
 * gives it. An in-process read hands back the registry's own rule objects, so
 * editing it in place would edit the extension's rule too.
 */
async function served(host: { protocol: ObjectStackProtocolImplementation }) {
    return clone((await host.protocol.getMetaItem({ type: 'object', name: OBJ } as never)).item) as any;
}

/** The served object with the extension's rule copy edited by `edit`. */
async function withCopy(host: { protocol: ObjectStackProtocolImplementation }, edit: (rule: any) => void) {
    const item = await served(host);
    const copy = (item.validations as any[]).find((r) => r.name === 'ext_blocked_needs_reason');
    expect(copy, 'the served object carries the extension rule').toBeDefined();
    edit(copy);
    return item;
}

async function thrownBy(p: Promise<unknown>): Promise<any> {
    try {
        await p;
    } catch (e) {
        return e;
    }
    throw new Error('expected the save to be refused');
}

describe('[#28448] the save door judges a tenant copy of a packaged validation rule', () => {
    it('a copy that changes the condition is refused with the ruling\'s prescription, and nothing is written', async () => {
        const host = await seeded();
        const before = host.storedBody();
        const item = await withCopy(host, (rule) => { rule.condition = "record.status == 'blocked'"; });
        const err = await thrownBy(host.protocol.saveMetaItem({ type: 'object', name: OBJ, item } as never));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        const index = (item.validations as any[]).findIndex((r) => r.name === 'ext_blocked_needs_reason');
        expect(err.issues).toEqual([expect.objectContaining({
            rule: 'validation-rule-copy-changed',
            severity: 'error',
            path: `validations[${index}].condition`,
            hint: PRESCRIPTION,
        })]);
        expect(err.issues[0].message).toContain('"ext_blocked_needs_reason"');
        expect(err.issues[0].message).toContain(PRESCRIPTION);
        expect(err.rulesRun).toContain('validation-rule-copy-changed');
        expect(host.storedBody()).toEqual(before);
    });

    it('a copy that changes the type is refused, `type` named', async () => {
        const host = await seeded();
        // `cross_field` shares `script`'s condition and requires `fields`, so the
        // copy parses: what refuses it is the package owning the type.
        const item = await withCopy(host, (rule) => { rule.type = 'cross_field'; rule.fields = ['note']; });
        const err = await thrownBy(host.protocol.saveMetaItem({ type: 'object', name: OBJ, item } as never));
        expect(err).toMatchObject({ code: 'INVALID_METADATA', status: 422 });
        expect(err.issues).toEqual([expect.objectContaining({ rule: 'validation-rule-copy-changed' })]);
        expect(err.issues[0].path).toMatch(/^validations\[\d+\]\.type$/);
        expect(err.issues[0].message).toContain('`type`');
    });

    it('a reworded copy saves, and the tenant\'s sentence is stored', async () => {
        const host = await seeded();
        const item = await withCopy(host, (rule) => { rule.message = 'Tell us what blocks this duty.'; });
        const result = await host.protocol.saveMetaItem({ type: 'object', name: OBJ, item } as never);
        expect(result.success).toBe(true);
        const stored = (host.storedBody()!.validations as any[]).find((r) => r.name === 'ext_blocked_needs_reason');
        expect(stored.message).toBe('Tell us what blocks this duty.');
    });

    it('a copy switched off with `active: false` saves', async () => {
        const host = await seeded();
        const item = await withCopy(host, (rule) => { rule.active = false; });
        const result = await host.protocol.saveMetaItem({ type: 'object', name: OBJ, item } as never);
        expect(result.success).toBe(true);
        const stored = (host.storedBody()!.validations as any[]).find((r) => r.name === 'ext_blocked_needs_reason');
        expect(stored.active).toBe(false);
    });

    it('a rule under a new name saves, even with the changed condition', async () => {
        const host = await seeded();
        const item = await served(host);
        item.validations = [
            ...(item.validations as any[]),
            { ...extRule(), name: 'tenant_blocked_needs_reason', condition: "record.status == 'blocked'" },
        ];
        const result = await host.protocol.saveMetaItem({ type: 'object', name: OBJ, item } as never);
        expect(result.success).toBe(true);
        expect((host.storedBody()!.validations as any[]).map((r) => r.name)).toContain('tenant_blocked_needs_reason');
    });
});
