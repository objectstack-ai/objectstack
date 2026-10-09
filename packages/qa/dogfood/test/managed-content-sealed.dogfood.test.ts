// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0131 D6] Managed content is sealed — on a BOOTED app, through the REST
// door a browser crosses, with the `OS_METADATA_WRITABLE` hatch open.
//
// The hatch used to open a write onto, and a removal of, an item a managed
// package ships, for every type it named. Measured on the CRM app before this
// change, with `OS_METADATA_WRITABLE=flow,object,permission,position`:
//
//   PUT    /meta/flow/crm_convert_lead_wizard          200, an overlay row
//   PUT    /meta/object/crm_lead (a field relabelled)  200, an overlay row
//   PUT    /meta/position/sales_rep                    200, an overlay row
//   PUT    /automation/crm_convert_lead_wizard         200, re-registered
//   DELETE /meta/flow|object/... over a stored row     200, the row removed
//   DELETE /meta/object/crm_lead?dropStorage=true      200 — and the managed
//          object was gone from the data plane: POST /data/crm_lead answered
//          404 OBJECT_NOT_FOUND, GET /data/crm_lead 500 DATABASE_ERROR.
//
// (`PUT /meta/permission/crm_sales_user` was already refused, by
// plugin-security's packaged-permission-set lock; the protocol's package door
// now answers it first.) Each of those is now the answer the shut hatch gives:
// 403 `NOT_OVERRIDABLE`, nothing written, nothing removed.
//
// The controls — what the seal leaves open, measured on the same boot:
//  - a regime-O overlay: a packaged VIEW is overlaid and its overlay removed;
//  - a NEW flow, through `PUT /meta/flow/:name` and through `POST /automation`
//    (the card's positive control: creating a new flow in Studio works);
//  - the switch: `POST /automation/:name/toggle` turns the managed flow off and
//    on (this `single`-posture boot is inert to the operator wall, whose
//    walled-posture pins are `runtime/src/domains/activation-gate*.test.ts`);
//  - the clone: a sibling under a NEW name, carrying no linkage key;
//  - the #6960 repair: removing a stored overlay row of a type whose loader
//    merges it at read (`permission`, `position`) restores the package's
//    definition and stays allowed.
//
// The "stored row" a removal needs is the row a pre-seal hatch write left: it
// is written through the protocol's own repository with the `runtime-only`
// intent — the one write the seal does not judge — standing in for that
// legacy row. The dispatcher transport is pinned in
// `runtime/src/meta-managed-content-seal.test.ts` (its `/meta` door serves no
// DELETE), the legacy spelling `OBJECTSTACK_METADATA_WRITABLE` there and in
// `rest/src/rest-meta-managed-seal-hatch.test.ts`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crmStack from '@objectstack/example-crm';
import { bootStack, type VerifyStack } from '@objectstack/verify';

const HATCH = 'flow,object,field,permission,position';
const FLOW = 'crm_convert_lead_wizard';
const OBJECT = 'crm_lead';
const PERMISSION = 'crm_sales_user';
const POSITION = 'sales_rep';
const VIEW = 'crm_opportunity.all';

type Json = Record<string, any>;

/** The served document's authorable keys — the envelope and every `_` stamp dropped. */
const ENVELOPE_KEYS = new Set([
    'editable', 'deletable', 'lock', 'lockReason', 'lockSource', 'lockDocsUrl', 'provenance',
    'packageId', 'packageVersion', 'resettable', 'version', 'etag',
]);
const authorable = (doc: Json | undefined): Json =>
    Object.fromEntries(Object.entries(doc ?? {}).filter(([k]) => !k.startsWith('_') && !ENVELOPE_KEYS.has(k)));

describe('[ADR-0131 D6] managed content is sealed — the hatch opens nothing a managed package ships (CRM, REST)', () => {
    let stack: VerifyStack;
    let token: string;
    let priorWritable: string | undefined;

    beforeAll(async () => {
        // Set before the boot: both readers memoise the variable on first use.
        priorWritable = process.env.OS_METADATA_WRITABLE;
        process.env.OS_METADATA_WRITABLE = HATCH;
        stack = await bootStack(crmStack as never, { automation: true } as never);
        token = await stack.signIn();
    }, 240_000);

    afterAll(async () => {
        await stack?.stop?.();
        if (priorWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
        else process.env.OS_METADATA_WRITABLE = priorWritable;
    });

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack.apiAs(token, method, path, body);
        const text = await res.text();
        let json: Json = {};
        try { json = JSON.parse(text) as Json; } catch { json = { raw: text }; }
        return { status: res.status, json, code: (json.code ?? json.error?.code) as unknown, text };
    };
    const served = async (type: string, name: string): Promise<Json> => {
        const r = await call('GET', `/meta/${type}/${name}`);
        expect(r.status, `GET ${type}/${name}: ${r.text}`).toBe(200);
        return (r.json.data?.item ?? r.json.data ?? r.json.item ?? r.json) as Json;
    };
    const storedRows = async (type: string, name: string) => {
        const ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as {
            find(object: string, options?: unknown): Promise<Json[]>;
        };
        return ql.find('sys_metadata', {
            where: { type, name },
            context: { isSystem: true, positions: [], permissions: [] },
        });
    };
    /** A pre-seal overlay row, written through the protocol's own repository (see the header). */
    const legacyRow = async (type: string, name: string, body: Json) => {
        const protocol = (await stack.kernel.getServiceAsync('protocol')) as any;
        const repo = protocol.getOverlayRepo(null);
        const ref = { type, name, org: 'env' };
        const current = await repo.get(ref, { state: 'active' });
        await repo.put(ref, body, {
            parentVersion: current?.hash ?? null,
            actor: null,
            source: 'dogfood.legacy-hatch-row',
            intent: 'runtime-only',
            state: 'active',
        });
    };
    const expectSealed = (r: { status: number; code: unknown; text: string }, what: string) => {
        expect(r.status, `${what}: ${r.text}`).toBe(403);
        expect(r.code, what).toBe('NOT_OVERRIDABLE');
        expect(r.text, what).toContain('managed package');
    };

    it('premise: the hatch is open — the type listing still advertises it for flow', async () => {
        // The listing's type-level flag is the hatch's own reading; this pins
        // that the boot really runs with it open, so every refusal below is
        // the seal and not a shut hatch.
        const r = await call('GET', '/meta/types');
        const entries = (r.json.data?.entries ?? r.json.entries ?? []) as Json[];
        const flow = entries.find((e) => e?.type === 'flow');
        expect(flow).toMatchObject({ allowOrgOverride: true, overrideSource: 'env' });
    });

    it('PUT of a managed flow, object (a field relabelled), field, permission set and position — 403, no row', async () => {
        const flow = authorable(await served('flow', FLOW));
        const object = authorable(await served('object', OBJECT));
        const relabelled = { ...object, fields: { ...object.fields, name: { ...object.fields?.name, label: 'Renamed' } } };
        const permission = authorable(await served('permission', PERMISSION));
        const position = authorable(await served('position', POSITION));

        for (const [type, name, body] of [
            ['flow', FLOW, { ...flow, label: 'Edited in place' }],
            ['object', OBJECT, relabelled],
            ['field', `${OBJECT}.name`, { name: 'name', type: 'text', label: 'Renamed' }],
            ['permission', PERMISSION, { ...permission, label: 'Edited in place' }],
            ['position', POSITION, { ...position, label: 'Edited in place' }],
        ] as const) {
            expectSealed(await call('PUT', `/meta/${type}/${name}`, body), `PUT ${type}/${name}`);
            expect(await storedRows(type, name), `${type}/${name}`).toEqual([]);
        }
    });

    it('PUT /automation/:name of the managed flow — 403, the engine keeps the shipped definition', async () => {
        const flow = authorable(await served('flow', FLOW));
        expectSealed(await call('PUT', `/automation/${FLOW}`, { ...flow, label: 'Edited in place' }), 'PUT /automation');
        expect((await served('flow', FLOW)).label).toBe(flow.label);
    });

    it('DELETE of a managed flow and object over a stored row — 403, the row stays', async () => {
        await legacyRow('flow', FLOW, { ...authorable(await served('flow', FLOW)), label: 'Pre-seal overlay' });
        const object = authorable(await served('object', OBJECT));
        await legacyRow('object', OBJECT, { ...object, label: 'Pre-seal overlay' });
        for (const [type, name] of [['flow', FLOW], ['object', OBJECT]] as const) {
            expectSealed(await call('DELETE', `/meta/${type}/${name}`), `DELETE ${type}/${name}`);
            expect(await storedRows(type, name), `${type}/${name}`).toHaveLength(1);
        }
    });

    it('DELETE ?dropStorage=true of the managed object — 403, and its data plane stays up', async () => {
        // The removal the hatch used to open dropped the managed object's
        // table and took it off the data plane (see the header).
        const before = await call('POST', `/data/${OBJECT}`, { name: 'Seal probe — before' });
        expect(before.status, before.text).toBeLessThan(300);
        expectSealed(await call('DELETE', `/meta/object/${OBJECT}?dropStorage=true`), 'DELETE ?dropStorage=true');
        const after = await call('POST', `/data/${OBJECT}`, { name: 'Seal probe — after' });
        expect(after.status, after.text).toBeLessThan(300);
        const list = await call('GET', `/data/${OBJECT}`);
        expect(list.status, list.text).toBe(200);
    });

    it('control (#6960): removing a stored overlay row of a permission set and a position restores the package\'s definition', async () => {
        for (const [type, name] of [['permission', PERMISSION], ['position', POSITION]] as const) {
            const shipped = authorable(await served(type, name));
            await legacyRow(type, name, { ...shipped, label: 'Pre-seal overlay' });
            const r = await call('DELETE', `/meta/${type}/${name}`);
            expect(r.status, `${type}/${name}: ${r.text}`).toBe(200);
            expect(r.text, `${type}/${name}`).toContain('reset to artifact default');
            expect(await storedRows(type, name), `${type}/${name}`).toEqual([]);
        }
    });

    it('control (regime O): a packaged VIEW is overlaid, and its overlay removed', async () => {
        const view = authorable(await served('view', VIEW));
        const put = await call('PUT', `/meta/view/${VIEW}`, { ...view, label: 'My Opportunities' });
        expect(put.status, put.text).toBe(200);
        const del = await call('DELETE', `/meta/view/${VIEW}`);
        expect(del.status, del.text).toBe(200);
        expect(del.text).toContain('reset to artifact default');
    });

    it('control (the card\'s positive control): a NEW flow is created through /meta and through /automation', async () => {
        const body = (name: string) => ({
            name,
            label: 'Seal control',
            type: 'autolaunched',
            nodes: [{ id: 'start', type: 'start', label: 'Start' }, { id: 'end', type: 'end', label: 'End' }],
            edges: [{ id: 'e1', source: 'start', target: 'end' }],
        });
        const meta = await call('PUT', '/meta/flow/seal_control_meta', body('seal_control_meta'));
        expect(meta.status, meta.text).toBe(200);
        const automation = await call('POST', '/automation', body('seal_control_automation'));
        expect(automation.status, automation.text).toBe(200);
        expect((await served('flow', 'seal_control_meta')).name).toBe('seal_control_meta');
    });

    it('control (ADR-0126 §7.2): the switch turns the managed flow off and on', async () => {
        const off = await call('POST', `/automation/${FLOW}/toggle`, { enabled: false });
        expect(off.status, off.text).toBe(200);
        const on = await call('POST', `/automation/${FLOW}/toggle`, { enabled: true });
        expect(on.status, on.text).toBe(200);
    });

    it('control (ADR-0126 §7.1): the clone is a sibling under a NEW name with no linkage key', async () => {
        const r = await call('POST', `/automation/${FLOW}/clone`, { name: 'seal_control_clone', label: 'Seal clone' });
        expect(r.status, r.text).toBe(200);
        const flow = (r.json.data?.flow ?? {}) as Json;
        expect(flow.name).toBe('seal_control_clone');
        expect(Object.keys(flow).filter((k) => /^_|cloned|source|base|linkage|origin/i.test(k))).toEqual([]);
    });
});
