// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The print service end to end, on a real showcase boot: `PrintServicePlugin`
// mints a session for the requesting user (`IAuthService.mintPrincipalSession`),
// headless Chromium loads the REAL console with only that session, prints the
// invoice's print page, and the PDF is archived on the invoice as the requester
// — on BOTH placements:
//
//  - **local** — `chromiumPath`, the plugin launches the executable;
//  - **remote** — `browserEndpoint`: this test spawns the same executable with
//    its DevTools WebSocket endpoint open and hands the plugin that endpoint,
//    so the browser is reached only through the remote placement's connect.
//
// Per placement it pins:
//  - the console booted under the requester, never the system (every
//    `get-session` the browser made answered the requester);
//  - a real PDF archived as one `sys_attachment` on the invoice, with
//    `sys_file.owner_id` and `sys_attachment.uploaded_by` the requester;
//  - the minted session gone after the print — after a success and after a
//    forced failure (the archive's byte store refusing after the render);
//  - the minted cookie in no refusal message.
//
// Needs two things this suite's CI job does not build: the Console bundle
// (`packages/console/dist`, `pnpm objectui:build`) and a Chromium
// (`OS_TEST_PRINT_CHROMIUM_PATH`, or Playwright's provisioned
// `$PLAYWRIGHT_BROWSERS_PATH/chromium`). Without either the file is skipped and
// says so: a skipped render is not a passed one.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import type { IAuthService, IDataEngine, IStorageService, PrincipalSession } from '@objectstack/spec/contracts';
import { bootShowcase } from './showcase-boot.js';
import { createConsoleStaticPlugin } from '../../../cli/src/utils/console.js';
import { PrintServicePlugin } from '../../../services/service-print/src/print-service-plugin.js';
import type { IPrintService } from '../../../services/service-print/src/print-service.js';

const SYS = { isSystem: true } as const;
const PAGE = 'showcase_invoice_document';
const APP = 'com.example.showcase';
/** The Console bundle's entry: its presence is what this file runs on. */
const CONSOLE_INDEX = fileURLToPath(new URL('../../../console/dist/index.html', import.meta.url));
const CONSOLE_DIST = dirname(CONSOLE_INDEX);

function chromiumUnderTest(): string | undefined {
  const candidates = [
    process.env.OS_TEST_PRINT_CHROMIUM_PATH,
    process.env.PLAYWRIGHT_BROWSERS_PATH ? join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium') : undefined,
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not this one
    }
  }
  return undefined;
}

const CHROMIUM = chromiumUnderTest();
const CONSOLE_BUILT = existsSync(CONSOLE_INDEX);
if (!CHROMIUM || !CONSOLE_BUILT) {
  console.warn(
    `[dogfood] print-service-render.dogfood.test.ts SKIPPED: ${!CONSOLE_BUILT ? 'no built Console (packages/console/dist; pnpm objectui:build)' : ''}` +
      `${!CONSOLE_BUILT && !CHROMIUM ? ' and ' : ''}${!CHROMIUM ? 'no Chromium (OS_TEST_PRINT_CHROMIUM_PATH or PLAYWRIGHT_BROWSERS_PATH)' : ''}. ` +
      'The real render was NOT measured on this host.',
  );
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const { port } = s.address() as { port: number };
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function spawnRemoteBrowser(executable: string): Promise<{ child: ChildProcess; endpoint: string; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'os-print-render-remote-'));
  const child = spawn(
    executable,
    ['--headless=new', '--no-sandbox', '--no-first-run', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const endpoint = await new Promise<string>((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error('the remote browser printed no DevTools endpoint')), 20_000);
    child.stderr!.on('data', (chunk) => {
      stderr += String(chunk);
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) {
        clearTimeout(timer);
        resolve(m[1]!);
      }
    });
  });
  return { child, endpoint, dir };
}

interface Refusal {
  code?: unknown;
  status?: unknown;
  message: string;
}

async function refusalOf(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (err) {
    const e = err as Refusal;
    return { code: e.code, status: e.status, message: e.message };
  }
  throw new Error('expected a refusal, the call resolved');
}

for (const placement of ['local', 'remote'] as const) {
  describe.skipIf(!CHROMIUM || !CONSOLE_BUILT)(`print service real render (${placement} placement)`, () => {
    let stack: VerifyStack;
    let server: Server;
    let remote: { child: ChildProcess; endpoint: string; dir: string } | undefined;
    let rootDir: string;
    let print: IPrintService;
    let ql: IDataEngine;
    /** The user id of every `get-session` the browser's requests resolved to. */
    const sessionUsers: Array<string | null> = [];
    /** Each session the plugin minted: its cookie, captured to prove it is gone afterwards. Never printed. */
    const minted: Array<PrincipalSession['cookie']> = [];

    beforeAll(async () => {
      const port = await freePort();
      const engine =
        placement === 'local'
          ? { chromiumPath: CHROMIUM! }
          : { browserEndpoint: (remote = await spawnRemoteBrowser(CHROMIUM!)).endpoint };
      rootDir = mkdtempSync(join(tmpdir(), 'print-render-storage-'));
      stack = await bootShowcase({
        extraPlugins: [
          new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
          new AuditPlugin(),
          createConsoleStaticPlugin(CONSOLE_DIST),
          new PrintServicePlugin({ ...engine, consoleUrl: `http://127.0.0.1:${port}/_console` }),
        ],
      });
      // The real HTTP door the browser reaches: every request handed to the
      // booted stack as it arrives, every answer handed back as it is.
      server = createServer(async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
        const hasBody = chunks.length > 0 && req.method !== 'GET' && req.method !== 'HEAD';
        const answer = await stack.raw(req.url!, { method: req.method, headers, ...(hasBody ? { body: Buffer.concat(chunks) } : {}) } as RequestInit);
        const out: Record<string, string | string[]> = {};
        answer.headers.forEach((v, k) => {
          if (k !== 'set-cookie' && k !== 'content-encoding' && k !== 'content-length') out[k] = v;
        });
        const setCookie = (answer.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
        if (setCookie.length) out['set-cookie'] = setCookie;
        const body = Buffer.from(await answer.arrayBuffer());
        if (req.url?.startsWith('/api/v1/auth/get-session')) {
          try {
            sessionUsers.push((JSON.parse(body.toString('utf8')) as { user?: { id?: string } } | null)?.user?.id ?? null);
          } catch {
            sessionUsers.push(null);
          }
        }
        res.writeHead(answer.status, out);
        res.end(body);
      });
      await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));

      print = stack.kernel.getService<IPrintService>('print');
      ql = stack.kernel.getService<IDataEngine>('objectql');
      // Observe each mint (the plugin reads the auth service per call): keep the
      // cookie so the test can ask, afterwards, whether it still opens a session.
      const auth = stack.kernel.getService<IAuthService>('auth');
      const mint = auth.mintPrincipalSession!.bind(auth);
      auth.mintPrincipalSession = async (...args) => {
        const session = await mint(...args);
        minted.push(session.cookie);
        return session;
      };
    }, 240_000);

    afterAll(async () => {
      server?.close();
      await stack?.stop();
      if (remote) {
        const exited = new Promise<void>((r) => (remote!.child.exitCode !== null ? r() : remote!.child.once('exit', () => r())));
        remote.child.kill();
        await exited;
        rmSync(remote.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
      }
      if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    });

    const opensASession = async (cookie: PrincipalSession['cookie']): Promise<[number, string | undefined]> => {
      const res = await stack.raw('/api/v1/auth/get-session', { headers: { cookie: `${cookie.name}=${cookie.value}` } });
      const json = (await res.json()) as { user?: { id?: string }; error?: { code?: string } } | null;
      return [res.status, json?.user?.id ?? json?.error?.code];
    };

    const newInvoice = async (name: string, owner: string): Promise<string> => {
      const [seeded] = await ql.find('showcase_invoice', { limit: 1 }, { context: SYS });
      return String((await ql.insert('showcase_invoice', { name, owner, account: seeded!.account, status: 'draft' }, { context: SYS })).id);
    };

    it(`the engine is ready on the ${placement} placement`, () => {
      expect(print.status()).toMatchObject({ state: 'ready', placement });
    });

    it('prints the invoice through the real console as the requester, archives it as theirs, and the session is gone', async () => {
      const token = await stack.signIn();
      const ctx = await stack.contextFor(token);
      const invoice = await newInvoice(`INV-RENDER-${placement}`, 'admin@objectos.ai');
      sessionUsers.length = 0;
      minted.length = 0;

      const out = await print.printRecordToFile({ app: APP, object: 'showcase_invoice', recordId: invoice, page: PAGE }, ctx);

      // The console booted under the requester, and only them.
      expect(sessionUsers.length).toBeGreaterThan(0);
      expect(new Set(sessionUsers)).toEqual(new Set([ctx.userId]));
      // A real PDF, archived on the invoice as the requester's.
      const file = await ql.findOne('sys_file', { where: { id: out.fileId } }, { context: SYS });
      const attachment = await ql.findOne('sys_attachment', { where: { id: out.attachmentId } }, { context: SYS });
      expect(file).toMatchObject({ status: 'committed', mime_type: 'application/pdf', owner_id: ctx.userId });
      expect(attachment).toMatchObject({ parent_object: 'showcase_invoice', parent_id: invoice, file_id: out.fileId, uploaded_by: ctx.userId });
      const bytes = await stack.kernel.getService<IStorageService>('storage').download(String(file!.key));
      expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(bytes.byteLength).toBe(out.size);
      // The minted session is gone.
      expect(minted).toHaveLength(1);
      expect(await opensASession(minted[0]!)).toEqual([401, 'UNAUTHENTICATED']);
    }, 120_000);

    it('a print that fails after the render still revokes the session, stores nothing, and names no credential', async () => {
      const token = await stack.signIn();
      const ctx = await stack.contextFor(token);
      const invoice = await newInvoice(`INV-RENDER-FAIL-${placement}`, 'admin@objectos.ai');
      minted.length = 0;
      // Force the failure after the render: the archive's byte store refuses the upload once.
      const storage = stack.kernel.getService<IStorageService>('storage');
      const upload = storage.upload.bind(storage);
      storage.upload = async () => {
        storage.upload = upload;
        throw new Error('forced byte-store failure');
      };

      const r = await refusalOf(print.printRecordToFile({ app: APP, object: 'showcase_invoice', recordId: invoice, page: PAGE }, ctx));

      expect(r.message).toContain('forced byte-store failure');
      expect(minted).toHaveLength(1);
      expect(r.message).not.toContain(minted[0]!.value);
      expect(await opensASession(minted[0]!)).toEqual([401, 'UNAUTHENTICATED']);
      expect(await ql.find('sys_attachment', { where: { parent_id: invoice } }, { context: SYS })).toEqual([]);
    }, 120_000);
  });
}
