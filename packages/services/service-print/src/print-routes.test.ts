// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { ApiErrorSchema, envelopeViolations } from '@objectstack/spec/api';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ChromiumDriver } from './chromium-driver.js';
import type { PrintPlacementResolution } from './config.js';
import { PRINT_RECORDS_ROUTE, registerPrintRoutes } from './print-routes.js';
import { PrintService, type IPrintService } from './print-service.js';

/**
 * The print door, `POST /api/v1/print/records`, driven through the handler it
 * mounts: the real platform resolver turns the request's bearer into an
 * execution context, and the real `PrintService` judges the print over
 * recording doubles of the data engine, the archive, the mint and the browser.
 *
 * Each refusal is asserted by its envelope (`code` and `status`, ADR-0112),
 * and each one by what it did NOT start: no session minted, no page read, no
 * file stored.
 */

const PDF = Buffer.from('%PDF-1.4 door');
const PAGE = 'invoice_document';
const INVOICE = { app: 'sales', object: 'invoice', page: PAGE } as const;
const CONFIGURED: PrintPlacementResolution = {
  state: 'configured',
  resolved: { placement: 'local', target: '/staged/chromium', consoleUrl: 'http://127.0.0.1:3000/_console' },
};

/** The sessions the fake auth service knows, by bearer token. */
interface FakeSession {
  userId: string;
  organizationId?: string;
  impersonatedBy?: string | null;
  authGate?: { code: string; message: string };
}

const SESSIONS: Record<string, FakeSession> = {
  alice: { userId: 'usr_alice', organizationId: 'org_1' },
  impersonated: { userId: 'usr_alice', organizationId: 'org_1', impersonatedBy: 'usr_admin' },
  notImpersonated: { userId: 'usr_alice', organizationId: 'org_1', impersonatedBy: null },
  held: { userId: 'usr_alice', authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' } },
};

/** Invoices and their owners: a caller reads only their own (row-level security, as the caller). */
const RECORDS: Record<string, { id: string; owner: string }> = {
  inv_alice: { id: 'inv_alice', owner: 'usr_alice' },
  inv_bob: { id: 'inv_bob', owner: 'usr_bob' },
};

interface DoorSetup {
  placement?: PrintPlacementResolution;
  page?: Record<string, unknown>;
  /** Hand the door this service instead of a real `PrintService`. */
  service?: IPrintService;
}

function door(setup: DoorSetup = {}) {
  const handlers = new Map<string, (req: unknown, res: unknown) => Promise<void>>();
  const http = {
    get: vi.fn(),
    post: vi.fn((path: string, handler: (req: unknown, res: unknown) => Promise<void>) => handlers.set(`POST ${path}`, handler)),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    use: vi.fn(),
  };

  const sessionReads: unknown[] = [];
  const auth = {
    api: {
      getSession: vi.fn(async (input: { headers: Headers }) => {
        sessionReads.push(input);
        const bearer = input.headers.get('authorization')?.replace(/^Bearer /, '');
        const s = bearer ? SESSIONS[bearer] : undefined;
        if (!s) return null;
        return {
          user: { id: s.userId, email: `${s.userId}@example.test`, ...(s.authGate ? { authGate: s.authGate } : {}) },
          session: {
            id: `ses_${bearer}`,
            userId: s.userId,
            activeOrganizationId: s.organizationId,
            ...(s.impersonatedBy !== undefined ? { impersonatedBy: s.impersonatedBy } : {}),
          },
        };
      }),
    },
  };

  // The archive: an in-memory `sys_file` / `sys_attachment` store, written as the caller.
  const rows = { sys_file: [] as Record<string, unknown>[], sys_attachment: [] as Record<string, unknown>[] };
  const attachFileAs = vi.fn(
    async (input: { parentObject: string; parentId: string; filename: string; data: Buffer }, context: ExecutionContext) => {
      const fileId = `file_${rows.sys_file.length + 1}`;
      const attachmentId = `att_${rows.sys_attachment.length + 1}`;
      rows.sys_file.push({ id: fileId, owner_id: context.userId, name: input.filename, size: input.data.byteLength });
      rows.sys_attachment.push({
        id: attachmentId,
        file_id: fileId,
        parent_object: input.parentObject,
        parent_id: input.parentId,
        uploaded_by: context.userId,
      });
      return { fileId, attachmentId, size: input.data.byteLength };
    },
  );
  const systemAttachFile = vi.fn();
  const findOne = vi.fn(async (_object: string, query: { where: { id: string } }, opts: { context: ExecutionContext }) => {
    const row = RECORDS[query.where.id];
    return row && row.owner === opts.context.userId ? row : null;
  });
  const page = setup.page ?? { name: PAGE, type: 'record', object: 'invoice', isDefault: true, print: { paperSize: 'A4' } };
  const revoke = vi.fn(async () => undefined);
  const mint = vi.fn(async (_context: ExecutionContext) => ({
    token: 'minted-token',
    cookie: { name: 'os.session_token', value: 'minted-cookie', path: '/', httpOnly: true, secure: false },
    revoke,
  }));
  const renderPdf = vi.fn(async () => PDF);
  const real = new PrintService({
    placement: setup.placement ?? CONFIGURED,
    driver:
      (setup.placement ?? CONFIGURED).state === 'configured'
        ? ({ placement: 'local', probe: async () => ({ version: 'stand-in' }), renderPdf } as unknown as ChromiumDriver)
        : null,
    getEngine: () =>
      ({
        findOne,
        registry: {
          getItem: (_type: string, name: string) => (name === PAGE ? page : undefined),
          getObject: () => ({ name: 'invoice', enable: { files: true } }),
        },
      }) as never,
    getAttachments: () => ({ attachFile: systemAttachFile, attachFileAs, assertMayAttach: async () => undefined }) as never,
    getMinter: () => ({ mint }),
  });
  const service = setup.service ?? real;
  const printRecordToFile = vi.spyOn(service, 'printRecordToFile');

  registerPrintRoutes(http as never, {
    print: service,
    // The resolver's grant reads: this caller holds no position or permission set.
    getEngine: () => ({ find: async () => [] }),
    getAuth: () => auth as never,
    resolveTenancyPosture: async () => undefined,
  });

  async function call(opts: { bearer?: string; body?: unknown; query?: Record<string, string> } = {}) {
    const handler = handlers.get(`POST ${PRINT_RECORDS_ROUTE}`);
    if (!handler) throw new Error('the door mounted no POST handler at its route');
    const answer: { status: number; body: any } = { status: 0, body: undefined };
    const res = {
      status: (code: number) => {
        answer.status = code;
        return res;
      },
      json: (body: unknown) => {
        answer.body = body;
      },
      header: () => res,
      send: () => undefined,
    };
    await handler(
      {
        params: {},
        query: opts.query ?? {},
        body: opts.body,
        headers: opts.bearer ? { authorization: `Bearer ${opts.bearer}` } : {},
        method: 'POST',
        path: PRINT_RECORDS_ROUTE,
      },
      res,
    );
    expect(envelopeViolations(answer.body), JSON.stringify(answer.body)).toEqual([]);
    return answer;
  }

  return { call, real, ready: () => real.probe(), rows, mint, revoke, renderPdf, findOne, attachFileAs, systemAttachFile, printRecordToFile, auth, sessionReads };
}

type Door = ReturnType<typeof door>;

/** The refusal envelope's `code` and `status`, after checking the error parses as the declared `ApiError`. */
function envelope(answer: { status: number; body: any }): [unknown, number] {
  expect(answer.body?.success).toBe(false);
  expect(ApiErrorSchema.safeParse(answer.body.error).success, JSON.stringify(answer.body.error)).toBe(true);
  return [answer.body.error.code, answer.status];
}

/** Capture the server fault log (`console.error` / `console.warn`) for one call, and read what it was told. */
function quietFaultLog() {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // Read before the restore: restoring a spy clears what it recorded.
  let errors = '';
  return {
    errors: () => errors,
    restore: () => {
      errors = JSON.stringify(error.mock.calls);
      error.mockRestore();
      warn.mockRestore();
    },
  };
}

/** Nothing minted, rendered or stored, and the record never read. */
function expectNothingStarted(d: Door): void {
  expect(d.mint).not.toHaveBeenCalled();
  expect(d.renderPdf).not.toHaveBeenCalled();
  expect(d.findOne).not.toHaveBeenCalled();
  expect(d.rows.sys_attachment).toHaveLength(0);
  expect(d.systemAttachFile).not.toHaveBeenCalled();
}

describe('the print door — mounted', () => {
  it('registers exactly one route: POST /api/v1/print/records', () => {
    const http = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn(), use: vi.fn() };
    registerPrintRoutes(http as never, {} as never);
    expect(http.post.mock.calls.map((c) => c[0])).toEqual(['/api/v1/print/records']);
    for (const verb of ['get', 'put', 'patch', 'delete', 'use'] as const) expect(http[verb]).not.toHaveBeenCalled();
  });
});

describe('the print door — a print', () => {
  it('prints as the caller and answers 201 with the file the service stored: exactly one attachment, never a second', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(answer.status).toBe(201);
    expect(answer.body).toEqual({
      success: true,
      data: { fileId: 'file_1', attachmentId: 'att_1', size: PDF.byteLength, filename: `${PAGE}-inv_alice.pdf` },
    });
    const forTheInvoice = d.rows.sys_attachment.filter((r) => r.parent_object === 'invoice' && r.parent_id === 'inv_alice');
    expect(forTheInvoice).toHaveLength(1);
    expect(d.rows.sys_attachment).toHaveLength(1);
    expect(forTheInvoice[0]).toMatchObject({ id: 'att_1', file_id: 'file_1', uploaded_by: 'usr_alice' });
    expect(d.rows.sys_file).toEqual([expect.objectContaining({ id: 'file_1', owner_id: 'usr_alice' })]);
    expect(d.attachFileAs).toHaveBeenCalledTimes(1);
    expect(d.systemAttachFile).not.toHaveBeenCalled();
    expect(d.revoke).toHaveBeenCalledTimes(1);
  });

  it('hands the service the request and the caller\'s own context, which reaches the mint unchanged', async () => {
    const d = door();
    await d.ready();
    await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice', filename: 'INV-1.pdf' } });
    expect(d.printRecordToFile).toHaveBeenCalledTimes(1);
    const [request, context] = d.printRecordToFile.mock.calls[0]!;
    expect(request).toEqual({ ...INVOICE, recordId: 'inv_alice', filename: 'INV-1.pdf' });
    expect(context).toMatchObject({ userId: 'usr_alice', tenantId: 'org_1', principalKind: 'human', isSystem: false });
    expect(d.mint.mock.calls[0]![0]).toBe(context);
  });

  it('reads the session once, through the resolver, and a session with no impersonation mark prints', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'notImpersonated', body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(answer.status).toBe(201);
    expect(d.auth.api.getSession).toHaveBeenCalledTimes(1);
  });
});

describe('the print door — the refusals card ③ pins, relayed through the door', () => {
  it('no render driver configured: SERVICE_UNAVAILABLE / 503, reported, before anything is minted or read', async () => {
    const d = door({ placement: { state: 'unconfigured', reason: 'No print engine is configured. Set OS_PRINT_CHROMIUM_PATH.' } });
    const logged = quietFaultLog();
    const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice' } });
    logged.restore();
    expect(envelope(answer)).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expect(answer.body.error.message.length).toBeGreaterThan(0);
    expectNothingStarted(d);
  });

  it('a page that declares no `print`: VALIDATION_ERROR / 400', async () => {
    const d = door({ page: { name: PAGE, type: 'record', object: 'invoice', isDefault: true } });
    await d.ready();
    const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
    expectNothingStarted(d);
  });

  it('a caller who cannot read the record: RECORD_NOT_FOUND / 404, judged as the caller', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_bob' } });
    expect(envelope(answer)).toEqual(['RECORD_NOT_FOUND', 404]);
    expect(d.findOne).toHaveBeenCalledTimes(1);
    expect(d.mint).not.toHaveBeenCalled();
    expect(d.rows.sys_attachment).toHaveLength(0);
  });

  const declared: Array<[string, number]> = [
    ['PERMISSION_DENIED', 403],
    ['SERVICE_UNAVAILABLE', 503],
    ['RESOURCE_NOT_FOUND', 404],
    ['VALIDATION_ERROR', 400],
    ['RECORD_NOT_FOUND', 404],
    ['FILES_DISABLED', 403],
    ['ATTACHMENT_PARENT_ACCESS', 403],
    ['TIMEOUT', 504],
    ['INTERNAL_ERROR', 500],
    ['PAYLOAD_TOO_LARGE', 413],
  ];
  for (const [code, status] of declared) {
    it(`relays ${code} / ${status} with its code and status unchanged`, async () => {
      const text = `the service's own text for ${code}, naming /srv/secret/host-path`;
      const stub: IPrintService = {
        status: () => ({ state: 'ready', placement: 'local', version: 'stand-in' }),
        printRecordToFile: async () => {
          throw Object.assign(new Error(text), { code, status });
        },
      };
      const d = door({ service: stub });
      const logged = quietFaultLog();
      const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice' } });
      logged.restore();
      expect(envelope(answer)).toEqual([code, status]);
      if (status < 500) {
        expect(answer.body.error.message).toBe(text);
      } else {
        expect(answer.body.error.message).not.toContain('/srv/secret');
        // The operator keeps the text: it is in the server fault log. A 503 is a
        // declared capability absence, reported once per route per process, so
        // only the other 5xx are asserted here.
        if (status !== 503) expect(logged.errors()).toContain('/srv/secret');
      }
    });
  }

  it('an undeclared throw is a fault: INTERNAL_ERROR / 500, its text withheld', async () => {
    const stub: IPrintService = {
      status: () => ({ state: 'ready', placement: 'local', version: 'stand-in' }),
      printRecordToFile: async () => {
        throw new Error('ECONNRESET at /srv/secret/host-path');
      },
    };
    const d = door({ service: stub });
    const logged = quietFaultLog();
    const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice' } });
    logged.restore();
    expect(envelope(answer)).toEqual(['INTERNAL_ERROR', 500]);
    expect(answer.body.error.message).not.toContain('/srv/secret');
    expect(logged.errors()).toContain('/srv/secret');
  });
});

describe('the print door — its own refusals, before the service is asked', () => {
  it('an impersonation session: PERMISSION_DENIED / 403, saying so, before anything is minted or read', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'impersonated', body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(envelope(answer)).toEqual(['PERMISSION_DENIED', 403]);
    expect(answer.body.error.message).toMatch(/impersonation/);
    expect(d.printRecordToFile).not.toHaveBeenCalled();
    expectNothingStarted(d);
  });

  it('an anonymous request: UNAUTHENTICATED / 401, and the service is never asked', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(envelope(answer)).toEqual(['UNAUTHENTICATED', 401]);
    expect(d.printRecordToFile).not.toHaveBeenCalled();
    expectNothingStarted(d);
  });

  it('a sign-in held by an authentication policy: 403 with the policy\'s own code', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'held', body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(envelope(answer)).toEqual(['PASSWORD_EXPIRED', 403]);
    expect(d.printRecordToFile).not.toHaveBeenCalled();
  });

  it('a body field outside the request\'s closed set: VALIDATION_ERROR / 400, never ignored', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'alice', body: { ...INVOICE, recordId: 'inv_alice', fileName: 'INV-1.pdf' } });
    expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
    expect(answer.body.error.message).toContain('fileName');
    expect(d.printRecordToFile).not.toHaveBeenCalled();
  });

  it('a body that is not an object: VALIDATION_ERROR / 400', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'alice', body: ['inv_alice'] });
    expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
    expect(d.printRecordToFile).not.toHaveBeenCalled();
  });

  it('a query parameter: VALIDATION_ERROR / 400 — the door reads none', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'alice', query: { recordId: 'inv_alice' }, body: { ...INVOICE, recordId: 'inv_alice' } });
    expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
    expect(d.printRecordToFile).not.toHaveBeenCalled();
  });

  it('a missing field reaches the service, which refuses it: VALIDATION_ERROR / 400', async () => {
    const d = door();
    await d.ready();
    const answer = await d.call({ bearer: 'alice', body: { app: 'sales', object: 'invoice', page: PAGE } });
    expect(envelope(answer)).toEqual(['VALIDATION_ERROR', 400]);
    expect(d.mint).not.toHaveBeenCalled();
  });
});
