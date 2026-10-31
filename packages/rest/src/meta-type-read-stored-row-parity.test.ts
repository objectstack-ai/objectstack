// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27884] Parity: the `/meta` type-level read admission and the engine's
 * stored-row read gate admit the same callers to a datasource-family document.
 *
 * The `/meta` gate (`metaTypeReadRefusal`) reads `META_TYPE_READ_CAPABILITIES`;
 * the engine gate (`stored-metadata-type-read-gate.ts`, `@objectstack/objectql`)
 * composes its predicate from `storedMetadataTypesWithheldFrom`
 * (`@objectstack/metadata-core`). Both must be the ONE row, and for every caller
 * a type the `/meta` gate refuses must be a type the stored-row exit withholds,
 * and the reverse.
 */

import { describe, it, expect } from 'vitest';
import { STORED_METADATA_TYPE_READ_CAPABILITIES, storedMetadataTypesWithheldFrom } from '@objectstack/metadata-core';
import { META_TYPE_READ_CAPABILITIES, metaTypeReadRefusal } from './meta-item-read-gate.js';

const CALLERS: Record<string, unknown> = {
    platformAdmin: { userId: 'u_admin', systemPermissions: ['manage_platform_settings', 'manage_metadata', 'studio.access', 'setup.access'] },
    datasourceAdminOnly: { userId: 'u_ds', systemPermissions: ['manage_platform_settings'] },
    organizationAdmin: { userId: 'u_org', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write', 'manage_mailboxes'] },
    studioAuthor: { userId: 'u_author', systemPermissions: ['studio.access', 'manage_metadata'] },
    member: { userId: 'u_member', systemPermissions: [] },
    noCapabilitySet: { userId: 'u_bare' },
};

describe('[#27884] one read row for a datasource-family document, at both exits', () => {
    it('the /meta row IS the stored-row row — the same frozen object, not a copy', () => {
        expect(META_TYPE_READ_CAPABILITIES).toBe(STORED_METADATA_TYPE_READ_CAPABILITIES);
        expect(Object.isFrozen(META_TYPE_READ_CAPABILITIES)).toBe(true);
    });

    it.each(Object.keys(CALLERS))('%s: a type the /meta gate refuses is exactly a type the stored-row exit withholds', (name) => {
        const caller = CALLERS[name];
        const withheld = storedMetadataTypesWithheldFrom(caller);
        for (const type of Object.keys(META_TYPE_READ_CAPABILITIES)) {
            const refusedOnMeta = metaTypeReadRefusal('GET', type, caller) !== undefined;
            expect({ type, withheld: withheld.includes(type) }).toEqual({ type, withheld: refusedOnMeta });
        }
    });

    it('a holder is withheld nothing; a caller below datasource administration is withheld every gated type', () => {
        expect(storedMetadataTypesWithheldFrom(CALLERS.platformAdmin)).toEqual([]);
        expect(storedMetadataTypesWithheldFrom(CALLERS.organizationAdmin).sort()).toEqual(['datasource', 'external_catalog']);
    });
});
