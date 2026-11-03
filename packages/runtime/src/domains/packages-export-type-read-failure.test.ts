// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29760] `GET /packages/:id/export` is the package's whole content or no
 * answer: a per-type read that fails for a type this runtime serves refuses the
 * export, naming the package and the type, instead of answering 200 without that
 * collection. Only a type the runtime does not serve (absent from its live type
 * vocabulary, `getMetaTypes`) is still skipped. The whole-deployment bundle,
 * `GET /packages/export`, composes that export, so it refuses through the same
 * producer, naming both, with no second check of its own.
 *
 * The protocol is a double and the door is the real dispatcher. The same throw
 * through the real protocol, on a real boot, is the dogfood file
 * `package-export-type-read-failure.dogfood.test.ts`.
 *
 *  - a failed read of a served type: refused, naming the package and the type,
 *    with the read's declared status and code carried and an undeclared throw
 *    answered `500`;
 *  - the read's sentence is quoted only when it is a declared client refusal;
 *  - CONTROL: a type the runtime does not serve is still skipped, the rest of
 *    the export answered;
 *  - fail closed: a protocol with no `getMetaTypes`, or whose listing throws,
 *    has not shown the type unknown, so the export is refused.
 */
import { describe, expect, it, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.example.ledger';
const DASHBOARD = { name: 'ledger_pulse', label: 'Pulse', _packageId: PKG };
const OBJECT = { name: 'ledger_entry', label: 'Entry', fields: {}, _packageId: PKG };

const system = (): any => ({ request: {}, environmentId: 'platform', executionContext: { isSystem: true } });

function make(protocol: any) {
    const registry = {
        getPackage: vi.fn((id: string) => ({ id, manifest: { id, name: id, version: '1.0.0' } })),
        getAllPackages: vi.fn().mockReturnValue([
            { id: PKG, source: 'authored', enabled: true, manifest: { id: PKG, name: PKG, version: '1.0.0' } },
        ]),
    };
    const kernel: any = {
        context: {
            getService: (name: string) =>
                name === 'objectql' ? { registry } : name === 'protocol' ? protocol : null,
        },
    };
    return new HttpDispatcher(kernel);
}

/**
 * A protocol whose per-package read of `failing` throws `thrown` and serves one
 * object and one dashboard otherwise; its live vocabulary is `served`.
 */
function protocolWith(failing: string, thrown: unknown, served: string[] | null = ['object', 'dashboard']) {
    return {
        getMetaItemsPerPackage: vi.fn(async (req: { type: string; packageId?: string }) => {
            if (req.type === failing) throw thrown;
            if (req.type === 'object') return { items: [OBJECT] };
            if (req.type === 'dashboard') return { items: [DASHBOARD] };
            return { items: [] };
        }),
        getMetaItems: vi.fn(async () => ({ items: [] })),
        ...(served === null ? {} : { getMetaTypes: vi.fn(async () => ({ types: served, entries: [] })) }),
    };
}

const exportOf = async (protocol: any) =>
    (await make(protocol).handlePackages(`/${encodeURIComponent(PKG)}/export`, 'GET', undefined, {}, system())).response as any;

const bundleOf = async (protocol: any) =>
    (await make(protocol).handlePackages('/export', 'GET', undefined, {}, system())).response as any;

const refusalOf = (response: any) => ({
    status: response?.status,
    code: response?.body?.error?.code,
    message: String(response?.body?.error?.message ?? ''),
});

describe('[#29760] GET /packages/:id/export refuses on a failed read of a type the runtime serves', () => {
    it('an undeclared throw reading a served type answers 500, naming the package and the type, never 200 without the collection', async () => {
        const response = await exportOf(protocolWith('dashboard', new Error('overlay read failed')));
        expect(response?.status, JSON.stringify(response?.body)).not.toBe(200);
        const refusal = refusalOf(response);
        expect({ status: refusal.status, code: refusal.code }).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(refusal.message).toContain(`'${PKG}'`);
        expect(refusal.message).toContain(`'dashboard'`);
        // An undeclared throw is a fault: its sentence is not quoted.
        expect(refusal.message).not.toContain('overlay read failed');
    });

    it('the read\'s declared status and code ride on: a 503 stays a 503', async () => {
        const thrown = Object.assign(new Error('metadata service unavailable'), { status: 503, code: 'SERVICE_UNAVAILABLE' });
        const refusal = refusalOf(await exportOf(protocolWith('dashboard', thrown)));
        expect({ status: refusal.status, code: refusal.code }).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(refusal.message).toContain(`'${PKG}'`);
        expect(refusal.message).toContain(`'dashboard'`);
    });

    it('a declared client refusal\'s sentence is quoted after the package and the type', async () => {
        const thrown = Object.assign(new Error('the type is refused for this caller'), { status: 400, code: 'INVALID_REQUEST' });
        const refusal = refusalOf(await exportOf(protocolWith('dashboard', thrown)));
        expect({ status: refusal.status, code: refusal.code }).toEqual({ status: 400, code: 'INVALID_REQUEST' });
        expect(refusal.message.startsWith(`Reading the 'dashboard' items of package '${PKG}' failed`), refusal.message).toBe(true);
        expect(refusal.message).toContain('the type is refused for this caller');
    });

    it('CONTROL: a throwing read of a type the runtime does not serve is still skipped, the rest of the export answered', async () => {
        const protocol = protocolWith('dashboard', new Error('no such type here'), ['object']);
        const response = await exportOf(protocol);
        expect(response?.status, JSON.stringify(response?.body)).toBe(200);
        const manifest = response.body.data;
        expect(manifest.objects.map((o: any) => o.name)).toEqual(['ledger_entry']);
        expect(manifest.dashboards).toBeUndefined();
        expect(protocol.getMetaTypes).toHaveBeenCalled();
    });

    it('fail closed: a protocol that brings no `getMetaTypes` has not shown the type unknown, so the export is refused', async () => {
        const refusal = refusalOf(await exportOf(protocolWith('dashboard', new Error('overlay read failed'), null)));
        expect(refusal.status).toBe(500);
        expect(refusal.message).toContain(`'dashboard'`);
    });

    it('fail closed: a type listing that throws has not shown the type unknown, so the export is refused', async () => {
        const protocol = protocolWith('dashboard', new Error('overlay read failed'));
        protocol.getMetaTypes = vi.fn(async () => { throw new Error('listing failed'); });
        const refusal = refusalOf(await exportOf(protocol));
        expect(refusal.status).toBe(500);
        expect(refusal.message).toContain(`'${PKG}'`);
        expect(refusal.message).toContain(`'dashboard'`);
    });

    it('CONTROL: the vocabulary is asked only after a read threw', async () => {
        const protocol = protocolWith('none', new Error('unused'));
        const response = await exportOf(protocol);
        expect(response?.status, JSON.stringify(response?.body)).toBe(200);
        expect(protocol.getMetaTypes).not.toHaveBeenCalled();
    });
});

describe('[#29760] GET /packages/export refuses through the per-package export it composes', () => {
    it('a failed read of a served type refuses the bundle with the read\'s status and code, naming the package and the type', async () => {
        const thrown = Object.assign(new Error('metadata service unavailable'), { status: 503, code: 'SERVICE_UNAVAILABLE' });
        const response = await bundleOf(protocolWith('dashboard', thrown));
        expect(response?.status, JSON.stringify(response?.body)).not.toBe(200);
        expect(response?.body?.data).toBeUndefined();
        const refusal = refusalOf(response);
        expect({ status: refusal.status, code: refusal.code }).toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(refusal.message).toContain(`'${PKG}'`);
        expect(refusal.message).toContain(`'dashboard'`);
    });

    it('an undeclared throw refuses the bundle 500, naming the package and the type', async () => {
        const refusal = refusalOf(await bundleOf(protocolWith('dashboard', new Error('overlay read failed'))));
        expect({ status: refusal.status, code: refusal.code }).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(refusal.message).toContain(`'${PKG}'`);
        expect(refusal.message).toContain(`'dashboard'`);
    });

    it('CONTROL: a throwing read of a type the runtime does not serve leaves the bundle 200, the entry without it', async () => {
        const response = await bundleOf(protocolWith('dashboard', new Error('no such type here'), ['object']));
        expect(response?.status, JSON.stringify(response?.body)).toBe(200);
        const [entry] = response.body.data.packages;
        expect(entry.id).toBe(PKG);
        expect(entry.objects.map((o: any) => o.name)).toEqual(['ledger_entry']);
        expect(entry.dashboards).toBeUndefined();
    });
});
