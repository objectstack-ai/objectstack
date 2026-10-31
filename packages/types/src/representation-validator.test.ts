// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27627] The one body-hash validator rule three transports share — the
// `/meta` reads (`@objectstack/rest`), `/auth/me/localization`
// (`plugin-hono-server`) and `/runtime/config` (`cloud-connection`). The
// route-level pins live beside each route; this file pins the rule itself.

import { describe, expect, it } from 'vitest';
import { ifNoneMatchHits, representationEtag, REVALIDATE_PRIVATE_CACHE_CONTROL } from './representation-validator.js';

describe('representationEtag — the weak validator of exactly what is served', () => {
    it('is a weak tag over 16 hex chars', () => {
        expect(representationEtag({ a: 1 })).toMatch(/^W\/"[0-9a-f]{16}"$/);
    });

    it('is stable for an equal body, so an unchanged answer revalidates', () => {
        expect(representationEtag({ items: [{ name: 'crm' }] })).toBe(representationEtag({ items: [{ name: 'crm' }] }));
    });

    it('moves when any served byte moves — one item more, one label changed, one locale', () => {
        const base = representationEtag({ items: [{ name: 'crm', label: 'CRM' }] });
        expect(representationEtag({ items: [{ name: 'crm', label: 'CRM' }, { name: 'hr' }] })).not.toBe(base);
        expect(representationEtag({ items: [{ name: 'crm', label: '客户' }] })).not.toBe(base);
        expect(representationEtag([])).not.toBe(representationEtag({}));
    });

    it('the posture is private, revalidated on every use — never public', () => {
        expect(REVALIDATE_PRIVATE_CACHE_CONTROL).toBe('private, no-cache');
    });
});

describe('ifNoneMatchHits — the weak comparison of RFC 9110 §13.1.2', () => {
    const etag = representationEtag({ ok: true });
    const opaque = etag.slice(2);

    it('the tag as issued hits', () => {
        expect(ifNoneMatchHits(etag, etag)).toBe(true);
    });

    it('a strong spelling of the same opaque tag hits (weak comparison)', () => {
        expect(ifNoneMatchHits(opaque, etag)).toBe(true);
    });

    it('a list hits when any member does, and * hits any representation', () => {
        expect(ifNoneMatchHits(`W/"0000000000000000", ${etag}`, etag)).toBe(true);
        expect(ifNoneMatchHits('*', etag)).toBe(true);
    });

    it('a repeated header (an array) is read as one list', () => {
        expect(ifNoneMatchHits(['W/"0000000000000000"', etag], etag)).toBe(true);
    });

    it('another tag, an empty header and no header all miss', () => {
        expect(ifNoneMatchHits(representationEtag({ ok: false }), etag)).toBe(false);
        expect(ifNoneMatchHits('', etag)).toBe(false);
        expect(ifNoneMatchHits(undefined, etag)).toBe(false);
    });

    it('the quotes are part of the opaque tag: a bare hex string is another tag', () => {
        expect(ifNoneMatchHits(opaque.slice(1, -1), etag)).toBe(false);
    });
});
