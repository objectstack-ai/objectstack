// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12702 · ADR-0131 D6] `metaWriteCapabilityVerdict` — which CALLERS a
 * `/meta` item write door admits.
 *
 * The contract under test: `isSystem` or `manage_metadata`, and nothing else.
 * The org-scoped `manage_org_presentation` arm retired with the
 * per-organization overlay axis — the doors carry no organization into a
 * metadata write, so the arm would have admitted its holders to
 * environment-wide authoring. Its holders are refused like any other caller.
 *
 * Refusal messages are envelope halves, not the envelope: each door supplies
 * its own status/code (REST `403 FORBIDDEN`, dispatcher `403
 * PERMISSION_DENIED`, pinned in their own gate suites). What is pinned HERE is
 * that the sentence names the sanctioned capability and varies only on the
 * door's verb, never on what the caller holds (#7450).
 */

import { describe, it, expect } from 'vitest';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import * as metadataCore from './index.js';
import {
    METADATA_AUTHORING_CAPABILITY,
    metaWriteCapabilityVerdict,
    isSecurityCatalogType,
    PLATFORM_OPERATOR_POSTURE,
    SECURITY_CATALOG_TYPES,
    walledCatalogWriteVerdict,
    type MetaWriteOperation,
} from './meta-write-capability.js';

const OPERATIONS: Record<MetaWriteOperation, string> = {
    save: 'Saving a metadata item',
    reset: 'Resetting a metadata item',
    publish: 'Publishing a metadata item',
    rollback: 'Rolling back a metadata item',
};

describe('#12702 — the declaration cannot drift from the enforcement spelling', () => {
    it('`manage_metadata` stays the platform-scoped authoring capability', () => {
        const declared = PLATFORM_CAPABILITIES.find(
            (c) => c.name === METADATA_AUTHORING_CAPABILITY,
        );
        expect(declared).toBeDefined();
        expect(declared!.scope).toBe('platform');
    });
});

describe('ADR-0131 D6 — `manage_org_presentation` retired', () => {
    it('is no longer declared, and its constant is no longer exported', () => {
        expect(PLATFORM_CAPABILITIES.some((c) => c.name === 'manage_org_presentation')).toBe(false);
        expect('ORG_PRESENTATION_AUTHORING_CAPABILITY' in metadataCore).toBe(false);
        // Control: the surviving export is visible through the same barrel.
        expect('metaWriteCapabilityVerdict' in metadataCore).toBe(true);
    });

    it('a holder of it alone is refused on every door verb, with the plain sentence', () => {
        for (const [operation, subject] of Object.entries(OPERATIONS) as Array<[MetaWriteOperation, string]>) {
            const v = metaWriteCapabilityVerdict({
                systemPermissions: ['manage_org_presentation'],
                operation,
            });
            expect(v).toEqual({
                allowed: false,
                message: `${subject} requires the \`manage_metadata\` capability.`,
            });
        }
    });
});

describe('metaWriteCapabilityVerdict — who is admitted', () => {
    it('admits `isSystem` whatever it holds', () => {
        expect(metaWriteCapabilityVerdict({ isSystem: true, operation: 'save' })).toEqual({ allowed: true });
        expect(metaWriteCapabilityVerdict({ isSystem: true, systemPermissions: 'nonsense', operation: 'publish' }))
            .toEqual({ allowed: true });
    });

    it('admits a `manage_metadata` holder on every verb', () => {
        for (const operation of Object.keys(OPERATIONS) as MetaWriteOperation[]) {
            expect(metaWriteCapabilityVerdict({
                systemPermissions: ['studio.access', 'manage_metadata'],
                operation,
            })).toEqual({ allowed: true });
        }
    });

    it('refuses a caller holding neither, and tolerates a non-array grant list as none held', () => {
        for (const held of [[], ['studio.access', 'setup.access'], undefined, 'manage_metadata', { manage_metadata: true }]) {
            const v = metaWriteCapabilityVerdict({ systemPermissions: held, operation: 'save' });
            expect(v.allowed, `held=${JSON.stringify(held)}`).toBe(false);
        }
    });

    it('`isSystem: false` is not a bypass', () => {
        expect(metaWriteCapabilityVerdict({ isSystem: false, operation: 'rollback' }).allowed).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// [ADR-0131 D3] The walled catalog refusal
// ─────────────────────────────────────────────────────────────────────────────

describe('[ADR-0131 D3] walledCatalogWriteVerdict — under a wall the security catalog is the platform operator\'s', () => {
    const TENANT = { isSystem: false, callerPosture: 'TENANT_ADMIN' };

    it('refuses a non-operator write of each catalog type under `isolated` and `group`', () => {
        for (const tenancyPosture of ['isolated', 'group'] as const) {
            for (const type of SECURITY_CATALOG_TYPES) {
                const v = walledCatalogWriteVerdict({ type, tenancyPosture, ...TENANT });
                expect(v.allowed, `${type} under ${tenancyPosture}`).toBe(false);
            }
        }
    });

    it('the sentence names the posture and the capability, and nothing about the caller', () => {
        const v = walledCatalogWriteVerdict({ type: 'permission', tenancyPosture: 'group', ...TENANT });
        expect(v.allowed).toBe(false);
        const message = (v as { message: string }).message;
        expect(message.split(': ')[0]).toBe('Creating, changing or deleting a permission set requires the platform operator');
        expect(message).toContain("'group' tenancy posture");
        expect(message).toContain('`manage_metadata`');
        expect(message).not.toContain('TENANT_ADMIN');
    });

    it('a URL spelling the protocol folds to a catalog type is judged as that type', () => {
        for (const type of ['positions', 'permissions', 'capabilities']) {
            expect(isSecurityCatalogType(type), type).toBe(true);
            expect(walledCatalogWriteVerdict({ type, tenancyPosture: 'isolated', ...TENANT }).allowed, type).toBe(false);
        }
    });

    it('admits the platform operator rung and a system write', () => {
        expect(walledCatalogWriteVerdict({ type: 'position', tenancyPosture: 'isolated', callerPosture: PLATFORM_OPERATOR_POSTURE }))
            .toEqual({ allowed: true });
        expect(walledCatalogWriteVerdict({ type: 'position', tenancyPosture: 'isolated', isSystem: true }))
            .toEqual({ allowed: true });
    });

    it('a caller with no rung at all is not the operator', () => {
        expect(walledCatalogWriteVerdict({ type: 'position', tenancyPosture: 'isolated' }).allowed).toBe(false);
    });

    it('is inert under `single` and with no posture (no `tenancy` service): the capability gate decides alone', () => {
        for (const tenancyPosture of ['single', undefined] as const) {
            for (const type of SECURITY_CATALOG_TYPES) {
                expect(walledCatalogWriteVerdict({ type, tenancyPosture, ...TENANT })).toEqual({ allowed: true });
            }
        }
    });

    it('admits every other type under a wall — the refusal is the catalog\'s, not the metadata door\'s', () => {
        for (const type of ['object', 'view', 'flow', 'app']) {
            expect(isSecurityCatalogType(type), type).toBe(false);
            expect(walledCatalogWriteVerdict({ type, tenancyPosture: 'isolated', ...TENANT })).toEqual({ allowed: true });
        }
    });

    it('the catalog is exactly positions, permission sets and capabilities', () => {
        expect([...SECURITY_CATALOG_TYPES]).toEqual(['position', 'permission', 'capability']);
    });
});
