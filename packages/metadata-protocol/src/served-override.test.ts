// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28409, ADR-0146 D8 item 2] {@link isServedOverrideRowOf} — the one
 * predicate "is this stored row the served override of X's name": bound to
 * X's pair `<X>.custom` by its own `package_id`, of an overridable type, and
 * declaring `overrides.package = X` in its body. Each refusal below is the
 * predicate's own judgement, so each has a row that differs from an accepted
 * row in that one respect.
 */
import { describe, expect, it } from 'vitest';
import { isServedOverrideRowOf, servedOverrideBaseOf } from './served-override.js';
import { installedManifestsOf } from '@objectstack/metadata-core';

/** Nothing installed: the pair lookup reads no manifest while `appOf` is the identity. */
const NOTHING_INSTALLED = installedManifestsOf(undefined);

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';
const body = (extra: Record<string, unknown> = {}) => ({
    name: 'account.default',
    object: 'account',
    viewKind: 'list',
    overrides: { package: BASE, basedOn: '3.2.0' },
    ...extra,
});
const row = (over: Record<string, unknown> = {}) => ({
    type: 'view',
    package_id: PAIR,
    metadata: JSON.stringify(body()),
    ...over,
});

describe('[#28409] isServedOverrideRowOf', () => {
    it('a row of the pair, of an overridable type, declaring the base: the served override', () => {
        expect(isServedOverrideRowOf(row(), BASE, NOTHING_INSTALLED)).toBe(true);
        // The body as stored, a JSON string, or already parsed.
        expect(isServedOverrideRowOf(row({ metadata: body() }), BASE, NOTHING_INSTALLED)).toBe(true);
        // The type folds to its canonical singular, as the reads fold it.
        expect(isServedOverrideRowOf(row({ type: 'views' }), BASE, NOTHING_INSTALLED)).toBe(true);
        // `basedOn` is recorded and never judged (ADR-0146 D2).
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: BASE } }) }), BASE, NOTHING_INSTALLED)).toBe(true);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: BASE, basedOn: '0.0.1' } }) }), BASE, NOTHING_INSTALLED)).toBe(true);
    });

    it('bound by the row\'s own `package_id`: another package\'s declaration is ignored (ruling A, #28390)', () => {
        expect(isServedOverrideRowOf(row({ package_id: 'com.partner.ext' }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: BASE }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: 'com.other.custom' }), BASE, NOTHING_INSTALLED)).toBe(false);
        // The same row is the pair of one base only.
        expect(isServedOverrideRowOf(row(), 'com.acme', NOTHING_INSTALLED)).toBe(false);
    });

    it('never a body stamp: an unbound row whose body names the pair binds nothing', () => {
        const stamped = JSON.stringify(body({ _packageId: PAIR }));
        expect(isServedOverrideRowOf(row({ package_id: null, metadata: stamped }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: undefined, metadata: stamped }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: '', metadata: stamped }), BASE, NOTHING_INSTALLED)).toBe(false);
    });

    it('the declaration must name the base', () => {
        expect(isServedOverrideRowOf(row({ metadata: JSON.stringify(body({ overrides: undefined })) }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: 'com.other' } }) }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: PAIR } }) }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: BASE }) }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: [BASE] }) }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: null }) }), BASE, NOTHING_INSTALLED)).toBe(false);
    });

    it('a type a declaration never overrides: extended (object) or one name per deployment', () => {
        for (const type of ['object', 'objects', 'permission_set', 'position', 'capability']) {
            expect(isServedOverrideRowOf(row({ type }), BASE, NOTHING_INSTALLED), type).toBe(false);
        }
        expect(isServedOverrideRowOf(row({ type: undefined }), BASE, NOTHING_INSTALLED)).toBe(false);
    });

    it('total: false for any input it cannot read as a declaring row', () => {
        expect(isServedOverrideRowOf(null, BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(undefined, BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: '{not json' }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: '[]' }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: null }), BASE, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row(), '', NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row(), undefined, NOTHING_INSTALLED)).toBe(false);
        expect(isServedOverrideRowOf(row(), 42, NOTHING_INSTALLED)).toBe(false);
    });
});

/**
 * [#30062] The read-side reading: which base a SERVED document is the declared
 * override of. The reads stamp a served override with the base's envelope
 * (`_packageId` = the base) and keep its declaration, so the two agree exactly
 * on a document served as the base's item from its pair.
 */
describe('[#30062] servedOverrideBaseOf', () => {
    const served = (extra: Record<string, unknown> = {}) => ({ name: 'crm_welcome', label: 'OVpage', _packageId: BASE, overrides: { package: BASE, basedOn: '1.0.0' }, ...extra });

    it('names the base for a served override of every type a declared override replaces', () => {
        for (const type of ['page', 'app', 'dataset', 'book', 'view', 'dashboard', 'report', 'email_template', 'doc', 'mapping', 'translation']) {
            expect(servedOverrideBaseOf(type, served()), type).toBe(BASE);
        }
        // The plural spelling folds to the same type.
        expect(servedOverrideBaseOf('pages', served())).toBe(BASE);
    });

    it('names none for a type that takes no declared override', () => {
        for (const type of ['object', 'permission', 'position', 'datasource', 'not_a_type']) {
            expect(servedOverrideBaseOf(type, served()), type).toBeUndefined();
        }
    });

    it('names none when the envelope and the declaration disagree, or either is missing', () => {
        // A pair row served under its own binding: not served as the base's item.
        expect(servedOverrideBaseOf('page', served({ _packageId: PAIR }))).toBeUndefined();
        // A package-less row.
        const { _packageId: _dropped, ...unbound } = served();
        expect(servedOverrideBaseOf('page', unbound)).toBeUndefined();
        // The base's own item: no declaration.
        expect(servedOverrideBaseOf('page', served({ overrides: undefined }))).toBeUndefined();
        // A declaration naming another package than the envelope.
        expect(servedOverrideBaseOf('page', served({ overrides: { package: 'com.other' } }))).toBeUndefined();
        expect(servedOverrideBaseOf('page', served({ overrides: { package: '' }, _packageId: '' }))).toBeUndefined();
    });

    it('is total over inputs it cannot read', () => {
        for (const document of [null, undefined, 'page', 42, [served()], served({ overrides: 'com.acme.crm' }), served({ overrides: [BASE] })]) {
            expect(servedOverrideBaseOf('page', document), JSON.stringify(document)).toBeUndefined();
        }
        expect(servedOverrideBaseOf(undefined, served())).toBeUndefined();
    });
});
