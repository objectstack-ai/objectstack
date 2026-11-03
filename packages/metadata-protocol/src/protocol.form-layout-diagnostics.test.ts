// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29196 — a form view naming a field its object lacks reads with the lint's
 * `form-field-unknown` warning in its `_diagnostics`.
 *
 * ## The defect, measured on `origin/main` before this file was written
 *
 * The body below is QA's reproduction (a stored form `ViewItem`, one section
 * naming `no_such_field`). It saved as a draft, published, and both its draft
 * read and its active read answered `_diagnostics: { valid: true }`: the door
 * judged the Zod shape only, and `validateFormLayout`, the rule that says such
 * a field "is silently skipped and never renders on the form", ran only in the
 * CLI.
 *
 * ## What is pinned
 *
 * - The draft still saves and the publish is not refused: the finding is a
 *   WARNING, so `valid` stays the schema's answer.
 * - The draft read and the active read both carry one `warnings[]` entry,
 *   located at the field reference and worded exactly as `validateFormLayout`
 *   words it (compared against the rule run in the same test).
 * - The field set is the one the door resolves for the view's object
 *   (`registry.getObject`, the served object with its extensions): a field the
 *   resolver knows is not reported.
 * - A form naming only real fields, and a form whose object does not resolve,
 *   read exactly `{ valid: true }`.
 *
 * Harness: the stub engine of `protocol.draft-publish-verdict.test.ts`, with
 * the registry's `getObject` the read path asks. Nothing on the save, read or
 * publish path is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_FIELD_UNKNOWN, FORM_SECTION_GROUP_UNKNOWN, validateFormLayout } from '@objectstack/lint';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

/** The object as authored, one declared field group among its keys. */
const authoredTask = {
    name: 'task',
    label: 'Task',
    sharingModel: 'private',
    fieldGroups: [{ key: 'details', label: 'Details' }],
    fields: {
        title: { type: 'text', label: 'Title', group: 'details' },
        status: { type: 'text', label: 'Status' },
    },
};

/**
 * The object as the registry SERVES it: the authored fields plus one an
 * extension contributes. A form naming `region__c` names a field the served
 * object has, so it must not be reported.
 *
 * [#29309] Both registry reads answer this shape, and the stub below says so:
 * `getObject` (the read's resolver) and `listItems('object')` (the publish
 * gate's universe) both go through `SchemaRegistry.resolveObject`, the overlay
 * plus every extender folded on. The stub's universe used to list the
 * authored shape, which no real registry answers.
 */
const servedTask = {
    ...authoredTask,
    fields: { ...authoredTask.fields, region__c: { type: 'text', label: 'Region' } },
};

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    package_id: string | null;
    state: string;
    metadata: string;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}|${w.state ?? 'active'}|${w.package_id ?? '__nopkg__'}`;
}

function matchesWhere(r: Row, where: Record<string, unknown>): boolean {
    for (const [k, v] of Object.entries(where)) {
        if (k === '$or') {
            if (!(v as Array<Record<string, unknown>>).some((c) => matchesWhere(r, c))) return false;
            continue;
        }
        if (v === undefined) continue;
        if (v && typeof v === 'object' && Array.isArray((v as { $in?: unknown }).$in)) {
            if (!(v as { $in: unknown[] }).$in.includes((r as any)[k])) return false;
            continue;
        }
        if ((r as any)[k] !== v) return false;
    }
    return true;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    const history: Array<Record<string, unknown>> = [];
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        if (w.package_id !== undefined) {
            const k = keyOf(w);
            const r = rows.get(k);
            return r ? { key: k, row: r } : null;
        }
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    // Field equality only: a combinator this double does not implement is
    // refused, never read as a field name.
    const matchesHistory = (h: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`history double: '${k}' is not implemented`);
            return v === undefined || h[k] === v;
        });
    const engine: any = {
        async findOne(table: string, opts: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, opts);
            if (table === 'sys_metadata_history') return history.find((h) => matchesHistory(h, opts.where)) ?? null;
            return findRow(opts.where)?.row ?? null;
        },
        async find(table: string, opts: { where: Record<string, unknown>; limit?: number }) {
            const matched = table === 'sys_metadata_history'
                ? history.filter((h) => matchesHistory(h, opts.where))
                : Array.from(rows.values()).filter((r) => matchesWhere(r, opts.where));
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            if (table === 'sys_metadata_history') {
                history.push({ id: `h_${nextId}`, ...data });
                return { id: `h_${nextId}` };
            }
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, opts);
            const found = findRow(opts.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(keyOf(merged), merged);
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            assertEngineDeleteDispatch(opts);
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async transaction<T>(cb: (ctx: any, info: { owned: boolean }) => Promise<T>): Promise<T> {
            return cb(undefined, { owned: true });
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
            // The publish gate's universe: `getAllObjects`, the same merged
            // object `getObject` serves (`resolveObject` for both).
            listItems: (type: string) => (type === 'object' ? [servedTask] : []),
            // The read path's resolver: the SERVED object, extensions folded on.
            getObject: (name: string) => (name === 'task' ? servedTask : undefined),
            // [#29435] The layered read's code layer: no package ships these
            // views, so every one is a stored row with no code layer.
            getItem: () => undefined,
            getPackage: (id: string) => (id === PKG ? { manifest: { id: PKG } } : undefined),
        },
    };
    return { engine, rows };
}
const PKG = 'app.tasks';

/** QA's reproduction shape: a stored form `ViewItem`, sections under `config`. */
function formItem(name: string, object: string, fields: string[]) {
    return {
        name,
        object,
        viewKind: 'form',
        isDefault: true,
        config: {
            type: 'tabbed',
            data: { provider: 'object', object },
            sections: [{ name: 'overview', label: 'Overview', columns: 2, fields }],
        },
    };
}

type Diagnostics = { valid: boolean; errors?: unknown[]; warnings?: Array<{ path: string; message: string }> };

async function readDiagnostics(protocol: ObjectStackProtocolImplementation, name: string, state: 'draft' | 'active') {
    const read: any = await protocol.getMetaItem({ type: 'view', name, state, packageId: PKG } as any);
    return read.item._diagnostics as Diagnostics;
}

/** The lint's own words for the item, from the rule itself — the one spelling. */
function lintMessages(item: ReturnType<typeof formItem>, object: Record<string, unknown>) {
    return validateFormLayout({ objects: [object], views: [{ name: item.name, object: item.object, form: item.config }] })
        .filter((f) => f.rule === FORM_FIELD_UNKNOWN)
        .map((f) => f.message);
}

describe('a form view naming a field its object lacks reads with the lint warning (#29196)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('the draft saves, its read warns, the publish is not refused, and the active read warns', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title', 'no_such_field']);
        const expected = lintMessages(item, servedTask);
        expect(expected).toHaveLength(1);
        expect(expected[0]).toContain('"no_such_field"');

        const saved: any = await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        expect(saved).toMatchObject({ success: true, state: 'draft' });

        const warning = { path: 'config.sections.0.fields.1', message: expected[0] };
        expect(await readDiagnostics(protocol, item.name, 'draft')).toEqual({ valid: true, warnings: [warning] });

        const published: any = await protocol.publishMetaItem({ type: 'view', name: item.name, packageId: PKG } as any);
        expect(published).toMatchObject({ success: true });

        expect(await readDiagnostics(protocol, item.name, 'active')).toEqual({ valid: true, warnings: [warning] });
    });

    it('a view container\'s named form is judged on the same door, located under its own key', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const container = {
            name: 'task',
            object: 'task',
            formViews: { edit: { type: 'simple', sections: [{ name: 'main', fields: ['no_such_field', 'title'] }] } },
        };

        await (protocol as any).saveMetaItem({ type: 'view', name: container.name, item: container, packageId: PKG, mode: 'draft' });
        const draft = await readDiagnostics(protocol, container.name, 'draft');

        expect(draft.valid).toBe(true);
        expect(draft.warnings).toEqual([{ path: 'formViews.edit.sections.0.fields.0', message: expect.stringContaining('"no_such_field"') }]);
    });

    it('control: a form naming only fields the served object has (an extension field among them) reads { valid: true }', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title', 'status', 'region__c']);

        await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        expect(await readDiagnostics(protocol, item.name, 'draft')).toEqual({ valid: true });

        await protocol.publishMetaItem({ type: 'view', name: item.name, packageId: PKG } as any);
        expect(await readDiagnostics(protocol, item.name, 'active')).toEqual({ valid: true });
    });

    it('a form whose object the door cannot resolve gets no warning', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('ghost.form', 'ghost', ['no_such_field']);

        await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        expect(await readDiagnostics(protocol, item.name, 'draft')).toEqual({ valid: true });
    });
});

// ---------------------------------------------------------------------------
// #29309 — the sibling finding on the read, and both findings on the save and
// publish answers.
//
// Measured on `origin/main` `57cde8cb` before the fix: a section naming an
// undeclared field group read `{ valid: true }` (the read let
// `form-field-unknown` through and nothing else), and an active save and a
// publish of a form naming an unknown field or group answered with no
// `advisories` key at all (`validateFormLayout` was CLI-only in
// `AUTHORING_RULES`). The publish gate's universe holds the bound object with
// its extension fields on both doors that run rules (see `servedTask`), so the
// rule is crossed to `runtimeTypes: ['view']`. A draft save runs no registry
// rule (#4463 D1), so it carries no advisory; its read does.
// ---------------------------------------------------------------------------

/** A view container whose named form `edit` carries the given sections. */
function formContainer(sections: Array<Record<string, unknown>>) {
    return { name: 'task', object: 'task', formViews: { edit: { type: 'simple', sections } } };
}

/** The lint's findings on a container, from the rule itself — the one spelling. */
function lintFindings(container: Record<string, unknown>) {
    return validateFormLayout({ objects: [servedTask], views: [container] });
}

type Advisory = { rule: string; path: string; message: string; hint: string; severity: string };

function formLayoutAdvisories(response: { advisories?: Advisory[] }): Advisory[] {
    return (response.advisories ?? []).filter(
        (a) => a.rule === FORM_FIELD_UNKNOWN || a.rule === FORM_SECTION_GROUP_UNKNOWN,
    );
}

describe('form-section-group-unknown on the read, and both findings on save and publish (#29309)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('a section naming a field group its object does not declare reads with the lint warning, draft and active', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title']);
        // A group-referencing section takes its presentation from the group,
        // so it carries no `name` / `label` of its own (the save refuses both).
        (item.config as { sections: unknown[] }).sections = [{ group: 'no_such_group' }];
        const expected = validateFormLayout({
            objects: [servedTask],
            views: [{ name: item.name, object: item.object, form: item.config }],
        }).filter((f) => f.rule === FORM_SECTION_GROUP_UNKNOWN);
        expect(expected).toHaveLength(1);

        await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        const warning = { path: 'config.sections.0.group', message: expected[0].message };
        expect(await readDiagnostics(protocol, item.name, 'draft')).toEqual({ valid: true, warnings: [warning] });

        const published: any = await protocol.publishMetaItem({ type: 'view', name: item.name, packageId: PKG } as any);
        expect(published).toMatchObject({ success: true });
        expect(await readDiagnostics(protocol, item.name, 'active')).toEqual({ valid: true, warnings: [warning] });
    });

    it('an active save naming an unknown field and an unknown group answers both as warnings, and the write lands', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const container = formContainer([
            { name: 'main', fields: ['no_such_field', 'title'] },
            { group: 'no_such_group' },
        ]);
        const expected = lintFindings(container);
        expect(expected.map((f) => f.rule).sort()).toEqual([FORM_FIELD_UNKNOWN, FORM_SECTION_GROUP_UNKNOWN]);

        const saved: any = await (protocol as any).saveMetaItem({ type: 'view', name: container.name, item: container, packageId: PKG });
        expect(saved).toMatchObject({ success: true });
        const advisories = formLayoutAdvisories(saved);
        expect(advisories.map((a) => a.severity)).toEqual(['warning', 'warning']);
        expect(advisories.map(({ rule, message, hint }) => ({ rule, message, hint })))
            .toEqual(expected.map(({ rule, message, hint }) => ({ rule, message, hint })));

        // One finding, once: the active read carries each as a warning, and
        // the read runs no runtime advisory of its own.
        const read = await readDiagnostics(protocol, container.name, 'active');
        expect(read.valid).toBe(true);
        expect(read.warnings?.map((w) => w.message).sort()).toEqual(expected.map((f) => f.message).sort());
    });

    it('a publish of a draft naming an unknown field answers it as a warning, and is not refused', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const container = formContainer([{ name: 'main', fields: ['title', 'no_such_field'] }]);
        const expected = lintFindings(container);
        expect(expected.map((f) => f.rule)).toEqual([FORM_FIELD_UNKNOWN]);

        const saved: any = await (protocol as any).saveMetaItem({ type: 'view', name: container.name, item: container, packageId: PKG, mode: 'draft' });
        expect(saved).toMatchObject({ success: true, state: 'draft' });
        // D1: a draft save runs no registry rule, so it carries no advisory.
        expect(formLayoutAdvisories(saved)).toEqual([]);

        const published: any = await protocol.publishMetaItem({ type: 'view', name: container.name, packageId: PKG } as any);
        expect(published).toMatchObject({ success: true });
        expect(formLayoutAdvisories(published).map(({ rule, message, hint, severity }) => ({ rule, message, hint, severity })))
            .toEqual([{ rule: FORM_FIELD_UNKNOWN, message: expected[0].message, hint: expected[0].hint, severity: 'warning' }]);
    });

    it('control: a form naming only real fields (an extension field among them) and a declared group answers no advisory', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const container = formContainer([
            { name: 'main', fields: ['title', 'status', 'region__c'] },
            { group: 'details' },
        ]);
        expect(lintFindings(container)).toEqual([]);

        const saved: any = await (protocol as any).saveMetaItem({ type: 'view', name: container.name, item: container, packageId: PKG });
        expect(saved).toMatchObject({ success: true });
        expect(formLayoutAdvisories(saved)).toEqual([]);
        expect(await readDiagnostics(protocol, container.name, 'active')).toEqual({ valid: true });

        await (protocol as any).saveMetaItem({ type: 'view', name: 'task', item: container, packageId: PKG, mode: 'draft' });
        const published: any = await protocol.publishMetaItem({ type: 'view', name: 'task', packageId: PKG } as any);
        expect(published).toMatchObject({ success: true });
        expect(formLayoutAdvisories(published)).toEqual([]);
    });
});

// ---------------------------------------------------------------------------
// #29309 — the Studio-saved form ViewItem on the save and publish answers.
//
// Measured on a real showcase boot before the lint's view walk learned the
// `config` rung: `PUT /meta/view/showcase_account.probe_e` (a `viewKind: 'form'`
// item naming `no_such_field`) answered no advisory, while its read warned.
// ---------------------------------------------------------------------------

describe('a form ViewItem is judged on save and publish too (#29309)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('an active save and a publish of a form item naming an unknown field answer it as a warning', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title', 'no_such_field']);
        const expected = validateFormLayout({
            objects: [servedTask],
            views: [{ name: item.name, object: item.object, form: item.config }],
        }).filter((f) => f.rule === FORM_FIELD_UNKNOWN);
        expect(expected).toHaveLength(1);
        const want = [{ rule: FORM_FIELD_UNKNOWN, message: expected[0].message, hint: expected[0].hint, severity: 'warning' }];
        const pick = (r: any) => formLayoutAdvisories(r).map(({ rule, message, hint, severity }) => ({ rule, message, hint, severity }));

        const saved: any = await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG });
        expect(saved).toMatchObject({ success: true });
        expect(pick(saved)).toEqual(want);

        await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        const published: any = await protocol.publishMetaItem({ type: 'view', name: item.name, packageId: PKG } as any);
        expect(published).toMatchObject({ success: true });
        expect(pick(published)).toEqual(want);

        // Once on the read, at the same `config` path #29196 pinned.
        expect(await readDiagnostics(protocol, item.name, 'active')).toEqual({
            valid: true,
            warnings: [{ path: 'config.sections.0.fields.1', message: expected[0].message }],
        });
    });

    it('control: a form item naming only real fields (an extension field among them) answers no advisory', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title', 'region__c']);

        const saved: any = await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG });
        expect(saved).toMatchObject({ success: true });
        expect(formLayoutAdvisories(saved)).toEqual([]);
        expect(await readDiagnostics(protocol, item.name, 'active')).toEqual({ valid: true });
    });
});

// ---------------------------------------------------------------------------
// #29435 — the layered read (`?layers=true`) of the same form view.
//
// Measured on `origin/main` `7dae3b3c` before the fix: `getMetaItemLayered`
// computed its `_diagnostics` with `computeMetadataDiagnostics` alone, so a
// published form view naming `no_such_field` read `{ valid: true }` there
// while `getMetaItem` of the same item carried the `form-field-unknown`
// warning. Studio's Interfaces pillar and item editor read the layered answer
// when no draft is pending.
// ---------------------------------------------------------------------------

async function readLayeredDiagnostics(protocol: ObjectStackProtocolImplementation, name: string) {
    const read: any = await protocol.getMetaItemLayered({ type: 'view', name, packageId: PKG });
    return read._diagnostics as Diagnostics;
}

describe('the layered read of a form view carries the same form-layout warnings (#29435)', () => {
    let warn: ReturnType<typeof vi.spyOn>;
    beforeEach(() => {
        warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });
    afterEach(() => {
        warn.mockRestore();
    });

    it('a published form view naming an unknown field warns at the same path as getMetaItem', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title', 'no_such_field']);
        const expected = lintMessages(item, servedTask);
        expect(expected).toHaveLength(1);

        await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        await protocol.publishMetaItem({ type: 'view', name: item.name, packageId: PKG } as any);

        const single = await readDiagnostics(protocol, item.name, 'active');
        const layered = await readLayeredDiagnostics(protocol, item.name);
        expect(layered).toEqual({ valid: true, warnings: [{ path: 'config.sections.0.fields.1', message: expected[0] }] });
        expect(layered).toEqual(single);
    });

    it('control: a published form naming only real fields (an extension field among them) reads { valid: true } with no warnings', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const item = formItem('task.form', 'task', ['title', 'status', 'region__c']);

        await (protocol as any).saveMetaItem({ type: 'view', name: item.name, item, packageId: PKG, mode: 'draft' });
        await protocol.publishMetaItem({ type: 'view', name: item.name, packageId: PKG } as any);

        expect(await readLayeredDiagnostics(protocol, item.name)).toEqual({ valid: true });
    });
});
