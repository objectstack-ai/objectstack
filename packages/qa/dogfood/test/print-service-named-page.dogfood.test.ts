// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// A record printed on a print page that is NOT its object's default record
// page (#26583, ruling A), on a real showcase boot.
//
// `showcase_project` keeps its everyday record page, `showcase_project_detail`
// (the default, a slotted working page with no `print`). A second page, a
// project brief that declares `print`, is saved through the metadata save door
// the way an author adds one, beside it. The print service, over the real
// kernel services, then:
//
//  - prints a project on the brief, rendering the console's named record-page
//    route (`…/record/ID/page/PAGE`, `RECORD_NAMED_PAGE_ROUTE`), and archives
//    the PDF on the project as the requester;
//  - still refuses the working page (it declares no `print`) and a print page
//    of another object, `VALIDATION_ERROR` / 400, before anything is minted.
//
// The browser and the auth mint are stood in by recording doubles, as in
// `print-service-archive.dogfood.test.ts`; the console route itself is drawn
// against a real Chromium in `print-service-render.dogfood.test.ts`.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VerifyStack } from '@objectstack/verify';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { bootShowcase } from './showcase-boot.js';
import { PrintServicePlugin } from '../../../services/service-print/src/print-service-plugin.js';
import { PrintService, type PrintEngine } from '../../../services/service-print/src/print-service.js';
import { FILE_ATTACHMENT_SERVICE, type IDataEngine, type IFileAttachmentService } from '@objectstack/spec/contracts';
import { PROJECT_BRIEF_PAGE } from './print-named-page.fixture.js';

const SYS = { isSystem: true } as const;
const CONSOLE = 'http://127.0.0.1:1/_console';
const PDF = Buffer.from('%PDF-1.4\n% named print page dogfood\n%%EOF\n');
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

describe('a record printed on a print page that is not its object’s default record page', () => {
  let stack: VerifyStack;
  let rootDir: string;
  let ql: IDataEngine;
  let service: PrintService;
  let project: string;
  const saved: Record<string, string | undefined> = {};
  const revoke = vi.fn(async () => undefined);
  const mint = vi.fn(async () => ({
    token: 'stand-in-token',
    cookie: { name: 'stand-in', value: 'stand-in-cookie', path: '/', httpOnly: true, secure: false },
    revoke,
  }));
  const renderPdf = vi.fn(async () => PDF);

  beforeAll(async () => {
    for (const k of PRINT_ENV) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    rootDir = mkdtempSync(join(tmpdir(), 'print-named-page-'));
    stack = await bootShowcase({
      extraPlugins: [
        new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }),
        new AuditPlugin(),
        new PrintServicePlugin(),
      ],
    });
    ql = stack.kernel.getService<IDataEngine>('objectql');
    // The brief is added the way an author adds a page: through the metadata save door.
    const protocol = await stack.kernel.getServiceAsync<{ saveMetaItem(r: Record<string, unknown>): Promise<unknown> }>('protocol');
    await protocol.saveMetaItem({ type: 'page', name: PROJECT_BRIEF_PAGE.name, item: PROJECT_BRIEF_PAGE });
    const [seeded] = await ql.find('showcase_project', { limit: 1 }, { context: SYS });
    project = String(seeded!.id);

    service = new PrintService({
      placement: { state: 'configured', resolved: { placement: 'local', target: '/stand-in/chromium', consoleUrl: CONSOLE } },
      driver: { placement: 'local', probe: async () => ({ version: 'stand-in' }), renderPdf },
      getEngine: () => stack.kernel.getService<PrintEngine>('objectql'),
      getAttachments: () => stack.kernel.getService<IFileAttachmentService>(FILE_ATTACHMENT_SERVICE),
      getMinter: () => ({ mint }),
    });
    await service.probe();
  }, 180_000);

  afterAll(async () => {
    await stack?.stop();
    if (rootDir) rmSync(rootDir, { recursive: true, force: true });
    for (const k of PRINT_ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  const request = (page: string, object = 'showcase_project', recordId = project) => ({ app: 'showcase', object, recordId, page });

  it('precondition: the project keeps its working default record page, and the brief is a second page beside it', () => {
    const engine = stack.kernel.getService<PrintEngine>('objectql');
    expect(engine.registry.getItem<Record<string, unknown>>('page', 'showcase_project_detail')).toMatchObject({
      object: 'showcase_project',
      isDefault: true,
    });
    expect(engine.registry.getItem<Record<string, unknown>>('page', 'showcase_project_detail')?.print).toBeUndefined();
    const brief = engine.registry.getItem<Record<string, unknown>>('page', PROJECT_BRIEF_PAGE.name);
    expect(brief).toMatchObject({ type: 'record', object: 'showcase_project', print: { paperSize: 'A4' } });
    expect(brief?.isDefault).toBeUndefined();
  });

  it('prints the project on the brief through the console’s named record-page route, archived as the requester', async () => {
    const ctx = await stack.contextFor(await stack.signIn());
    mint.mockClear();
    revoke.mockClear();
    renderPdf.mockClear();
    const out = await service.printRecordToFile(request(PROJECT_BRIEF_PAGE.name), ctx);
    expect(renderPdf).toHaveBeenCalledTimes(1);
    expect(renderPdf).toHaveBeenCalledWith(
      expect.objectContaining({ url: `${CONSOLE}/apps/showcase/showcase_project/record/${project}/page/${PROJECT_BRIEF_PAGE.name}` }),
    );
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ size: PDF.byteLength, filename: `${PROJECT_BRIEF_PAGE.name}-${project}.pdf` });
    const attachment = await ql.findOne('sys_attachment', { where: { id: out.attachmentId } }, { context: SYS });
    expect(attachment).toMatchObject({ parent_object: 'showcase_project', parent_id: project, file_id: out.fileId, uploaded_by: ctx.userId });
  });

  it('the working default page, which declares no print, is still refused: VALIDATION_ERROR / 400, nothing minted', async () => {
    const ctx = await stack.contextFor(await stack.signIn());
    mint.mockClear();
    renderPdf.mockClear();
    expect(await refusalOf(service.printRecordToFile(request('showcase_project_detail'), ctx))).toEqual({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(mint).not.toHaveBeenCalled();
    expect(renderPdf).not.toHaveBeenCalled();
  });

  it('the brief cannot print a record of another object: VALIDATION_ERROR / 400, nothing minted', async () => {
    const ctx = await stack.contextFor(await stack.signIn());
    const [invoice] = await ql.find('showcase_invoice', { limit: 1 }, { context: SYS });
    mint.mockClear();
    renderPdf.mockClear();
    expect(
      await refusalOf(service.printRecordToFile(request(PROJECT_BRIEF_PAGE.name, 'showcase_invoice', String(invoice!.id)), ctx)),
    ).toEqual({ code: 'VALIDATION_ERROR', status: 400 });
    expect(mint).not.toHaveBeenCalled();
    expect(renderPdf).not.toHaveBeenCalled();
  });
});
