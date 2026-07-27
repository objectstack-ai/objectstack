// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/auth` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-7).
 * Bridges to the `auth` service's better-auth handler; when no auth service
 * is registered (MSW / browser-only mock environments) a minimal mock
 * fallback keeps core sign-up/sign-in/session flows from 404ing.
 */

import { CoreServiceName } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

/**
 * Browser-safe UUID generator — prefers Web Crypto's `randomUUID`, falls back
 * to an RFC 4122 v4 built from `crypto.getRandomValues` (available everywhere
 * `randomUUID` might be missing, e.g. non-secure contexts). The legacy
 * `Math.random()` fallback was a latent CodeQL js/insecure-randomness hit
 * surfaced by the extraction — these ids feed mock session tokens, so use
 * CSPRNG bytes regardless.
 */
function randomUUID(): string {
    const c: Crypto | undefined = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') {
        return c.randomUUID();
    }
    const bytes = new Uint8Array(16);
    if (c && typeof c.getRandomValues === 'function') {
        c.getRandomValues(bytes);
    } else {
        // No crypto at all (ancient runtime) — mock-only path; still avoid
        // Math.random by deriving from the only entropy available.
        for (let i = 0; i < 16; i++) bytes[i] = (Date.now() + i * 7919) & 0xff;
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createAuthDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/auth',
        handler: (req, context) =>
            handleAuthRequest(deps, req.path.substring(5), req.method, req.body, context),
    };
}

/**
 * Handles Auth requests
 * path: sub-path after /auth/
 */
export async function handleAuthRequest(deps: DomainHandlerDeps, path: string, method: string, body: any, context: HttpProtocolContext): Promise<HttpDispatcherResult> {
    // 1. Try generic Auth Service
    const authService = await deps.getService(CoreServiceName.enum.auth);
    if (authService && typeof authService.handler === 'function') {
        const response = await authService.handler(context.request, context.response);
        return { handled: true, result: response };
    }

    // 2. Mock fallback for MSW/test environments when no auth service is registered
    const normalizedPath = path.replace(/^\/+/, '');
    return mockAuthFallback(normalizedPath, method, body);
}

/**
 * Provides mock auth responses for core better-auth endpoints when
 * AuthPlugin is not loaded (e.g. MSW/browser-only environments).
 * This ensures registration/sign-in flows do not 404 in mock mode.
 */
function mockAuthFallback(path: string, method: string, body: any): HttpDispatcherResult {
    const m = method.toUpperCase();
    const MOCK_SESSION_EXPIRY_MS = 86_400_000; // 24 hours

    // POST sign-up/email
    if ((path === 'sign-up/email' || path === 'register') && m === 'POST') {
        const id = `mock_${randomUUID()}`;
        return {
            handled: true,
            response: {
                status: 200,
                body: {
                    user: { id, name: body?.name || 'Mock User', email: body?.email || 'mock@test.local', emailVerified: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                    session: { id: `session_${id}`, userId: id, token: `mock_token_${id}`, expiresAt: new Date(Date.now() + MOCK_SESSION_EXPIRY_MS).toISOString() },
                },
            },
        };
    }

    // POST sign-in/email or login
    if ((path === 'sign-in/email' || path === 'login') && m === 'POST') {
        const id = `mock_${randomUUID()}`;
        return {
            handled: true,
            response: {
                status: 200,
                body: {
                    user: { id, name: 'Mock User', email: body?.email || 'mock@test.local', emailVerified: true, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
                    session: { id: `session_${id}`, userId: id, token: `mock_token_${id}`, expiresAt: new Date(Date.now() + MOCK_SESSION_EXPIRY_MS).toISOString() },
                },
            },
        };
    }

    // GET get-session
    if (path === 'get-session' && m === 'GET') {
        return {
            handled: true,
            response: { status: 200, body: { session: null, user: null } },
        };
    }

    // POST sign-out
    if (path === 'sign-out' && m === 'POST') {
        return {
            handled: true,
            response: { status: 200, body: { success: true } },
        };
    }

    return { handled: false };
}
