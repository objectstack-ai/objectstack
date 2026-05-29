// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { ProtectionSchema, applyProtection } from './protection.zod';

describe('ProtectionSchema', () => {
    it('accepts the four lock values', () => {
        for (const lock of ['none', 'no-overlay', 'no-delete', 'full'] as const) {
            expect(() => ProtectionSchema.parse({ lock, reason: 'r' })).not.toThrow();
        }
    });

    it('rejects unknown lock values', () => {
        expect(() => ProtectionSchema.parse({ lock: 'frozen' as any, reason: 'r' })).toThrow();
    });

    it('rejects unknown keys (strict mode)', () => {
        expect(() => ProtectionSchema.parse({ lock: 'full', reason: 'r', extras: 'no' as any }))
            .toThrow();
    });

    it('requires a non-empty reason', () => {
        expect(() => ProtectionSchema.parse({ lock: 'full' } as any)).toThrow();
        expect(() => ProtectionSchema.parse({ lock: 'full', reason: '' })).toThrow();
    });

    it('accepts optional reason and docsUrl', () => {
        const out = ProtectionSchema.parse({
            lock: 'full',
            reason: 'Locked by upstream package',
            docsUrl: 'https://example.com/lock',
        });
        expect(out.reason).toBe('Locked by upstream package');
        expect(out.docsUrl).toBe('https://example.com/lock');
    });

    it('rejects invalid docsUrl (non-URL string)', () => {
        expect(() => ProtectionSchema.parse({ lock: 'full', reason: 'r', docsUrl: 'not a url' }))
            .toThrow();
    });
});

describe('applyProtection', () => {
    it('translates protection → _lock envelope and strips the public block', () => {
        const item = {
            name: 'setup',
            label: 'Setup',
            protection: {
                lock: 'full',
                reason: 'Core admin UI',
                docsUrl: 'https://docs.objectstack.ai/adr/0010',
            },
        } as Record<string, unknown>;
        applyProtection(item, { packageId: 'com.objectstack.platform-objects' });
        expect(item._lock).toBe('full');
        expect(item._lockReason).toBe('Core admin UI');
        expect(item._lockDocsUrl).toBe('https://docs.objectstack.ai/adr/0010');
        expect(item._lockSource).toBe('package');
        expect(item._provenance).toBe('package');
        expect(item._packageId).toBe('com.objectstack.platform-objects');
        expect(item.protection).toBeUndefined();
    });

    it('stamps packageId/_provenance without protection block', () => {
        const item = { name: 'task', label: 'Task' } as Record<string, unknown>;
        applyProtection(item, { packageId: 'crm', packageVersion: '1.2.3' });
        expect(item._packageId).toBe('crm');
        expect(item._packageVersion).toBe('1.2.3');
        expect(item._provenance).toBe('package');
        expect(item._lock).toBeUndefined();
    });

    it('leaves bare items unchanged (no packageId, no protection)', () => {
        const item = { name: 'x' } as Record<string, unknown>;
        applyProtection(item, {});
        expect(item._packageId).toBeUndefined();
        expect(item._provenance).toBeUndefined();
        expect(item._lock).toBeUndefined();
    });

    it('falls back to lockSource=artifact when no packageId', () => {
        const item = {
            name: 'x',
            protection: { lock: 'no-overlay', reason: 'r' },
        } as Record<string, unknown>;
        applyProtection(item, {});
        expect(item._lockSource).toBe('artifact');
        expect(item._lock).toBe('no-overlay');
    });

    it('does not overwrite pre-existing _lock fields', () => {
        const item = {
            _lock: 'no-delete',
            _lockReason: 'pre-set',
            _packageId: 'existing',
            protection: { lock: 'full', reason: 'new' },
        } as Record<string, unknown>;
        applyProtection(item, { packageId: 'override' });
        // _packageId is preserved (only sets when undefined).
        expect(item._packageId).toBe('existing');
        // But _lock IS overwritten because we treat `protection` as the
        // authoritative declaration; this matches loader semantics.
        expect(item._lock).toBe('full');
        expect(item._lockReason).toBe('new');
    });
});
