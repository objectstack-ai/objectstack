// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1; #31699] What the exact qualifier keeps of an answer
 * the layers below reached ({@link exactQualifierItem}), per type. The keep of
 * a customization pair's item on its base's address is gated to a bundled type
 * (`ITEM_KEY_DISCRIMINATORS`: the email template's locale), so for every other
 * type of `PACKAGE_SCOPED_READ_TYPES` the answer is the one it was before
 * email_template joined the readers: another installed package's item is
 * replaced by the admitted holder's.
 */

import { describe, it, expect } from 'vitest';
import { exactQualifierItem } from './protocol-exact-qualifier.js';

const BASE = 'com.acme.alpha';
const PAIR = `${BASE}.custom`;
const OTHER = 'com.acme.beta';

/** A registry double: the packages installed, and the holder's own item per type. */
function host(own: Record<string, unknown>) {
    const installed = new Set([BASE, PAIR, OTHER]);
    return {
        engine: {
            registry: {
                readsByPackage: () => true,
                packageScopedHoldersOf: () => [BASE],
                getEnvironmentScopedItem: () => undefined,
                getPackageScopedItem: (type: string) => own[type],
                getPackage: (id: string) => (installed.has(id) ? { manifest: { id, name: id, version: '1.0.0', type: 'app' } } : undefined),
            },
        },
    } as never;
}
const ADDRESS = { packageId: BASE, registryHolders: [BASE] };

describe('the exact qualifier keeps a pair\'s item on its base\'s address for a bundled type only (#31699)', () => {
    it('email_template: the pair\'s added member is the base\'s own, served as reached', () => {
        const pairMember = { name: 'welcome', locale: 'fr-FR', _packageId: PAIR };
        expect(exactQualifierItem(host({ email_template: undefined }), { type: 'email_template', name: 'welcome' }, ADDRESS, pairMember, 'fr-FR'))
            .toBe(pairMember);
    });

    it.each(['app', 'page', 'dashboard', 'report', 'book', 'analytics_cube', 'tool', 'skill', 'agent'])(
        'CONTROL — %s: an item stamped with the pair is replaced by the admitted holder\'s, as before',
        (type) => {
            const own = { name: 'x', label: 'base own', _packageId: BASE };
            expect(exactQualifierItem(host({ [type]: own }), { type, name: 'x' }, ADDRESS, { name: 'x', _packageId: PAIR }, undefined))
                .toBe(own);
        },
    );

    it('CONTROL — email_template: another installed package\'s member is still replaced', () => {
        const own = { name: 'welcome', locale: 'fr-FR', _packageId: BASE };
        expect(exactQualifierItem(host({ email_template: own }), { type: 'email_template', name: 'welcome' }, ADDRESS,
            { name: 'welcome', locale: 'fr-FR', _packageId: OTHER }, 'fr-FR')).toBe(own);
    });
});
