// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Artifact-pinned boot, end to end (#8368, acceptance #1 and #6).
 *
 * ## Why this one has to be a real child process
 *
 * The criterion is "a runtime container + `OS_ARTIFACT_URL` boots the
 * referenced artifact **with no project checkout present**". Every part of that
 * sentence is about the process's surroundings, not about a function's return
 * value: the cwd holds no `objectstack.config.ts` and no `dist/`, the artifact
 * arrives over the network or from a mounted file, and the boot has to reach
 * "kernel bootstrapped" from there. A unit test can prove the resolver returns
 * the right path; only a child process standing in an empty directory can prove
 * a boot happens from it.
 *
 * `OS_MIGRATE_AND_EXIT=1` is what makes that affordable: `serve` runs the whole
 * kernel bootstrap — plugins, datasource, schema sync, metadata hydration, and
 * the #8368 migration gate on `kernel:ready` — then shuts down and exits 0
 * instead of serving. A successful exit therefore means the artifact really
 * booted, not merely that a path resolved.
 *
 * ## The secrets assertion, and its positive control
 *
 * The refusal case drives a pre-signed URL — userinfo plus a signature query
 * parameter — through the real failure path and reads the child's ENTIRE
 * stdout+stderr. Asserting the credential is absent is worthless on its own: an
 * empty capture, a child that died before printing, or a message about
 * something else would all pass. So the same capture is asserted to contain the
 * host and path of that same URL. The output is provably the output that would
 * have carried the credential.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROTOCOL_MAJOR } from '@objectstack/spec/kernel';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX_LOADER = resolve(HERE, '../../../node_modules/tsx/dist/loader.mjs');

/** A minimal but real compiled artifact: one app, one object. */
const ARTIFACT = JSON.stringify(
    {
        manifest: {
            id: 'com.example.hotcrm',
            name: 'hotcrm',
            version: '2.2.2',
            type: 'app',
            engines: { protocol: `^${PROTOCOL_MAJOR}` },
        },
        objects: [
            {
                name: 'crm_lead',
                label: 'Lead',
                fields: { name: { type: 'text', label: 'Name' } },
            },
        ],
        views: [],
        apps: [],
        flows: [],
        requires: [],
    },
    null,
    2,
);
const ARTIFACT_SHA256 = createHash('sha256').update(Buffer.from(ARTIFACT)).digest('hex');

const HOST_PATH = '/releases/hotcrm-2.2.2.json';
const CREDENTIAL = 's3cr3t-signature-value';
const USERINFO_SECRET = 'hunter2-userinfo';

let root: string;
let server: Server;
let origin: string;

/** Serve the artifact over real HTTP so the boot performs a real fetch. */
beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'os-8368-e2e-'));
    server = createServer((req, res) => {
        if ((req.url ?? '').startsWith(HOST_PATH)) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(ARTIFACT);
            return;
        }
        res.writeHead(404).end('not found');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const addr = server.address() as { port: number };
    origin = `127.0.0.1:${addr.port}`;
});

afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    rmSync(root, { recursive: true, force: true });
});

interface RunResult { code: number; output: string }

/**
 * Run `os serve` in a FRESH EMPTY directory — no config, no `dist/`, nothing.
 * That emptiness is the point of the criterion, so it is built here rather than
 * assumed.
 */
function runServe(env: Record<string, string>, opts: { migrateAndExit?: boolean } = {}): Promise<RunResult> {
    const cwd = mkdtempSync(join(root, 'empty-'));
    const home = join(cwd, 'home');
    mkdirSync(home, { recursive: true });
    // Guard the premise: an accidental fixture in the cwd would make a passing
    // boot mean nothing at all.
    expect(readdirSync(cwd).filter((f) => f !== 'home')).toEqual([]);

    return new Promise((resolvePromise) => {
        const child = spawn(
            process.execPath,
            ['--import', TSX_LOADER, CLI, 'serve'],
            {
                cwd,
                env: {
                    ...process.env,
                    NODE_ENV: 'production',
                    OS_HOME: home,
                    OS_DATABASE_URL: `file:${join(home, 'e2e.db')}`,
                    OS_SECRET_KEY: '0'.repeat(64),
                    AUTH_SECRET: '0'.repeat(32),
                    OS_DISABLE_CONSOLE: '1',
                    ...(opts.migrateAndExit === false ? {} : { OS_MIGRATE_AND_EXIT: '1' }),
                    // The image default this feature has to beat: always set on
                    // the official runtime image, always pointing at a file a
                    // container carrying no app does not have.
                    OS_ARTIFACT_PATH: join(cwd, 'dist/objectstack.json'),
                    ...env,
                },
                stdio: ['ignore', 'pipe', 'pipe'],
            },
        );
        let output = '';
        child.stdout.on('data', (c) => { output += String(c); });
        child.stderr.on('data', (c) => { output += String(c); });
        child.on('close', (code) => resolvePromise({ code: code ?? -1, output }));
    });
}

const BOOT_TIMEOUT = 180_000;

describe('OS_ARTIFACT_URL — boots with no project checkout (acceptance #1)', () => {
    it('boots an https:// artifact, overriding the image\'s OS_ARTIFACT_PATH default', async () => {
        const { code, output } = await runServe({
            OS_ARTIFACT_URL: `http://${origin}${HOST_PATH}#sha256=${ARTIFACT_SHA256}`,
        });
        expect(output).toContain('sha256 verified');
        expect(output).toContain('Migration complete');
        expect(code).toBe(0);
        // The OS_ARTIFACT_PATH the image sets points at a file that does not
        // exist; had it won, the boot would have refused with "does not exist".
        expect(output).not.toContain('does not exist');
    }, BOOT_TIMEOUT);

    it('boots a file:// artifact — the volume-mount workflow', async () => {
        const mounted = join(root, 'mounted-objectstack.json');
        writeFileSync(mounted, ARTIFACT);
        const { code, output } = await runServe({
            OS_ARTIFACT_URL: `${pathToFileURL(mounted).href}#sha256=${ARTIFACT_SHA256}`,
        });
        expect(output).toContain('sha256 verified');
        expect(code).toBe(0);
    }, BOOT_TIMEOUT);

    it('boots unpinned, and says so rather than claiming verification', async () => {
        const { code, output } = await runServe({
            OS_ARTIFACT_URL: `http://${origin}${HOST_PATH}`,
        });
        expect(output).toContain('unpinned');
        expect(output).not.toContain('sha256 verified');
        expect(code).toBe(0);
    }, BOOT_TIMEOUT);
});

describe('OS_ARTIFACT_URL — loud refusals (acceptance #2, #3, #6)', () => {
    it('refuses a hash mismatch, naming expected AND actual, and exits non-zero', async () => {
        const wrong = 'f'.repeat(64);
        const { code, output } = await runServe({
            OS_ARTIFACT_URL: `http://${origin}${HOST_PATH}#sha256=${wrong}`,
        });
        expect(code).not.toBe(0);
        expect(output).toContain('Integrity check FAILED');
        expect(output).toContain(wrong);            // expected
        expect(output).toContain(ARTIFACT_SHA256);  // actual
    }, BOOT_TIMEOUT);

    it('refuses an unreachable artifact instead of degrading to an empty kernel', async () => {
        const { code, output } = await runServe({
            // Port 1 on loopback: nothing listens, connection refused immediately.
            OS_ARTIFACT_URL: 'http://127.0.0.1:1/nope.json',
        });
        expect(code).not.toBe(0);
        expect(output).toContain('Cannot boot from OS_ARTIFACT_URL');
        // The degradation this must never take.
        expect(output).not.toContain('booting empty kernel');
    }, BOOT_TIMEOUT);

    it('never prints the credential of a pre-signed URL — on the real refusal path', async () => {
        const presigned =
            `http://svc-user:${USERINFO_SECRET}@${origin}${HOST_PATH}`
            + `?X-Amz-Signature=${CREDENTIAL}&X-Amz-Credential=AKIAEXAMPLE`
            + `#sha256=${'f'.repeat(64)}`;
        const { code, output } = await runServe({ OS_ARTIFACT_URL: presigned });

        expect(code).not.toBe(0);
        // ── Positive control ────────────────────────────────────────────
        // Without this, every assertion below would also pass against an
        // empty capture or a child that never reached this code path.
        expect(output.length).toBeGreaterThan(0);
        expect(output).toContain(origin);
        expect(output).toContain(HOST_PATH);
        expect(output).toContain('Integrity check FAILED');
        // ── The assertion that matters ──────────────────────────────────
        expect(output).not.toContain(CREDENTIAL);
        expect(output).not.toContain(USERINFO_SECRET);
        expect(output).not.toContain('AKIAEXAMPLE');
        expect(output).not.toContain('svc-user');
    }, BOOT_TIMEOUT);

    it('refuses an artifact built for another protocol major (acceptance #4)', async () => {
        const incompatible = JSON.stringify({
            manifest: {
                id: 'com.example.old',
                name: 'old',
                version: '1.0.0',
                type: 'app',
                engines: { protocol: `^${PROTOCOL_MAJOR - 1}` },
            },
            objects: [],
        });
        const file = join(root, 'incompatible.json');
        writeFileSync(file, incompatible);

        const { code, output } = await runServe({
            OS_ARTIFACT_URL: pathToFileURL(file).href,
        });
        expect(code).not.toBe(0);
        expect(output).toContain(`^${PROTOCOL_MAJOR - 1}`);

        // ── Why this assertion is written the strict way ────────────────
        // `AppPlugin` ALREADY runs the same handshake when a bundle reaches it,
        // so "an incompatible artifact fails the boot" was true before this
        // change too — a test asserting only a non-zero exit would pass against
        // `origin/main`'s behaviour and prove nothing about #8368. What is new
        // is WHERE the refusal happens: at reference resolution, before the
        // artifact boot is even announced and before any datasource connects.
        expect(output).toContain('Cannot boot from OS_ARTIFACT_URL');
        expect(output).not.toContain('Booting from the artifact named by OS_ARTIFACT_URL');
    }, BOOT_TIMEOUT);
});
