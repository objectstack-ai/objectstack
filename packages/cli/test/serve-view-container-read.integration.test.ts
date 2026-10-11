// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22614 — the by-name read of a `defineView` container answers the same on an
 * ARTIFACT boot and on a CONFIG boot of one single-package project, with every
 * view inside it translated.
 *
 * ## The defect, as measured through the doors
 *
 * `GET /api/v1/meta/view/acme_note`, authenticated, where `acme_note` is the
 * key the registry files the project's `defineView({ object: 'acme_note', … })`
 * container under:
 *
 *  - `os build`, then `os serve` of the artifact: `500 INTERNAL_ERROR`, the log
 *    reading `Cannot read properties of undefined (reading 'startsWith')`. The
 *    compiled container carries no `name`, and the read handed it to the
 *    single-view translator, which keys the catalog on `name`;
 *  - `os serve objectstack.config.ts`: `200`, from a container the config
 *    boot's registrar had stamped `name: 'acme_note'` onto — served with a
 *    fabricated `label: 'acme_note'` and both views inside it in English for a
 *    `zh-CN` reader.
 *
 * The read now classifies the served view document once and translates a
 * container as a container (`translateMetaDocument`, `@objectstack/rest`;
 * pinned function-level by `meta-view-container-i18n.test.ts` there).
 *
 * ## What each boot is asked
 *
 *  - THE CARD'S READ, in `zh-CN` and in `en`: the container, whose views carry
 *    the catalog's labels for the reader's locale, and no label the project
 *    never wrote;
 *  - CONTROL: the by-name reads of the two views it expands to
 *    (`acme_note.default`, `acme_note.mine`), translated as they always were.
 *
 * ⚠️ Not counts: each assertion reads a label the catalog carries for exactly
 * one view and one locale, so a read that stopped translating, or translated
 * under the wrong key, names the view it got wrong.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
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

const OBJ = 'acme_note';

/** One package, no `packages[]`; one container with a default list and one named list, and a catalog for both. */
const CONFIG = `
import { defineStack } from '@objectstack/spec';
const grid = (label) => ({ type: 'grid', label, data: { provider: 'object', object: '${OBJ}' }, columns: ['title'] });
const noteObj = { name: '${OBJ}', label: 'Note', sharingModel: 'private', fields: { title: { type: 'text', label: 'Title' } } };
const noteViews = { object: '${OBJ}', list: grid('All Notes'), listViews: { mine: grid('My Notes') } };
const app = { id: 'com.example.acme', name: 'acme', namespace: 'acme', version: '1.0.0', type: 'app' };
const translations = [{
  en: { objects: { ${OBJ}: { label: 'Note', _views: { default: { label: 'All Notes' }, mine: { label: 'My Notes' } } } } },
  'zh-CN': { objects: { ${OBJ}: { label: '笔记', _views: { default: { label: '全部笔记' }, mine: { label: '我的笔记' } } } } },
}];
export default defineStack({ manifest: app, objects: [noteObj], views: [noteViews], translations }, { strict: false });
`;

const dirs: string[] = [];
const children: ChildProcessWithoutNullStreams[] = [];

function project(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
  linkSpec(dir);
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
      label: 'serve-view-container-read',
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

/** One by-name read, as a boot answered it. */
interface Answer { status: number; item: any; error?: unknown }

/** What one boot answers for the container and for the two views it expands to, per locale. */
type Reading = Record<string, Answer>;

const READS = [OBJ, `${OBJ}.default`, `${OBJ}.mine`];
const LOCALES = ['zh-CN', 'en'];

/** Boot, sign in as the seeded admin, read every by-name view in every locale, stop. */
async function read(dir: string, args: string[]): Promise<{ reading: Reading; output: string }> {
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
    const reading: Reading = {};
    for (const name of READS) {
      for (const locale of LOCALES) {
        const answer = await request(serve, `the read of view ${name} in ${locale}`, `${base}/meta/view/${name}`, {
          headers: { authorization: `Bearer ${token}`, 'accept-language': locale },
        });
        reading[`${name} ${locale}`] = {
          status: answer.status,
          item: answer.body?.item,
          ...(answer.status === 200 ? {} : { error: answer.body }),
        };
      }
    }
    return { reading, output: serve.output() };
  } finally {
    await stop(serve.child);
  }
}

/** The view content of a served container — what a translation can change, without the registrar's stamps. */
function containerContent(item: any): Record<string, unknown> {
  const { object, label, list, listViews, form, formViews } = item ?? {};
  return { object, label, list, listViews, form, formViews };
}

afterAll(async () => {
  for (const child of children) await stop(child);
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}, 60_000);

describe('#22614 — the by-name read of a view container, on an artifact boot and on a config boot', () => {
  let config: { reading: Reading; output: string };
  let artifact: { reading: Reading; output: string };

  beforeAll(async () => {
    config = await read(project('view-container-read-config-'), ['objectstack.config.ts']);
    const built = project('view-container-read-artifact-');
    await buildArtifact(built);
    artifact = await read(built, []);
  }, 480_000);

  it.each([
    ['the artifact boot', () => artifact],
    ['the config boot', () => config],
  ])('%s answers 200 for the container, its views translated for a zh-CN reader', (_door, boot) => {
    const { reading, output } = boot();
    const answer = reading[`${OBJ} zh-CN`];
    // Before the fix: the artifact boot answered 500 here.
    expect(answer.status, `${JSON.stringify(answer.error)}\n--- output ---\n${output.slice(-3000)}`).toBe(200);
    // Before the fix: the config boot served both in English.
    expect(answer.item.list.label).toBe('全部笔记');
    expect(answer.item.listViews.mine.label).toBe('我的笔记');
    // Before the fix: the config boot served a `label` equal to the object name.
    expect(answer.item).not.toHaveProperty('label');
    expect(output).not.toMatch(/reading 'startsWith'/);
  });

  it.each([
    ['the artifact boot', () => artifact],
    ['the config boot', () => config],
  ])('%s serves the authored labels to an en reader', (_door, boot) => {
    const answer = boot().reading[`${OBJ} en`];
    expect(answer.status, JSON.stringify(answer.error)).toBe(200);
    expect(answer.item.list.label).toBe('All Notes');
    expect(answer.item.listViews.mine.label).toBe('My Notes');
  });

  it('the two boots serve the same container', () => {
    for (const locale of LOCALES) {
      expect(containerContent(config.reading[`${OBJ} ${locale}`].item), locale)
        .toEqual(containerContent(artifact.reading[`${OBJ} ${locale}`].item));
    }
  });

  it('CONTROL — the by-name reads of the views it expands to are translated as before, alike on both boots', () => {
    const expected: Record<string, string> = {
      [`${OBJ}.default zh-CN`]: '全部笔记',
      [`${OBJ}.default en`]: 'All Notes',
      [`${OBJ}.mine zh-CN`]: '我的笔记',
      [`${OBJ}.mine en`]: 'My Notes',
    };
    for (const [key, label] of Object.entries(expected)) {
      for (const boot of [artifact, config]) {
        const answer = boot.reading[key];
        expect(answer.status, `${key}: ${JSON.stringify(answer.error)}`).toBe(200);
        expect(answer.item.label, key).toBe(label);
      }
    }
  });
});
