// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { SharingConfigSchema } from '@objectstack/spec/ui';
import {
    anonymousFormIntakeCandidates,
    anonymousFormIntakeSlug,
    anonymousFormIntakeSlugs,
    publicFormSlug,
} from './anonymous-form-intake.js';

const OPEN = { enabled: true, allowAnonymous: true, publicLink: '/forms/contact-us' };

describe('anonymousFormIntakeSlug — which sharing opens a form to anonymous intake', () => {
    it('both switches on and a publicLink: open, slug normalised', () => {
        expect(anonymousFormIntakeSlug(OPEN)).toBe('contact-us');
        expect(anonymousFormIntakeSlug({ ...OPEN, publicLink: 'forms/contact-us' })).toBe('contact-us');
        expect(anonymousFormIntakeSlug({ ...OPEN, publicLink: 'contact-us' })).toBe('contact-us');
    });

    it.each<[string, Record<string, unknown>]>([
        ['enabled: false', { ...OPEN, enabled: false }],
        ['enabled absent', { allowAnonymous: true, publicLink: '/forms/contact-us' }],
        ['allowAnonymous: false', { ...OPEN, allowAnonymous: false }],
        ['allowAnonymous absent', { enabled: true, publicLink: '/forms/contact-us' }],
        ['publicLink absent', { enabled: true, allowAnonymous: true }],
        ['publicLink empty', { ...OPEN, publicLink: '' }],
        ['a truthy non-boolean switch', { ...OPEN, enabled: 'true' }],
    ])('%s: closed', (_label, sharing) => {
        expect(anonymousFormIntakeSlug(sharing)).toBeNull();
    });

    it('a raw body and its parse get the same answer (the schema defaults `enabled` to false)', () => {
        for (const raw of [OPEN, { allowAnonymous: true, publicLink: '/forms/contact-us' }, { ...OPEN, enabled: false }]) {
            expect(anonymousFormIntakeSlug(SharingConfigSchema.parse(raw))).toBe(anonymousFormIntakeSlug(raw));
        }
    });

    it('not an object: closed', () => {
        expect(anonymousFormIntakeSlug(undefined)).toBeNull();
        expect(anonymousFormIntakeSlug(null)).toBeNull();
        expect(anonymousFormIntakeSlug('x')).toBeNull();
    });
});

describe('anonymousFormIntakeCandidates / anonymousFormIntakeSlugs — the three form shapes of a view', () => {
    const view = (sharing: Record<string, unknown>) => ({
        name: 'inquiry.contact',
        object: 'inquiry',
        form: { data: { object: 'inquiry' }, sharing: { ...sharing, publicLink: '/forms/nested' } },
        formViews: {
            a: { sharing: { ...sharing, publicLink: '/forms/a' } },
            b: { sharing: { ...OPEN, enabled: false, publicLink: '/forms/b' } },
        },
        viewKind: 'form',
        config: { sharing: { ...sharing, publicLink: 'forms/flat' } },
    });

    it('scans the nested form, every formViews entry and the flattened config, open ones only', () => {
        const c = anonymousFormIntakeCandidates(view(OPEN));
        expect(c.map((x) => [x.key, x.slug])).toEqual([
            [undefined, 'nested'],
            ['a', 'a'],
            ['inquiry.contact', 'flat'],
        ]);
        expect(anonymousFormIntakeSlugs(view(OPEN))).toEqual(['a', 'flat', 'nested']);
    });

    it('withdrawn through either switch: no candidate on any shape', () => {
        expect(anonymousFormIntakeSlugs(view({ ...OPEN, enabled: false }))).toEqual([]);
        expect(anonymousFormIntakeSlugs(view({ ...OPEN, allowAnonymous: false }))).toEqual([]);
    });

    it('de-duplicates and sorts slugs; tolerates non-object input', () => {
        expect(anonymousFormIntakeSlugs({ formViews: { x: { sharing: OPEN }, y: { sharing: { ...OPEN, publicLink: 'contact-us' } } } }))
            .toEqual(['contact-us']);
        expect(anonymousFormIntakeSlugs(null)).toEqual([]);
        expect(anonymousFormIntakeSlugs({ formViews: { x: null } })).toEqual([]);
        expect(publicFormSlug('//forms/x')).toBe('x');
    });
});
