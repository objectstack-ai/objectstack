// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import { resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';

/**
 * Phase 3a-1 + 3a-env-writable tests.
 *
 * Validates that:
 *   • `getMetaTypes()` returns enriched `entries` alongside the legacy
 *     `types` array (back-compat preserved).
 *   • Registry metadata (label, domain, allowOrgOverride, …) flows through
 *     from DEFAULT_METADATA_TYPE_REGISTRY.
 *   • `OS_METADATA_WRITABLE` env var elevates `allowOrgOverride`
 *     at runtime, and tags the entry with `overrideSource: 'env'`.
 *   • The env-elevated set is also honoured by the saveMetaItem 403 gate.
 */
describe('ObjectStackProtocolImplementation - getMetaTypes rich response', () => {
    let protocol: ObjectStackProtocolImplementation;
    let mockEngine: any;
    let registry: SchemaRegistry;
    const originalEnv = process.env.OS_METADATA_WRITABLE;

    beforeEach(() => {
        registry = new SchemaRegistry({ multiTenant: false });
        // Pre-register a handful of object schemas so getRegisteredTypes()
        // returns something realistic.
        registry.registerItem('object', { name: 'sys_user', label: 'User' }, 'name');
        registry.registerItem('view', { name: 'sys_user.grid', type: 'grid', object: 'sys_user' }, 'name');
        registry.registerItem('app', { name: 'crm', label: 'CRM' }, 'name');
        // `function` is registry-default `allowOrgOverride: false` (system/wiring-layer)
        // and is used by the "honours OS_METADATA_WRITABLE" test as a control type.
        registry.registerItem('flow', { name: 'crm.onboard', steps: [] }, 'name');
        // Register wiring-layer types so getMetaTypes() includes them in `entries`
        // (getMetaTypes only returns types present in getRegisteredTypes()).
        registry.registerItem('function', { name: 'process_payment' }, 'name');
        registry.registerItem('trigger', { name: 'on_insert' }, 'name');

        mockEngine = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'x' }),
            update: vi.fn().mockResolvedValue({ id: 'x' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        protocol = new ObjectStackProtocolImplementation(mockEngine);
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.OS_METADATA_WRITABLE;
        } else {
            process.env.OS_METADATA_WRITABLE = originalEnv;
        }
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
    });

    it('returns both legacy `types` array and rich `entries` array', async () => {
        const result: any = await protocol.getMetaTypes();
        expect(Array.isArray(result.types)).toBe(true);
        expect(Array.isArray(result.entries)).toBe(true);
        expect(result.types.length).toBeGreaterThan(0);
        expect(result.entries.length).toBeGreaterThan(0);
    });

    it('enriches known types with registry metadata', async () => {
        const result: any = await protocol.getMetaTypes();
        const objectEntry = result.entries.find((e: any) => e.type === 'object');
        expect(objectEntry).toBeDefined();
        expect(objectEntry.label).toBe('Object');
        expect(objectEntry.domain).toBe('data');
        // object reverted to allowOrgOverride:false on 2026-05-29 — packaged
        // objects are LOCKED at runtime; tenants must create new objects.
        expect(objectEntry.allowOrgOverride).toBe(false);
        expect(objectEntry.allowRuntimeCreate).toBe(true);
        expect(objectEntry.overrideSource).toBe('registry');
        expect(objectEntry.supportsOverlay).toBe(false);

        const viewEntry = result.entries.find((e: any) => e.type === 'view');
        expect(viewEntry).toBeDefined();
        expect(viewEntry.allowOrgOverride).toBe(true);
        expect(viewEntry.domain).toBe('ui');
    });

    it('honours OS_METADATA_WRITABLE to elevate allowOrgOverride', async () => {
        // Use `function` and `service` — both are registry-default
        // `allowOrgOverride: false` (wiring-layer types that must stay code-only).
        process.env.OS_METADATA_WRITABLE = 'function,service';
        ObjectStackProtocolImplementation.resetEnvWritableCache();

        const result: any = await protocol.getMetaTypes();
        const functionEntry = result.entries.find((e: any) => e.type === 'function');
        expect(functionEntry.allowOrgOverride).toBe(true);
        expect(functionEntry.overrideSource).toBe('env');

        // Types not listed AND not writable in the registry default retain
        // `allowOrgOverride: false`. `trigger` is one such type — it is
        // execution-pinned and not org-overridable.
        const triggerEntry = result.entries.find((e: any) => e.type === 'trigger');
        expect(triggerEntry.allowOrgOverride).toBe(false);
        expect(triggerEntry.overrideSource).toBe('registry');
    });

    it('saveMetaItem honours the env-elevated allow list', async () => {
        // Scoped (project) protocol — overlay gate applies.
        const scoped = new ObjectStackProtocolImplementation(mockEngine, undefined, undefined, 'env_alpha');
        mockEngine.findOne.mockResolvedValue(null);

        // Without env var: `function` writes blocked. Since the test
        // registry has no artifact at this name and `function` has
        // `allowRuntimeCreate: false`, the protocol returns
        // `not_creatable` (the precise reason); for artifact-backed names
        // the code would be `not_overridable`. Both indicate the gate
        // fired with the same 403 status.
        delete process.env.OS_METADATA_WRITABLE;
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        await expect(
            scoped.saveMetaItem({ type: 'function', name: 'my_fn', item: { name: 'my_fn' } })
        ).rejects.toThrow(/not_(overridable|creatable)/);

        // With env var: `function` writes allowed.
        process.env.OS_METADATA_WRITABLE = 'function';
        ObjectStackProtocolImplementation.resetEnvWritableCache();
        resetEnvWritableMetadataTypes();
        // Should no longer throw "not_overridable" / "not_creatable". (May still hit
        // unrelated persistence errors from the mock engine — we only assert the gate.)
        try {
            await scoped.saveMetaItem({ type: 'function', name: 'my_fn', item: { name: 'my_fn' } });
        } catch (err: any) {
            expect(err.code).not.toBe('not_overridable');
            expect(err.code).not.toBe('not_creatable');
        }
    });

    it('returns entries sorted by domain, then by type name', async () => {
        const result: any = await protocol.getMetaTypes();
        for (let i = 1; i < result.entries.length; i++) {
            const prev = result.entries[i - 1];
            const curr = result.entries[i];
            if (prev.domain === curr.domain) {
                expect(prev.type.localeCompare(curr.type)).toBeLessThanOrEqual(0);
            } else {
                expect(prev.domain.localeCompare(curr.domain)).toBeLessThanOrEqual(0);
            }
        }
    });
});
