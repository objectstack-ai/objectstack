// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The print service on a real showcase boot: `PrintServicePlugin` composed
// explicitly beside the real storage and audit plugins, and its refusal chain
// and archive judged by the REAL services a deployment composes — the
// metadata service's pages and objects, the data engine's row-level security
// read as the caller, and `file-attachments`' one writer of `sys_file` and
// `sys_attachment`.
//
// Two layers, on the same boot:
//
//  - **The plugin as composed** (no engine configured here): `status()` says
//    so, and a print is refused `503` after the principal check and before any
//    page is read.
//  - **The service over the real kernel services**, with the two parts that
//    need a browser or the auth mint stood in by recording doubles: the page,
//    record and files refusals in the ruled order, and a successful archive —
//    the PDF lands as one committed `sys_file` and one `sys_attachment` on the
//    invoice, in the caller's organization, with the session revoked after it.
//    The engine itself is pinned against a real Chromium on both placements in
//    `@objectstack/service-print`'s own suite; the console route it loads is
//    the console's.
//
// The boot keeps the showcase's own default profile, as `objectstack serve`
// wires it, and the member holds the app's `showcase_contributor`. The showcase's print page is `showcase_invoice_document`, the invoice's
// default record page; `showcase_invoice` declares `enable.files` for it, and
// its select RLS (`owner == current_user.email`) is what hides another user's
// invoice from a contributor.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { bootShowcase } from './showcase-boot.js';
import { PrintServicePlugin } from '../../../services/service-print/src/print-service-plugin.js';
import { principalSessionMinterOf } from '../../../services/service-print/src/principal-session.js';
import {
  PrintService,
  type IPrintService,
  type PrintEngine,
} from '../../../services/service-print/src/print-service.js';
import {
  FILE_ATTACHMENT_SERVICE,
  type IAuthService,
  type IDataEngine,
  type IFileAttachmentService,
} from '@objectstack/spec/contracts';

const SYS = { isSystem: true } as const;
const PAGE = 'showcase_invoice_document';
const PDF = Buffer.from('%PDF-1.4\n% print-service dogfood\n%%EOF\n');
const PRINT_ENV = ['OS_PRINT_CHROMIUM_PATH', 'OS_PRINT_BROWSER_ENDPOINT', 'OS_PRINT_CONSOLE_URL'];

interface Refusal {
  code: unknown;
  status: unknown;
}

async function refusalOf(p: Promise<unknown>): Promise<Refusal> {
  try {
    await p;
  } catch (err) {
    return { code: (err as Refusal).code, status: (err as Refusal).status };
  }
  throw new Error('expected a refusal, the call resolved');
}

describe('print service on a real showcase boot', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: IDataEngine;
  let plugin: IPrintService;
  let service: PrintService;
  const saved: Record<string, string | undefined> = {};
  const revoke = vi.fn(async () => undefined);
  const mint = vi.fn(async () => ({
    token: 'stand-in-token',
    cookie: { name: 'stand-in', value: 'stand-in-cookie', path: '/', httpOnly: true, secure: false },
    revoke,
  }));
  const renderPdf = vi.fn(async () => PDF);
  let memberToken: string;
  let memberEmail: string;
  let ownInvoice: string;
  let othersInvoice: string;

  beforeAll(async () => {
    for (const k of PRINT_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    rootDir = mkdtempSync(join(tmpdir(), 'print-dogfood-'));
    stack = await bootShowcase({
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
        new PrintServicePlugin(),
      ],
    });
    ql = stack.kernel.getService<IDataEngine>('objectql');
    plugin = stack.kernel.getService<IPrintService>('print');

    memberEmail = 'print-member@dogfood.test';
    memberToken = await stack.signUp(memberEmail);
    // The app's own `showcase_contributor`: invoice read scoped to the
    // caller's own rows (`owner == current_user.email`).
    const member = await ql.findOne('sys_user', { where: { email: memberEmail } }, { context: SYS });
    await ql.insert('sys_user_permission_set', { user_id: member!.id, permission_set: 'showcase_contributor' }, { context: SYS });
    // Two invoices cloned from a seeded one, differing only in who owns them.
    const [seeded] = await ql.find('showcase_invoice', { limit: 1 }, { context: SYS });
    const invoice = (name: string, owner: string) =>
      ql.insert('showcase_invoice', { name, owner, account: seeded.account, status: 'draft' }, { context: SYS });
    ownInvoice = String((await invoice('INV-PRINT-OWN', memberEmail)).id);
    othersInvoice = String((await invoice('INV-PRINT-OTHER', 'someone-else@dogfood.test')).id);

    service = new PrintService({
      placement: {
        state: 'configured',
        resolved: { placement: 'local', target: '/stand-in/chromium', consoleUrl: 'http://127.0.0.1:1/_console' },
      },
      driver: { placement: 'local', probe: async () => ({ version: 'stand-in' }), renderPdf },
      getEngine: () => stack.kernel.getService<PrintEngine>('objectql'),
      getAttachments: () => stack.kernel.getService<IFileAttachmentService>(FILE_ATTACHMENT_SERVICE),
      getMinter: () => ({ mint }),
    });
    await service.probe();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    rmSync(rootDir, { recursive: true, force: true });
    for (const k of PRINT_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const request = (recordId: string, page = PAGE, object = 'showcase_invoice') => ({
    app: 'showcase',
    object,
    recordId,
    page,
  });

  describe('the plugin as composed, with no engine configured', () => {
    it('registers the print service and reports it unconfigured', () => {
      expect(plugin.status()).toMatchObject({ state: 'unconfigured', placement: null });
    });

    it('refuses a print 503 for a signed-in user, and 403 for the system context first', async () => {
      const ctx = await stack.contextFor(memberToken);
      expect(await refusalOf(plugin.printRecordToFile(request(ownInvoice), ctx))).toEqual({
        code: 'SERVICE_UNAVAILABLE',
        status: 503,
      });
      expect(await refusalOf(plugin.printRecordToFile(request(ownInvoice), SYS))).toEqual({
        code: 'PERMISSION_DENIED',
        status: 403,
      });
    });
  });

  describe('the service over the real kernel services', () => {
    it('is ready once the archive, metadata and data services are found', () => {
      expect(service.status()).toMatchObject({ state: 'ready' });
    });

    it('an unknown page: RESOURCE_NOT_FOUND / 404', async () => {
      const ctx = await stack.contextFor(memberToken);
      expect(await refusalOf(service.printRecordToFile(request(ownInvoice, 'showcase_no_such_page'), ctx))).toEqual({
        code: 'RESOURCE_NOT_FOUND',
        status: 404,
      });
    });

    it('a record page that does not declare print: VALIDATION_ERROR / 400', async () => {
      const ctx = await stack.contextFor(memberToken);
      const [task] = await ql.find('showcase_task', { limit: 1 }, { context: SYS });
      expect(
        await refusalOf(service.printRecordToFile(request(String(task.id), 'showcase_task_detail', 'showcase_task'), ctx)),
      ).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
    });

    it('another user’s invoice, hidden by RLS from the caller: RECORD_NOT_FOUND / 404', async () => {
      const ctx = await stack.contextFor(memberToken);
      // Control: the caller-scoped read really does not see it, and the system does.
      expect(await ql.findOne('showcase_invoice', { where: { id: othersInvoice } }, { context: ctx })).toBeNull();
      expect(await ql.findOne('showcase_invoice', { where: { id: othersInvoice } }, { context: SYS })).not.toBeNull();
      mint.mockClear();
      renderPdf.mockClear();
      expect(await refusalOf(service.printRecordToFile(request(othersInvoice), ctx))).toEqual({
        code: 'RECORD_NOT_FOUND',
        status: 404,
      });
      expect(mint).not.toHaveBeenCalled();
      expect(renderPdf).not.toHaveBeenCalled();
    });

    it('archives the PDF on the caller’s own invoice as one committed sys_file and one sys_attachment', async () => {
      const ctx = await stack.contextFor(memberToken);
      mint.mockClear();
      revoke.mockClear();
      const out = await service.printRecordToFile(request(ownInvoice), ctx);
      expect(mint).toHaveBeenCalledWith(ctx, 60);
      expect(renderPdf).toHaveBeenCalledWith(
        expect.objectContaining({ url: `http://127.0.0.1:1/_console/apps/showcase/showcase_invoice/record/${ownInvoice}` }),
      );
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(out).toMatchObject({ size: PDF.byteLength, filename: `${PAGE}-${ownInvoice}.pdf` });

      const file = await ql.findOne('sys_file', { where: { id: out.fileId } }, { context: SYS });
      expect(file).toMatchObject({ status: 'committed', mime_type: 'application/pdf', size: PDF.byteLength, scope: 'attachments' });
      const attachment = await ql.findOne('sys_attachment', { where: { id: out.attachmentId } }, { context: SYS });
      expect(attachment).toMatchObject({ parent_object: 'showcase_invoice', parent_id: ownInvoice, file_id: out.fileId });
    });

    it('with the real auth mint: the render loads as the caller, and the session is gone once the print returns', async () => {
      const ctx = await stack.contextFor(memberToken);
      const minter = principalSessionMinterOf(stack.kernel.getService<IAuthService>('auth'));
      expect(minter, 'the auth service implements IAuthService.mintPrincipalSession').toBeDefined();
      const asSession = (cookie: { name: string; value: string }) =>
        stack.raw('/api/v1/auth/get-session', { headers: { cookie: `${cookie.name}=${cookie.value}` } });
      let seenCookie: { name: string; value: string } | undefined;
      let duringRender: unknown;
      const real = new PrintService({
        placement: {
          state: 'configured',
          resolved: { placement: 'local', target: '/stand-in/chromium', consoleUrl: 'http://127.0.0.1:1/_console' },
        },
        driver: {
          placement: 'local',
          probe: async () => ({ version: 'stand-in' }),
          renderPdf: async ({ cookie }) => {
            seenCookie = cookie;
            duringRender = await (await asSession(cookie)).json();
            return PDF;
          },
        },
        getEngine: () => stack.kernel.getService<PrintEngine>('objectql'),
        getAttachments: () => stack.kernel.getService<IFileAttachmentService>(FILE_ATTACHMENT_SERVICE),
        getMinter: () => minter,
      });
      await real.probe();
      await real.printRecordToFile(request(ownInvoice), ctx);
      expect((duringRender as { user?: { id?: string } } | null)?.user?.id).toBe(ctx.userId);
      const after = await asSession(seenCookie!);
      expect([after.status, ((await after.json()) as { error?: { code?: string } }).error?.code]).toEqual([401, 'UNAUTHENTICATED']);
    });
  });
});
