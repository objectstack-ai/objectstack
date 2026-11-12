// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D5, child G1; #31699, #32277] What the exact qualifier keeps of an
 * answer the layers below reached ({@link exactQualifierItem}), per type. A
 * customization pair's item is its base's own, served as reached, for every
 * package-scoped type (#32277 made the pair line generic; before it the keep
 * was gated to a bundled type); another installed package's item is replaced
 * by the admitted holder's.
 */

import { describe, it, expect } from 'vitest';
import { exactQualifierItem, judgesPackageLessRows, packageLessRowOwners, pairRowOnAddress } from './protocol-exact-qualifier.js';

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

describe('the exact qualifier keeps a pair\'s item on its base\'s address (#31699, #32277)', () => {
    it('email_template: the pair\'s added member is the base\'s own, served as reached', () => {
        const pairMember = { name: 'welcome', locale: 'fr-FR', _packageId: PAIR };
        expect(exactQualifierItem(host({ email_template: undefined }), { type: 'email_template', name: 'welcome' }, ADDRESS, pairMember, 'fr-FR'))
            .toBe(pairMember);
    });

    it.each(['app', 'page', 'dashboard', 'report', 'book', 'analytics_cube', 'tool', 'skill', 'agent'])(
        '%s: an item stamped with the pair is the base\'s own too, served as reached (#32277: the pair line is generic)',
        (type) => {
            const own = { name: 'x', label: 'base own', _packageId: BASE };
            const pairItem = { name: 'x', _packageId: PAIR };
            expect(exactQualifierItem(host({ [type]: own }), { type, name: 'x' }, ADDRESS, pairItem, undefined))
                .toBe(pairItem);
        },
    );

    it('CONTROL — email_template: another installed package\'s member is still replaced', () => {
        const own = { name: 'welcome', locale: 'fr-FR', _packageId: BASE };
        expect(exactQualifierItem(host({ email_template: own }), { type: 'email_template', name: 'welcome' }, ADDRESS,
            { name: 'welcome', locale: 'fr-FR', _packageId: OTHER }, 'fr-FR')).toBe(own);
    });
});

/**
 * [#31699, epic ruling 6761802819] The holders a package-less row could be the
 * customization of: every package holding the name, for a type read by
 * package. A name the platform requests by spelling resolves
 * environment-wide, so its package-less row stays the environment's.
 */
describe('[#31699] packageLessRowOwners', () => {
    const registry = (holders: string[], readsByPackage = true) => ({
        readsByPackage: () => readsByPackage,
        packageScopedHoldersOf: () => holders,
    });

    it('names every holder of the name, for a type read by package', () => {
        expect(packageLessRowOwners(registry(['a.x', 'b.y']), 'email_template', 'welcome')).toEqual(['a.x', 'b.y']);
        expect(packageLessRowOwners(registry(['a.x']), 'agent', 'helper')).toEqual(['a.x']);
    });

    it('CONTROL — a platform-requested name (an auth mail), and a type neither read by package nor narrowed, name none', () => {
        expect(packageLessRowOwners(registry(['a.x', 'b.y']), 'email_template', 'auth.password_reset')).toEqual([]);
        expect(packageLessRowOwners(registry(['a.x', 'b.y'], false), 'page', 'home')).toEqual([]);
        expect(packageLessRowOwners(registry(['a.x', 'b.y'], false), 'hook', 'on_save')).toEqual([]);
    });

    it('[#32407] a type narrowed to the namespace is judged whether or not the registry reads it by package (BASE: none)', () => {
        expect(packageLessRowOwners(registry(['a.x', 'b.y'], false), 'action', 'approve')).toEqual(['a.x', 'b.y']);
        expect(packageLessRowOwners(registry(['a.x', 'b.y'], false), 'email_template', 'welcome')).toEqual(['a.x', 'b.y']);
        expect(packageLessRowOwners({ packageScopedHoldersOf: () => ['a.x', 'b.y'] }, 'action', 'approve')).toEqual(['a.x', 'b.y']);
        expect(judgesPackageLessRows({ readsByPackage: () => false }, 'function')).toBe(false);
    });
});

/**
 * [#31699 F2, contract review F-B, delta review S2] The one owner check for a
 * customization pair's member row on an exact address, which the exact read
 * and the scoped list both ask. Two packages of one App share the App's pair.
 */
describe('[#31699] pairRowOnAddress', () => {
    const APP = 'com.acme.suite';
    const X = 'com.acme.suitex';
    const Y = 'com.acme.suitey';
    const APP_PAIR = `${APP}.custom`;
    const manifests: Record<string, { type: string; namespace: string; dependencies?: Record<string, string> }> = {
        [APP]: { type: 'app', namespace: 'suite' },
        [X]: { type: 'module', namespace: 'suitex', dependencies: { [APP]: '^1.0.0' } },
        [Y]: { type: 'module', namespace: 'suitey', dependencies: { [APP]: '^1.0.0' } },
        [APP_PAIR]: { type: 'module', namespace: 'suite' },
    };
    const installed = (id: string) => manifests[id];
    const row = (over: Record<string, unknown> = {}) => ({ name: 'welcome', locale: 'fr-FR', _packageId: APP_PAIR, ...over });

    it('a sole owner that is not among the address\'s bases keeps its member: not this address\'s (S2)', () => {
        expect(pairRowOnAddress(APP_PAIR, row(), Y, [Y], [X], installed)).toBe('not-member');
    });

    it('CONTROL — the sole owner\'s own address serves it (#28390 ruling A)', () => {
        expect(pairRowOnAddress(APP_PAIR, row(), X, [X], [X], installed)).toBe('serve');
    });

    it('two owners: refused, naming both (F2)', () => {
        expect(pairRowOnAddress(APP_PAIR, row(), X, [X], [X, Y], installed)).toEqual({ refuse: [X, Y] });
    });

    it('a declared base is read first: the App\'s own address does not serve a row bound to X (F-B); X does', () => {
        const bound = row({ overrides: { package: X } });
        expect(pairRowOnAddress(APP_PAIR, bound, APP, [APP], [APP, X], installed)).toBe('not-member');
        expect(pairRowOnAddress(APP_PAIR, bound, X, [X], [APP, X], installed)).toBe('serve');
    });

    it('CONTROL — the App\'s own address serves its pair\'s undeclared added member', () => {
        expect(pairRowOnAddress(APP_PAIR, row(), APP, [APP], [APP, X], installed)).toBe('serve');
    });
});
