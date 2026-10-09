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
