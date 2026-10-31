// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D2.1 — the MCP authorization flow's discovery order and its
// refusals at the transport. The whole flow runs end to end in
// `../connector-mcp-authorization-door.test.ts`. The values are obvious dummies.

import { describe, expect, it } from 'vitest';
import { isConnectorUpstreamUnavailable } from '@objectstack/spec/integration';
import {
    authorizationServerMetadataUrls,
    discoverMcpAuthorization,
    McpAuthorizationRefusedError,
    parseMcpAuthorizationClient,
    protectedResourceMetadataUrls,
} from './mcp-authorization.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function server(routes: Record<string, () => Response>) {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const impl = (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return (routes[url] ?? (() => json({}, 404)))();
    }) as unknown as typeof fetch;
    return { impl, seen };
}

const request = (fetchImpl: typeof fetch, over: Record<string, unknown> = {}) => ({
    connector: 'notion',
    serverUrl: 'https://mcp.example.com/mcp',
    declared: {},
    redirectUri: 'https://app.example.com/api/v1/automation/connectors/oauth/callback',
    fetch: fetchImpl,
    ...over,
});

describe('the discovery order (RFC 9728, RFC 8414, OpenID Connect discovery)', () => {
    it('protected-resource metadata: the path-aware URL first, then the root', () => {
        expect(protectedResourceMetadataUrls(new URL('https://mcp.example.com/v1/mcp/'))).toEqual([
            'https://mcp.example.com/.well-known/oauth-protected-resource/v1/mcp',
            'https://mcp.example.com/.well-known/oauth-protected-resource',
        ]);
        expect(protectedResourceMetadataUrls(new URL('https://mcp.example.com'))).toEqual([
            'https://mcp.example.com/.well-known/oauth-protected-resource',
        ]);
    });

    it('authorization-server metadata: RFC 8414 first, then the two OpenID Connect spellings', () => {
        expect(authorizationServerMetadataUrls(new URL('https://auth.example.com/tenant'))).toEqual([
            'https://auth.example.com/.well-known/oauth-authorization-server/tenant',
            'https://auth.example.com/.well-known/openid-configuration/tenant',
            'https://auth.example.com/tenant/.well-known/openid-configuration',
        ]);
        expect(authorizationServerMetadataUrls(new URL('https://auth.example.com'))).toEqual([
            'https://auth.example.com/.well-known/oauth-authorization-server',
            'https://auth.example.com/.well-known/openid-configuration',
        ]);
    });

    it('falls back to the root protected-resource document and to OpenID Connect discovery', async () => {
        const { impl, seen } = server({
            'https://mcp.example.com/.well-known/oauth-protected-resource': () => json({
                resource: 'https://mcp.example.com', authorization_servers: ['https://auth.example.com'],
            }),
            'https://auth.example.com/.well-known/openid-configuration': () => json({
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                code_challenge_methods_supported: ['S256'],
            }),
        });
        const client = await discoverMcpAuthorization(request(impl, { declared: { clientId: 'pre-registered' } }));
        expect(client).toEqual({
            issuer: 'https://auth.example.com',
            authorizationUrl: 'https://auth.example.com/authorize',
            tokenUrl: 'https://auth.example.com/token',
            resource: 'https://mcp.example.com',
            clientId: 'pre-registered',
            registered: false,
        });
        expect(seen.every((s) => s.init.redirect === 'error')).toBe(true);
    });
});

describe('what the flow refuses at the transport', () => {
    it('⛔ an MCP server that is not https off loopback is refused before anything is fetched', async () => {
        const { impl, seen } = server({});
        await expect(discoverMcpAuthorization(request(impl, { serverUrl: 'http://mcp.example.com/mcp' })))
            .rejects.toBeInstanceOf(McpAuthorizationRefusedError);
        expect(seen).toHaveLength(0);
    });

    it('⛔ an authorization server that is not https is refused before its metadata is fetched', async () => {
        const { impl, seen } = server({
            'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': () => json({
                resource: 'https://mcp.example.com/mcp', authorization_servers: ['http://auth.example.com'],
            }),
        });
        await expect(discoverMcpAuthorization(request(impl))).rejects.toThrow(/authorization server that is not https/);
        expect(seen).toHaveLength(1);
    });

    it('no answer, a 429 or a 5xx is operational, and quotes nothing it was sent', async () => {
        const down = (async () => { throw new Error('connect ECONNREFUSED dummy-detail'); }) as unknown as typeof fetch;
        const err = await discoverMcpAuthorization(request(down)).catch((e: unknown) => e as Error);
        expect(isConnectorUpstreamUnavailable(err)).toBe(true);
        expect(err.message).not.toContain('dummy-detail');
        for (const status of [429, 503]) {
            const { impl } = server({ 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': () => json({}, status) });
            expect(isConnectorUpstreamUnavailable(await discoverMcpAuthorization(request(impl)).catch((e: unknown) => e))).toBe(true);
        }
    });

    it("a refused registration names only a registered RFC 7591 code, never the server's text", async () => {
        const { impl } = server({
            'https://mcp.example.com/.well-known/oauth-protected-resource/mcp': () => json({
                resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://auth.example.com'],
            }),
            'https://auth.example.com/.well-known/oauth-authorization-server': () => json({
                issuer: 'https://auth.example.com',
                authorization_endpoint: 'https://auth.example.com/authorize',
                token_endpoint: 'https://auth.example.com/token',
                registration_endpoint: 'https://auth.example.com/register',
                code_challenge_methods_supported: ['S256'],
            }),
            'https://auth.example.com/register': () => json({ error: 'invalid_redirect_uri', error_description: 'dummy-echo' }, 400),
        });
        const err = await discoverMcpAuthorization(request(impl)).catch((e: unknown) => e as Error);
        expect(err).toBeInstanceOf(McpAuthorizationRefusedError);
        expect(err.message).toContain('(invalid_redirect_uri)');
        expect(err.message).not.toContain('dummy-echo');
    });
});

describe('the kept client', () => {
    it('reads back what was stored, and nothing incomplete', () => {
        const kept = {
            issuer: 'https://a', authorizationUrl: 'https://a/authorize', tokenUrl: 'https://a/token', resource: 'https://m', clientId: 'c', registered: true,
        };
        expect(parseMcpAuthorizationClient(JSON.stringify(kept))).toEqual(kept);
        expect(parseMcpAuthorizationClient(JSON.stringify({ ...kept, tokenUrl: undefined }))).toBeUndefined();
        expect(parseMcpAuthorizationClient('not json')).toBeUndefined();
        expect(parseMcpAuthorizationClient(undefined)).toBeUndefined();
    });
});
