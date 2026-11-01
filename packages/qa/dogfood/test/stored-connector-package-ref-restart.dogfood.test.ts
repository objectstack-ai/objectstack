// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a stored connector entry whose package-relative ref is
// refused (#28594), or that carries any other configuration fault (#28698),
// never stops the platform from booting.
//
// ## Why a restart
//
// `stored-connector-package-ref.dogfood.test.ts` saves its entries into a
// RUNNING kernel, where the reconcile that refuses them is the post-boot one.
// A row already at rest takes the other road: ObjectQL's `start()` hydrates
// `sys_metadata` into the registry, and the automation service's own
// `start()` reconcile reads that registry. That reconcile treats a
// configuration fault as fatal, so an entry the upgrade newly refuses (one
// that worked the day before) would refuse the next boot of every
// environment holding it.
//
// ## What this file pins
//
// Two showcase boots over one database file. The first saves, through the
// metadata door, an environment-wide `openapi` entry naming a
// package-relative file, the same entry in an `authored` package, an
// environment-wide stdio `mcp` entry, and a control carrying its document
// inline. [#28698] It also saves an environment-wide entry naming a provider
// no installed plugin offers (accepted at save, skipped after boot: the shape
// a row takes when the plugin that offered its provider is removed). The
// second boot:
//
//   1. starts (no throw);
//   2. does not list any refused entry, and its boot record names each entry
//      and its ref (or, for the unknown provider, the provider);
//   3. lists the stored inline control `ready` with its operation (the rows
//      were hydrated, so the refusal above was read at boot, not skipped);
//   4. lists the showcase's own file-ref and stdio entries `ready` (control).
//
// Boots fixture stacks of its own (a database file), so it stays out of
// `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const FILE_REF = './src/system/connectors/status-openapi.json';
const ENV_FILE = 'srr_env_file';
const ENV_CWD = 'srr_env_cwd';
const AUTHORED_FILE = 'srr_authored_file';
/** An `authored` package created through the package door. */
const AUTHORED_PACKAGE_ID = 'com.dogfood.storedrestart';
const INLINE = 'srr_inline';
/** [#28698] A stored entry whose provider no installed plugin offers. */
const UNKNOWN_PROVIDER = 'srr_unknown_provider';
const HOST_FILE_ENTRY = 'showcase_status_openapi';
const HOST_STDIO_ENTRY = 'showcase_mcp_tools';

/** A one-operation OpenAPI 3 document; nothing is dispatched, so its server answers nothing. */
const DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Stored inline document', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:9/' }],
  paths: { '/v1/things': { get: { operationId: 'GetThings', responses: { '200': { description: 'ok' } } } } },
};

const openapi = (name: string, spec: unknown) => ({
  name,
  label: `Stored ${name}`,
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec, baseUrl: 'http://127.0.0.1:9/' },
});

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Every line the process writes while `run` is in flight — the kernel logger writes to the streams. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  const error = console.error;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); warn(...args); };
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); error(...args); };
  try {
    return { value: await run(), lines };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
    console.error = error;
  }
}

const listed = (answer: Answer): any[] => answer.body?.data?.connectors ?? [];
const entryOf = (answer: Answer, name: string): any => listed(answer).find((c: any) => c?.name === name);
const shown = (answer: Answer, name: string): string => {
  const c = entryOf(answer, name);
  return c === undefined
    ? `'${name}' not listed`
    : JSON.stringify({ name: c.name, state: c.state, actions: c.actions?.map((a: any) => a.key) });
};

/** Read the listing until every `names` entry lists `ready`, or the window closes. */
async function settle(stack: VerifyStack, token: string, names: readonly string[]): Promise<Answer> {
  const deadline = Date.now() + 15_000;
  let answer: Answer;
  do {
    answer = await json(await stack.apiAs(token, 'GET', '/automation/connectors'));
    if (names.every((n) => entryOf(answer, n)?.state === 'ready')) break;
    await new Promise((r) => setTimeout(r, 100));
  } while (Date.now() < deadline);
  return answer;
}

describe('dogfood: a stored connector entry refused its package-relative ref does not stop the next boot', () => {
  let dir: string;
  const saves: Record<string, Answer> = {};
  let before: Answer;
  let bootError: unknown;
  let after: Answer;
  let bootLines: string[] = [];
  let second: VerifyStack | undefined;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'dogfood-stored-connector-restart-'));
    const databaseFile = join(dir, 'os.db');

    const first = await bootShowcase({ databaseFile });
    try {
      const token = await first.signIn();
      saves[ENV_FILE] = await json(await first.apiAs(token, 'PUT', `/meta/connector/${ENV_FILE}`, openapi(ENV_FILE, FILE_REF)));
      saves[ENV_CWD] = await json(await first.apiAs(token, 'PUT', `/meta/connector/${ENV_CWD}`, {
        name: ENV_CWD,
        label: 'Stored stdio',
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'stdio', command: 'node', args: ['./scripts/mcp-fixture.mjs'] } },
      }));
      saves.package = await json(await first.apiAs(token, 'POST', '/packages', {
        id: AUTHORED_PACKAGE_ID, name: 'Stored connector restart', version: '1.0.0', type: 'app',
      }));
      saves[AUTHORED_FILE] = await json(await first.apiAs(
        token, 'PUT', `/meta/connector/${AUTHORED_FILE}?package=${AUTHORED_PACKAGE_ID}`, openapi(AUTHORED_FILE, FILE_REF),
      ));
      saves[UNKNOWN_PROVIDER] = await json(await first.apiAs(token, 'PUT', `/meta/connector/${UNKNOWN_PROVIDER}`, {
        ...openapi(UNKNOWN_PROVIDER, DOCUMENT),
        provider: 'no_such_provider',
      }));
      saves[INLINE] = await json(await first.apiAs(token, 'PUT', `/meta/connector/${INLINE}`, openapi(INLINE, DOCUMENT)));
      before = await settle(first, token, [INLINE]);
    } finally {
      await first.stop();
    }

    const captured = await captureOutput(async () => {
      try {
        second = await bootShowcase({ databaseFile });
      } catch (err) {
        bootError = err;
        return undefined;
      }
      const token = await second.signIn();
      return settle(second, token, [INLINE, HOST_FILE_ENTRY, HOST_STDIO_ENTRY]);
    });
    bootLines = captured.lines;
    if (captured.value) after = captured.value;
  }, 300_000);

  afterAll(async () => {
    await second?.stop?.();
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('precondition: the first boot accepts every save and lists the inline control', () => {
    for (const [name, answer] of Object.entries(saves)) {
      expect(answer.status, `${name}: ${JSON.stringify(answer.body).slice(0, 400)}`).toBeLessThan(300);
    }
    expect(entryOf(before, INLINE)?.state, shown(before, INLINE)).toBe('ready');
    expect(entryOf(before, ENV_FILE), shown(before, ENV_FILE)).toBeUndefined();
    expect(entryOf(before, UNKNOWN_PROVIDER), shown(before, UNKNOWN_PROVIDER)).toBeUndefined();
  });

  it('the second boot over the same database starts', () => {
    expect(bootError, bootError instanceof Error ? bootError.message.slice(0, 600) : String(bootError)).toBeUndefined();
  });

  it.each([
    [ENV_FILE, `file ref '${FILE_REF}'`],
    [ENV_CWD, 'path ref \'.\''],
    [AUTHORED_FILE, `file ref '${FILE_REF}'`],
  ])('%s is not listed after the restart, and the boot record names it and its ref', (name, ref) => {
    expect(entryOf(after, name), shown(after, name)).toBeUndefined();
    const record = bootLines.find((l) => l.includes(`connector instance '${name}'`) && l.includes('is refused'));
    expect(record, `no boot record refuses '${name}'`).toBeDefined();
    expect(record).toContain(ref);
  });

  it('[#28698] a stored entry naming a provider no plugin offers is not listed after the restart, and the boot record names it', () => {
    expect(entryOf(after, UNKNOWN_PROVIDER), shown(after, UNKNOWN_PROVIDER)).toBeUndefined();
    const record = bootLines.find((l) => l.includes(`connector instance '${UNKNOWN_PROVIDER}' declares provider 'no_such_provider'`));
    expect(record, `no boot record names '${UNKNOWN_PROVIDER}'`).toBeDefined();
    expect(record).toContain('no provider factory is registered');
  });

  it('controls: the stored inline entry, and the showcase\'s own file-ref and stdio entries, list ready after the restart', () => {
    expect(entryOf(after, INLINE)?.state, shown(after, INLINE)).toBe('ready');
    expect(entryOf(after, INLINE).actions.map((a: any) => a.key)).toEqual(['GetThings']);
    expect(entryOf(after, HOST_FILE_ENTRY)?.state, shown(after, HOST_FILE_ENTRY)).toBe('ready');
    expect(entryOf(after, HOST_STDIO_ENTRY)?.state, shown(after, HOST_STDIO_ENTRY)).toBe('ready');
  });
});
