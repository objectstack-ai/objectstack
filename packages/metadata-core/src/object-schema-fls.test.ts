// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0106 / #3682] The shared projection's own properties — the ones the
 * per-exit contract suites consume rather than re-derive.
 */

import { describe, it, expect } from 'vitest';
import {
    ObjectSchemaMaskEvaluationError,
    applyObjectSchemaMask,
    foldVisibilityFingerprintIntoEtag,
    isObjectSchemaMaskExempt,
    isObjectSchemaMaskingEnabled,
    normalizeIfNoneMatch,
    objectFieldVisibilityFingerprint,
    resolveObjectSchemaMaskPosture,
    OBJECT_SCHEMA_MASK_DISABLE_ENV,
    OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES,
    OBJECT_SCHEMA_MASK_UNDETERMINED_METRIC,
    OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES,
    OBJECT_SCHEMA_WRITE_CAPABILITIES,
    type ObjectSchemaMaskPosture,
} from './object-schema-fls.js';

const OBJECT = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { type: 'text' },
        salary_grade: { type: 'select', options: [{ value: 'a' }], requiredPermissions: ['view_comp'] },
    },
};

const project = (readable: string[]): ObjectSchemaMaskPosture => ({ kind: 'project', readable: new Set(readable) });

describe('[ADR-0106 D1] applyObjectSchemaMask', () => {
    it('removes an unreadable field WHOLE — options and requiredPermissions go with it', () => {
        const { document, denied } = applyObjectSchemaMask(OBJECT, project(['id']));

        expect(Object.keys((document as any).fields)).toEqual(['id']);
        expect(denied).toEqual(['salary_grade']);
        expect(JSON.stringify(document)).not.toContain('view_comp');
        expect(JSON.stringify(document)).not.toContain('salary_grade');
    });

    it('never mutates its input — the shared cache entry stays full', () => {
        const source = JSON.parse(JSON.stringify(OBJECT));
        applyObjectSchemaMask(source, project(['id']));
        expect(Object.keys(source.fields)).toEqual(['id', 'salary_grade']);
    });

    it('returns the SAME REFERENCE when nothing is denied — an unrestricted caller pays no copy', () => {
        const result = applyObjectSchemaMask(OBJECT, project(['id', 'salary_grade']));
        expect(result.document).toBe(OBJECT);
        expect(result.fingerprint).toBe('');
        expect(result.denied).toEqual([]);
    });

    it('is a no-op for every passthrough posture', () => {
        for (const reason of ['disabled', 'no-service', 'exempt', 'not-applicable'] as const) {
            const result = applyObjectSchemaMask(OBJECT, { kind: 'passthrough', reason });
            expect(result.document).toBe(OBJECT);
        }
        expect(applyObjectSchemaMask(OBJECT, { kind: 'undetermined' }).document).toBe(OBJECT);
    });

    it('tolerates any input — a document with no `fields` record is returned untouched', () => {
        for (const input of [undefined, null, 42, 'x', [], { name: 'x' }, { fields: [] }]) {
            expect(applyObjectSchemaMask(input as any, project([])).document).toBe(input);
        }
    });

    it('flags `emptied` when the projection would leave no fields at all', () => {
        expect(applyObjectSchemaMask(OBJECT, project([])).emptied).toBe(true);
        expect(applyObjectSchemaMask(OBJECT, project(['id'])).emptied).toBe(false);
        // A source that declares none was never a lie to begin with.
        expect(applyObjectSchemaMask({ name: 'x', fields: {} }, project([])).emptied).toBe(false);
    });
});

describe('[ADR-0106 D3] visibility fingerprint', () => {
    it('is empty for a caller who denies nothing', () => {
        expect(objectFieldVisibilityFingerprint([])).toBe('');
    });

    it('is order-independent — one cohort, one hash', () => {
        expect(objectFieldVisibilityFingerprint(['b', 'a'])).toBe(objectFieldVisibilityFingerprint(['a', 'b']));
    });

    it('separates cohorts', () => {
        expect(objectFieldVisibilityFingerprint(['a'])).not.toBe(objectFieldVisibilityFingerprint(['a', 'b']));
        // Not merely a concatenation — `['ab']` and `['a','b']` must differ.
        expect(objectFieldVisibilityFingerprint(['ab'])).not.toBe(objectFieldVisibilityFingerprint(['a', 'b']));
    });

    it('folds into an ETag only when non-empty — that is the byte-identical guarantee', () => {
        expect(foldVisibilityFingerprintIntoEtag('v1', '')).toBe('v1');
        expect(foldVisibilityFingerprintIntoEtag('v1', 'deadbeef')).toBe('v1~deadbeef');
    });

    it('normalizeIfNoneMatch strips weak markers and quotes the way the protocol does', () => {
        expect(normalizeIfNoneMatch('"v1~deadbeef"')).toBe('v1~deadbeef');
        expect(normalizeIfNoneMatch('W/"v1"')).toBe('v1');
        expect(normalizeIfNoneMatch('  ')).toBeUndefined();
        expect(normalizeIfNoneMatch(undefined)).toBeUndefined();
    });
});

describe('[ADR-0106 D4] exemptions are caller properties', () => {
    it('exempts `isSystem` and the builder capabilities, nothing else', () => {
        expect(isObjectSchemaMaskExempt({ isSystem: true })).toBe(true);
        expect(isObjectSchemaMaskExempt({ systemPermissions: ['studio.access'] })).toBe(true);
        expect(isObjectSchemaMaskExempt({ systemPermissions: ['setup.access'] })).toBe(true);
        expect(isObjectSchemaMaskExempt({ systemPermissions: ['manage_users'] })).toBe(false);
        expect(isObjectSchemaMaskExempt({ userId: 'u' })).toBe(false);
        expect(isObjectSchemaMaskExempt(undefined)).toBe(false);
    });
});

/**
 * [#7020] The maintainer's 2026-08-10 ruling: the #6603 write gate is the
 * authoritative set and the D4 read exemption is a DERIVATION of it, so
 * "whoever can write a schema can see all of it" holds by construction.
 *
 * Before this change the two sets were disjoint apart from `admin_full_access`
 * carrying all three capabilities, so a `manage_metadata`-only caller — a shape
 * the write gate admits and pins as a 200 — read a PROJECTED schema and its
 * GET → edit → PUT round trip deleted the fields it could not see.
 */
describe('[#7020] the D4 read exemption is derived from the write gate', () => {
    it('exempts a caller holding `manage_metadata` and NEITHER builder capability', () => {
        // The broken case: passes every #6603 write gate, was masked on read.
        expect(isObjectSchemaMaskExempt({ userId: 'u_author', systemPermissions: ['manage_metadata'] })).toBe(true);
    });

    it('leaves the existing exempt principals exactly as they were', () => {
        // `admin_full_access`'s shipped shape, and the two named read-only
        // exemptions that hold no write capability (`organization_admin` /
        // `showcase_ops`) — none of them lose access to anything.
        expect(isObjectSchemaMaskExempt({
            systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'],
        })).toBe(true);
        expect(isObjectSchemaMaskExempt({
            systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'],
        })).toBe(true);
        expect(isObjectSchemaMaskExempt({ systemPermissions: ['setup.access', 'showcase.export_data'] })).toBe(true);
    });

    it('still masks a caller holding neither half', () => {
        expect(isObjectSchemaMaskExempt({ userId: 'u_portal', systemPermissions: [] })).toBe(false);
        expect(isObjectSchemaMaskExempt({ userId: 'u_member', systemPermissions: ['manage_org_users'] })).toBe(false);
        // Adjacent-but-different capability names do not leak in.
        expect(isObjectSchemaMaskExempt({ systemPermissions: ['manage_metadata_drafts'] })).toBe(false);
    });

    it('resolves the posture to `exempt` WITHOUT consulting the security service', async () => {
        // D4 is decided before the service call, so the write cohort's exemption
        // costs nothing and a sick service cannot turn it into a fault.
        let asked = 0;
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'account',
            context: { userId: 'u_author', systemPermissions: ['manage_metadata'] },
            security: { getMetadataReadableFields: () => { asked++; throw new Error('must not be consulted'); } },
            enabled: true,
        });
        expect(posture).toEqual({ kind: 'passthrough', reason: 'exempt' });
        expect(asked).toBe(0);
    });

    it('builds the exempt set BY CONSTRUCTION — not a third hand-kept list', () => {
        // The point of the ruling: the union cannot drift from the write gate,
        // because it is not written down twice.
        expect(OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES)
            .toEqual([...OBJECT_SCHEMA_WRITE_CAPABILITIES, ...OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES]);
        // The write half is the #6603 gate's key, spelled once.
        expect(OBJECT_SCHEMA_WRITE_CAPABILITIES).toEqual(['manage_metadata']);
        // The read-only half is preserved verbatim pending #7020's follow-up
        // ruling on `organization_admin` / `showcase_ops` — nobody's current
        // read access is narrowed by this change.
        expect(OBJECT_SCHEMA_READ_ONLY_EXEMPT_CAPABILITIES).toEqual(['studio.access', 'setup.access']);
    });
});

describe('[ADR-0106 D8] escape hatch', () => {
    it('defaults ON', () => {
        expect(isObjectSchemaMaskingEnabled(undefined, {})).toBe(true);
        expect(isObjectSchemaMaskingEnabled(true, {})).toBe(true);
    });

    it('honours the config key and the environment override', () => {
        expect(isObjectSchemaMaskingEnabled(false, {})).toBe(false);
        expect(isObjectSchemaMaskingEnabled(undefined, { [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '1' })).toBe(false);
        // A falsy-looking value is not an opt-out — a deliberate override has
        // to look deliberate.
        expect(isObjectSchemaMaskingEnabled(undefined, { [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '0' })).toBe(true);
        expect(isObjectSchemaMaskingEnabled(undefined, { [OBJECT_SCHEMA_MASK_DISABLE_ENV]: 'false' })).toBe(true);
        expect(isObjectSchemaMaskingEnabled(undefined, { [OBJECT_SCHEMA_MASK_DISABLE_ENV]: '' })).toBe(true);
    });
});

describe('[ADR-0106 D6] three-tier failure posture', () => {
    const base = { objectName: 'account', context: { userId: 'u' }, enabled: true };

    it('tier 1 — no security service → passthrough', async () => {
        expect(await resolveObjectSchemaMaskPosture({ ...base, security: undefined }))
            .toEqual({ kind: 'passthrough', reason: 'no-service' });
        // A service that implements neither method is the same tier.
        expect(await resolveObjectSchemaMaskPosture({ ...base, security: {} }))
            .toEqual({ kind: 'passthrough', reason: 'no-service' });
    });

    it('tier 2 — `undefined` → undetermined, with a structured warn AND a metric', async () => {
        const warns: Array<[string, unknown]> = [];
        const counters: Array<[string, unknown]> = [];
        const posture = await resolveObjectSchemaMaskPosture({
            ...base,
            security: { getReadableFields: () => undefined },
            telemetry: {
                warn: (m, meta) => warns.push([m, meta]),
                counter: (n, labels) => counters.push([n, labels]),
            },
        });

        expect(posture).toEqual({ kind: 'undetermined' });
        expect(warns).toHaveLength(1);
        expect(warns[0][0]).toContain('ADR-0106');
        expect(warns[0][1]).toMatchObject({ object: 'account' });
        expect(counters).toEqual([[OBJECT_SCHEMA_MASK_UNDETERMINED_METRIC, { object: 'account' }]]);
    });

    it('tier 3 — a throwing service becomes ObjectSchemaMaskEvaluationError, never a posture', async () => {
        const boom = new Error('security down');
        await expect(resolveObjectSchemaMaskPosture({
            ...base,
            security: { getReadableFields: () => { throw boom; } },
        })).rejects.toBeInstanceOf(ObjectSchemaMaskEvaluationError);

        const error = await resolveObjectSchemaMaskPosture({
            ...base,
            security: { getReadableFields: () => { throw boom; } },
        }).catch((e) => e);
        expect(error.objectName).toBe('account');
        expect(error.evaluationError).toBe(boom);
    });

    it('an EXEMPT caller short-circuits before the service is consulted — a sick service cannot fault them', async () => {
        let asked = false;
        const posture = await resolveObjectSchemaMaskPosture({
            ...base,
            context: { isSystem: true },
            security: { getReadableFields: () => { asked = true; throw new Error('boom'); } },
        });
        expect(posture).toEqual({ kind: 'passthrough', reason: 'exempt' });
        expect(asked).toBe(false);
    });

    it('D8 disabled short-circuits before the exemption check and the service alike', async () => {
        let asked = false;
        const posture = await resolveObjectSchemaMaskPosture({
            ...base,
            enabled: false,
            security: { getReadableFields: () => { asked = true; return ['id']; } },
        });
        expect(posture).toEqual({ kind: 'passthrough', reason: 'disabled' });
        expect(asked).toBe(false);
    });
});

describe('[ADR-0106 D7] the metadata-plane query is preferred when the service offers it', () => {
    it('prefers `getMetadataReadableFields` over `getReadableFields`', async () => {
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'account',
            context: {},
            enabled: true,
            security: {
                getReadableFields: () => ['id', 'salary_grade'],
                getMetadataReadableFields: () => ['id'],
            },
        });
        expect(posture).toEqual({ kind: 'project', readable: new Set(['id']) });
    });

    it('falls back to `getReadableFields` on a service that predates D7', async () => {
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'account',
            context: {},
            enabled: true,
            security: { getReadableFields: () => ['id'] },
        });
        expect(posture).toEqual({ kind: 'project', readable: new Set(['id']) });
    });
});
