// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash } from 'node:crypto';
import { recordNotFoundError } from '@objectstack/core';
import type { RegisteredErrorCode, StandardErrorCode } from '@objectstack/spec/api';
import type { EngineSchemaRegistryView, IDataEngine, IFileAttachmentService } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { defaultRecordPageObject } from '@objectstack/spec/ui';
import type { ICallerFileAttachmentService } from '@objectstack/service-storage';
import type { ChromiumDriver } from './chromium-driver.js';
import type { PrintPlacement, PrintPlacementResolution } from './config.js';
import type { PrincipalSessionMinter, PrintSession } from './principal-session.js';

/**
 * The print service: render a record's print page in headless Chromium, as
 * the requesting user, and archive the PDF as a file attached to the record.
 *
 * ## The order — every refusal before anything is minted or launched
 *
 * A call is judged in this order, and each step refuses with `code` and
 * `status` (ADR-0112) before the next one runs. Nothing is minted, no browser
 * is launched or connected and nothing is stored until every step has passed:
 *
 *  1. **The principal.** A human user acting for themselves: a context with a
 *     user, not the system, `principalKind` absent or `human`, and no
 *     authentication-policy hold (`authGate`). Anything else answers
 *     `PERMISSION_DENIED` / `403`. There is no system principal to fall back
 *     to: the PDF is what this user may see, rendered as this user.
 *  2. **The engine.** {@link PrintService.status} must be `ready`. Otherwise
 *     `SERVICE_UNAVAILABLE` / `503`, carrying the reason `status()` gives.
 *     One exception keeps an engine recoverable without a restart: an engine
 *     that failed its last probe, with everything else composed, is probed
 *     once more AFTER step 5 — so even that probe never starts a browser
 *     before every other refusal has had its say.
 *  3. **The page.** The request names the page it expects; it must exist
 *     (`RESOURCE_NOT_FOUND` / `404`), be a record page of the record's object,
 *     and declare `print` (`VALIDATION_ERROR` / `400` for each). Any print page
 *     of the object prints, the default record page or another one: the
 *     default renders on the console's record route, any other page on its
 *     named record-page route ({@link printPageUrl}).
 *  4. **The record, read AS THE CALLER.** A record the caller cannot read and
 *     a record that does not exist answer the same `RECORD_NOT_FOUND` / `404`,
 *     so the answer says nothing about a record the caller may not see. A user
 *     never archives what they could not read.
 *  5. **The files opt-in, and the attach rule.** The record's object must
 *     declare `enable: { files: true }`, the opt-in every attachment of it
 *     needs (`FILES_DISABLED` / `403`), and the caller must be allowed to
 *     attach a file to the record, asked of the archive with the insert's own
 *     answers (`assertMayAttach`): may they create attachments at all
 *     (`PERMISSION_DENIED` / `403`), and edit access to the record, the attach
 *     rule (`ATTACHMENT_PARENT_ACCESS` / `403`). All are checked here so a
 *     refused archive never costs a render.
 *
 * Then the session is minted for the caller's own principal, the page is
 * rendered with it, the PDF is archived through the `file-attachments` service,
 * and the session is revoked in a `finally` — after a failed render or a
 * refused archive as much as after a success. A revoke that itself fails never
 * replaces the print's outcome: it is logged at `error` by a fingerprint of the
 * session (never its token), and the session's 60 s TTL ends it.
 *
 * The archive is the one writer of `sys_file` and `sys_attachment`, run AS
 * THE CALLER (`attachFileAs`, `@objectstack/service-storage`): its size limit,
 * its organization wall and every gate on an attachment insert judge this file
 * for the requesting user exactly as they judge their own upload, and both
 * rows name that user (`sys_file.owner_id`, `sys_attachment.uploaded_by`).
 */

/** A request to print one record. */
export interface PrintRecordRequest {
  /** The app the console opens the record in (its route segment: the package id or the app name). */
  app: string;
  /** The record's object. */
  object: string;
  /** The record's id. */
  recordId: string;
  /** The print page the caller expects the record to print on. */
  page: string;
  /** The archived file's name. Defaults to `<page>-<recordId>.pdf`. */
  filename?: string;
}

/** What a print stored. */
export interface PrintedRecordFile {
  /** The `sys_file` row's id. */
  fileId: string;
  /** The `sys_attachment` row's id. */
  attachmentId: string;
  /** The PDF's size in bytes. */
  size: number;
  /** The file name it was stored under. */
  filename: string;
}

/**
 * The print engine's state.
 *
 *  - `ready` — a placement is configured, the engine answered its probe, and
 *    every service a print needs is registered.
 *  - `unconfigured` — no placement is configured. Printing is off.
 *  - `misconfigured` — a placement is configured but cannot be used as given.
 *  - `unavailable` — configured, but the engine did not answer its probe or a
 *    service a print needs is missing.
 */
export interface PrintEngineStatus {
  state: 'ready' | 'unconfigured' | 'misconfigured' | 'unavailable';
  /** Where the engine runs, when one is configured. */
  placement: PrintPlacement | null;
  /** The Chromium version the last probe read. */
  version?: string;
  /** Why the engine is not `ready`, with the remedy. Absent when `ready`. */
  reason?: string;
}

/** The public face of the `print` service. */
export interface IPrintService {
  /** The engine's state, read now. */
  status(): PrintEngineStatus;
  /** Print one record to a PDF as the caller and attach it to the record. */
  printRecordToFile(request: PrintRecordRequest, context: ExecutionContext): Promise<PrintedRecordFile>;
}

/**
 * The data engine a print reads through: the record, read as the caller, and
 * the engine's schema registry — the pages and objects the console itself is
 * served, so the page judged here is the page the browser renders.
 */
export type PrintEngine = Pick<IDataEngine, 'findOne'> & {
  readonly registry: Pick<EngineSchemaRegistryView, 'getItem' | 'getObject'>;
};

/** What {@link PrintService} is composed over — each service read at call time. */
export interface PrintServiceDeps {
  placement: PrintPlacementResolution;
  /** The engine for the configured placement; `null` exactly when none is configured. */
  driver: ChromiumDriver | null;
  getEngine(): PrintEngine | undefined;
  getAttachments(): (IFileAttachmentService & Partial<ICallerFileAttachmentService>) | undefined;
  getMinter(): PrincipalSessionMinter | undefined;
  /** Where a failed revoke is reported. */
  logger?: { error(message: string): void };
}

/** The whole render's time budget. */
export const PRINT_RENDER_TIMEOUT_MS = 30_000;
/**
 * The minted session's life: twice the render budget, so a render that runs
 * its full budget still holds a live session, and no longer. Revoked in a
 * `finally` well before it would expire on its own.
 */
export const PRINT_SESSION_TTL_SECONDS = 60;
/** The engine probe's time budget. */
export const PRINT_PROBE_TIMEOUT_MS = 15_000;

const PDF_MIME_TYPE = 'application/pdf';

/**
 * An ADR-0112-shaped refusal: an `Error` carrying `code` and `status`. Every
 * code the print service answers is from the standard catalog, plus the
 * registered `FILES_DISABLED`: it adds no wire vocabulary of its own.
 */
function printRefusal(code: StandardErrorCode | RegisteredErrorCode, status: number, message: string): never {
  const err = new Error(message) as Error & { code: string; status: number };
  err.code = code;
  err.status = status;
  throw err;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * True when `page` is a record page of `object`: its `type` is `'record'` and
 * its `object` names that object.
 *
 * The same reading as the console's `isRecordPageOf` (`@object-ui/react`,
 * `ui/packages/react/src/hooks/usePageAssignment.ts`), which is what the
 * console's named record-page route asks before it draws the named page and
 * what its record route filters the object's pages with. The console refuses
 * every other name with a not-found state, so a page this function accepts is
 * one the console draws, and a page it refuses is one a print could only put a
 * not-found state (or no page at all) on paper for. No wider and no narrower:
 * `type` is read exactly, as the console reads it, so a body that carries no
 * `type` is not a record page here either (every door that parses or serves a
 * page fills `PageSchema`'s declared default in).
 */
function isRecordPageOf(page: Record<string, unknown>, object: string): boolean {
  return page.type === 'record' && page.object === object;
}

/**
 * The console URL a record prints from on `page`, a record page of its object
 * that declares `print` (checked before this is asked).
 *
 *  - The object's default record page renders on the console's record route,
 *    `CONSOLE/apps/APP/OBJECT/record/ID`, which draws a record on that page.
 *  - Any other print page renders on the console's named record-page route,
 *    `CONSOLE/apps/APP/OBJECT/record/ID/page/PAGE` (`RECORD_NAMED_PAGE_ROUTE`,
 *    `ui/packages/app-shell/src/console/AppContent.tsx`), which draws the named
 *    page and never falls back to the default one.
 *
 * Every segment is encoded on its own, so a name carrying `/` or `?` stays the
 * one segment it is.
 */
function printPageUrl(consoleUrl: string, req: ValidRequest, page: Record<string, unknown>): string {
  const record =
    `${consoleUrl}/apps/${encodeURIComponent(req.app)}/` +
    `${encodeURIComponent(req.object)}/record/${encodeURIComponent(req.recordId)}`;
  return defaultRecordPageObject(page) === req.object ? record : `${record}/page/${encodeURIComponent(req.page)}`;
}

/** What the engine's last probe answered. */
type ProbeResult = { ok: true; version: string } | { ok: false; reason: string };

export class PrintService implements IPrintService {
  private lastProbe: ProbeResult | undefined;

  constructor(private readonly deps: PrintServiceDeps) {}

  /**
   * Probe the engine: open the browser, read its version, close it. Records
   * the answer for {@link status}, and returns it.
   */
  async probe(): Promise<PrintEngineStatus> {
    const { driver } = this.deps;
    if (driver) {
      try {
        const { version } = await driver.probe(PRINT_PROBE_TIMEOUT_MS);
        this.lastProbe = { ok: true, version };
      } catch (err) {
        this.lastProbe = { ok: false, reason: String((err as Error)?.message ?? err) };
      }
    }
    return this.status();
  }

  status(): PrintEngineStatus {
    const { placement } = this.deps;
    if (placement.state === 'unconfigured') {
      return { state: 'unconfigured', placement: null, reason: placement.reason };
    }
    if (placement.state === 'misconfigured') {
      return { state: 'misconfigured', placement: placement.placement, reason: placement.reason };
    }
    const where = placement.resolved.placement;
    if (!this.lastProbe) {
      return { state: 'unavailable', placement: where, reason: 'The print engine has not been probed yet.' };
    }
    if (!this.lastProbe.ok) {
      return { state: 'unavailable', placement: where, reason: this.lastProbe.reason };
    }
    const version = this.lastProbe.version;
    const missing = this.missingService();
    if (missing) return { state: 'unavailable', placement: where, version, reason: missing };
    return { state: 'ready', placement: where, version };
  }

  /** The first service a print needs that is not registered, as a reason; `undefined` when all are. */
  private missingService(): string | undefined {
    if (!this.deps.getMinter()) {
      return (
        'The registered auth service offers no principal-session mint (IAuthService.mintPrincipalSession), so ' +
        "a page cannot be rendered as the requesting user. Compose an auth plugin that provides it."
      );
    }
    const attachments = this.deps.getAttachments();
    if (!attachments) {
      return (
        'No file-attachments service is registered, so a rendered PDF has nowhere to be archived. Compose ' +
        "@objectstack/service-storage's StorageServicePlugin."
      );
    }
    if (typeof attachments.attachFileAs !== 'function' || typeof attachments.assertMayAttach !== 'function') {
      return (
        'The registered file-attachments service cannot attach a file as the requesting user (attachFileAs / ' +
        "assertMayAttach, @objectstack/service-storage's ICallerFileAttachmentService), so a PDF could only be archived " +
        'as the system. Compose a StorageServicePlugin that provides them.'
      );
    }
    if (!this.deps.getEngine()) return 'No data engine is registered, so a page or a record cannot be read.';
    return undefined;
  }

  async printRecordToFile(request: PrintRecordRequest, context: ExecutionContext): Promise<PrintedRecordFile> {
    // ① The principal.
    this.refuseUnlessHumanCaller(context);

    // ② The engine, as configured and composed. An engine whose last probe
    // failed is probed once more — but only after step ⑤, so no browser is
    // launched or connected before every other refusal has had its say.
    const status = this.status();
    const reprobe = status.state === 'unavailable' && this.lastProbe?.ok === false && !this.missingService();
    if (status.state !== 'ready' && !reprobe) {
      printRefusal('SERVICE_UNAVAILABLE', 503, `Records cannot be printed to a file: ${status.reason}`);
    }
    const driver = this.deps.driver!;
    const engine = this.deps.getEngine()!;
    const attachments = this.deps.getAttachments() as IFileAttachmentService & ICallerFileAttachmentService;
    const minter = this.deps.getMinter()!;
    const placement = this.deps.placement as Extract<PrintPlacementResolution, { state: 'configured' }>;

    // ③ The page.
    const req = validateRequest(request);
    const page = this.refuseUnlessPrintPage(engine, req);

    // ④ The record, read as the caller.
    await this.refuseUnlessReadable(engine, req, context);

    // ⑤ The files opt-in, and the attach rule for the caller.
    this.refuseUnlessFilesEnabled(engine, req.object);
    await attachments.assertMayAttach(req.object, req.recordId, context);

    // ② again, for an engine that failed its last probe: probe it now, so an
    // endpoint that came up after boot serves without a restart.
    if (reprobe) {
      const probed = await this.probe();
      if (probed.state !== 'ready') {
        printRefusal('SERVICE_UNAVAILABLE', 503, `Records cannot be printed to a file: ${probed.reason}`);
      }
    }

    // Mint, render, archive — and revoke, whatever happened.
    const filename = req.filename ?? `${req.page}-${req.recordId}.pdf`;
    const url = printPageUrl(placement.resolved.consoleUrl, req, page);
    const session: PrintSession = await minter.mint(context, PRINT_SESSION_TTL_SECONDS);
    try {
      const pdf = await driver.renderPdf({ url, cookie: session.cookie, timeoutMs: PRINT_RENDER_TIMEOUT_MS });
      const attached = await attachments.attachFileAs(
        {
          parentObject: req.object,
          parentId: req.recordId,
          organizationId: nonEmptyString(context.tenantId) ? context.tenantId : null,
          filename,
          mimeType: PDF_MIME_TYPE,
          data: pdf,
        },
        context,
      );
      return { fileId: attached.fileId, attachmentId: attached.attachmentId, size: attached.size, filename };
    } finally {
      await this.revokeQuietly(session, context);
    }
  }

  /**
   * End the minted session. A revoke that fails never replaces the print's own
   * outcome — the committed archive or the refusal — and is not silent either:
   * it is logged at `error`, naming the session by a fingerprint of its token
   * (never the token or the cookie), and the session's own TTL ends it.
   */
  private async revokeQuietly(session: PrintSession, context: ExecutionContext): Promise<void> {
    try {
      await session.revoke();
    } catch (err) {
      const fingerprint = createHash('sha256').update(session.token).digest('hex').slice(0, 12);
      const why = [session.token, session.cookie.value].reduce(
        (text, secret) => (secret ? text.split(secret).join('[redacted]') : text),
        String((err as Error)?.message ?? err),
      );
      this.deps.logger?.error(
        `[print] the session minted for user ${String(context.userId)} (fingerprint ${fingerprint}) could not be ` +
          `revoked: ${why}. It stays valid until it expires, at most ${PRINT_SESSION_TTL_SECONDS} s after the mint.`,
      );
    }
  }

  private refuseUnlessHumanCaller(context: ExecutionContext): void {
    const deny = (why: string): never =>
      printRefusal('PERMISSION_DENIED', 403, `A record can be printed to a file only by a signed-in user acting for themselves: ${why}.`);
    if (!context || typeof context !== 'object') deny('the call carries no execution context');
    if (context.isSystem === true) deny('the system context has no user to render the page as');
    if (!nonEmptyString(context.userId)) deny('the call carries no user');
    if (context.principalKind !== undefined && context.principalKind !== 'human') {
      deny(`the caller is a ${context.principalKind} principal, not a user`);
    }
    if (context.authGate) deny(`the user's sign-in is held by an authentication policy (${context.authGate.code})`);
  }

  private refuseUnlessPrintPage(engine: PrintEngine, req: ValidRequest): Record<string, unknown> {
    const page = engine.registry.getItem<Record<string, unknown>>('page', req.page);
    if (!page || typeof page !== 'object') {
      printRefusal('RESOURCE_NOT_FOUND', 404, `There is no page named '${req.page}'.`);
    }
    if (!isRecordPageOf(page, req.object)) {
      printRefusal(
        'VALIDATION_ERROR',
        400,
        `The page '${req.page}' is not a record page of '${req.object}' (type: 'record', object: '${req.object}'), ` +
          `so it cannot print a ${req.object} record.`,
      );
    }
    const print = page.print;
    if (!print || typeof print !== 'object' || Array.isArray(print)) {
      printRefusal(
        'VALIDATION_ERROR',
        400,
        `The page '${req.page}' does not declare 'print', so it is not a print page. Declare print on the page to print records on it.`,
      );
    }
    return page;
  }

  private async refuseUnlessReadable(
    engine: PrintEngine,
    req: ValidRequest,
    context: ExecutionContext,
  ): Promise<void> {
    let row: Record<string, unknown> | null;
    try {
      row = await engine.findOne(req.object, { where: { id: req.recordId } }, { context });
    } catch (err) {
      // A read the caller is refused answers exactly as a record that does not
      // exist: never a 403 that tells the two apart.
      if ((err as { status?: unknown })?.status === 403) throw recordNotFoundError(req.object, req.recordId);
      throw err;
    }
    if (!row) throw recordNotFoundError(req.object, req.recordId);
  }

  private refuseUnlessFilesEnabled(engine: PrintEngine, object: string): void {
    const def = engine.registry.getObject(object) as { enable?: { files?: unknown } } | undefined;
    if (def?.enable?.files !== true) {
      printRefusal(
        'FILES_DISABLED',
        403,
        `Files are not enabled on '${object}', so a printed PDF cannot be attached to its records. Declare ` +
          `enable: { files: true } on the object.`,
      );
    }
  }
}

type ValidRequest = Required<Omit<PrintRecordRequest, 'filename'>> & { filename?: string };

/** The request, checked field by field: a JavaScript caller can hand anything. */
function validateRequest(request: PrintRecordRequest): ValidRequest {
  const fail = (message: string): never => printRefusal('VALIDATION_ERROR', 400, `printRecordToFile: ${message}`);
  if (!request || typeof request !== 'object') fail('the request must be an object');
  for (const field of ['app', 'object', 'recordId', 'page'] as const) {
    if (!nonEmptyString(request[field])) fail(`'${field}' must be a non-empty string`);
  }
  if (request.filename !== undefined && !nonEmptyString(request.filename)) {
    fail("'filename' must be a non-empty string when given");
  }
  return request as ValidRequest;
}
