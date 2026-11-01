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
import { isServedOverrideRowOf } from './served-override.js';

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
        expect(isServedOverrideRowOf(row(), BASE)).toBe(true);
        // The body as stored, a JSON string, or already parsed.
        expect(isServedOverrideRowOf(row({ metadata: body() }), BASE)).toBe(true);
        // The type folds to its canonical singular, as the reads fold it.
        expect(isServedOverrideRowOf(row({ type: 'views' }), BASE)).toBe(true);
        // `basedOn` is recorded and never judged (ADR-0146 D2).
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: BASE } }) }), BASE)).toBe(true);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: BASE, basedOn: '0.0.1' } }) }), BASE)).toBe(true);
    });

    it('bound by the row\'s own `package_id`: another package\'s declaration is ignored (ruling A, #28390)', () => {
        expect(isServedOverrideRowOf(row({ package_id: 'com.partner.ext' }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: BASE }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: 'com.other.custom' }), BASE)).toBe(false);
        // The same row is the pair of one base only.
        expect(isServedOverrideRowOf(row(), 'com.acme')).toBe(false);
    });

    it('never a body stamp: an unbound row whose body names the pair binds nothing', () => {
        const stamped = JSON.stringify(body({ _packageId: PAIR }));
        expect(isServedOverrideRowOf(row({ package_id: null, metadata: stamped }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: undefined, metadata: stamped }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ package_id: '', metadata: stamped }), BASE)).toBe(false);
    });

    it('the declaration must name the base', () => {
        expect(isServedOverrideRowOf(row({ metadata: JSON.stringify(body({ overrides: undefined })) }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: 'com.other' } }) }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: { package: PAIR } }) }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: BASE }) }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: [BASE] }) }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: body({ overrides: null }) }), BASE)).toBe(false);
    });

    it('a type a declaration never overrides: extended (object) or one name per deployment', () => {
        for (const type of ['object', 'objects', 'permission_set', 'position', 'capability']) {
            expect(isServedOverrideRowOf(row({ type }), BASE), type).toBe(false);
        }
        expect(isServedOverrideRowOf(row({ type: undefined }), BASE)).toBe(false);
    });

    it('total: false for any input it cannot read as a declaring row', () => {
        expect(isServedOverrideRowOf(null, BASE)).toBe(false);
        expect(isServedOverrideRowOf(undefined, BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: '{not json' }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: '[]' }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row({ metadata: null }), BASE)).toBe(false);
        expect(isServedOverrideRowOf(row(), '')).toBe(false);
        expect(isServedOverrideRowOf(row(), undefined)).toBe(false);
        expect(isServedOverrideRowOf(row(), 42)).toBe(false);
    });
});
