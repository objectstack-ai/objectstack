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
    resolveObjectSchemaRuntimeView,
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
        // [#22250] The posture carries the LAZY runtime question — resolving the
        // posture still asks nothing, and the definition still passes through.
        expect(posture).toMatchObject({ kind: 'passthrough', reason: 'exempt' });
        expect(posture.kind === 'passthrough' && typeof posture.runtime).toBe('function');
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
        expect(posture).toMatchObject({ kind: 'project', readable: new Set(['id']) });
    });

    it('falls back to `getReadableFields` on a service that predates D7', async () => {
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'account',
            context: {},
            enabled: true,
            security: { getReadableFields: () => ['id'] },
        });
        expect(posture).toMatchObject({ kind: 'project', readable: new Set(['id']) });
    });
});

/**
 * [#22250] D4 exempts the DEFINITION (Studio/Setup authoring needs the whole
 * schema), not the runtime projections served beside it: those follow the
 * caller's own field permission, which the data route enforces for every
 * class. Pinned per caller class, with the member as the control.
 */
describe('[#22250] the D4 exemption covers the definition, not the runtime view', () => {
    const CLASSES = {
        'platform admin': { userId: 'u_platform_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
        'organization admin': { userId: 'u_org_admin', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'] },
        member: { userId: 'u_member', systemPermissions: [] as string[] },
    } as const;

    const resolveFor = (context: unknown, readable: () => string[] | undefined, telemetry?: Parameters<typeof resolveObjectSchemaMaskPosture>[0]['telemetry']) => {
        let asked = 0;
        const security = { getMetadataReadableFields: () => { asked++; return readable(); } };
        return {
            posture: resolveObjectSchemaMaskPosture({ objectName: 'account', context, security, enabled: true, telemetry }),
            asked: () => asked,
        };
    };

    for (const [label, context] of Object.entries(CLASSES)) {
        it(`${label}: the runtime view holds only the readable fields, whatever the definition serves`, async () => {
            const { posture: pending } = resolveFor(context, () => ['id']);
            const posture = await pending;
            const served = applyObjectSchemaMask(OBJECT, posture).document;
            const view = await resolveObjectSchemaRuntimeView(served, posture);

            expect(Object.keys(view.document.fields)).toEqual(['id']);
            if (label === 'member') {
                // Control: the definition mask already projects a member, so the
                // runtime view IS the served document — same reference, nothing
                // withheld on top, no second fingerprint.
                expect(posture.kind).toBe('project');
                expect(Object.keys(served.fields)).toEqual(['id']);
                expect(view.document).toBe(served);
                expect(view.withheld).toEqual([]);
                expect(view.fingerprint).toBe('');
            } else {
                // The exempt definition stays whole, for authoring...
                expect(posture).toMatchObject({ kind: 'passthrough', reason: 'exempt' });
                expect(served).toBe(OBJECT);
                expect(Object.keys(served.fields)).toEqual(['id', 'salary_grade']);
                // ...and only the runtime view drops what the caller cannot read.
                expect(view.withheld).toEqual(['salary_grade']);
                expect(view.fingerprint).not.toBe('');
            }
        });
    }

    it('one field permission, one runtime view, whatever the class', async () => {
        const views = await Promise.all(Object.values(CLASSES).map(async (context) => {
            const posture = await resolveFor(context, () => ['id']).posture;
            return (await resolveObjectSchemaRuntimeView(applyObjectSchemaMask(OBJECT, posture).document, posture)).document;
        }));
        for (const view of views) expect(view.fields).toEqual(views[2].fields);
    });

    it('never shares a validator with the definition mask over the same denied set', async () => {
        const admin = await resolveFor(CLASSES['platform admin'], () => ['id']).posture;
        const member = await resolveFor(CLASSES.member, () => ['id']).posture;
        const adminView = await resolveObjectSchemaRuntimeView(OBJECT, admin);
        const memberMask = applyObjectSchemaMask(OBJECT, member);
        // Same denied field, different served bodies (the admin's carries the
        // field in `item`): the two fingerprints must differ or a 304 crosses over.
        expect(memberMask.fingerprint).toBe(objectFieldVisibilityFingerprint(['salary_grade']));
        expect(adminView.fingerprint).not.toBe(memberMask.fingerprint);
    });

    it('an unrestricted exempt caller: same reference, empty fingerprint (D3 byte-identity)', async () => {
        const posture = await resolveFor(CLASSES['platform admin'], () => ['id', 'salary_grade']).posture;
        const view = await resolveObjectSchemaRuntimeView(OBJECT, posture);
        expect(view.document).toBe(OBJECT);
        expect(view.fingerprint).toBe('');
    });

    it('asks the service lazily and at most once per posture, and never for a document without `fields`', async () => {
        const { posture: pending, asked } = resolveFor(CLASSES['platform admin'], () => ['id']);
        const posture = await pending;
        expect(asked()).toBe(0);
        await resolveObjectSchemaRuntimeView({ name: 'not_an_object_schema' }, posture);
        expect(asked()).toBe(0);
        await resolveObjectSchemaRuntimeView(OBJECT, posture);
        await resolveObjectSchemaRuntimeView(OBJECT, posture);
        expect(asked()).toBe(1);
        // The input is never mutated.
        expect(Object.keys(OBJECT.fields)).toEqual(['id', 'salary_grade']);
    });

    it('`undefined` settles undetermined: the view is the served document, warned and counted once', async () => {
        const warns: unknown[] = [];
        const counters: unknown[] = [];
        const posture = await resolveFor(CLASSES['platform admin'], () => undefined, {
            warn: (m, meta) => warns.push([m, meta]),
            counter: (n, labels) => counters.push([n, labels]),
        }).posture;
        const view = await resolveObjectSchemaRuntimeView(OBJECT, posture);
        expect(view.document).toBe(OBJECT);
        expect(view.fingerprint).toBe('');
        expect(warns).toHaveLength(1);
        expect(counters).toEqual([[OBJECT_SCHEMA_MASK_UNDETERMINED_METRIC, { object: 'account' }]]);
    });

    it('a throwing service never faults the exempt caller (D4) — the view settles undetermined, warned', async () => {
        const warns: unknown[] = [];
        const posture = await resolveObjectSchemaMaskPosture({
            objectName: 'account',
            context: CLASSES['platform admin'],
            security: { getMetadataReadableFields: () => { throw new Error('security down'); } },
            enabled: true,
            telemetry: { warn: (m, meta) => warns.push([m, meta]) },
        });
        const view = await resolveObjectSchemaRuntimeView(OBJECT, posture);
        expect(view.document).toBe(OBJECT);
        expect(view.fingerprint).toBe('');
        expect(warns).toHaveLength(1);
    });

    it('`isSystem` and a deployment with no security service carry no runtime question', async () => {
        const system = await resolveFor({ isSystem: true }, () => ['id']);
        const systemPosture = await system.posture;
        expect(systemPosture).toEqual({ kind: 'passthrough', reason: 'exempt' });
        expect((await resolveObjectSchemaRuntimeView(OBJECT, systemPosture)).document).toBe(OBJECT);
        expect(system.asked()).toBe(0);

        const noService = await resolveObjectSchemaMaskPosture({
            objectName: 'account', context: CLASSES['platform admin'], security: undefined, enabled: true,
        });
        expect(noService).toEqual({ kind: 'passthrough', reason: 'exempt' });
    });
});
