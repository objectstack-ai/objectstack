// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D4 / D5 — an `oauth2` instance sends its client secret and refresh
// token only over https, or over plain http to a loopback host.

import { describe, expect, it } from 'vitest';
import { insecureOAuth2EndpointFields, isSecureOAuth2Endpoint } from './endpoint-transport.js';

describe('ADR-0143 D4 — which oauth2 endpoint a secret may be sent to', () => {
    it.each([
        'https://idp.example.com/token',
        'HTTPS://IDP.EXAMPLE.COM/token',
        'http://localhost:8080/token',
        'http://idp.localhost/token',
        'http://127.0.0.1:9000/token',
        'http://127.255.0.1/token',
        'http://[::1]:9000/token',
    ])('accepts %s', (url) => {
        expect(isSecureOAuth2Endpoint(url)).toBe(true);
    });

    it.each([
        'http://idp.example.com/token',
        'http://10.0.0.5/token',
        'http://128.0.0.1/token',
        'http://127.0.0.1.example.com/token',
        'http://localhost.example.com/token',
        'ftp://idp.example.com/token',
        'javascript:alert(1)',
        'not a url',
    ])('refuses %s', (url) => {
        expect(isSecureOAuth2Endpoint(url)).toBe(false);
    });

    it('names the refused fields, in order, and ignores the ones not declared', () => {
        expect(insecureOAuth2EndpointFields({ tokenUrl: 'http://idp.example.com/t', authorizationUrl: 'http://idp.example.com/a' }))
            .toEqual(['tokenUrl', 'authorizationUrl']);
        expect(insecureOAuth2EndpointFields({ tokenUrl: 'https://idp.example.com/t' })).toEqual([]);
        expect(insecureOAuth2EndpointFields({})).toEqual([]);
    });
});
