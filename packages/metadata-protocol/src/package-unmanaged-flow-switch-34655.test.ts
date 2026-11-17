// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34655, ADR-0126 §4 amendment] An unmanaged install copies a flow's
 * `defaultActive` as the switch the copy has. The copy is the environment's
 * own flow, switched by its `status`, and the automation engine refuses the
 * key on such a flow, so a package that ships a flow switched off arrives
 * switched off (`status: 'obsolete'`) and without the key.
 */

// Pays the lint root's first load at collection, never inside a clocked case.
import './lint-root-preload.testkit.js';
import { describe, expect, it } from 'vitest';
import { DEFAULT_METADATA_TYPE_REGISTRY } from '@objectstack/spec/kernel';
import { copyUnmanagedFlowSwitch, planUnmanagedImport } from './package-unmanaged-install.js';
import { overlaySchemaDeclaredKey } from './protocol.js';

function flow(name: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        name,
        label: name,
        type: 'record_change',
        status: 'active',
        nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { objectName: 'crm_quote', triggerType: 'record-after-update' } },
            { id: 'end', type: 'end', label: 'End' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'end' }],
        ...extra,
    };
}

function crmBody(flows: Record<string, unknown>[]): Record<string, unknown> {
    return {
        id: 'com.example.crm',
        namespace: 'crm',
        version: '4.0.0',
        type: 'app',
        name: 'CRM',
        scope: 'cloud',
        objects: [{
            name: 'crm_quote',
            label: 'Quote',
            sharingModel: 'private',
            fields: { title: { type: 'text', label: 'Title' } },
        }],
        flows,
        translations: [],
        i18n: { defaultLocale: 'en' },
    };
}

const plan = (body: Record<string, unknown>) =>
    planUnmanagedImport(body, {
        isRuntimeCreatable: (type: string) =>
            DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type)?.allowRuntimeCreate ?? true,
        loadOrderOf: (type: string) =>
            DEFAULT_METADATA_TYPE_REGISTRY.find((e) => e.type === type)?.loadOrder ?? Number.MAX_SAFE_INTEGER,
        protectionDeclarationOf: (type: string) => overlaySchemaDeclaredKey(type, 'protection'),
    });

function flowItem(p: ReturnType<typeof plan>, name: string) {
    return p.items.find((item) => item.type === 'flow' && item.name === name)?.body;
}

describe('#34655 — an unmanaged install copies `defaultActive` as the copy\'s status', () => {
    it('a flow shipped switched off is copied switched off, as `status: \'obsolete\'`, without the key', () => {
        const p = plan(crmBody([flow('draft_contract', { defaultActive: false })]));
        const body = flowItem(p, 'draft_contract');
        expect(body).toBeDefined();
        expect(body).not.toHaveProperty('defaultActive');
        expect(body?.status).toBe('obsolete');
    });

    it('a flow shipped on keeps its declared status, without the key', () => {
        const p = plan(crmBody([flow('on_flow', { defaultActive: true })]));
        const body = flowItem(p, 'on_flow');
        expect(body).not.toHaveProperty('defaultActive');
        expect(body?.status).toBe('active');
    });

    it('a status that already disarms the flow is kept', () => {
        expect(copyUnmanagedFlowSwitch('flow', flow('f', { defaultActive: false, status: 'invalid' }))).toEqual(
            flow('f', { status: 'invalid' }),
        );
    });

    it('a flow with no status declared and shipped off is copied `obsolete`', () => {
        const { status: _none, ...noStatus } = flow('f');
        expect(copyUnmanagedFlowSwitch('flow', { ...noStatus, defaultActive: false })).toEqual({ ...noStatus, status: 'obsolete' });
    });

    it('CONTROL: a flow without the key, another type, and a value that is not a boolean are handed on as the same body', () => {
        const plain = flow('plain');
        expect(copyUnmanagedFlowSwitch('flow', plain)).toBe(plain);
        const other = { name: 'x', defaultActive: false };
        expect(copyUnmanagedFlowSwitch('view', other)).toBe(other);
        const malformed = flow('bad', { defaultActive: 'no' });
        expect(copyUnmanagedFlowSwitch('flow', malformed)).toBe(malformed);

        const p = plan(crmBody([plain]));
        expect(flowItem(p, 'plain')).toEqual(plain);
    });
});
