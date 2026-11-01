// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a connector entry an INSTALLED package declares never
// reads, or launches a process in, the HOST's package root (#28534).
//
// ## What was measured before the fix
//
// Installed into the showcase through `POST /api/v1/marketplace/install-local`,
// an inline manifest whose `provider: 'openapi'` connector names
// `providerConfig.spec: './src/system/connectors/status-openapi.json'` — a file
// the installed package does not ship, and the showcase does — materialized
// `ready` on `GET /api/v1/automation/connectors` carrying the showcase's own
// document: its description and its `getHealth` action. A `provider: 'mcp'`
// stdio connector naming `./scripts/mcp-fixture.mjs` spawned the showcase's own
// fixture, its working directory the showcase's root, and listed `ready` with
// the fixture's `echo_upper` tool. The materializer handed every entry the
// host's root as `loadPackageFile` / `resolvePackagePath`, whichever package
// declared it; an installed package has no root on disk at all, since the
// install keeps its artifact JSON and nothing else.
//
// ## What this file pins, on one boot
//
//   1. the install answers 200 and hot-loads the package;
//   2. neither installed entry that names a package-relative ref materializes:
//      both are absent from the listing, and the reconcile's error record names
//      each entry, its ref and the remedy;
//   3. controls: the installed entry carrying its document inline lists
//      `ready` with that document's operation, and the showcase's own
//      file-ref and stdio entries keep listing `ready` with their own actions.
//
// Boots a fixture stack of its own (the install-local plugin mounted), so it
// stays out of `SHARED_SHOWCASE`.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { MarketplaceInstallLocalPlugin } from '@objectstack/cloud-connection';
import { bootShowcase } from './showcase-boot.js';

const PACKAGE_ID = 'com.dogfood.pkgref';
/** An `openapi` entry naming a file the showcase ships and the installed package does not. */
const FILE_REF_ENTRY = 'pkgref_host_file';
const FILE_REF = './src/system/connectors/status-openapi.json';
/** A stdio `mcp` entry whose working directory the provider asks for with `resolvePackagePath('.')`. */
const PATH_REF_ENTRY = 'pkgref_host_cwd';
/** Control: an installed `openapi` entry carrying its document inline. */
const INLINE_ENTRY = 'pkgref_inline';
/** The showcase's own entries — the file-ref and stdio forms of the same two providers. */
const HOST_FILE_ENTRY = 'showcase_status_openapi';
const HOST_STDIO_ENTRY = 'showcase_mcp_tools';

/** A one-operation OpenAPI 3 document; nothing is dispatched, so its server answers nothing. */
const DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Installed inline document', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:9/' }],
  paths: { '/v1/things': { get: { operationId: 'GetThings', responses: { '200': { description: 'ok' } } } } },
};

/** The install body `os package install` sends for an inline manifest. */
const INSTALL_BODY = {
  manifest: {
    id: PACKAGE_ID,
    namespace: 'pkgref',
    name: 'Installed package-relative connector refs',
    version: '1.0.0',
    type: 'app',
    connectors: [
      {
        name: FILE_REF_ENTRY,
        label: 'Names a host file',
        type: 'api',
        provider: 'openapi',
        providerConfig: { spec: FILE_REF, baseUrl: 'http://127.0.0.1:9/' },
      },
      {
        name: PATH_REF_ENTRY,
        label: 'Runs in the host root',
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'stdio', command: 'node', args: ['./scripts/mcp-fixture.mjs'] } },
      },
      {
        name: INLINE_ENTRY,
        label: 'Inline document',
        type: 'api',
        provider: 'openapi',
        providerConfig: { spec: DOCUMENT },
      },
    ],
  },
};

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
/** What a listing says about one entry — enough for a failure to show whose document it carried. */
const shown = (answer: Answer, name: string): string => {
  const c = entryOf(answer, name);
  return c === undefined
    ? `'${name}' not listed`
    : JSON.stringify({ name: c.name, state: c.state, description: c.description, actions: c.actions?.map((a: any) => a.key) });
};

describe('dogfood: an installed package\'s package-relative connector ref is refused, never resolved against the host\'s root', () => {
  let stack: VerifyStack;
  let storageDir: string;
  let install: Answer;
  let connectors: Answer;
  let lines: string[] = [];

  beforeAll(async () => {
    storageDir = mkdtempSync(join(tmpdir(), 'dogfood-connector-package-ref-'));
    stack = await bootShowcase({
      extraPlugins: [new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off', storageDir })],
    });
    const token = await stack.signIn();
    const captured = await captureOutput(async () => {
      install = await json(await stack.apiAs(token, 'POST', '/marketplace/install-local', INSTALL_BODY));
      // The reconcile the install's re-sync announces may land after the
      // answer: read the listing until the inline control is in it, or the
      // window closes. The control and the refused entries are judged in the
      // same reconcile run.
      const deadline = Date.now() + 10_000;
      do {
        connectors = await json(await stack.apiAs(token, 'GET', '/automation/connectors'));
        if (entryOf(connectors, INLINE_ENTRY)) break;
        await new Promise((r) => setTimeout(r, 100));
      } while (Date.now() < deadline);
    });
    lines = captured.lines;
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    if (storageDir) rmSync(storageDir, { recursive: true, force: true });
  });

  it('the install answers 200 and hot-loads the package', () => {
    expect(install.status, JSON.stringify(install.body)).toBe(200);
    expect(install.body?.data?.hotLoaded).toBe(true);
    expect(connectors.status, JSON.stringify(connectors.body)).toBe(200);
  });

  it('controls: the installed inline entry and the showcase\'s own file-ref and stdio entries list ready', () => {
    expect(entryOf(connectors, INLINE_ENTRY)?.state, shown(connectors, INLINE_ENTRY)).toBe('ready');
    expect(entryOf(connectors, INLINE_ENTRY).actions.map((a: any) => a.key)).toEqual(['GetThings']);
    expect(entryOf(connectors, HOST_FILE_ENTRY)?.state, shown(connectors, HOST_FILE_ENTRY)).toBe('ready');
    expect(entryOf(connectors, HOST_FILE_ENTRY).actions.map((a: any) => a.key)).toEqual(['getHealth']);
    expect(entryOf(connectors, HOST_STDIO_ENTRY)?.state, shown(connectors, HOST_STDIO_ENTRY)).toBe('ready');
  });

  it('the installed entry naming a host FILE does not materialize, and the record names it, its ref and the remedy', () => {
    expect(entryOf(connectors, FILE_REF_ENTRY), shown(connectors, FILE_REF_ENTRY)).toBeUndefined();
    const record = lines.find((l) => l.includes(`connector instance '${FILE_REF_ENTRY}'`) && l.includes(PACKAGE_ID));
    expect(record, `no reconcile record names '${FILE_REF_ENTRY}' with its package`).toBeDefined();
    expect(record).toContain(`'${FILE_REF}'`);
    expect(record).toContain('os build');
  });

  it('the installed entry asking for a host LOCATION does not materialize, and the record names it and its ref', () => {
    expect(entryOf(connectors, PATH_REF_ENTRY), shown(connectors, PATH_REF_ENTRY)).toBeUndefined();
    const record = lines.find((l) => l.includes(`connector instance '${PATH_REF_ENTRY}'`) && l.includes(PACKAGE_ID));
    expect(record, `no reconcile record names '${PATH_REF_ENTRY}' with its package`).toBeDefined();
    expect(record).toContain('path ref \'.\'');
  });
});
