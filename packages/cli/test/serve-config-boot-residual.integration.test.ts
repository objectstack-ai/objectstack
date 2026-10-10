// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22521 — a CONFIG boot of a multi-package stack answers for the stack's
 * unowned top level exactly as an ARTIFACT boot of the same project does:
 * every top-level item no package body declares is registered under the
 * stack's `manifest.id`, and the boot warns once, with the count.
 *
 * ## The defect, as measured through the doors
 *
 * `os serve objectstack.config.ts` (with or without `--dev`) on a stack that
 * carries `packages[]` hands the stack to the `manifest` service, which
 * registers the package bodies and never the top level. A top-level doc,
 * object or view that no body declares was therefore served by no door, and
 * the boot said nothing. `os build` of the same project, booted as an
 * artifact, served the same items under `manifest.id` and the metadata plugin
 * warned. Two doors, two answers, and the silent one breaks "absence must be
 * loud".
 *
 * Both doors now run the metadata plugin's one residual rule
 * (`MetadataPlugin.registerUnclaimedTopLevel`): the artifact door over the
 * compiled artifact, `AppPlugin` over the config. Each describe below is one
 * row of the card's position table, one fixture each, and asserts the config
 * boot and the artifact boot of that fixture give the SAME reading — plus the
 * reading itself, so two empty answers can never pass as parity.
 *
 *   - ROW 1 (flat `src/docs/`, `manifest.id` naming one package) is pinned by
 *     `serve-config-boot-flat-docs.integration.test.ts`, untouched here.
 *   - ROW 2: flat `src/docs/`, `manifest.id` naming no package.
 *   - ROW 3: inline `docs` spread on a composed stack's top level. Config boot
 *     only: `os build` refuses that shape before an artifact exists, and that
 *     refusal is pinned here too, so the day it stops refusing this row goes
 *     red and the artifact half gets measured.
 *   - ROW 4: a top-level object and view no package owns.
 *   - CONTROL: a single-package config (no `packages[]`) is unchanged and has
 *     no residual on either door.
 *
 * ⚠️ What this file does NOT pin: the data door for a residual OBJECT. Both
 * doors list it on `/meta/object` and answer `404` on `/data/<name>` — the
 * residual rule registers metadata, and no engine registration follows. That
 * is the artifact door's answer this card makes the config boot match, not a
 * behaviour to freeze.
 *
 * ⚠️ Pedigree, not counts: every doc page carries a marker written into exactly
 * one source, read back from the served doc.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

/** The residual line's stable fragment and its count, through either door. */
const RESIDUAL_LINE = /(\d+) top-level metadata item\(s\) that none of its \d+ package bodies declare/;

const OBJECTS = `
const caseObj = { name: 'acme_case', label: 'Case', sharingModel: 'private', fields: { subject: { type: 'text', label: 'Subject' } } };
const accountObj = { name: 'acme_account', label: 'Account', sharingModel: 'private', fields: { name: { type: 'text', label: 'Name' } } };
const noteObj = { name: 'acme_note', label: 'Note', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } };
const noteView = { object: 'acme_note', list: { type: 'grid', data: { provider: 'object', object: 'acme_note' }, columns: ['title'] } };
const svc = { id: '${SERVICE_ID}', name: 'service', namespace: 'acme', version: '2.4.0', type: 'module' };
const app = { id: '${APP_ID}', name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' };
`;

/** Row 2: two packages, a `manifest.id` that names neither, and only flat `src/docs/` pages beyond the bodies. */
const CONFIG_ROW2 = `
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

/** Row 4: the same stack, plus a top-level object and a top-level view no package owns. */
const CONFIG_ROW4 = `
import { defineStack } from '@objectstack/spec';
${OBJECTS}
export default defineStack({
  manifest: { ...app, id: '${RELEASE_ID}' },
  objects: [caseObj, accountObj, noteObj],
  views: [noteView],
  packages: [
    { manifest: { ...svc, objects: [caseObj] } },
    { manifest: { ...app, objects: [accountObj] } },
  ],
}, { strict: false });
`;

/** Row 3: inline docs spread onto a composed stack's top level — the app composed last, so its manifest. */
const CONFIG_ROW3 = `
import { composeStacks, defineStack } from '@objectstack/spec';
${OBJECTS}
const composed = composeStacks([
  defineStack({ manifest: svc, objects: [caseObj] }, { strict: false }),
  defineStack({ manifest: app, objects: [accountObj] }, { strict: false }),
], { manifest: 'preserve' });
export default { ...composed, docs: [{ name: 'acme_inline', label: 'Inline', content: '# acme_inline\\n\\nMARKER-22521-inline\\n' }] };
`;

/** Control: one package, no `packages[]` — its top level IS its package. */
const CONFIG_SINGLE = `
import { defineStack } from '@objectstack/spec';
${OBJECTS}
export default defineStack({ manifest: app, objects: [accountObj, noteObj], views: [noteView] }, { strict: false });
`;

const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

/** A fixture project; `flat` adds the two flat `src/docs/` pages. */
function project(prefix: string, config: string, flat: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), config, 'utf8');
  linkSpec(dir);
  if (flat) {
    mkdirSync(join(dir, 'src', 'docs'), { recursive: true });
    writeFileSync(join(dir, 'src', 'docs', 'acme_guide.md'), '# acme_guide\n\nMARKER-22521-flat-guide\n', 'utf8');
    writeFileSync(join(dir, 'src', 'docs', 'acme_faq.md'), '# acme_faq\n\nMARKER-22521-flat-faq\n', 'utf8');
  }
  return dir;
}

interface Run { code: number; stdout: string; stderr: string }

/** `os build` in `dir`, through the source entry. */
function build(dir: string): Promise<Run> {
  return new Promise((done) => {
    execFile(
      TSX,
      [CLI, 'build'],
      // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
      { cwd: dir, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => done({
        code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
        stdout: String(stdout),
        stderr: String(stderr),
      }),
    );
  });
}

/** `os build`, then take the config away so `os serve` boots the compiled artifact. */
async function buildArtifact(dir: string): Promise<void> {
  const built = await build(dir);
  if (built.code !== 0 || !existsSync(join(dir, 'dist', 'objectstack.json'))) {
    throw new Error(`os build failed in ${dir} (exit ${built.code})\n${built.stdout}\n${built.stderr}`);
  }
  renameSync(join(dir, 'objectstack.config.ts'), join(dir, 'objectstack.config.ts.off'));
}

interface LiveServe {
  child: ChildProcessWithoutNullStreams;
  output: () => string;
}

/** Boot `os serve` in `dir` with `args`; the source entry seeds the dev admin either way. */
function bootServe(dir: string, args: string[], port: string): Promise<LiveServe> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(TSX, [CLI, 'serve', ...args, '-p', port], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      // `childEnv`, never a bare `...process.env` — see its header (commit 1ddda1d00).
      env: childEnv({
        NO_COLOR: '1',
        OS_DATABASE_URL: ':memory:',
        OS_LOG_LEVEL: 'warn',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
      }),
    }) as ChildProcessWithoutNullStreams;
    children.push(child);

    const what = `os serve ${args.join(' ')} in ${dir}`;
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
      label: 'serve-config-boot-residual',
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

/** What one boot serves for the fixture's `acme_*` items, and what it said about the residual. */
interface Reading {
  /** Each doc: its owning package and the marker its served content carries. */
  docs: Record<string, { packageId: string | undefined; marker: string | undefined }>;
  /** `name@owner`, sorted. */
  objects: string[];
  views: string[];
  /** The count each residual line reports — one entry per line printed. */
  residual: number[];
}

/** Boot, sign in as the seeded admin, read the three listings and every listed doc, stop. */
async function read(dir: string, args: string[]): Promise<Reading> {
  const port = randomPort();
  const base = `http://localhost:${port}/api/v1`;
  const serve = await bootServe(dir, args, port);
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
    const list = async (type: string): Promise<Array<{ name: string; _packageId?: string }>> => {
      const answer = await request(serve, `the ${type} list probe`, `${base}/meta/${type}`, { headers });
      const items = answer.body?.items;
      if (answer.status !== 200 || !Array.isArray(items)) {
        throw new Error(`GET /meta/${type} answered ${answer.status}: ${JSON.stringify(answer.body).slice(0, 2000)}`);
      }
      return (items as Array<{ name: string; _packageId?: string }>).filter((item) => /^acme_/.test(item?.name ?? ''));
    };
    const owned = (items: Array<{ name: string; _packageId?: string }>) =>
      items.map((item) => `${item.name}@${item._packageId ?? '-'}`).sort();

    const docs: Reading['docs'] = {};
    for (const item of await list('doc')) {
      const one = await request(serve, `the read of doc ${item.name}`, `${base}/meta/doc/${item.name}`, { headers });
      docs[item.name] = {
        packageId: item._packageId,
        marker: /MARKER-22521-[\w-]+/.exec(JSON.stringify(one.body))?.[0],
      };
    }
    const objects = owned(await list('object'));
    const views = owned(await list('view'));
    const residual = serve.output()
      .split('\n')
      .map((line) => RESIDUAL_LINE.exec(line)?.[1])
      .filter((count): count is string => count !== undefined)
      .map(Number);
    return { docs, objects, views, residual };
  } finally {
    await stop(serve.child);
  }
}

const CONFIG_DEV = ['objectstack.config.ts', '--dev'];
const CONFIG_PLAIN = ['objectstack.config.ts'];
const ARTIFACT_DEV = ['--dev'];

afterAll(async () => {
  for (const child of children) await stop(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#22521 row 2: flat src/docs with a manifest.id naming no package', () => {
  let config: Reading;
  let configDev: Reading;
  let artifact: Reading;

  beforeAll(async () => {
    config = await read(project('residual-row2-config-', CONFIG_ROW2, true), CONFIG_PLAIN);
    configDev = await read(project('residual-row2-config-dev-', CONFIG_ROW2, true), CONFIG_DEV);
    const built = project('residual-row2-artifact-', CONFIG_ROW2, true);
    await buildArtifact(built);
    artifact = await read(built, ARTIFACT_DEV);
  }, 480_000);

  it('the artifact boot serves both flat pages under the manifest id and warns once, counting 2', () => {
    expect(artifact.docs, JSON.stringify(artifact)).toEqual({
      acme_guide: { packageId: RELEASE_ID, marker: 'MARKER-22521-flat-guide' },
      acme_faq: { packageId: RELEASE_ID, marker: 'MARKER-22521-flat-faq' },
    });
    expect(artifact.residual).toEqual([2]);
  });

  it('the config boot gives the artifact boot\'s answer, without --dev', () => {
    // Before the fix: no doc listed, no residual line.
    expect(config).toEqual(artifact);
  });

  it('the config boot gives the artifact boot\'s answer, with --dev', () => {
    expect(configDev).toEqual(artifact);
  });
});

describe('#22521 row 4: a top-level object and view no package owns', () => {
  let configDev: Reading;
  let artifact: Reading;

  beforeAll(async () => {
    configDev = await read(project('residual-row4-config-dev-', CONFIG_ROW4, true), CONFIG_DEV);
    const built = project('residual-row4-artifact-', CONFIG_ROW4, true);
    await buildArtifact(built);
    artifact = await read(built, ARTIFACT_DEV);
  }, 480_000);

  it('the artifact boot lists the object and the expanded view under the manifest id, beside the bodies\' own', () => {
    expect(artifact.objects, JSON.stringify(artifact)).toEqual([
      `acme_account@${APP_ID}`,
      `acme_case@${SERVICE_ID}`,
      `acme_note@${RELEASE_ID}`,
    ]);
    expect(artifact.views, JSON.stringify(artifact)).toEqual([`acme_note.default@${RELEASE_ID}`]);
    // 2 flat docs + the object + the view container + the one view it expands into.
    expect(artifact.residual).toEqual([5]);
  });

  it('the config boot gives the artifact boot\'s answer', () => {
    // Before the fix: neither acme_note nor its view listed, no residual line.
    expect(configDev).toEqual(artifact);
  });
});

describe('#22521 row 3: inline docs spread on a composed stack\'s top level', () => {
  let configDev: Reading;
  let refused: Run;
  let refusedDir: string;

  beforeAll(async () => {
    configDev = await read(project('residual-row3-config-dev-', CONFIG_ROW3, false), CONFIG_DEV);
    refusedDir = project('residual-row3-build-', CONFIG_ROW3, false);
    refused = await build(refusedDir);
  }, 480_000);

  it('the artifact half is not measurable: os build refuses the shape and writes no artifact', () => {
    // The day this stops refusing, the artifact boot of this row exists and
    // must be read beside the config boot below.
    expect(refused.code, `${refused.stdout}\n${refused.stderr}`).not.toBe(0);
    expect(existsSync(join(refusedDir, 'dist', 'objectstack.json'))).toBe(false);
  });

  it('the config boot serves the inline doc under the composed manifest id and warns once, counting 1', () => {
    // Before the fix: not listed, no residual line.
    expect(configDev.docs, JSON.stringify(configDev)).toEqual({
      acme_inline: { packageId: APP_ID, marker: 'MARKER-22521-inline' },
    });
    expect(configDev.residual).toEqual([1]);
  });
});

describe('#22521 control: a single-package config has no residual on either door', () => {
  let configDev: Reading;
  let artifact: Reading;

  beforeAll(async () => {
    configDev = await read(project('residual-single-config-dev-', CONFIG_SINGLE, true), CONFIG_DEV);
    const built = project('residual-single-artifact-', CONFIG_SINGLE, true);
    await buildArtifact(built);
    artifact = await read(built, ARTIFACT_DEV);
  }, 480_000);

  it('the artifact boot serves everything under its one package and prints no residual line', () => {
    expect(artifact.docs, JSON.stringify(artifact)).toEqual({
      acme_guide: { packageId: APP_ID, marker: 'MARKER-22521-flat-guide' },
      acme_faq: { packageId: APP_ID, marker: 'MARKER-22521-flat-faq' },
    });
    expect(artifact.objects).toEqual([`acme_account@${APP_ID}`, `acme_note@${APP_ID}`]);
    expect(artifact.views).toEqual([`acme_note.default@${APP_ID}`]);
    expect(artifact.residual).toEqual([]);
  });

  it('the config boot gives the same answer', () => {
    expect(configDev).toEqual(artifact);
  });
});
