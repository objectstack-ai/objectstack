// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22405 — a CONFIG boot of a multi-package stack serves the stack's flat
 * `src/docs/` pages under the package that owns the stack's `manifest.id`,
 * exactly where `os build` places them.
 *
 * ## The defect, as measured through the door
 *
 * `os serve objectstack.config.ts --dev` on a two-package
 * `composeStacks([…], { manifest: 'preserve' })` project, with no compiled
 * artifact on disk: the authenticated `GET /api/v1/meta/doc` listed the
 * service package's own directory doc and nothing of the flat `src/docs/`, and
 * the boot warned about nothing. The dev-mode docs mirror in `serve.ts` put
 * the flat set on the config's TOP LEVEL, and this boot registers package
 * bodies (`AppPlugin` → `manifest.register()` → `registerApp(body)` per body),
 * never the top level of a config that carries `packages[]`. `os build` of the
 * same project, booted as an artifact, served both pages under the app package.
 *
 * The mirror now hands the flat set to `placeCollectedDocs`, the one placement
 * rule `os build` uses (`src/utils/collect-docs.ts`), so the config boot and
 * the artifact boot answer the same.
 *
 * ## Why it spawns the real command
 *
 * The placement helper is pinned in-process by
 * `src/utils/collect-docs.flat-docs-owner.test.ts`. That pin stays green on a
 * `serve.ts` that never calls it, which is exactly the base this card was filed
 * against. Only a boot of `os serve` on a config reaches the mirror.
 *
 * ## The three boots
 *
 *   - THE CARD'S SHAPE: the flat pages are served under the app package, the
 *     one whose id the composed stack's `manifest.id` names. The service
 *     package's own `src/service/docs/` page stays under the service — the
 *     lit control that the read sees package docs at all.
 *   - CONTROL, a single-package config (no `packages[]`): its flat pages are
 *     served under its one package, as before.
 *   - CONTROL, no owner: a `manifest.id` that names no package entry. The flat
 *     set stays on the top level, as `os build` keeps it there, so neither
 *     package serves a flat page — no guess. ⚠️ What this boot does NOT claim:
 *     that the top-level pages are served. A config boot registers no top-level
 *     item of a multi-package config, while an artifact boot registers them
 *     under the manifest id with a warning; that asymmetry lives in the boot's
 *     registration, not in the mirror, and this file does not pin it either way.
 *
 * ⚠️ Pedigree, not counts: every page on disk carries a marker written into
 * exactly one file, and the assertions read the marker back from the served
 * doc.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
import { linkSpec } from './helpers/define-stack-fixture.js';

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;

const APP_ID = 'com.example.acme';
const SERVICE_ID = 'com.example.acme.service';
const RELEASE_ID = 'com.example.acme.release';

const MARKER_FLAT_GUIDE = 'MARKER-22405-flat-guide';
const MARKER_FLAT_FAQ = 'MARKER-22405-flat-faq';
const MARKER_SERVICE = 'MARKER-22405-service-runbook';

const FLAT_NAMES = ['acme_faq', 'acme_guide'];

const OBJECTS = `
const caseObj = { name: 'acme_case', label: 'Case', sharingModel: 'private', fields: { subject: { type: 'text', label: 'Subject' } } };
const accountObj = { name: 'acme_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } };
const svc = { id: '${SERVICE_ID}', name: 'service', namespace: 'acme', version: '2.4.0', type: 'module' };
const app = { id: '${APP_ID}', name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' };
`;

/** The card's project: the app composed LAST, so the stack's `manifest` is the app's. */
const CONFIG_MULTI = `
import { composeStacks, defineStack } from '@objectstack/spec';
${OBJECTS}
export default composeStacks([
  defineStack({ manifest: svc, objects: [caseObj] }, { strict: false }),
  defineStack({ manifest: app, objects: [accountObj] }, { strict: false }),
], { manifest: 'preserve' });
`;

/** One package, no `packages[]`: its top level IS its package. */
const CONFIG_SINGLE = `
import { defineStack } from '@objectstack/spec';
${OBJECTS}
export default defineStack({ manifest: app, objects: [accountObj] }, { strict: false });
`;

/** Two packages, and a `manifest.id` that names neither of them. */
const CONFIG_NO_OWNER = `
import { defineStack } from '@objectstack/spec';
${OBJECTS}
export default defineStack({
  manifest: { ...app, id: '${RELEASE_ID}' },
  objects: [caseObj, accountObj],
  packages: [
    { manifest: { ...svc, objects: [caseObj] } },
    { manifest: { ...app, objects: [accountObj] } },
  ],
}, { strict: false });
`;

const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

/** A fixture project with the flat pages and, when asked, the service's own docs directory. */
function project(prefix: string, config: string, serviceDocs: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  linkSpec(dir);
  const page = (sub: string, name: string, marker: string) => {
    mkdirSync(join(dir, 'src', sub), { recursive: true });
    writeFileSync(join(dir, 'src', sub, `${name}.md`), `# ${name}\n\n${marker}\n`, 'utf8');
  };
  page('docs', 'acme_guide', MARKER_FLAT_GUIDE);
  page('docs', 'acme_faq', MARKER_FLAT_FAQ);
  if (serviceDocs) page(join('service', 'docs'), 'acme_service_runbook', MARKER_SERVICE);
  return dir;
}

interface LiveServe {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
}

/** Boot `os serve objectstack.config.ts --dev` and keep it running; `--dev` seeds the admin. */
function bootServe(dir: string, port: string): Promise<LiveServe> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '-p', port, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    }) as ChildProcessWithoutNullStreams;
    children.push(child);

    const what = `os serve --dev in ${dir}`;
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
      180_000,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound (#12525).
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

/** One HTTP exchange, attributed to the child if the transport fails (#15653). ⛔ No assertion inside. */
async function request(serve: LiveServe, what: string, url: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  return probeThroughChild(
    {
      child: serve.child,
      transcript: () => `\n--- child output ---\n${serve.output().slice(-4000)}`,
      label: 'serve-config-boot-flat-docs',
      what,
    },
    async () => {
      const r = await fetch(url, init);
      const text = await r.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, body };
    },
  );
}

/** What the door serves: each doc's owning package and the marker its content carries. */
interface Served {
  [name: string]: { packageId: string | undefined; marker: string | undefined };
}

interface Reading {
  served: Served;
  output: string;
}

/** Boot `dir`, sign in as the seeded admin, read `GET /api/v1/meta/doc` and every doc it lists, stop. */
async function readDocs(dir: string): Promise<Reading> {
  const port = randomPort();
  const base = `http://localhost:${port}/api/v1`;
  const serve = await bootServe(dir, port);
  try {
    const signIn = await request(serve, 'the sign-in probe', `${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    const token = signIn.body?.token;
    if (signIn.status !== 200 || typeof token !== 'string') {
      throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${serve.output().slice(-3000)}`);
    }
    const headers = { authorization: `Bearer ${token}` };
    const list = await request(serve, 'the doc list probe', `${base}/meta/doc`, { headers });
    const items = list.body?.items;
    if (list.status !== 200 || !Array.isArray(items)) {
      throw new Error(`GET /meta/doc answered ${list.status}: ${JSON.stringify(list.body).slice(0, 2000)}`);
    }
    const served: Served = {};
    for (const item of items as Array<{ name: string; _packageId?: string }>) {
      const one = await request(serve, `the read of doc ${item.name}`, `${base}/meta/doc/${item.name}`, { headers });
      served[item.name] = {
        packageId: item._packageId,
        marker: /MARKER-22405-[\w-]+/.exec(JSON.stringify(one.body))?.[0],
      };
    }
    return { served, output: serve.output() };
  } finally {
    await stop(serve.child);
  }
}

afterAll(async () => {
  for (const child of children) await stop(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#22405: a multi-package config boot serves its flat src/docs under the package that owns the manifest', () => {
  let reading: Reading;

  beforeAll(async () => {
    reading = await readDocs(project('serve-flat-docs-multi-', CONFIG_MULTI, true));
  }, 240_000);

  it('the read is lit: the service package\'s own directory doc is served under the service', () => {
    expect(reading.served.acme_service_runbook, JSON.stringify(reading.served)).toEqual({
      packageId: SERVICE_ID,
      marker: MARKER_SERVICE,
    });
  });

  it('both flat pages are served under the app package, the one whose id is the stack\'s manifest.id', () => {
    // Before the fix both were absent: the mirror left them on a top level this
    // boot never registers.
    expect(reading.served.acme_guide, JSON.stringify(reading.served)).toEqual({ packageId: APP_ID, marker: MARKER_FLAT_GUIDE });
    expect(reading.served.acme_faq, JSON.stringify(reading.served)).toEqual({ packageId: APP_ID, marker: MARKER_FLAT_FAQ });
  });
});

describe('#22405 control: a single-package config boot is unchanged', () => {
  let reading: Reading;

  beforeAll(async () => {
    reading = await readDocs(project('serve-flat-docs-single-', CONFIG_SINGLE, false));
  }, 240_000);

  it('serves its flat pages under its one package', () => {
    expect(reading.served.acme_guide, JSON.stringify(reading.served)).toEqual({ packageId: APP_ID, marker: MARKER_FLAT_GUIDE });
    expect(reading.served.acme_faq, JSON.stringify(reading.served)).toEqual({ packageId: APP_ID, marker: MARKER_FLAT_FAQ });
  });
});

describe('#22405 control: a manifest id that names no package keeps the flat set off every package, as os build does', () => {
  let reading: Reading;

  beforeAll(async () => {
    reading = await readDocs(project('serve-flat-docs-no-owner-', CONFIG_NO_OWNER, true));
  }, 240_000);

  it('the read is lit: the service package\'s own directory doc is served under the service', () => {
    expect(reading.served.acme_service_runbook, JSON.stringify(reading.served)).toEqual({
      packageId: SERVICE_ID,
      marker: MARKER_SERVICE,
    });
  });

  it('no flat page is served under either package — no owner is guessed', () => {
    for (const name of FLAT_NAMES) {
      expect([SERVICE_ID, APP_ID], `${name}: ${JSON.stringify(reading.served)}`).not.toContain(reading.served[name]?.packageId);
    }
  });
});
