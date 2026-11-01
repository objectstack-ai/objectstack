// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25779 — a seed record fills a required file field with a file the package
 * ships, `seedFile(path)`, and the booted platform serves that file.
 *
 * The card's acceptance, measured through the doors a user reaches: `os serve
 * objectstack.config.ts --dev` on a project whose `clm_version.file` is
 * required, seeded with two versions naming the same fixture. Each seeded row
 * holds a file of its own, and following `GET /storage/files/:fileId` for it
 * answers the fixture's bytes, so the file is stored, committed and owned (an
 * uncommitted or unowned file is not served).
 *
 * ## Why it spawns the real command
 *
 * The collection and the loader are pinned in-process
 * (`src/utils/bundle-seed-files.test.ts`, metadata-protocol's
 * `seed-loader-seed-files.test.ts`, service-storage's
 * `field-file-service.test.ts`). Only a boot reaches the seams between them: the
 * config-load mirror in `serve.ts` (a config carries the reference, not the
 * bytes), the `field-files` service the storage plugin registers, and the
 * inline seed deferred to `kernel:bootstrapped`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  childEnv,
  probeThroughChild,
  readKernelAssignedPort,
} from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;

const PDF = '%PDF-1.7 MARKER-25779 a seeded contract';

const CONFIG = `import { defineStack } from '@objectstack/spec';
import { seedFile } from '@objectstack/spec/data';

export default defineStack({
  manifest: { id: 'com.example.clm', name: 'clm', version: '1.0.0', type: 'app', namespace: 'clm' },
  objects: [
    {
      name: 'clm_version',
      label: 'Version',
      sharingModel: 'private',
      fields: {
        code: { type: 'text', label: 'Code' },
        file: { type: 'file', label: 'File', required: true },
      },
    },
  ],
  data: [
    {
      object: 'clm_version',
      externalId: 'code',
      records: [
        { code: 'V1', file: seedFile('fixtures/nda.pdf') },
        { code: 'V2', file: seedFile('fixtures/nda.pdf', { name: 'NDA v2.pdf' }) },
      ],
    },
  ],
}, { strict: false });
`;

let dir = '';
let child: ChildProcessWithoutNullStreams | null = null;
let output = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'os-seed-files-serve-'));
  mkdirSync(join(dir, 'fixtures'));
  writeFileSync(join(dir, 'fixtures', 'nda.pdf'), PDF);
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG);
  linkSpec(dir);
});

afterAll(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>((done) => {
      const give = setTimeout(() => {
        try { child!.kill('SIGKILL'); } catch { /* already gone */ }
        done();
      }, 10_000);
      child!.once('exit', () => { clearTimeout(give); done(); });
      try { child!.kill('SIGTERM'); } catch { clearTimeout(give); done(); }
    });
  }
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** Boot `os serve objectstack.config.ts --dev`; `--dev` seeds the admin. Answers the port it bound. */
function bootServe(): Promise<number> {
  return new Promise((resolveBoot, rejectBoot) => {
    child = spawn(process.execPath, [CLI, 'serve', 'objectstack.config.ts', '-p', KERNEL_ASSIGNED_PORT, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    }) as ChildProcessWithoutNullStreams;
    const what = `os serve --dev in ${dir}`;
    let settled = false;
    const settle = (verdict: Error | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (verdict instanceof Error) rejectBoot(verdict);
      else resolveBoot(verdict);
    };
    const timer = setTimeout(
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${output.slice(-4000)}`)),
      180_000,
    );
    const onData = (d: unknown) => {
      output += String(d);
      if (READY.test(output)) settle(readKernelAssignedPort(output, what));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${output.slice(-4000)}`)),
    );
  });
}

/** One HTTP exchange, attributed to the child if the transport fails. ⛔ No assertion inside. */
async function request(what: string, url: string, init: RequestInit = {}): Promise<{ status: number; headers: Headers; text: string; body: any }> {
  return probeThroughChild(
    {
      child: child!,
      transcript: () => `\n--- child output ---\n${output.slice(-4000)}`,
      label: 'serve-config-boot-seed-files',
      what,
    },
    async () => {
      const r = await fetch(url, init);
      const text = await r.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, headers: r.headers, text, body };
    },
  );
}

/** The rows a data read answers, whichever envelope carries them. */
function rowsOf(body: any): Array<Record<string, any>> {
  const candidates = [body?.data?.records, body?.data?.items, body?.records, body?.items, body?.data, body?.value];
  return (candidates.find(Array.isArray) ?? []) as Array<Record<string, any>>;
}

/** A file field's value as read: the bare id, or the expanded form carrying it. */
function fileIdOf(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    for (const key of ['id', 'fileId', 'file_id']) if (typeof v[key] === 'string') return v[key] as string;
  }
  return undefined;
}

describe('a config boot seeds and serves the files seed records name (#25779)', () => {
  it('each seeded version holds a stored file of its own, and the file door serves the fixture\'s bytes', async () => {
    const port = await bootServe();
    const base = `http://localhost:${port}/api/v1`;

    const signIn = await request('the sign-in probe', `${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(signIn.status, `sign-in: ${signIn.text}`).toBe(200);
    const headers = { authorization: `Bearer ${signIn.body.token}` };

    // The inline seed of a stack carrying seed files runs at
    // `kernel:bootstrapped`; read until both rows are there, bounded.
    let rows: Array<Record<string, any>> = [];
    let last = '';
    for (let attempt = 0; attempt < 60 && rows.length < 2; attempt++) {
      const read = await request('the data read', `${base}/data/clm_version`, { headers });
      last = `${read.status} ${read.text.slice(0, 2000)}`;
      rows = rowsOf(read.body);
      if (rows.length < 2) await new Promise((r) => setTimeout(r, 1000));
    }
    expect(rows.map((r) => r.code).sort(), `last read: ${last}\n--- output ---\n${output.slice(-4000)}`).toEqual(['V1', 'V2']);

    const ids = rows.map((r) => fileIdOf(r.file));
    expect(ids.every((id) => typeof id === 'string' && id.length > 0), JSON.stringify(rows)).toBe(true);
    expect(new Set(ids).size, 'each row holds a file of its own').toBe(2);

    for (const id of ids) {
      const redirect = await request(`the file door for ${id}`, `${base}/storage/files/${id}`, { headers, redirect: 'manual' });
      expect(redirect.status, `GET /storage/files/${id}: ${redirect.text}`).toBe(302);
      const location = new URL(redirect.headers.get('location')!, `http://localhost:${port}`).toString();
      const bytes = await request(`the bytes of ${id}`, location, { headers });
      expect(bytes.status).toBe(200);
      expect(bytes.text).toBe(PDF);
    }
  }, 300_000);
});
