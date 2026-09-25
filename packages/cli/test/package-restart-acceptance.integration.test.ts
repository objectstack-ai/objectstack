// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #17676 ruling A' item 5 — the card's acceptance, run as HTTP against the real
 * `os serve` composition across a restart on ONE database file:
 *
 *   「The three probes (Studio writable list, `GET /api/v1/data/<ns>_<obj>`,
 *    `GET /api/v1/meta/object/…/published`) agree after a restart — that is
 *    the acceptance.」
 *
 * The chain is the card's own repro, on a host app that declares neither
 * `marketplace` nor `package-registry` (the `examples/app-crm` shape):
 * `POST /api/v1/packages` (a writable base, the body Studio's create dialog
 * sends) → `PUT /api/v1/meta/object/<obj>?mode=draft&package=<id>` →
 * `POST /api/v1/packages/<id>/publish-drafts` → stop → boot again → probes.
 *
 * ## The three probes, and where each one's route comes from
 *
 *   1. Studio writable list — Studio's builder landing (objectui
 *      `packages/app-shell/src/views/studio-design/BuilderLanding.tsx`, heading
 *      `engine.studio.landing.mineHeading` = "My packages (writable)", empty
 *      state "No writable packages yet") lists `fetchPackages()` filtered to
 *      `writable`. `fetchPackages()` (`studio-design/packages-io.ts`) is ONE
 *      read: `GET /api/v1/packages`, no query parameters; `parsePackages` drops
 *      `scope: system | cloud` rows and takes the row's top-level `writable`
 *      boolean — the server's verdict (`withWritableVerdict` in
 *      `packages/runtime/src/domains/packages.ts`). {@link studioWritableIds}
 *      is that reader, minus the fallback for servers that predate `writable`.
 *   2. `GET /api/v1/data/<ns>_<obj>` — the object must be REGISTERED to serve.
 *   3. `GET /api/v1/meta/object/<ns>_<obj>/published` — the stored row.
 *
 * ## What this file pins
 *
 * All three probes cross the restart. Probe 1: the package comes back from
 * `sys_packages` (the `package-registry` mount). Probe 3: the published row is
 * still served. Probe 2: the data route serves the object again, because the
 * stock composition, `createStandaloneStack` (`packages/runtime`), DECLARES
 * `hydrateMetadataFromDb` on its `ObjectQLPlugin` (#20071), so
 * `ObjectQLPlugin.start()` reads the runtime-authored object back from
 * `sys_metadata`. Before that declaration the stack stamped `environmentId:
 * 'env_local'`, the plugin read the stamp as "a per-project kernel" and skipped
 * the read, and the data route answered `404 OBJECT_NOT_FOUND` after the
 * restart for an object that was published and serving before it. This file
 * landed with probe 2 as `it.fails` and went red on that fix, which promoted it
 * to a plain `it`. The other assertions below are harness health for probe 2:
 * the chain, the pre-restart agreement and the other two probes are asserted on
 * their own.
 *
 * Tier: the name carries no nightly tier (`scripts/nightly-tiers.mjs`), so it
 * runs in the per-PR and merge-queue Test Core run; it spawns the CLI, so
 * `vitest-tiers.ts` puts it in the `integration` project. A queue-tier file is
 * deliberate: the change that fixes probe 2 lives in a package this suite
 * depends on, so the `it.fails` flips on THAT pull request, not on a nightly
 * after it lands.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLI,
  E2E_SECRET_KEY,
  TSX,
  childEnv,
  portContentionError,
  portDriftError,
  probeThroughChild,
  randomPort,
} from './helpers/serve-process.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;

/** The writable base the chain creates, and the object it publishes into it. */
const PKG_ID = 'com.example.leave';
const NAMESPACE = 'leave';
const OBJECT = `${NAMESPACE}_request`;

/** A host app shaped like `examples/app-crm`: it declares neither capability token. */
const HOST_CONFIG = `
export default {
  manifest: {
    id: 'com.example.acceptancehost',
    namespace: 'acceptancehost',
    version: '1.0.0',
    type: 'app',
    name: 'acceptance host',
  },
  objects: [{
    name: 'acceptancehost_task',
    label: 'Task',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};
`;

interface LiveServe {
  child: ChildProcessWithoutNullStreams;
  /** Everything the child has printed so far, both streams. */
  output: () => string;
}

const children: ChildProcessWithoutNullStreams[] = [];
const dirs: string[] = [];

/** Boot `os serve --dev` on `db` and keep it running until {@link stop}. */
function bootServe(dir: string, port: string, db: string): Promise<LiveServe> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '-p', port, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `childEnv`, never a bare `...process.env` — see its header.
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: db,
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    }) as ChildProcessWithoutNullStreams;
    children.push(child);

    const what = `os serve --dev on ${db}`;
    let out = '';
    let settled = false;
    const settle = (err: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) rejectBoot(err);
      else resolveBoot({ child, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      150_000,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound.
      if (READY.test(out)) settle(portDriftError(out, what, port));
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) =>
      settle(
        portContentionError(out, what, port)
          ?? new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`),
      ),
    );
  });
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(give);
      done();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

interface Answer {
  status: number;
  body: unknown;
}

/**
 * One HTTP exchange against `serve`, attributed to the child if the transport
 * fails. ⛔ No assertion goes inside it: the answer is returned and read by an
 * `it` below.
 */
function request(
  serve: LiveServe,
  what: string,
  url: string,
  init: { method?: string; token?: string; body?: unknown } = {},
): Promise<Answer> {
  return probeThroughChild(
    {
      child: serve.child,
      transcript: () => `\n--- child output ---\n${serve.output().slice(-4000)}`,
      label: 'package-restart-acceptance',
      what,
    },
    async () => {
      const r = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
        },
        ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
      });
      const text = await r.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        /* not JSON — keep the text */
      }
      return { status: r.status, body };
    },
  );
}

/** The `--dev` admin's bearer token; `''` when sign-in did not answer one. */
async function signIn(serve: LiveServe, base: string): Promise<{ status: number; token: string }> {
  const res = await request(serve, 'the sign-in probe', `${base}/auth/sign-in/email`, {
    method: 'POST',
    body: { email: 'admin@objectos.ai', password: 'admin123' },
  });
  const token = (res.body as { token?: unknown } | null)?.token;
  return { status: res.status, token: typeof token === 'string' ? token : '' };
}

/**
 * Probe 1's reader: the package ids Studio's builder landing lists under "My
 * packages (writable)". Mirrors objectui `parsePackages` — `data ?? payload`,
 * then the array or its `packages`; the id from `manifest.id` then `id`;
 * `scope: system | cloud` rows dropped — and keeps a row only when the server
 * sent `writable: true`. The client's fallback for a server that sends no
 * `writable` is deliberately NOT copied: this server sends it, and a row
 * without it is a finding, not a row to guess about.
 */
function studioWritableIds(payload: unknown): string[] {
  const root = (payload as { data?: unknown } | null)?.data ?? payload;
  const raw = Array.isArray(root) ? root : ((root as { packages?: unknown } | null)?.packages ?? []);
  if (!Array.isArray(raw)) return [];
  const ids: string[] = [];
  for (const row of raw as Array<Record<string, unknown> | null>) {
    if (!row || typeof row !== 'object') continue;
    const manifest = (row.manifest ?? {}) as Record<string, unknown>;
    const id = String(manifest.id ?? row.id ?? '');
    if (!id) continue;
    if (manifest.scope === 'system' || manifest.scope === 'cloud') continue;
    if (row.writable === true) ids.push(id);
  }
  return ids;
}

/** The error code of an ADR-0112 envelope, flat or nested. */
function errorCode(body: unknown): unknown {
  const b = body as { code?: unknown; error?: { code?: unknown } } | null;
  return b?.code ?? b?.error?.code;
}

interface ThreeProbes {
  writableList: Answer;
  data: Answer;
  published: Answer;
}

async function threeProbes(serve: LiveServe, base: string, token: string): Promise<ThreeProbes> {
  return {
    writableList: await request(serve, 'probe 1 — the Studio writable list', `${base}/packages`, { token }),
    data: await request(serve, 'probe 2 — the data route', `${base}/data/${OBJECT}`, { token }),
    published: await request(serve, 'probe 3 — the published object', `${base}/meta/object/${OBJECT}/published`, {
      token,
    }),
  };
}

afterAll(async () => {
  for (const child of children) await stop(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#17676 ruling A\' item 5: the three probes across a restart of a stock `os serve` on one database file', () => {
  let chain: { signIn: number; install: Answer; draft: Answer; publish: Answer } | undefined;
  let before: ThreeProbes | undefined;
  let after: ThreeProbes | undefined;
  let afterSignIn = 0;
  let secondBoot = '';

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pkg-restart-acceptance-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'objectstack.config.ts'), HOST_CONFIG, 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'pkg-restart-acceptance-fixture', private: true, type: 'module' }, null, 2),
      'utf8',
    );
    const db = join(dir, 'probe.db');
    const port = randomPort();
    const base = `http://localhost:${port}/api/v1`;

    // ── boot 1: the card's repro, then the three probes while it serves ──────
    const first = await bootServe(dir, port, db);
    const auth = await signIn(first, base);
    const install = await request(first, 'step 1 — POST /packages', `${base}/packages`, {
      method: 'POST',
      token: auth.token,
      // Studio's create dialog body: a writable base carries no `scope`.
      body: { manifest: { id: PKG_ID, name: 'Leave', version: '0.1.0', type: 'app', namespace: NAMESPACE } },
    });
    const draft = await request(
      first,
      'step 2 — PUT the object draft into the package',
      `${base}/meta/object/${OBJECT}?mode=draft&package=${encodeURIComponent(PKG_ID)}`,
      {
        method: 'PUT',
        token: auth.token,
        body: {
          name: OBJECT,
          label: 'Leave Request',
          sharingModel: 'private',
          fields: { title: { type: 'text', label: 'Title' } },
        },
      },
    );
    const publish = await request(
      first,
      'step 3 — publish the package drafts',
      `${base}/packages/${encodeURIComponent(PKG_ID)}/publish-drafts`,
      { method: 'POST', token: auth.token, body: {} },
    );
    chain = { signIn: auth.status, install, draft, publish };
    before = await threeProbes(first, base, auth.token);
    await stop(first.child);

    // ── boot 2: same database file, same port, then the same three probes ────
    const second = await bootServe(dir, port, db);
    const auth2 = await signIn(second, base);
    afterSignIn = auth2.status;
    after = await threeProbes(second, base, auth2.token);
    secondBoot = second.output();
    await stop(second.child);
  }, 420_000);

  it('the repro chain lands: install 201, draft 200, publish-drafts publishes the object', () => {
    expect(chain?.signIn, 'the --dev admin must be able to sign in').toBe(200);
    expect(chain?.install.status, `POST /api/v1/packages: ${JSON.stringify(chain?.install.body)}`).toBe(201);
    expect(chain?.draft.status, `PUT ?mode=draft: ${JSON.stringify(chain?.draft.body)}`).toBe(200);
    expect(chain?.publish.status, 'POST /publish-drafts').toBe(200);
    const outcome = (chain?.publish.body as { data?: { outcome?: unknown; published?: unknown } } | null)?.data;
    expect(outcome?.outcome, `publish-drafts outcome: ${JSON.stringify(chain?.publish.body)}`).toBe('published');
    expect(outcome?.published).toEqual([expect.objectContaining({ type: 'object', name: OBJECT })]);
  });

  it('before the restart the three probes agree', () => {
    expect(studioWritableIds(before?.writableList.body), 'probe 1 — Studio writable list').toContain(PKG_ID);
    expect(before?.data.status, `probe 2 — GET /data/${OBJECT}: ${JSON.stringify(before?.data.body)}`).toBe(200);
    expect(before?.published.status, 'probe 3 — GET /meta/object/…/published').toBe(200);
    expect((before?.published.body as { name?: unknown } | null)?.name).toBe(OBJECT);
  });

  it('probe 1 after the restart — Studio still lists the package as writable (it came back from sys_packages)', () => {
    expect(afterSignIn, 'the --dev admin must be able to sign in on the second boot').toBe(200);
    expect(after?.writableList.status, 'GET /api/v1/packages').toBe(200);
    expect(
      studioWritableIds(after?.writableList.body),
      `Studio's writable list after a restart — absent means the package lived in memory only:\n${secondBoot.slice(-3000)}`,
    ).toContain(PKG_ID);
  });

  it('probe 3 after the restart — the published object metadata is still served', () => {
    expect(after?.published.status, 'GET /meta/object/…/published').toBe(200);
    expect((after?.published.body as { name?: unknown } | null)?.name).toBe(OBJECT);
  });

  // #17676's acceptance. Landed as `it.fails` while the stock standalone
  // composition skipped `sys_metadata` hydration; promoted on #20071, the change
  // that declares it (see the header).
  it('probe 2 after the restart — the data route serves the published object, so the three probes agree', () => {
    expect(
      after?.data.status,
      `GET /data/${OBJECT} after a restart: ${JSON.stringify(after?.data.body)} (code ${String(errorCode(after?.data.body))})`,
    ).toBe(200);
  });

  it('the second boot hydrated sys_metadata instead of skipping it as a "project kernel"', () => {
    // The plugin's `else` line. It printed on every self-hosted boot before
    // #20071, and it was false there: this composition persists its own
    // `sys_metadata`. The second boot is where it matters, because only there
    // is anything runtime-authored waiting to be read back.
    expect(secondBoot, 'the second boot must not skip hydration').not.toContain(
      'Project kernel — skipping sys_metadata hydration',
    );
  });
});
