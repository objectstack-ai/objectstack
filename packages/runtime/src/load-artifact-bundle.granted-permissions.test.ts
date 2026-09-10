// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13457 — the `{ schemaVersion, metadata }` unwrap must carry
// `grantedPermissions` across.
//
// `EnvironmentArtifactSchema` puts the install-time consented set BESIDE
// `metadata`, and the unwrap hands the kernel `metadata` alone — so every key
// standing beside it is dropped. For `grantedPermissions` that loss is SILENT
// and indistinguishable from the legitimate reading: an absent key means "no
// consent record", so an envelope stripped of its consent records boots green,
// enforcing nothing, with nothing to see. That is why this is pinned on the
// loader rather than left to the consumer.

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadArtifactBundle } from './load-artifact-bundle.js';

const write = (body: unknown): string => {
    const dir = mkdtempSync(join(tmpdir(), 'os-13457-'));
    const file = join(dir, 'objectstack.json');
    writeFileSync(file, JSON.stringify(body), 'utf-8');
    return file;
};

const envelope = (extra: Record<string, unknown>) => ({
    schemaVersion: '0.1',
    environmentId: 'env_1',
    commitId: 'c1',
    checksum: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    metadata: { manifest: { id: 'com.acme.crm', name: 'crm', version: '1.0.0', type: 'app' } },
    ...extra,
});

describe('#13457 — the envelope unwrap carries the consented set', () => {
    it('a populated `grantedPermissions` survives the unwrap', async () => {
        const grants = { 'com.acme.crm': { services: ['object'], hooks: [], network: [], fs: [] } };
        const bundle = await loadArtifactBundle(write(envelope({ grantedPermissions: grants })), {
            unwrapEnvelope: true,
        });
        // The unwrapped bundle is `metadata`; the consented set rode across.
        expect(bundle.manifest.id).toBe('com.acme.crm');
        expect(bundle.grantedPermissions).toEqual(grants);
    });

    it('a declared EMPTY map survives as `{}` — not as absence', async () => {
        const bundle = await loadArtifactBundle(write(envelope({ grantedPermissions: {} })), {
            unwrapEnvelope: true,
        });
        // ⭐ `{}` is a consent record that names no package. A truthiness or
        // emptiness test in the carry would drop it and turn it into the absent
        // reading, which is the collapse the producer pins against.
        expect(bundle.grantedPermissions).toEqual({});
        expect('grantedPermissions' in bundle).toBe(true);
    });

    it('an envelope with NO `grantedPermissions` does not grow one', async () => {
        const bundle = await loadArtifactBundle(write(envelope({})), { unwrapEnvelope: true });
        expect('grantedPermissions' in bundle).toBe(false);
    });

    it('an UNWRAPPED artifact is untouched — the carry is the unwrap\'s business only', async () => {
        // No `schemaVersion`, so nothing unwraps and the parsed object is the
        // bundle; the key (present or not) is already where the consumer reads.
        const flat = { manifest: { id: 'com.acme.crm' }, grantedPermissions: { 'com.acme.crm': {} } };
        const bundle = await loadArtifactBundle(write(flat), { unwrapEnvelope: true });
        expect(bundle.grantedPermissions).toEqual({ 'com.acme.crm': {} });
    });
});
