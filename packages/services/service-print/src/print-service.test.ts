// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';
import { PRINCIPAL_SESSION_MAX_TTL_SECONDS } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ChromiumDriver } from './chromium-driver.js';
import type { PrintPlacementResolution } from './config.js';
import type { PrincipalSessionMinter, PrintSession } from './principal-session.js';
import { principalSessionMinterOf } from './principal-session.js';
import {
  PRINT_RENDER_TIMEOUT_MS,
  PRINT_SESSION_TTL_SECONDS,
  PrintService,
  type PrintRecordRequest,
} from './print-service.js';

/** A refusal as a gate or a collaborator throws it: `code` and `status` on an `Error`. */
function refusalError(code: string, status: number, message: string): Error {
  return Object.assign(new Error(message), { code, status });
}

const CONSOLE = 'http://127.0.0.1:3000/_console';
const COOKIE_VALUE = 'minted-cookie-value.signature';
const TOKEN = 'minted-bearer-token';
const PDF = Buffer.from('%PDF-1.4 fake');

const USER: ExecutionContext = { userId: 'usr_alice', tenantId: 'org_1', principalKind: 'human' } as ExecutionContext;
const REQUEST: PrintRecordRequest = { app: 'showcase', object: 'invoice', recordId: 'inv_1', page: 'invoice_print' };

const PRINT_PAGE = {
  name: 'invoice_print',
  type: 'record',
  object: 'invoice',
  isDefault: true,
  print: { paperSize: 'A4' },
};

interface Harness {
  service: PrintService;
  driver: { probe: ReturnType<typeof vi.fn>; renderPdf: ReturnType<typeof vi.fn> };
  mint: ReturnType<typeof vi.fn>;
  revoke: ReturnType<typeof vi.fn>;
  attachFile: ReturnType<typeof vi.fn>;
  systemAttachFile: ReturnType<typeof vi.fn>;
  assertMayAttach: ReturnType<typeof vi.fn>;
  findOne: ReturnType<typeof vi.fn>;
  metadataGet: ReturnType<typeof vi.fn>;
  loggerError: ReturnType<typeof vi.fn>;
}

interface Setup {
  placement?: PrintPlacementResolution;
  page?: unknown;
  object?: unknown;
  record?: unknown;
  readError?: unknown;
  probeError?: Error;
  renderError?: unknown;
  attachError?: unknown;
  noMint?: boolean;
  noAttachments?: boolean;
  noCallerAttach?: boolean;
  attachRefusal?: Error;
  revokeError?: Error;
}

const configured: PrintPlacementResolution = {
  state: 'configured',
  resolved: { placement: 'local', target: '/usr/bin/chromium', consoleUrl: CONSOLE },
};

async function harness(setup: Setup = {}): Promise<Harness> {
  const placement = setup.placement ?? configured;
  const revoke = vi.fn(async () => {
    if (setup.revokeError) throw setup.revokeError;
  });
  const loggerError = vi.fn();
  const session: PrintSession = {
    token: TOKEN,
    cookie: { name: 'os.session_token', value: COOKIE_VALUE, path: '/', httpOnly: true, secure: false, sameSite: 'lax' },
    revoke,
  };
  const mint = vi.fn(async () => session);
  const driver = {
    placement: 'local' as const,
    probe: vi.fn(async () => {
      if (setup.probeError) throw setup.probeError;
      return { version: '141.0.7390.37' };
    }),
    renderPdf: vi.fn(async () => {
      if (setup.renderError) throw setup.renderError;
      return PDF;
    }),
  };
  const attachFile = vi.fn(async (input: { data: Buffer }, _context?: unknown) => {
    if (setup.attachError) throw setup.attachError;
    return { fileId: 'file_1', attachmentId: 'att_1', size: input.data.byteLength };
  });
  const systemAttachFile = vi.fn();
  const assertMayAttach = vi.fn(async () => {
    if (setup.attachRefusal) throw setup.attachRefusal;
  });
  const findOne = vi.fn(async () => {
    if (setup.readError) throw setup.readError;
    return 'record' in setup ? setup.record : { id: 'inv_1' };
  });
  const metadataGet = vi.fn((_type: string, name: string) =>
    'page' in setup ? setup.page : name === PRINT_PAGE.name ? PRINT_PAGE : undefined,
  );
  const minter: PrincipalSessionMinter = { mint };
  const service = new PrintService({
    placement,
    driver: placement.state === 'configured' ? (driver as ChromiumDriver) : null,
    getEngine: () =>
      ({
        findOne,
        registry: {
          getItem: metadataGet,
          getObject: () => ('object' in setup ? setup.object : { name: 'invoice', enable: { files: true } }),
        },
      }) as never,
    getAttachments: () =>
      setup.noAttachments
        ? undefined
        : ((setup.noCallerAttach
            ? { attachFile: systemAttachFile }
            : { attachFile: systemAttachFile, attachFileAs: attachFile, assertMayAttach }) as never),
    getMinter: () => (setup.noMint ? undefined : minter),
    logger: { error: loggerError },
  });
  await service.probe();
  return { service, driver, mint, revoke, attachFile, systemAttachFile, assertMayAttach, findOne, metadataGet, loggerError };
}

/** The refusal's ADR-0112 envelope: `code` and `status`. */
async function refusalOf(p: Promise<unknown>): Promise<{ code: unknown; status: unknown; message: string }> {
  try {
    await p;
  } catch (err) {
    const e = err as { code?: unknown; status?: unknown; message: string };
    return { code: e.code, status: e.status, message: e.message };
  }
  throw new Error('expected a refusal, the call resolved');
}

/** Nothing was minted, rendered or stored. */
function expectNothingStarted(h: Harness): void {
  expect(h.mint).not.toHaveBeenCalled();
  expect(h.driver.renderPdf).not.toHaveBeenCalled();
  expect(h.attachFile).not.toHaveBeenCalled();
  expect(h.systemAttachFile).not.toHaveBeenCalled();
}

describe('PrintService — the principal (step ①)', () => {
  const cases: Array<[string, unknown]> = [
    ['no context', undefined],
    ['the system context', { isSystem: true, userId: 'usr_alice' }],
    ['a context with no user', { tenantId: 'org_1' }],
    ['an agent principal', { userId: 'usr_alice', principalKind: 'agent' }],
    ['a service principal', { userId: 'usr_alice', principalKind: 'service' }],
    ['a guest principal', { userId: 'usr_alice', principalKind: 'guest' }],
    ['a system principal kind', { userId: 'usr_alice', principalKind: 'system' }],
    ['a user held by an authentication policy', { userId: 'usr_alice', authGate: { code: 'MFA_REQUIRED', message: 'enroll' } }],
  ];
  for (const [label, context] of cases) {
    it(`refuses ${label}: PERMISSION_DENIED / 403, before anything is minted or launched`, async () => {
      const h = await harness();
      const r = await refusalOf(h.service.printRecordToFile(REQUEST, context as ExecutionContext));
      expect([r.code, r.status]).toEqual(['PERMISSION_DENIED', 403]);
      expectNothingStarted(h);
      expect(h.findOne).not.toHaveBeenCalled();
    });
  }

  it('a principal refusal wins over an absent engine (the ruled order)', async () => {
    const h = await harness({ placement: { state: 'unconfigured', reason: 'none' } });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, { isSystem: true } as ExecutionContext));
    expect([r.code, r.status]).toEqual(['PERMISSION_DENIED', 403]);
  });
});

describe('PrintService — the engine (step ②)', () => {
  it('no placement configured: SERVICE_UNAVAILABLE / 503 naming the reason; the page is never read', async () => {
    const h = await harness({ placement: { state: 'unconfigured', reason: 'Set OS_PRINT_CHROMIUM_PATH.' } });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expect(r.message).toContain('OS_PRINT_CHROMIUM_PATH');
    expect(h.metadataGet).not.toHaveBeenCalled();
    expectNothingStarted(h);
  });

  it('a misconfigured placement: SERVICE_UNAVAILABLE / 503', async () => {
    const h = await harness({ placement: { state: 'misconfigured', placement: 'remote', reason: 'bad endpoint' } });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expectNothingStarted(h);
  });

  it('an unreachable engine is probed once more per call, then refused 503', async () => {
    const h = await harness({ probeError: new Error('connect ECONNREFUSED') });
    expect(h.service.status()).toMatchObject({ state: 'unavailable', placement: 'local' });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expect(h.driver.probe).toHaveBeenCalledTimes(2);
    expectNothingStarted(h);
  });

  it('an unreachable engine is re-probed only AFTER step 5: an unknown page is refused 404 with no browser started', async () => {
    const h = await harness({ probeError: new Error('connect ECONNREFUSED'), page: undefined });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['RESOURCE_NOT_FOUND', 404]);
    expect(h.driver.probe).toHaveBeenCalledTimes(1); // the boot probe alone
    expectNothingStarted(h);
  });

  it('an unreachable engine is re-probed only AFTER step 5: an attach refusal wins with no browser started', async () => {
    const h = await harness({
      probeError: new Error('connect ECONNREFUSED'),
      attachRefusal: refusalError('ATTACHMENT_PARENT_ACCESS', 403, 'no edit'),
    });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['ATTACHMENT_PARENT_ACCESS', 403]);
    expect(h.driver.probe).toHaveBeenCalledTimes(1);
    expectNothingStarted(h);
  });

  it('an engine that answers its re-probe after step 5 serves the print', async () => {
    const h = await harness({ probeError: new Error('connect ECONNREFUSED') });
    h.driver.probe.mockResolvedValueOnce({ version: '141.0.7390.37' });
    const out = await h.service.printRecordToFile(REQUEST, USER);
    expect(out.fileId).toBe('file_1');
    expect(h.driver.probe).toHaveBeenCalledTimes(2);
    const order = (fn: ReturnType<typeof vi.fn>): number => fn.mock.invocationCallOrder[fn.mock.invocationCallOrder.length - 1]!;
    expect(order(h.assertMayAttach)).toBeLessThan(order(h.driver.probe));
    expect(order(h.driver.probe)).toBeLessThan(order(h.mint));
  });

  it('no principal-session mint on the auth service: unavailable, 503, and status says why', async () => {
    const h = await harness({ noMint: true });
    expect(h.service.status()).toMatchObject({ state: 'unavailable', version: '141.0.7390.37' });
    expect(h.service.status().reason).toContain('mintPrincipalSession');
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expectNothingStarted(h);
  });

  it('no file-attachments service: unavailable, 503', async () => {
    const h = await harness({ noAttachments: true });
    expect(h.service.status().reason).toContain('file-attachments');
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expectNothingStarted(h);
  });

  it('a ready engine reports its placement and version', async () => {
    const h = await harness();
    expect(h.service.status()).toEqual({ state: 'ready', placement: 'local', version: '141.0.7390.37' });
  });
});

describe('PrintService — the page (step ③)', () => {
  it('a malformed request: VALIDATION_ERROR / 400', async () => {
    const h = await harness();
    for (const bad of [{ ...REQUEST, app: '' }, { ...REQUEST, recordId: 7 }, { ...REQUEST, filename: '' }]) {
      const r = await refusalOf(h.service.printRecordToFile(bad as PrintRecordRequest, USER));
      expect([r.code, r.status]).toEqual(['VALIDATION_ERROR', 400]);
    }
    expectNothingStarted(h);
  });

  it('an unknown page: RESOURCE_NOT_FOUND / 404, and the record is never read', async () => {
    const h = await harness({ page: undefined });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['RESOURCE_NOT_FOUND', 404]);
    expect(h.findOne).not.toHaveBeenCalled();
    expectNothingStarted(h);
  });

  const invalid: Array<[string, unknown]> = [
    ['a page of another object', { ...PRINT_PAGE, object: 'account' }],
    ['a page that does not declare print', { ...PRINT_PAGE, print: undefined }],
    ['a print page that is not the default record page', { ...PRINT_PAGE, isDefault: undefined }],
    ['a default page that is not a record page', { ...PRINT_PAGE, type: 'home' }],
  ];
  for (const [label, page] of invalid) {
    it(`${label}: VALIDATION_ERROR / 400, and the record is never read`, async () => {
      const h = await harness({ page });
      const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
      expect([r.code, r.status]).toEqual(['VALIDATION_ERROR', 400]);
      expect(h.findOne).not.toHaveBeenCalled();
      expectNothingStarted(h);
    });
  }
});

describe('PrintService — the record, read as the caller (step ④)', () => {
  it('reads the record with the caller’s own context, never a system one', async () => {
    const h = await harness();
    await h.service.printRecordToFile(REQUEST, USER);
    expect(h.findOne).toHaveBeenCalledWith('invoice', { where: { id: 'inv_1' } }, { context: USER });
  });

  it('a record the caller cannot see: RECORD_NOT_FOUND / 404', async () => {
    const h = await harness({ record: null });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    expectNothingStarted(h);
  });

  it('a read refused 403 answers the same 404, so the answer discloses nothing', async () => {
    const h = await harness({ readError: refusalError('PERMISSION_DENIED', 403, 'no read on invoice') });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['RECORD_NOT_FOUND', 404]);
    expectNothingStarted(h);
  });

  it('a read that fails for another reason is not disguised', async () => {
    const h = await harness({ readError: refusalError('DATABASE_ERROR', 500, 'down') });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['DATABASE_ERROR', 500]);
    expectNothingStarted(h);
  });
});

describe('PrintService — the files opt-in (step ⑤)', () => {
  it('an object without enable.files: FILES_DISABLED / 403, before any render', async () => {
    const h = await harness({ object: { name: 'invoice', enable: {} } });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['FILES_DISABLED', 403]);
    expectNothingStarted(h);
  });

  for (const [label, refusal] of [
    ['the attach rule refuses (no edit access)', ['ATTACHMENT_PARENT_ACCESS', 403]],
    ['the caller may not create attachments at all', ['PERMISSION_DENIED', 403]],
  ] as const) {
    it(`${label}: the archive's own refusal, ${refusal[0]} / ${refusal[1]}, before any mint or render`, async () => {
      const h = await harness({ attachRefusal: refusalError(refusal[0], refusal[1], label) });
      const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
      expect([r.code, r.status]).toEqual([...refusal]);
      expect(h.assertMayAttach).toHaveBeenCalledWith('invoice', 'inv_1', USER);
      expect(h.assertMayAttach.mock.calls[0]![2]).toBe(USER);
      expectNothingStarted(h);
    });
  }

  it('a files refusal wins over the attach rule (the ruled order)', async () => {
    const h = await harness({ object: { enable: {} }, attachRefusal: refusalError('ATTACHMENT_PARENT_ACCESS', 403, 'x') });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect(r.code).toBe('FILES_DISABLED');
    expect(h.assertMayAttach).not.toHaveBeenCalled();
  });

  it('an archive that can only attach as the system: unavailable, 503 — never a system-attributed PDF', async () => {
    const h = await harness({ noCallerAttach: true });
    expect(h.service.status().reason).toContain('attachFileAs');
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['SERVICE_UNAVAILABLE', 503]);
    expectNothingStarted(h);
  });

  it('an unreadable record wins over a files refusal (the ruled order)', async () => {
    const h = await harness({ record: null, object: { enable: {} } });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect(r.code).toBe('RECORD_NOT_FOUND');
  });
});

describe('PrintService — mint, render, archive, revoke', () => {
  it('mints for the caller with the TTL, renders the record URL with the cookie, archives the PDF', async () => {
    const h = await harness();
    const out = await h.service.printRecordToFile(REQUEST, USER);
    expect(h.mint).toHaveBeenCalledWith(USER, PRINT_SESSION_TTL_SECONDS);
    // The request's own context, unchanged — the very object the caller passed, never one assembled.
    expect(h.mint.mock.calls[0]![0]).toBe(USER);
    expect(h.findOne.mock.calls[0]![2].context).toBe(USER);
    expect(PRINT_SESSION_TTL_SECONDS * 1000).toBeGreaterThan(PRINT_RENDER_TIMEOUT_MS);
    expect(PRINT_SESSION_TTL_SECONDS).toBeLessThanOrEqual(PRINCIPAL_SESSION_MAX_TTL_SECONDS);
    expect(h.driver.renderPdf).toHaveBeenCalledWith({
      url: `${CONSOLE}/apps/showcase/invoice/record/inv_1`,
      cookie: expect.objectContaining({ value: COOKIE_VALUE }),
      timeoutMs: PRINT_RENDER_TIMEOUT_MS,
    });
    expect(h.attachFile).toHaveBeenCalledWith(
      {
        parentObject: 'invoice',
        parentId: 'inv_1',
        organizationId: 'org_1',
        filename: 'invoice_print-inv_1.pdf',
        mimeType: 'application/pdf',
        data: PDF,
      },
      USER,
    );
    // Archived AS THE CALLER: the caller's own context, and never the system verb.
    expect(h.attachFile.mock.calls[0]![1]).toBe(USER);
    expect(h.systemAttachFile).not.toHaveBeenCalled();
    expect(h.assertMayAttach).toHaveBeenCalledWith('invoice', 'inv_1', USER);
    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ fileId: 'file_1', attachmentId: 'att_1', size: PDF.byteLength, filename: 'invoice_print-inv_1.pdf' });
  });

  it('the mint happens only after every refusal check, and the revoke after the archive', async () => {
    const h = await harness();
    await h.service.printRecordToFile(REQUEST, USER);
    const order = (fn: ReturnType<typeof vi.fn>): number => fn.mock.invocationCallOrder[0]!;
    expect(order(h.findOne)).toBeLessThan(order(h.mint));
    expect(order(h.mint)).toBeLessThan(order(h.driver.renderPdf));
    expect(order(h.driver.renderPdf)).toBeLessThan(order(h.attachFile));
    expect(order(h.attachFile)).toBeLessThan(order(h.revoke));
  });

  it('a caller with no organization archives in none', async () => {
    const h = await harness();
    await h.service.printRecordToFile({ ...REQUEST, filename: 'copy.pdf' }, { userId: 'usr_alice' } as ExecutionContext);
    expect(h.attachFile).toHaveBeenCalledWith(expect.objectContaining({ organizationId: null, filename: 'copy.pdf' }), expect.anything());
  });

  it('a failed render still revokes the session, and the failure is passed on unchanged', async () => {
    const h = await harness({ renderError: refusalError('TIMEOUT', 504, 'the print page did not load') });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(h.attachFile).not.toHaveBeenCalled();
  });

  it('a refused archive still revokes the session', async () => {
    const h = await harness({ attachError: refusalError('PAYLOAD_TOO_LARGE', 413, 'too large') });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['PAYLOAD_TOO_LARGE', 413]);
    expect(h.revoke).toHaveBeenCalledTimes(1);
  });

  it('a revoke that fails after a committed archive: the caller still gets the success, and the failure is logged at error by fingerprint', async () => {
    const h = await harness({ revokeError: new Error(`session store down while revoking ${TOKEN}`) });
    const out = await h.service.printRecordToFile(REQUEST, USER);
    expect(out).toMatchObject({ fileId: 'file_1', attachmentId: 'att_1' });
    expect(h.revoke).toHaveBeenCalledTimes(1);
    expect(h.loggerError).toHaveBeenCalledTimes(1);
    const line = String(h.loggerError.mock.calls[0]![0]);
    expect(line).toMatch(/fingerprint [0-9a-f]{12}/);
    expect(line).toContain('usr_alice');
    expect(line).not.toContain(TOKEN);
    expect(line).not.toContain(COOKIE_VALUE);
  });

  it('a revoke that fails after a refused print: the original refusal wins, and the failure is logged the same way', async () => {
    const h = await harness({
      renderError: refusalError('TIMEOUT', 504, 'the print page did not load'),
      revokeError: new Error('session store down'),
    });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['TIMEOUT', 504]);
    expect(h.loggerError).toHaveBeenCalledTimes(1);
    expect(String(h.loggerError.mock.calls[0]![0])).not.toContain(TOKEN);
  });

  it('a mint refusal is passed on, and nothing is rendered', async () => {
    const h = await harness();
    h.mint.mockRejectedValueOnce(refusalError('PERMISSION_DENIED', 403, 'banned'));
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect([r.code, r.status]).toEqual(['PERMISSION_DENIED', 403]);
    expect(h.driver.renderPdf).not.toHaveBeenCalled();
    expect(h.revoke).not.toHaveBeenCalled();
  });

  it('the minted credential appears in no refusal message', async () => {
    const h = await harness({ renderError: refusalError('INTERNAL_ERROR', 500, 'engine crashed') });
    const r = await refusalOf(h.service.printRecordToFile(REQUEST, USER));
    expect(r.message).not.toContain(COOKIE_VALUE);
    expect(r.message).not.toContain(TOKEN);
  });
});

describe('principalSessionMinterOf — the one read of the auth service’s mint', () => {
  it('absent auth, or an auth service without the member, has no mint', () => {
    expect(principalSessionMinterOf(undefined)).toBeUndefined();
    expect(principalSessionMinterOf({ verify: () => undefined } as never)).toBeUndefined();
  });

  it('calls the member on the auth service with the caller’s context and the TTL', async () => {
    const auth = {
      seen: [] as unknown[],
      async mintPrincipalSession(this: { seen: unknown[] }, ctx: unknown, opts: unknown) {
        this.seen.push(ctx, opts);
        return { token: 't', cookie: { name: 'n', value: 'v', path: '/', httpOnly: true, secure: true }, revoke: async () => {} };
      },
    };
    const minter = principalSessionMinterOf(auth as never)!;
    await minter.mint(USER, 60);
    expect(auth.seen).toEqual([USER, { ttlSeconds: 60 }]);
    expect(auth.seen[0]).toBe(USER);
  });
});
