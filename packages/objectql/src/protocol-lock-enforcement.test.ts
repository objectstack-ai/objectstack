// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0010 Phase 1 — L3 per-item lock enforcement contract tests.
 *
 * Pins the four `_lock` states (`none` / `no-overlay` / `no-delete` /
 * `full`) at the protocol boundary. These tests must fail loud if a
 * future change weakens the gate or skips the audit row.
 *
 * Coverage matrix (artifact-backed item):
 *
 *                 | save (PUT) | delete (RESET) |
 *   --------------+------------+----------------+
 *    none         |   allow    |     allow      |
 *    no-delete    |   allow    |   403 locked   |
 *    no-overlay   |   403      |     allow      |
 *    full         |   403      |   403 locked   |
 *
 * Overlay-stored lock (no artifact backing) is tested too — covers the
 * tenant self-lock case noted in the ADR §3.3 open question.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from './registry.js';
import type { MetadataLock } from '@objectstack/spec/kernel';

function makeProtocol(opts: { environmentId?: string } = {}) {
    const registry = new SchemaRegistry({ multiTenant: false });
    const mockEngine: any = {
        registry,
        find: vi.fn().mockResolvedValue([]),
        findOne: vi.fn().mockResolvedValue(null),
        insert: vi.fn().mockResolvedValue({ id: 'new-uuid' }),
        update: vi.fn().mockResolvedValue({ id: 'existing-uuid' }),
        delete: vi.fn().mockResolvedValue({ deleted: 1 }),
        count: vi.fn().mockResolvedValue(0),
        aggregate: vi.fn().mockResolvedValue([]),
    };
    const protocol = new ObjectStackProtocolImplementation(
        mockEngine,
        undefined,
        undefined,
        opts.environmentId ?? 'env_prod',
    );
    return { protocol, mockEngine, registry };
}

/**
 * Seed an artifact-backed view into the registry with a given lock.
 * The protocol's `isArtifactBacked` check requires `_packageId` to be
 * truthy and !== 'sys_metadata'.
 */
function seedLockedArtifact(
    registry: SchemaRegistry,
    type: string,
    name: string,
    lock: MetadataLock,
) {
    const item: any = {
        name,
        label: name,
        object: 'case',
        columns: [{ field: 'name', label: 'Name' }],
        _packageId: '@objectstack/test-fixture',
        _packageVersion: '1.0.0',
        _lock: lock,
        _lockReason: `test fixture (${lock})`,
    };
    registry.registerItem(type, item, 'name', '@objectstack/test-fixture');
    return item;
}

const validView = {
    name: 'case_grid',
    label: 'Cases',
    object: 'case',
    columns: [{ field: 'name', label: 'Name' }],
};

describe('ADR-0010 L3 lock enforcement — artifact-backed item', () => {
    afterEach(() => vi.clearAllMocks());

    it('lock=none: PUT allowed, DELETE allowed', async () => {
        const { protocol, registry } = makeProtocol();
        seedLockedArtifact(registry, 'view', 'case_grid', 'none');

        const save = await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
            organizationId: 'org_alpha',
        });
        expect(save.success).toBe(true);

        const del = await protocol.deleteMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        });
        expect(del.success).toBe(true);
    });

    it('lock=no-delete: PUT allowed, DELETE → 403 item_locked', async () => {
        const { protocol, registry } = makeProtocol();
        seedLockedArtifact(registry, 'view', 'case_grid', 'no-delete');

        const save = await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
            organizationId: 'org_alpha',
        });
        expect(save.success).toBe(true);

        await expect(protocol.deleteMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        })).rejects.toMatchObject({
            code: 'item_locked',
            status: 403,
        });
    });

    it('lock=no-overlay: PUT → 403 item_locked, DELETE allowed', async () => {
        const { protocol, registry } = makeProtocol();
        seedLockedArtifact(registry, 'view', 'case_grid', 'no-overlay');

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
            organizationId: 'org_alpha',
        })).rejects.toMatchObject({
            code: 'item_locked',
            status: 403,
        });

        const del = await protocol.deleteMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        });
        expect(del.success).toBe(true);
    });

    it('lock=full: PUT → 403, DELETE → 403, PUBLISH → 403, ROLLBACK → 403', async () => {
        const { protocol, registry } = makeProtocol();
        seedLockedArtifact(registry, 'view', 'case_grid', 'full');

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
            organizationId: 'org_alpha',
        })).rejects.toMatchObject({ code: 'item_locked', status: 403 });

        await expect(protocol.deleteMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        })).rejects.toMatchObject({ code: 'item_locked', status: 403 });

        await expect(protocol.publishMetaItem({
            type: 'view', name: 'case_grid', organizationId: 'org_alpha',
        })).rejects.toMatchObject({ code: 'item_locked', status: 403 });

        await expect(protocol.rollbackMetaItem({
            type: 'view', name: 'case_grid', toVersion: 1, organizationId: 'org_alpha',
        })).rejects.toMatchObject({ code: 'item_locked', status: 403 });
    });
});

describe('ADR-0010 L3 lock enforcement — single-kernel bypass', () => {
    afterEach(() => vi.clearAllMocks());

    it('environmentId=undefined bypasses L3 (control-plane bootstrap)', async () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        const mockEngine: any = {
            registry,
            find: vi.fn().mockResolvedValue([]),
            findOne: vi.fn().mockResolvedValue(null),
            insert: vi.fn().mockResolvedValue({ id: 'new-uuid' }),
            update: vi.fn().mockResolvedValue({ id: 'existing-uuid' }),
            delete: vi.fn().mockResolvedValue({ deleted: 1 }),
            count: vi.fn().mockResolvedValue(0),
            aggregate: vi.fn().mockResolvedValue([]),
        };
        // No environmentId — single-kernel / control plane.
        const protocol = new ObjectStackProtocolImplementation(
            mockEngine, undefined, undefined, undefined,
        );
        seedLockedArtifact(registry, 'view', 'case_grid', 'full');

        // Even with lock=full, single-kernel mode bypasses L3.
        const save = await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
        });
        expect(save.success).toBe(true);
    });
});

describe('ADR-0010 L3 lock enforcement — audit trail', () => {
    afterEach(() => vi.clearAllMocks());

    it('denied write produces sys_metadata_audit row with outcome=denied', async () => {
        const { protocol, mockEngine, registry } = makeProtocol();
        seedLockedArtifact(registry, 'view', 'case_grid', 'full');

        await expect(protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
            organizationId: 'org_alpha',
            actor: 'user_42',
        })).rejects.toMatchObject({ code: 'item_locked' });

        // The denial path must have inserted a sys_metadata_audit row.
        const auditCalls = mockEngine.insert.mock.calls.filter(
            (c: any[]) => c[0] === 'sys_metadata_audit',
        );
        expect(auditCalls.length).toBeGreaterThanOrEqual(1);
        expect(auditCalls[0][1]).toMatchObject({
            type: 'view',
            name: 'case_grid',
            operation: 'save',
            outcome: 'denied',
            code: 'item_locked',
            lock_state: 'full',
            actor: 'user_42',
        });
    });

    it('allowed save produces sys_metadata_audit row with outcome=allowed', async () => {
        const { protocol, mockEngine, registry } = makeProtocol();
        seedLockedArtifact(registry, 'view', 'case_grid', 'none');

        const result = await protocol.saveMetaItem({
            type: 'view', name: 'case_grid', item: validView,
            organizationId: 'org_alpha',
            actor: 'user_42',
        });
        expect(result.success).toBe(true);

        const auditCalls = mockEngine.insert.mock.calls.filter(
            (c: any[]) => c[0] === 'sys_metadata_audit',
        );
        expect(auditCalls.length).toBeGreaterThanOrEqual(1);
        const entry = auditCalls[auditCalls.length - 1][1];
        expect(entry).toMatchObject({
            type: 'view',
            name: 'case_grid',
            operation: 'save',
            outcome: 'allowed',
            code: 'ok',
            actor: 'user_42',
        });
    });
});
