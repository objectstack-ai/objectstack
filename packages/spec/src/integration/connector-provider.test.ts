// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0096 — schema evolution for provider-bound declarative connector instances.
// Verifies the new `provider` / `providerConfig` / `auth` fields, the
// credentialRef-based instance auth (no inline secrets), and the authoring rules
// enforced by DeclarativeConnectorEntrySchema.

import { describe, it, expect } from 'vitest';
import {
    ConnectorSchema,
    DeclarativeConnectorEntrySchema,
    ConnectorInstanceAuthSchema,
} from './connector.zod';

describe('ADR-0096 connector schema evolution', () => {
    describe('ConnectorSchema — new fields', () => {
        it('defaults authentication to { type: none } so provider-bound instances need not inline it', () => {
            const c = ConnectorSchema.parse({ name: 'billing', label: 'Billing', type: 'api' });
            expect(c.authentication).toEqual({ type: 'none' });
        });

        it('accepts provider / providerConfig / auth', () => {
            const c = ConnectorSchema.parse({
                name: 'billing',
                label: 'Billing',
                type: 'api',
                provider: 'openapi',
                providerConfig: { spec: 'https://x/openapi.json', baseUrl: 'https://x' },
                auth: { type: 'bearer', credentialRef: 'billing_token' },
            });
            expect(c.provider).toBe('openapi');
            expect(c.auth).toEqual({ type: 'bearer', credentialRef: 'billing_token' });
        });

        it('rejects a non-snake_case provider key', () => {
            expect(() =>
                ConnectorSchema.parse({ name: 'x', label: 'X', type: 'api', provider: 'OpenAPI' }),
            ).toThrow();
        });
    });

    describe('ConnectorInstanceAuthSchema — credentialRef, never inline secrets', () => {
        it('accepts bearer/api-key/basic with credentialRef', () => {
            expect(ConnectorInstanceAuthSchema.parse({ type: 'bearer', credentialRef: 'r' }).type).toBe('bearer');
            expect(ConnectorInstanceAuthSchema.parse({ type: 'api-key', credentialRef: 'r' }).type).toBe('api-key');
            expect(
                ConnectorInstanceAuthSchema.parse({ type: 'basic', username: 'u', credentialRef: 'r' }).type,
            ).toBe('basic');
        });

        it('rejects an inline bearer token (no `token` field exists on the instance shape)', () => {
            expect(() => ConnectorInstanceAuthSchema.parse({ type: 'bearer', token: 'secret' } as never)).toThrow();
        });

        it('requires a non-empty credentialRef', () => {
            expect(() => ConnectorInstanceAuthSchema.parse({ type: 'bearer', credentialRef: '' })).toThrow();
        });
    });

    describe('DeclarativeConnectorEntrySchema — authoring rules', () => {
        const validInstance = {
            name: 'billing',
            label: 'Billing',
            type: 'api',
            provider: 'openapi',
            providerConfig: { spec: 'https://x/openapi.json' },
            auth: { type: 'bearer', credentialRef: 'billing_token' },
        };

        it('accepts a well-formed provider-bound instance', () => {
            expect(() => DeclarativeConnectorEntrySchema.parse(validInstance)).not.toThrow();
        });

        it('accepts a plain descriptor (no provider) with inline authentication + actions', () => {
            expect(() =>
                DeclarativeConnectorEntrySchema.parse({
                    name: 'legacy',
                    label: 'Legacy',
                    type: 'api',
                    authentication: { type: 'bearer', token: 'kept-for-descriptor' },
                    actions: [{ key: 'do', label: 'Do' }],
                }),
            ).not.toThrow();
        });

        it('rejects inline `authentication` secrets on a provider-bound instance (§3)', () => {
            expect(() =>
                DeclarativeConnectorEntrySchema.parse({
                    ...validInstance,
                    authentication: { type: 'bearer', token: 'inline-secret' },
                }),
            ).toThrow(/must not inline secrets/);
        });

        it('rejects `providerConfig` without a provider', () => {
            expect(() =>
                DeclarativeConnectorEntrySchema.parse({
                    name: 'x',
                    label: 'X',
                    type: 'api',
                    providerConfig: { spec: 'y' },
                }),
            ).toThrow(/`providerConfig` requires a `provider`/);
        });

        it('rejects `auth` without a provider', () => {
            expect(() =>
                DeclarativeConnectorEntrySchema.parse({
                    name: 'x',
                    label: 'X',
                    type: 'api',
                    auth: { type: 'bearer', credentialRef: 'r' },
                }),
            ).toThrow(/`auth` requires a `provider`/);
        });

        it('rejects authored `actions` on a provider-bound instance (§5 — derived by the provider)', () => {
            expect(() =>
                DeclarativeConnectorEntrySchema.parse({
                    ...validInstance,
                    actions: [{ key: 'do', label: 'Do' }],
                }),
            ).toThrow(/must not author `actions`/);
        });

        it('rejects authored `triggers` on a provider-bound instance (§5)', () => {
            expect(() =>
                DeclarativeConnectorEntrySchema.parse({
                    ...validInstance,
                    triggers: [{ key: 't', label: 'T', type: 'polling' }],
                }),
            ).toThrow(/must not author `triggers`/);
        });
    });
});
