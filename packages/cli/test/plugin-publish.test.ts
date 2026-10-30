// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    createTarGz,
    readOspluginManifest,
    readTarGz,
    sha256Hex,
    sriDigest,
    MANIFEST_FILENAME,
    SIGNATURE_FILENAME,
    type ArchiveFile,
} from '../src/utils/osplugin.js';
import PluginPublish from '../src/commands/plugin/publish.js';

const distData = new Uint8Array(Buffer.from('export const x=1;\n'));

const manifest = {
    id: 'com.acme.demo', name: 'Demo', version: '1.2.0', type: 'plugin',
    runtime: 'sandbox', packaging: 'bundled', main: 'dist/index.mjs',
    permissions: { services: ['object'] },
    // Real digest of `distData` — the publish preflight verifies it.
    integrity: { 'dist/index.mjs': sriDigest(distData) },
};

function buildArtifact(manifestOverride: Record<string, unknown> = manifest, extraFiles: ArchiveFile[] = []): Uint8Array {
    const files: ArchiveFile[] = [
        { path: 'dist/index.mjs', data: distData },
        { path: MANIFEST_FILENAME, data: new Uint8Array(Buffer.from(JSON.stringify(manifestOverride, null, 2))) },
        { path: SIGNATURE_FILENAME, data: new Uint8Array(Buffer.from('unsigned\n')) },
        ...extraFiles,
    ];
    return new Uint8Array(createTarGz(files));
}

describe('readTarGz / readOspluginManifest (inverse of createTarGz)', () => {
    it('round-trips the files and extracts the manifest', async () => {
        const blob = buildArtifact();
        const files = readTarGz(blob);
        expect(files.map((f) => f.path).sort()).toEqual([MANIFEST_FILENAME, SIGNATURE_FILENAME, 'dist/index.mjs'].sort());
        expect(Buffer.from(files.find((f) => f.path === 'dist/index.mjs')!.data).toString()).toBe('export const x=1;\n');
        await expect(readOspluginManifest(blob)).resolves.toMatchObject({ id: 'com.acme.demo', version: '1.2.0' });
    });
    it('throws when the manifest is absent', async () => {
        const blob = new Uint8Array(createTarGz([{ path: 'dist/index.mjs', data: new Uint8Array([1, 2, 3]) }]));
        await expect(readOspluginManifest(blob)).rejects.toThrow(/not found/);
    });
    it("parses through ManifestSchema: a pre-retirement manifest (packaging: 'manifest-deps') throws the schema's prescription", async () => {
        const blob = buildArtifact({ ...manifest, packaging: 'manifest-deps' });
        await expect(readOspluginManifest(blob)).rejects.toThrow(/packaging: `packaging: 'manifest-deps'` was removed/);
        await expect(readOspluginManifest(blob)).rejects.toThrow(/Delete the key/);
    });
    it('parses through ManifestSchema: a drifted manifest throws naming each issue', async () => {
        const drifted: Record<string, unknown> = { ...manifest, integrity: ['not', 'a', 'map'] };
        delete drifted.name;
        const blob = buildArtifact(drifted);
        await expect(readOspluginManifest(blob)).rejects.toThrow(/is not a valid plugin manifest: .*name: .*integrity: /);
    });
});

describe('os plugin publish (end-to-end, mocked cloud)', () => {
    let dir: string;
    const prevEnv = { url: process.env.OS_CLOUD_URL, key: process.env.OS_CLOUD_API_KEY };
    afterEach(async () => {
        vi.unstubAllGlobals();
        process.env.OS_CLOUD_URL = prevEnv.url;
        process.env.OS_CLOUD_API_KEY = prevEnv.key;
        if (dir) await rm(dir, { recursive: true, force: true });
    });

    it('POSTs the package then the plugin version with artifact + signature + checksum', async () => {
        dir = await mkdtemp(join(tmpdir(), 'plugin-publish-'));
        const blob = buildArtifact();
        const artifactPath = join(dir, 'com.acme.demo-1.2.0.osplugin');
        await writeFile(artifactPath, blob);
        await writeFile(`${artifactPath}.sig`, 'ed25519:acme:SIGVALUE\n');

        process.env.OS_CLOUD_URL = 'http://cloud.test';
        process.env.OS_CLOUD_API_KEY = 'tok_123';

        const calls: { url: string; body: any; auth?: string }[] = [];
        const fetchMock = vi.fn(async (url: string, init: any) => {
            calls.push({ url, body: JSON.parse(init.body), auth: init.headers?.Authorization });
            const data = url.endsWith('/versions')
                ? { version: '1.2.0', listing_status: 'pending_review' }
                : { id: 'pkg_1', created: true };
            return { ok: true, status: 200, json: async () => ({ success: true, data }), statusText: 'OK' } as any;
        });
        vi.stubGlobal('fetch', fetchMock);

        await PluginPublish.run([artifactPath, '--visibility', 'marketplace', '--submit']);

        expect(calls).toHaveLength(2);
        // 1) package register
        expect(calls[0].url).toBe('http://cloud.test/api/v1/cloud/packages');
        expect(calls[0].auth).toBe('Bearer tok_123');
        expect(calls[0].body).toMatchObject({ manifest_id: 'com.acme.demo', display_name: 'Demo', visibility: 'marketplace' });
        // 2) version publish — the exact plugin contract
        expect(calls[1].url).toBe('http://cloud.test/api/v1/cloud/packages/pkg_1/versions');
        expect(calls[1].body).toMatchObject({
            version: '1.2.0',
            artifact_kind: 'plugin',
            signature: 'ed25519:acme:SIGVALUE',
            artifact_checksum: sha256Hex(blob),
            submit_for_review: true,
        });
        // artifact round-trips through base64
        expect(Buffer.from(calls[1].body.osplugin, 'base64').equals(Buffer.from(blob))).toBe(true);
        expect(calls[1].body.plugin_manifest).toMatchObject({ id: 'com.acme.demo', runtime: 'sandbox' });
    });

    it('uploads the manifest the artifact carries, as it carries it (no schema default stamped)', async () => {
        dir = await mkdtemp(join(tmpdir(), 'plugin-publish-'));
        const blob = buildArtifact();
        const artifactPath = join(dir, 'com.acme.demo-1.2.0.osplugin');
        await writeFile(artifactPath, blob);
        process.env.OS_CLOUD_URL = 'http://cloud.test';
        process.env.OS_CLOUD_API_KEY = 'tok_123';
        const bodies: any[] = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, init: any) => {
            bodies.push(JSON.parse(init.body));
            const data = url.endsWith('/versions') ? { version: '1.2.0' } : { id: 'pkg_1', created: true };
            return { ok: true, status: 200, json: async () => ({ success: true, data }), statusText: 'OK' } as any;
        }));
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
        try {
            await PluginPublish.run([artifactPath]);
        } finally {
            logSpy.mockRestore();
        }
        expect(bodies).toHaveLength(2);
        // Exactly the artifact's own manifest: `ManifestSchema` would stamp
        // `scope` and `defaultDatasource`, and neither is uploaded.
        expect(bodies[1].plugin_manifest).toEqual(manifest);
        // Key for key, in the archive entry's own order (#27914).
        const entry = readTarGz(blob).find((f) => f.path === MANIFEST_FILENAME)!;
        expect(JSON.stringify(bodies[1].plugin_manifest)).toBe(JSON.stringify(JSON.parse(Buffer.from(entry.data).toString('utf8'))));
        expect(bodies[1].plugin_manifest).not.toHaveProperty('scope');
        expect(bodies[1].plugin_manifest).not.toHaveProperty('defaultDatasource');
    });

    async function runExpectingRefusal(blob: Uint8Array): Promise<{ output: string; fetchCalls: number }> {
        dir = await mkdtemp(join(tmpdir(), 'plugin-publish-'));
        const artifactPath = join(dir, 'com.acme.demo-1.2.0.osplugin');
        await writeFile(artifactPath, blob);
        process.env.OS_CLOUD_URL = 'http://cloud.test';
        process.env.OS_CLOUD_API_KEY = 'tok_123';
        const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}), statusText: 'OK' } as any));
        vi.stubGlobal('fetch', fetchMock);
        const lines: string[] = [];
        const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });
        try {
            await expect(PluginPublish.run([artifactPath])).rejects.toThrow(/EEXIT: 1/);
        } finally {
            logSpy.mockRestore();
        }
        return { output: lines.join('\n'), fetchCalls: fetchMock.mock.calls.length };
    }

    it("refuses a pre-retirement artifact (packaging: 'manifest-deps') with the schema's prescription, before any upload", async () => {
        const { output, fetchCalls } = await runExpectingRefusal(buildArtifact({ ...manifest, packaging: 'manifest-deps' }));
        expect(fetchCalls).toBe(0); // refused pre-upload — no request left the machine
        expect(output).toMatch(/^ +• packaging: `packaging: 'manifest-deps'` was removed/m);
        expect(output).toMatch(/Delete the key/);
        expect(output).toContain('os plugin build');
    });

    it('refuses a compiled manifest ManifestSchema refuses, naming each issue, before any upload', async () => {
        const drifted: Record<string, unknown> = { ...manifest, integrity: ['not', 'a', 'map'] };
        delete drifted.name;
        const { output, fetchCalls } = await runExpectingRefusal(buildArtifact(drifted));
        expect(fetchCalls).toBe(0);
        expect(output).toMatch(/^ +• name: /m);
        expect(output).toMatch(/^ +• integrity: /m);
    });

    it('refuses the publish before any upload when a declared digest mismatches', async () => {
        const tampered = { ...manifest, integrity: { 'dist/index.mjs': sriDigest(new Uint8Array(Buffer.from('other bytes'))) } };
        const { output, fetchCalls } = await runExpectingRefusal(buildArtifact(tampered));
        expect(fetchCalls).toBe(0); // refused pre-upload — nothing reached the cloud
        expect(output).toContain('Integrity preflight failed');
        expect(output).toContain('dist/index.mjs');
        expect(output).toContain('digest mismatch');
        expect(output).toContain('os plugin build');
    });

    it('refuses when the integrity map declares a file the artifact lacks', async () => {
        const withGhost = { ...manifest, integrity: { ...manifest.integrity, 'dist/ghost.mjs': sriDigest(distData) } };
        const { output, fetchCalls } = await runExpectingRefusal(buildArtifact(withGhost));
        expect(fetchCalls).toBe(0);
        expect(output).toContain('dist/ghost.mjs');
        expect(output).toContain('absent from the artifact');
    });

    it('refuses on a packaged file the integrity map does not declare (stale map)', async () => {
        const blob = buildArtifact(manifest, [{ path: 'dist/extra.mjs', data: distData }]);
        const { output, fetchCalls } = await runExpectingRefusal(blob);
        expect(fetchCalls).toBe(0);
        expect(output).toContain('dist/extra.mjs');
        expect(output).toContain('not in the integrity map');
    });

    it('absent integrity map is permissive: publish proceeds with a skip notice (the field is optional)', async () => {
        dir = await mkdtemp(join(tmpdir(), 'plugin-publish-'));
        const withoutIntegrity: Record<string, unknown> = { ...manifest };
        delete withoutIntegrity.integrity;
        const blob = buildArtifact(withoutIntegrity);
        const artifactPath = join(dir, 'com.acme.demo-1.2.0.osplugin');
        await writeFile(artifactPath, blob);
        process.env.OS_CLOUD_URL = 'http://cloud.test';
        process.env.OS_CLOUD_API_KEY = 'tok_123';
        const fetchMock = vi.fn(async (url: string) => {
            const data = url.endsWith('/versions') ? { version: '1.2.0' } : { id: 'pkg_1', created: true };
            return { ok: true, status: 200, json: async () => ({ success: true, data }), statusText: 'OK' } as any;
        });
        vi.stubGlobal('fetch', fetchMock);
        const lines: string[] = [];
        const logSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
            lines.push(args.map(String).join(' '));
        });
        try {
            await PluginPublish.run([artifactPath]);
        } finally {
            logSpy.mockRestore();
        }
        expect(fetchMock.mock.calls.length).toBe(2); // both uploads still happened
        expect(lines.join('\n')).toContain('integrity preflight skipped');
    });
});
