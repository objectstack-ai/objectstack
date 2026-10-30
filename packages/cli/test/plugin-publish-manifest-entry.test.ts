// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os plugin publish` uploads the compiled manifest from the one decode
 * `readCompiledPluginManifest` makes (#27914): the `plugin_manifest` payload
 * is the archive entry's own document, key for key, and the door does not
 * depend on the CLI's `MANIFEST_FILENAME` spelling the runtime's
 * `COMPILED_PLUGIN_MANIFEST_FILE`.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The CLI's constant spelled differently from the runtime's, as a drift
// between the two packages would leave it.
vi.mock('../src/utils/osplugin.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/utils/osplugin.js')>()),
    MANIFEST_FILENAME: 'objectstack.plugin.drifted.json',
}));

import { createTarGz, type ArchiveFile } from '../src/utils/osplugin.js';
import PluginPublish from '../src/commands/plugin/publish.js';

// The runtime's spelling (`COMPILED_PLUGIN_MANIFEST_FILE`), which the artifact uses.
const RUNTIME_MANIFEST_FILE = 'objectstack.plugin.json';

// No `integrity` map: the preflight's exemption list is spelled with the
// CLI constant, and this file is about the manifest read only.
const manifest = {
    version: '1.2.0', id: 'com.acme.demo', name: 'Demo', type: 'plugin',
    main: 'dist/index.mjs', packaging: 'bundled', runtime: 'sandbox',
    permissions: { services: ['object'] },
};
const manifestText = JSON.stringify(manifest, null, 4);

describe('os plugin publish: the uploaded manifest is the entry it decoded once', () => {
    let dir: string | undefined;
    const prevEnv = { url: process.env.OS_CLOUD_URL, key: process.env.OS_CLOUD_API_KEY };
    afterEach(async () => {
        vi.unstubAllGlobals();
        process.env.OS_CLOUD_URL = prevEnv.url;
        process.env.OS_CLOUD_API_KEY = prevEnv.key;
        if (dir) await rm(dir, { recursive: true, force: true });
    });

    it("publishes when the CLI's filename constant and the runtime's differ, and uploads the entry's document key for key", async () => {
        const files: ArchiveFile[] = [
            { path: 'dist/index.mjs', data: new Uint8Array(Buffer.from('export const x=1;\n')) },
            { path: RUNTIME_MANIFEST_FILE, data: new Uint8Array(Buffer.from(manifestText)) },
        ];
        dir = await mkdtemp(join(tmpdir(), 'plugin-publish-entry-'));
        const artifactPath = join(dir, 'com.acme.demo-1.2.0.osplugin');
        await writeFile(artifactPath, new Uint8Array(createTarGz(files)));
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
        expect(JSON.stringify(bodies[1].plugin_manifest)).toBe(JSON.stringify(JSON.parse(manifestText)));
    });
});
