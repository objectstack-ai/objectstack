// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// #29937 — the empty-boot stub (`com.objectstack.empty`) is the platform's own
// package, written by the runtime that boots it. With no `engines.protocol` the
// ADR-0087 handshake answered `no-range`, and `os start` in an empty directory
// (the docs' one-line Community quickstart) printed a compatibility WARN about
// it as the newcomer's first boot diagnostic. The stub now declares this
// runtime's major, and a stub an older CLI wrote is refreshed in place.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';
import { checkProtocolCompat } from '@objectstack/metadata-core';
import { EMPTY_BOOT_STUB_ID, createDefaultHostConfig, ensureEmptyBootStub } from './default-host.js';

const RANGE = `^${PROTOCOL_MAJOR}`;

/** The stub exactly as CLIs up to 18.3.0 wrote it: no `engines`. */
const LEGACY_STUB = {
    manifest: {
        id: EMPTY_BOOT_STUB_ID,
        name: 'empty',
        version: '0.0.0',
        type: 'app',
        description: 'Empty starter kernel — install apps via the Studio marketplace.',
    },
    objects: [],
    views: [],
    apps: [],
    flows: [],
    requires: [],
};

let dir: string;
let stubPath: string;

beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'os-29937-'));
    stubPath = join(dir, 'dist', 'objectstack.json');
});

afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
});

function readStub(): any {
    return JSON.parse(readFileSync(stubPath, 'utf8'));
}

function writeStub(value: unknown): void {
    mkdirSync(join(dir, 'dist'), { recursive: true });
    writeFileSync(stubPath, typeof value === 'string' ? value : JSON.stringify(value, null, 2), 'utf8');
}

describe('ensureEmptyBootStub — the empty kernel declares its own protocol range (#29937)', () => {
    it('writes a fresh stub that passes the ADR-0087 handshake with no warning', () => {
        ensureEmptyBootStub(stubPath);

        expect(existsSync(stubPath)).toBe(true);
        const stub = readStub();
        expect(stub.manifest.id).toBe(EMPTY_BOOT_STUB_ID);
        expect(stub.manifest.engines).toEqual({ protocol: RANGE });
        // `ok` is the only status `assertProtocolCompat` returns from silently.
        expect(checkProtocolCompat(stub.manifest).status).toBe('ok');
    });

    it('refreshes a stub an older CLI wrote with no `engines`, keeping everything else', () => {
        writeStub(LEGACY_STUB);
        expect(checkProtocolCompat(LEGACY_STUB.manifest).status).toBe('no-range');

        ensureEmptyBootStub(stubPath);

        const stub = readStub();
        expect(stub).toEqual({
            ...LEGACY_STUB,
            manifest: { ...LEGACY_STUB.manifest, engines: { protocol: RANGE } },
        });
        expect(checkProtocolCompat(stub.manifest).status).toBe('ok');
    });

    it('re-stamps a stub a CLI of another major wrote, so a major bump never refuses the empty boot', () => {
        const otherMajor = `^${PROTOCOL_MAJOR - 1}`;
        writeStub({ ...LEGACY_STUB, manifest: { ...LEGACY_STUB.manifest, engines: { protocol: otherMajor } } });
        expect(checkProtocolCompat(readStub().manifest).status).toBe('incompatible');

        ensureEmptyBootStub(stubPath);

        expect(readStub().manifest.engines).toEqual({ protocol: RANGE });
    });

    it('leaves a current stub byte for byte', () => {
        ensureEmptyBootStub(stubPath);
        const before = readFileSync(stubPath, 'utf8');

        ensureEmptyBootStub(stubPath);

        expect(readFileSync(stubPath, 'utf8')).toBe(before);
    });

    it('never touches an artifact that is not the stub', () => {
        const foreign = JSON.stringify({ manifest: { id: 'com.example.crm', name: 'crm', version: '1.0.0', type: 'app' } });
        writeStub(foreign);

        ensureEmptyBootStub(stubPath);

        expect(readFileSync(stubPath, 'utf8')).toBe(foreign);
    });

    it('never touches a file it cannot read as JSON (the loader reports it)', () => {
        writeStub('{ not json');

        ensureEmptyBootStub(stubPath);

        expect(readFileSync(stubPath, 'utf8')).toBe('{ not json');
    });
});

describe('createDefaultHostConfig — the stub is refreshed on every empty boot, named or not (#29937)', () => {
    const BOOT_TIMEOUT = 60_000;
    let savedHome: string | undefined;

    beforeEach(() => {
        savedHome = process.env.OS_HOME;
        process.env.OS_HOME = dir;
    });

    afterEach(() => {
        if (savedHome === undefined) delete process.env.OS_HOME;
        else process.env.OS_HOME = savedHome;
    });

    // `os start` resolves `<home>/dist/objectstack.json` as an artifact rung
    // once it exists and hands it down as `artifactPath`, so every boot after
    // the first reaches the stub NAMED, never through the empty-boot branch.
    it('refreshes a legacy stub handed in as `artifactPath` at the home location', async () => {
        writeStub(LEGACY_STUB);

        await createDefaultHostConfig({ requireArtifact: true, artifactPath: stubPath, databaseUrl: ':memory:' });

        expect(readStub().manifest.engines).toEqual({ protocol: RANGE });
    }, BOOT_TIMEOUT);

    it('writes the stub with its range on the empty boot itself', async () => {
        await createDefaultHostConfig({ requireArtifact: false, databaseUrl: ':memory:' });

        expect(readStub().manifest.engines).toEqual({ protocol: RANGE });
    }, BOOT_TIMEOUT);

    it('leaves a stub-shaped artifact named anywhere else alone', async () => {
        const elsewhere = join(dir, 'elsewhere.json');
        const bytes = JSON.stringify(LEGACY_STUB);
        writeFileSync(elsewhere, bytes, 'utf8');

        await createDefaultHostConfig({ requireArtifact: true, artifactPath: elsewhere, databaseUrl: ':memory:' });

        expect(readFileSync(elsewhere, 'utf8')).toBe(bytes);
    }, BOOT_TIMEOUT);
});
