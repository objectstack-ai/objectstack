// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IEmailService,
  IEmailTransport,
  SendEmailInput,
  SendEmailResult,
  SendTemplateInput,
  NormalizedEmailMessage,
  EmailAddress,
  EmailDeliveryStatus,
  TransportSendResult,
  IQueueService,
  QueueBackoffPolicy,
} from '@objectstack/spec/contracts';
import { renderTemplate, requireVars, htmlToText } from './template-engine.js';
import {
  SYS_EMAIL_ATTACHMENT_LIMIT_BYTES,
  encodeAttachmentsForRow,
  encodeHeadersForRow,
  decodeAttachmentsFromRow,
  decodeAttachmentsFromRowAsync,
  decodeHeadersFromRow,
  storageKeysInColumn,
  type EncodedAttachments,
} from './sys-email-payload.js';
import {
  EMAIL_ATTACHMENT_RECLAIM_QUEUE,
  EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
  deleteAttachmentKeys,
  fetchAttachmentContent,
  offloadAttachmentsToStorage,
  type EmailAttachmentReclaimPayload,
  type EmailAttachmentStorage,
} from './attachment-storage.js';

/**
 * Queue topic durable email delivery is published to and consumed from
 * (#5160). Exported so producer (`EmailService.send` in queue mode) and
 * consumer (`EmailServicePlugin`'s subscriber) name it once.
 */
export const EMAIL_SEND_QUEUE = 'email.send.async';

/**
 * Payload published to {@link EMAIL_SEND_QUEUE}.
 *
 * It carries the **id of an already-persisted `sys_email` row**, never the
 * message itself. That is the whole point of the shape: the worker delivers
 * THAT row and finalizes it in place, so N queue retries of one message stay
 * one row with a cumulative `attempt_count`. The pre-#5160 subscriber called
 * `send()` with the raw input, which inserted a fresh row per retry.
 */
export interface EmailSendQueuePayload {
  /** `sys_email.id` of the row to deliver. */
  rowId: string;
}

/**
 * Queue-delivery wiring handed to {@link EmailService} by
 * `EmailServicePlugin`. Present ⇒ `send()` enqueues instead of delivering
 * inline; absent ⇒ today's inline path, byte for byte.
 */
export interface EmailQueueDelivery {
  /**
   * Resolve the live queue service, or `undefined` when none can carry a
   * durable job. Resolved **per send**, never captured once: the queue
   * service is replaced during boot (`QueueServicePlugin` upgrades its
   * in-memory placeholder to the DB adapter on `kernel:ready`), and a
   * handle captured early would publish into the discarded one.
   */
  resolve(): IQueueService | undefined;
  /**
   * Total delivery attempts the QUEUE makes before the message goes to the
   * DLQ. In queue mode this is the ONLY retry budget: the per-row loop in
   * {@link EmailService.deliverPersistedRow} is pinned to a single attempt
   * per delivery, so the two layers cannot multiply (#5160).
   */
  maxAttempts: number;
  /** Backoff between queue attempts. */
  backoff: QueueBackoffPolicy;
}

/**
 * Per-call attempt accounting for {@link EmailService.deliverPersistedRow}.
 *
 * Both fields default to today's behaviour (`priorAttempts: 0`,
 * `maxAttempts: retries + 1`), so every existing caller is unaffected.
 */
export interface DeliverAttemptOptions {
  /**
   * Transport attempts to make in THIS call. The queue worker passes `1` —
   * it owns retrying, the row loop must not retry underneath it.
   */
  maxAttempts?: number;
  /**
   * Attempts already spent on this row by earlier calls, so `attempt_count`
   * accumulates across queue redeliveries instead of resetting to 1.
   */
  priorAttempts?: number;
}

/**
 * Reconstructing a `sys_email` row into a sendable message needs the
 * `file-storage` capability once a row's attachments live out of it (#5172),
 * and that is asynchronous — hence this async twin of {@link rowToNormalized}.
 *
 * `fetchContent` absent ⇒ a row that needs storage fails, loudly, exactly as
 * it does through the synchronous entry point. It is never optional in the
 * sense of "skip the attachment".
 */
export interface RowToNormalizedOptions {
  fetchContent?: (storageKey: string) => Promise<Buffer>;
}

/**
 * Internal persistence shim — typed loosely so the service can run
 * without an ObjectQL engine wired (e.g. unit tests, serverless).
 *
 * ## `insert` must return the row's own id (#5523)
 *
 * The id is **minted by the service**, written into `row.id`, and is already
 * load-bearing by the time `insert` is called: out-of-row attachment content
 * has been uploaded under `sys_email/attachments/<row.id>/…` *before* the
 * insert, so the row id is the only key that finds those bytes again.
 *
 * `insert` therefore **must** answer with that same id — `{ id: row.id }` (or
 * `row.id`). The return value is a **confirmation**, not an opportunity to
 * substitute an id of the implementation's own: returning a different one makes
 * `send()` throw, naming this contract and the id returned, before the message
 * is delivered.
 *
 * Why the contract is this way round, rather than the service adopting whatever
 * id came back: the `sys_email` `afterInsert` outbox drain hook decides whether
 * a freshly-inserted row is the service's to deliver by asking
 * {@link EmailService.isServiceManaged} about **the inserted row's own id**. An
 * implementation that re-keyed the row would hand the hook an id the service
 * had never reserved, the hook would read the row as an application-inserted
 * outbox entry, and the same message would go out twice — once from the hook,
 * once from `send()` — with two terminal updates racing on one row.
 *
 * A store that insists on assigning its own primary key is still supportable:
 * keep the service-minted id as the row's `id` and record the store's key in a
 * column of its own. What is not supportable is silently changing the identity
 * the rest of the pipeline has already committed to.
 */
export interface EmailPersistence {
  /**
   * Persist `row` and confirm it by returning **`row.id`** — see the contract
   * on {@link EmailPersistence}. Returning any other id throws.
   */
  insert(row: Record<string, any>): Promise<{ id: string } | string>;
  update?(id: string, patch: Record<string, any>): Promise<void>;
}

/**
 * Enforce {@link EmailPersistence}'s `insert` contract: the confirmation must
 * name the row the service asked to have inserted.
 *
 * Scope is deliberate — this judges the **value** of the confirmation, not its
 * presence. A confirmation that names no id at all (`undefined`/`null`, only
 * reachable from an untyped JS implementation, since the declared return type
 * requires one) leaves nothing to disagree with and is treated as confirmed:
 * the drain hook reads the id off the **inserted row**, which is the minted one
 * either way, so no double-send is reachable that way. The defect this closes
 * is a *different* id, and that is what it rejects.
 *
 * @throws Error naming the contract, the id returned, and the id expected.
 */
function assertInsertConfirmedRowId(res: { id: string } | string | undefined, rowId: string): void {
  const returned = typeof res === 'string' ? res : res == null ? undefined : res.id;
  if (returned == null) return;
  const confirmed = String(returned);
  if (confirmed === rowId) return;
  throw new Error(
    'EmailService: EmailPersistence.insert must return the row\'s own id — it returned '
    + `'${confirmed}' for a row inserted as '${rowId}'. The return value is a CONFIRMATION only: the id is `
    + 'minted by the service before the insert (out-of-row attachment content is already stored under '
    + `'sys_email/attachments/${rowId}/…'), and re-keying the row makes the sys_email outbox drain hook read it `
    + 'as an application-inserted entry — delivering the same message a second time. Fix: return '
    + '`{ id: row.id }` (or `row.id`) from insert; if your store assigns its own primary key, keep the '
    + 'service id in the row\'s `id` column and record the store\'s key in a column of its own.',
  );
}

/**
 * Naive RFC-5322 validator — good enough to catch obvious typos.
 * Defers full validation to the transport / receiving MTA.
 */
// Linear-time email check. Domain labels exclude '.', so the quantifiers on
// either side of each '.' can't overlap — this avoids the polynomial
// backtracking (ReDoS) of the naive `[^\s@]+\.[^\s@]+` shape.
const EMAIL_REGEX = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * Format an EmailAddress (string or {name,address}) into the canonical
 * `"Display" <addr>` form. Throws if address is malformed.
 */
export function formatAddress(addr: EmailAddress): string {
  const obj = typeof addr === 'string' ? { address: addr } : addr;
  const address = String(obj.address ?? '').trim();
  if (!EMAIL_REGEX.test(address)) {
    throw new Error(`Invalid email address: ${address || '(empty)'}`);
  }
  const name = obj.name?.trim();
  if (!name) return address;
  // Quote display name if it contains characters that need quoting
  const needsQuote = /[",()<>@:;.\\\[\]]/.test(name);
  const quoted = needsQuote ? `"${name.replace(/"/g, '\\"')}"` : name;
  return `${quoted} <${address}>`;
}

function listToArray(v: EmailAddress | EmailAddress[] | undefined): string[] | undefined {
  if (v === undefined) return undefined;
  const arr = Array.isArray(v) ? v : [v];
  return arr.map(formatAddress);
}

/**
 * Validate input + apply default-from + canonicalize recipients.
 * Throws Error('VALIDATION_FAILED: <reason>') for malformed payloads.
 */
export function normalizeMessage(
  input: SendEmailInput,
  defaultFrom?: EmailAddress,
): NormalizedEmailMessage {
  if (!input || typeof input !== 'object') {
    throw new Error('VALIDATION_FAILED: input must be an object');
  }
  const subject = String(input.subject ?? '').trim();
  if (!subject) throw new Error('VALIDATION_FAILED: subject is required');
  if (!input.text && !input.html) {
    throw new Error('VALIDATION_FAILED: at least one of text or html is required');
  }
  const toArr = listToArray(input.to);
  if (!toArr || toArr.length === 0) {
    throw new Error('VALIDATION_FAILED: at least one recipient (to) is required');
  }
  const fromCandidate = input.from ?? defaultFrom;
  if (!fromCandidate) {
    throw new Error('VALIDATION_FAILED: from address required (set options.defaultFrom or pass input.from)');
  }
  const from = formatAddress(fromCandidate);

  const msg: NormalizedEmailMessage = {
    to: toArr,
    from,
    subject,
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.html !== undefined ? { html: input.html } : {}),
  };
  const cc = listToArray(input.cc);
  if (cc && cc.length > 0) msg.cc = cc;
  const bcc = listToArray(input.bcc);
  if (bcc && bcc.length > 0) msg.bcc = bcc;
  if (input.replyTo) msg.replyTo = formatAddress(input.replyTo);
  if (input.attachments && input.attachments.length > 0) msg.attachments = input.attachments;
  if (input.headers && Object.keys(input.headers).length > 0) msg.headers = input.headers;
  return msg;
}

/** Split a persisted comma-separated address column back into a list. */
function splitAddresses(v: unknown): string[] {
  if (v == null) return [];
  return String(v)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Reconstruct a NormalizedEmailMessage from a persisted `sys_email` row
 * (the outbox-drain path). Addresses are already canonicalized at insert
 * time, so this re-splits the stored columns rather than re-validating.
 * Throws when the row lacks the minimum fields needed to send.
 */
export function rowToNormalized(row: Record<string, any>): NormalizedEmailMessage {
  const msg = rowEnvelope(row);
  // Headers and attachments (#5177). Both decoders return `undefined` for a
  // row that simply has no such column — every row written before #5177 — and
  // THROW for a column that is present but does not describe what it claims
  // to. Throwing here is the point: the caller (`deliverPersistedRow`) turns
  // it into a `failed` row carrying the reason, which is strictly better than
  // handing the transport a message with an attachment quietly missing.
  //
  // A row whose attachments live in storage (#5172) also throws here: this
  // entry point cannot fetch, and "cannot fetch" must never quietly become
  // "send it without". Use {@link rowToNormalizedAsync} where a fetch is
  // possible.
  const attachments = decodeAttachmentsFromRow(row.attachments_json);
  if (attachments) msg.attachments = attachments;
  return msg;
}

/**
 * {@link rowToNormalized}, able to fetch out-of-row attachment content
 * (#5172).
 *
 * The two share ONE validator (`readAttachmentColumn`) and one verifier
 * (`materializeAttachment`), so a storage-backed attachment is checked against
 * `size` and `hash` exactly as an in-row one is — a backend that returns a
 * truncated object is as unacceptable as a truncated column.
 */
export async function rowToNormalizedAsync(
  row: Record<string, any>,
  opts?: RowToNormalizedOptions,
): Promise<NormalizedEmailMessage> {
  const msg = rowEnvelope(row);
  const attachments = await decodeAttachmentsFromRowAsync(row.attachments_json, opts?.fetchContent);
  if (attachments) msg.attachments = attachments;
  return msg;
}

/** Everything a row says about a message except its attachments. */
function rowEnvelope(row: Record<string, any>): NormalizedEmailMessage {
  const to = splitAddresses(row.to_addresses);
  if (to.length === 0) throw new Error('VALIDATION_FAILED: row has no to_addresses');
  const from = String(row.from_address ?? '').trim();
  if (!from) throw new Error('VALIDATION_FAILED: row has no from_address');
  const subject = String(row.subject ?? '').trim();
  if (!subject) throw new Error('VALIDATION_FAILED: row has no subject');
  const text = row.body_text;
  const html = row.body_html;
  if ((text == null || text === '') && (html == null || html === '')) {
    throw new Error('VALIDATION_FAILED: row has neither body_text nor body_html');
  }
  const msg: NormalizedEmailMessage = {
    to,
    from,
    subject,
    ...(text != null && text !== '' ? { text: String(text) } : {}),
    ...(html != null && html !== '' ? { html: String(html) } : {}),
  };
  const cc = splitAddresses(row.cc_addresses);
  if (cc.length > 0) msg.cc = cc;
  const bcc = splitAddresses(row.bcc_addresses);
  if (bcc.length > 0) msg.bcc = bcc;
  if (row.reply_to) msg.replyTo = String(row.reply_to);
  const headers = decodeHeadersFromRow(row.headers_json);
  if (headers) msg.headers = headers;
  return msg;
}

/**
 * Development transport — never actually sends. Logs to the provided
 * logger and returns a synthetic Message-ID. Useful for local dev,
 * tests, and "dry run" environments.
 */
export class LogTransport implements IEmailTransport {
  private counter = 0;
  constructor(private readonly logger?: { info: (msg: string, meta?: any) => void }) {}
  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    const messageId = `<dev-${Date.now()}-${++this.counter}@objectstack.local>`;
    this.logger?.info('[LogTransport] would send email', {
      messageId,
      to: message.to,
      from: message.from,
      subject: message.subject,
      hasText: !!message.text,
      hasHtml: !!message.html,
      attachments: message.attachments?.length ?? 0,
    });
    return { messageId, response: 'logged' };
  }
}

/**
 * Generate a UUID-like id without pulling crypto in test contexts.
 * Uses crypto.randomUUID when available, falls back to a v4-shaped
 * random string. NOT cryptographically secure when the fallback is
 * used; the only consumer is local row identifiers, never tokens.
 */
function newId(): string {
  try {
    const g = (globalThis as any).crypto;
    if (g?.randomUUID) return g.randomUUID();
  } catch { /* fall through */ }
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/**
 * The locale a template resolves to when the caller names none.
 *
 * Declared, not inferred: `SendTemplateInput.locale` (spec contract),
 * `EmailTemplateDefinitionSchema.locale` and the `sys_email_template` object
 * doc all say the service falls back to `en-US`. #7731 is what happened while
 * one seam of the chain answered "whichever row the driver yields first"
 * instead — a no-locale send rendered zh-CN out of an en-US + zh-CN bundle.
 */
export const DEFAULT_TEMPLATE_LOCALE = 'en-US';

/**
 * Loader for sys_email_template rows. Injected by EmailServicePlugin
 * on `kernel:ready`. Returns the best-matching row for `(name, locale)`
 * or `null` when none exists / inactive.
 *
 * `locale` set → an EXACT match for that locale, or `null`; the en-US fallback
 * lives in {@link EmailService.sendTemplate}'s ladder rather than in the
 * loader, so a replacement loader cannot relocate the documented default.
 * `locale` undefined → the loader's own deterministic best answer for the name
 * (see `createSysEmailTemplateLoader`), which `sendTemplate` consults only as a
 * last resort, when the bundle carries no en-US row at all.
 */
export interface TemplateLoader {
  load(name: string, locale: string | undefined): Promise<EmailTemplateRow | null>;
}

/**
 * Row shape returned by the loader — mirrors sys_email_template
 * columns relevant to rendering.
 */
export interface EmailTemplateRow {
  name: string;
  locale: string;
  subject: string;
  body_html: string;
  body_text?: string | null;
  from_name?: string | null;
  from_address?: string | null;
  reply_to?: string | null;
  active?: boolean;
  variables_json?: string | null;
}

export interface EmailServiceOptions {
  transport: IEmailTransport;
  defaultFrom?: EmailAddress;
  /** Persist each attempt to sys_email. Omit to disable persistence. */
  persistence?: EmailPersistence;
  /** Resolve named templates for sendTemplate(). Omit to disable templates. */
  templateLoader?: TemplateLoader;
  /** Retry attempts on transport throw. Default 0 (no retry). */
  retries?: number;
  /** Logger for diagnostic output. */
  logger?: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void; error?: (msg: string, meta?: any) => void };
  /** Default render context merged into every sendTemplate call (e.g. `{ appName }`). */
  defaultTemplateContext?: Record<string, unknown>;
  /**
   * Durable delivery through the `queue` service (#5160). Set ⇒ `send()`
   * persists the `sys_email` row, publishes {@link EMAIL_SEND_QUEUE}
   * referencing it, and returns `status: 'queued'` immediately. Unset ⇒
   * inline delivery (the default, unchanged).
   */
  queueDelivery?: EmailQueueDelivery;
  /**
   * Out-of-row attachment content through the `file-storage` capability
   * (#5172). Set ⇒ a message whose attachments exceed
   * {@link SYS_EMAIL_ATTACHMENT_LIMIT_BYTES} can still be queued, with its
   * content in storage and a reference on the row. Unset (or unresolvable) ⇒
   * such a message keeps falling back to inline delivery, whole, and the
   * fallback says why.
   *
   * Only ever consulted in queue mode: out-of-row content exists to make
   * DURABLE delivery possible, and inline delivery already has the message in
   * memory.
   */
  attachmentStorage?: EmailAttachmentStorage;
}

/**
 * Concrete IEmailService implementation.
 *
 * Inline flow (the default):
 *   1. Validate + normalize input (throws on bad input).
 *   2. Persist queued row to sys_email (best-effort; failures logged).
 *   3. Call transport.send(); on success, update row to sent +
 *      timestamp + messageId. On failure, mark failed + error.
 *   4. Return SendEmailResult with the persisted row id (or a fresh
 *      id when persistence is disabled).
 *
 * Queue flow (`options.queueDelivery` wired, #5160) — steps 1-2 identical,
 * then publish {@link EMAIL_SEND_QUEUE} referencing the row and return
 * `status: 'queued'`. A worker later calls {@link deliverPersistedRow} on
 * that same row, so step 3 happens out of process and survives a restart.
 *
 * **Retries live in exactly one layer.** Inline, `options.retries` drives the
 * loop in `deliverNormalized`. Queued, the SAME number becomes the queue's
 * `maxAttempts` (`retries + 1` total attempts) and the row loop is pinned to
 * one attempt per delivery. Flipping the mode changes WHERE a retry happens
 * — durable and backed off, instead of in-process and capped at 2s — never
 * HOW MANY happen, and the two layers can never multiply into 5x5.
 */
export class EmailService implements IEmailService {
  /**
   * Row ids the service is itself delivering (via `send()`). The
   * EmailServicePlugin's sys_email afterInsert drain hook consults this
   * set and skips these rows, so a service-originated `queued` insert is
   * delivered exactly once (by `send()`) — never double-sent by the hook.
   * App-originated raw inserts are absent here, so the hook handles them.
   */
  private readonly managedRowIds = new Set<string>();

  /**
   * Set once queue delivery has been reported as unavailable, so the
   * degradation is stated at the FIRST send and not on every one
   * (AGENTS.md — "say it once, at the first degradation").
   */
  private queueDegradationReported = false;

  /**
   * Set once an attachment OFFLOAD failure has been reported, so a flapping
   * storage backend states the degradation at its first message instead of on
   * every one. Re-armed by {@link setQueueDelivery} /
   * {@link setAttachmentStorage}, i.e. whenever the operator changes the
   * configuration this verdict was about.
   */
  private attachmentStorageDegradationReported = false;

  constructor(public options: EmailServiceOptions) {
    if (!options.transport) throw new Error('EmailService: transport is required');
  }

  /** True when this row id is currently being delivered by `send()`. */
  isServiceManaged(id: string): boolean {
    return this.managedRowIds.has(id);
  }

  /** Wire (or replace) the template loader after construction. */
  setTemplateLoader(loader: TemplateLoader): void {
    this.options.templateLoader = loader;
  }

  /** Wire (or replace) persistence after construction. */
  setPersistence(persistence: EmailPersistence | undefined): void {
    this.options.persistence = persistence;
  }

  /**
   * Hot-swap the underlying transport. Used by EmailServicePlugin when
   * the `mail` settings namespace changes (e.g. SMTP host updated in
   * the admin UI) so subsequent `send()` calls go through the new
   * transport without restarting the process.
   */
  setTransport(transport: IEmailTransport): void {
    this.options.transport = transport;
  }

  /** Replace the default `from` address used when callers omit `input.from`. */
  setDefaultFrom(from: EmailAddress | undefined): void {
    this.options.defaultFrom = from;
  }

  /**
   * Turn durable queue delivery on (pass the wiring) or off (pass
   * `undefined`) on a running service — the `mail` settings toggle path.
   * Re-arms the one-shot degradation report so a re-enable is allowed to
   * speak again.
   */
  setQueueDelivery(queueDelivery: EmailQueueDelivery | undefined): void {
    this.options.queueDelivery = queueDelivery;
    this.queueDegradationReported = false;
    this.attachmentStorageDegradationReported = false;
  }

  /**
   * Wire (or unwire) out-of-row attachment storage on a running service
   * (#5172). Re-arms the one-shot degradation report, so mounting storage
   * after a complaint is allowed to complain again if it still cannot work.
   */
  setAttachmentStorage(attachmentStorage: EmailAttachmentStorage | undefined): void {
    this.options.attachmentStorage = attachmentStorage;
    this.attachmentStorageDegradationReported = false;
  }

  /**
   * Send through the configured delivery mode: durable queue when
   * {@link EmailServiceOptions.queueDelivery} is wired AND usable,
   * inline otherwise.
   */
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    return this.sendInternal(input, true);
  }

  /**
   * Send **synchronously through the transport**, never the queue.
   *
   * Two callers need this regardless of the configured mode:
   *  - `mail/test` — the "Send test email" button must answer with the SMTP
   *    server's own words ("535 authentication failed"), and "queued" is
   *    exactly the kind of non-answer #5087 removed from that button;
   *  - the `email.send.async` subscriber's legacy arm, where the payload is a
   *    raw `SendEmailInput` — routing that back through `send()` in queue
   *    mode would re-publish the message it is currently consuming.
   */
  async sendInline(input: SendEmailInput): Promise<SendEmailResult> {
    return this.sendInternal(input, false);
  }

  private async sendInternal(input: SendEmailInput, allowQueue: boolean): Promise<SendEmailResult> {
    let normalized: NormalizedEmailMessage;
    try {
      normalized = normalizeMessage(input, this.options.defaultFrom);
    } catch (err: any) {
      // Validation failures must surface to the caller.
      throw err;
    }

    // Encode the attachments ONCE (#5177). The same verdict answers both
    // questions that follow — "may this message be queued?" and "what goes in
    // `attachments_json`?" — so the row can never disagree with the routing
    // decision (e.g. an over-limit message queued against a column that was
    // never written).
    //
    // Skipped entirely without persistence: there is no row to write the
    // column to and no queue job that could reference one (queue delivery
    // reports that as its own degradation, below), so base64-ing a large
    // attachment for nobody is pure cost on the path that opted out of
    // persistence.
    let encodedAttachments: EncodedAttachments = this.options.persistence
      ? encodeAttachmentsForRow(normalized.attachments)
      : { kind: 'none' };

    // The row id is minted BEFORE the offload because the storage key embeds
    // it (`sys_email/attachments/<rowId>/…`) and the content must be in place
    // before the row that references it is inserted. The other order — insert,
    // then upload, then patch the row — would make a `queued` row observable
    // while it under-describes its own message, which the boot sweep would
    // then deliver stripped.
    const id = newId();

    // ── OUT-OF-ROW ATTACHMENT CONTENT (#5172) ──────────────────────────────
    // Over the in-row budget, in queue mode, with the file-storage capability
    // mounted: the content goes to storage and the row carries a reference, so
    // this message gets the same durability as every other. Anything missing
    // here leaves `over-limit` standing — inline delivery, whole, with the
    // reason attached to the one line the operator sees.
    if (allowQueue && encodedAttachments.kind === 'over-limit') {
      encodedAttachments = await this.offloadAttachments(id, normalized, encodedAttachments);
    }

    // `undefined` ⇒ every statement below is the pre-#5160 inline path.
    const queue = allowQueue ? this.resolveQueueForSend(encodedAttachments) : undefined;
    const headersJson = encodeHeadersForRow(normalized.headers);
    const baseRow: Record<string, any> = {
      id,
      from_address: normalized.from,
      to_addresses: normalized.to.join(', '),
      ...(normalized.cc?.length ? { cc_addresses: normalized.cc.join(', ') } : {}),
      ...(normalized.bcc?.length ? { bcc_addresses: normalized.bcc.join(', ') } : {}),
      ...(normalized.replyTo ? { reply_to: normalized.replyTo } : {}),
      subject: normalized.subject,
      ...(normalized.text !== undefined ? { body_text: normalized.text } : {}),
      ...(normalized.html !== undefined ? { body_html: normalized.html } : {}),
      // Written in BOTH delivery modes, not only the queued one. Two reasons:
      // the row is the audit record of what was actually sent, and the boot
      // sweep (#5161) re-delivers stranded rows in inline mode too — a row
      // that survived a crash without its headers/attachments would be
      // re-sent stripped, which is the exact loss these columns exist to
      // prevent. Over-limit attachments store NOTHING (see the verdict
      // above), so the row stays bounded.
      ...(headersJson !== undefined ? { headers_json: headersJson } : {}),
      ...(encodedAttachments.kind === 'inline' || encodedAttachments.kind === 'storage'
        ? { attachments_json: encodedAttachments.json }
        : {}),
      ...(input.relatedObject ? { related_object: input.relatedObject } : {}),
      ...(input.relatedId ? { related_id: input.relatedId } : {}),
      ...(input.sentBy ? { sent_by: input.sentBy } : {}),
      status: 'queued',
      attempt_count: 0,
    };

    // Reserve the row id BEFORE persistence.insert so the drain hook
    // (which fires synchronously inside that insert) sees it as managed
    // and skips it — `send()` owns this row's delivery.
    //
    // ONE id, reserved once and released once. `EmailPersistence.insert` is
    // contractually required to confirm the id it was handed (#5523), so there
    // is no second identity for this row to reserve: the drain hook, the boot
    // outbox sweep, the attachment storage keys and the queued job all name
    // `id`. An implementation that returns something else is rejected below,
    // before delivery — the service does not adopt the substitute.
    this.managedRowIds.add(id);
    try {
      // Did the row land? That is the only thing the insert's answer tells us
      // (the id is already known), so it is a boolean and not an id.
      let rowPersisted = false;
      if (this.options.persistence) {
        let res: { id: string } | string | undefined;
        let insertThrew = false;
        try {
          res = await this.options.persistence.insert(baseRow);
        } catch (err: any) {
          insertThrew = true;
          this.options.logger?.warn('EmailService: sys_email persist failed (non-fatal)', { error: err?.message });
        }
        if (!insertThrew) {
          // Deliberately OUTSIDE the catch above. An insert that *fails* is an
          // operational condition the service is built to ride out (the mail
          // still goes, inline, with a warning). An insert that succeeds while
          // renaming the row is a WIRING defect: tolerate it and the drain hook
          // double-sends this very message. So it escapes the non-fatal path,
          // and it is raised here — before any delivery below — rather than
          // after the second copy has already gone out.
          assertInsertConfirmedRowId(res, id);
          rowPersisted = true;
        }
      }
      const storageKeys = encodedAttachments.kind === 'storage' ? encodedAttachments.keys : [];
      if (!rowPersisted && storageKeys.length > 0) {
        // Content was uploaded for a row that does not exist. No row will ever
        // reference these bytes, so nothing will ever reclaim them either —
        // delete them here rather than create the one orphan class this design
        // is built to make impossible.
        await this.discardOrphanedAttachmentContent(storageKeys, 'the sys_email row could not be persisted');
      }
      if (queue) {
        // Queue mode delivers the ROW, so a row that never landed leaves the
        // job with nothing to reference. Deliver inline instead of publishing
        // a job that can only fail — the insert failure was already reported
        // above, and dropping the message would be the worse answer.
        if (!rowPersisted) {
          this.reportQueueDegradation(
            'the sys_email row could not be persisted, so a queued job would have nothing to deliver',
          );
        } else if (await this.publishRow(queue, id)) {
          // The row is in the database at `queued` and the job is in the
          // queue's own store: a process death here loses neither.
          return { id, status: 'queued' };
        }
      }
      // Inline delivery of a message whose content IS in storage (the publish
      // failed, or queue mode is off for this send): the in-memory message is
      // still whole, so the mail goes out — and the content still has to be
      // reclaimed afterwards, which is why the keys travel with the delivery.
      return await this.deliverNormalized(id, normalized, undefined, storageKeys);
    } finally {
      // Release EXACTLY what was reserved above — the one id, and only here.
      // Here and not earlier: the reservation has to outlive the whole body,
      // because in inline mode the delivery (and the `sent`/`failed` update of
      // this very row) happens inside the try, and a sweep that ran mid-flight
      // must still see the row as `send()`'s. Once this returns, ownership is
      // over in both modes: inline delivery is finished, and a queued row is
      // the worker's — with the row committed at `queued`, re-checkable, which
      // is what makes the boot sweep a backstop rather than a double-send.
      this.managedRowIds.delete(id);
    }
  }

  /**
   * Resolve the queue to publish THIS message to, or `undefined` to deliver
   * it inline.
   *
   * Returning `undefined` is never silent when queue delivery was asked for,
   * but the level distinguishes two different things:
   *
   *  - the wiring is **broken** (no queue service, no persistence) — the
   *    durability the operator switched on is not in force while everything
   *    still looks normal, so that is reported at `error`, once, with the fix;
   *  - this one message is **outside what a row can carry** (attachments over
   *    the budget) — nothing regressed, the outcome is exactly the pre-#5160
   *    inline path, so it is stated at `info`.
   *
   * Mail keeps flowing either way — what degrades is persistence of the
   * retry, not delivery, so a missing queue must not become a missing email.
   */
  private resolveQueueForSend(encodedAttachments: EncodedAttachments): IQueueService | undefined {
    const wiring = this.options.queueDelivery;
    if (!wiring) return undefined;

    // Custom headers are NO LONGER a reason to refuse the queue (#5177):
    // `headers_json` carries them and `rowToNormalized` rebuilds them.
    //
    // Attachments are queueable too, up to the row budget. Past it, the row
    // deliberately carries nothing, so a queued job could only deliver the
    // message stripped — silent data loss dressed as durability. Fall back to
    // inline delivery, where the in-memory message is still whole. This is
    // not a failure and does not degrade anything that was previously
    // working: the outcome is exactly today's behaviour, which is why it is
    // stated at `info` and not `error`.
    if (encodedAttachments.kind === 'over-limit') {
      this.options.logger?.info(
        `EmailService: queue delivery skipped for one message — its attachments total `
        + `${encodedAttachments.totalBytes} bytes, over the ${SYS_EMAIL_ATTACHMENT_LIMIT_BYTES}-byte limit a `
        + 'sys_email row carries, so the message was delivered inline (in-process retries only) rather than '
        + 'queued without them. Content that large is queueable through the file-storage capability (#5172), '
        + `but ${encodedAttachments.storageDetail ?? 'that path was not attempted for this message'}. `
        + 'Fix: mount the file-storage capability (@objectstack/service-storage) so large attachments are '
        + 'stored out of the row and the message can be delivered durably.',
      );
      return undefined;
    }
    if (encodedAttachments.kind === 'unsupported') {
      this.options.logger?.info(
        'EmailService: queue delivery skipped for one message — '
        + `${encodedAttachments.detail}, so it cannot be reconstructed from a sys_email row. The message was `
        + 'delivered inline (in-process retries only) rather than queued without the attachment.',
      );
      return undefined;
    }

    if (!this.options.persistence) {
      this.reportQueueDegradation(
        'sys_email persistence is disabled, so there is no row for a queued job to reference',
      );
      return undefined;
    }
    const queue = wiring.resolve();
    if (!queue) {
      this.reportQueueDegradation('no durable queue service is available');
      return undefined;
    }
    return queue;
  }

  /**
   * Try to move an over-budget message's attachment content out of the row and
   * into the `file-storage` capability (#5172).
   *
   * Returns a `storage` verdict on success, and the ORIGINAL `over-limit`
   * verdict — annotated with why — on every failure. That asymmetry is the
   * maintainer's ruling made mechanical: a message the platform cannot store
   * out of row is delivered **inline, whole, loudly**, never queued against a
   * row that does not carry it.
   */
  private async offloadAttachments(
    rowId: string,
    normalized: NormalizedEmailMessage,
    overLimit: Extract<EncodedAttachments, { kind: 'over-limit' }>,
  ): Promise<EncodedAttachments> {
    // Storage-backed content only pays for itself when there is a row to
    // reference it AND a durable queue to deliver that row. Without either,
    // uploading would buy nothing and still cost an upload: the message is
    // about to be delivered inline from memory, and the two degradations that
    // led here are already reported by `resolveQueueForSend`.
    if (!this.options.persistence || !this.options.queueDelivery) return overLimit;
    if (!this.options.queueDelivery.resolve()) return overLimit;

    const storage = this.options.attachmentStorage?.resolve();
    if (!storage) {
      return {
        ...overLimit,
        storageDetail: 'no file-storage capability is mounted, so there is nowhere to put the content',
      };
    }

    const offloaded = await offloadAttachmentsToStorage(normalized.attachments, rowId, storage);
    if (offloaded.kind === 'storage') {
      return {
        kind: 'storage',
        json: offloaded.json,
        keys: offloaded.keys,
        totalBytes: offloaded.totalBytes,
      };
    }

    // Storage IS mounted and it did not work. Unlike "not configured", this is
    // a fault: the durability the operator paid for is not in force while
    // everything else looks normal, so it is stated at `error`, once.
    this.reportAttachmentStorageDegradation(offloaded.detail);
    return { ...overLimit, storageDetail: offloaded.detail };
  }

  /**
   * Delete attachment content that no row will ever reference.
   *
   * Reported at `error` when it cannot be deleted: bytes that were meant to be
   * temporary have silently become permanent, in a bucket somebody pays for,
   * with nothing left pointing at them.
   */
  private async discardOrphanedAttachmentContent(keys: string[], because: string): Promise<void> {
    const storage = this.options.attachmentStorage?.resolve();
    if (!storage) return;
    const { failed } = await deleteAttachmentKeys(storage, keys);
    if (failed.length === 0) return;
    this.options.logger?.error?.(
      `EmailService: ${failed.length} attachment storage object(s) were uploaded but ${because}, and they could `
      + 'not be deleted again: '
      + failed.map((f) => `'${f.key}' (${f.error})`).join('; ')
      + '. Nothing references those bytes and nothing will ever reclaim them. Fix: delete them by hand under '
      + 'the sys_email/attachments/ prefix, and check why the file-storage backend is refusing deletes.',
    );
  }

  /** State an attachment-offload degradation once, at `error`. See {@link reportQueueDegradation}. */
  private reportAttachmentStorageDegradation(detail: string): void {
    if (this.attachmentStorageDegradationReported) return;
    this.attachmentStorageDegradationReported = true;
    this.options.logger?.error?.(
      `EmailService: a message's attachments could not be stored out of row — ${detail}. The message was `
      + 'still SENT, inline and whole, but it did not get durable queue delivery: a failure would be retried '
      + 'only in this process and lost if it dies. Fix: check the file-storage capability '
      + '(@objectstack/service-storage — credentials, bucket, disk), or accept inline delivery for messages '
      + `with attachments over ${SYS_EMAIL_ATTACHMENT_LIMIT_BYTES} bytes.`,
    );
  }

  /**
   * Publish the job that owns this row's delivery. Returns false when the
   * publish failed, in which case the caller delivers inline — the row is
   * already committed at `queued`, and leaving it for nobody to pick up is
   * the durability gap this feature exists to close.
   */
  private async publishRow(queue: IQueueService, rowId: string): Promise<boolean> {
    const wiring = this.options.queueDelivery;
    if (!wiring) return false;
    try {
      await queue.publish<EmailSendQueuePayload>(EMAIL_SEND_QUEUE, { rowId }, {
        maxAttempts: wiring.maxAttempts,
        // `maxAttempts` is the canonical field; `retries` is its legacy
        // spelling and is the ONLY one `MemoryQueueAdapter` reads. Both are
        // declared on QueuePublishOptions, so filling both consistently is
        // completing the contract, not tolerating a dialect — publishing one
        // budget that some adapters silently read as 1 would be the lie.
        retries: Math.max(0, wiring.maxAttempts - 1),
        backoff: wiring.backoff,
        // One row, one job: a re-publish for the same row (a retried caller,
        // a redelivered upstream event) collapses onto the existing message
        // instead of racing a second worker onto the same sys_email row.
        idempotencyKey: `sys_email:${rowId}`,
        metadata: { object: 'sys_email', rowId },
      });
      return true;
    } catch (err: any) {
      this.reportQueueDegradation(
        `publishing to '${EMAIL_SEND_QUEUE}' failed (${String(err?.message ?? err)})`,
      );
      return false;
    }
  }

  /**
   * Hand an ALREADY-PERSISTED `sys_email` row to the durable queue — the boot
   * sweep's producer entry point (#5161). Returns `false` when queue delivery
   * is not in force (or the publish failed), which is the caller's signal to
   * deliver the row inline instead.
   *
   * Deliberately routed through the same {@link publishRow} as `send()`: ONE
   * producer of {@link EmailSendQueuePayload}, one set of publish options, one
   * `sys_email:<id>` idempotency key. A second publisher spelling the payload
   * its own way is exactly how the two halves of a queue drift apart — and the
   * shared key is what makes sweeping a row that still has a pending job
   * collapse onto that job instead of racing a second worker onto the row.
   */
  async enqueuePersistedRow(rowId: string): Promise<boolean> {
    if (!rowId) return false;
    const queue = this.options.queueDelivery?.resolve();
    if (!queue) return false;
    return this.publishRow(queue, rowId);
  }

  /**
   * State a queue-delivery degradation once, at `error`.
   *
   * `error` and not `warn`: from the outside everything still looks normal —
   * `send()` returns, the row is written, the mail goes out — while the
   * durable-retry guarantee the operator switched on is not in force. That is
   * the durability class AGENTS.md pins at `error`, and the line owes both the
   * consequence and the fix.
   */
  private reportQueueDegradation(reason: string): void {
    if (this.queueDegradationReported) return;
    this.queueDegradationReported = true;
    this.options.logger?.error?.(
      `EmailService: queue delivery is enabled but ${reason} — mail is still being SENT, inline, but a send `
      + 'that fails is retried only in this process and is lost if it dies (no sys_job_queue job, no DLQ). '
      + 'Fix: mount the queue capability with a durable adapter (@objectstack/service-queue with an ObjectQL '
      + 'engine, so it upgrades to the sys_job_queue-backed DbQueueAdapter), or turn Settings → Mail → '
      + '"Durable queue delivery" off to make inline delivery the declared intent.',
    );
  }

  /**
   * Deliver a normalized message through the transport (with retry) and
   * finalize the persisted `sys_email` row (`sent` + message_id + sent_at,
   * or `failed` + error). Shared by `send()` and `deliverPersistedRow()`.
   */
  private async deliverNormalized(
    rowId: string,
    normalized: NormalizedEmailMessage,
    opts?: DeliverAttemptOptions,
    reclaimKeys?: string[],
  ): Promise<SendEmailResult> {
    // Defaults reproduce the pre-#5160 loop exactly.
    const maxAttempts = Math.max(1, opts?.maxAttempts ?? (this.options.retries ?? 0) + 1);
    const priorAttempts = Math.max(0, opts?.priorAttempts ?? 0);
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await this.options.transport.send(normalized);
        const messageId = result.messageId;
        const status: EmailDeliveryStatus = 'sent';
        await this.updateRow(rowId, {
          status,
          message_id: messageId,
          sent_at: new Date().toISOString(),
          attempt_count: priorAttempts + attempt,
        });
        await this.scheduleAttachmentReclaim(rowId, reclaimKeys);
        return { id: rowId, status, messageId };
      } catch (err: any) {
        lastError = err;
        if (attempt < maxAttempts) {
          // simple exponential backoff
          await new Promise(r => setTimeout(r, Math.min(2000, 100 * 2 ** (attempt - 1))));
        }
      }
    }
    const errMessage = String(lastError?.message ?? lastError ?? 'send failed').slice(0, 1000);
    await this.updateRow(rowId, {
      status: 'failed',
      error: errMessage,
      attempt_count: priorAttempts + maxAttempts,
    });
    await this.scheduleAttachmentReclaim(rowId, reclaimKeys);
    return { id: rowId, status: 'failed', error: errMessage };
  }

  /**
   * Schedule reclamation of this row's out-of-row attachment content, one
   * grace window from now (#5172).
   *
   * Published on EVERY terminal transition, `sent` and `failed` alike, with a
   * per-row idempotency key so the retries of one message collapse onto the
   * first job rather than each arming their own. `failed` is included because
   * `failed` is not the end of anything by itself — the queue re-delivers such
   * a row — and the job re-reads the row before it deletes, so an early
   * schedule can only ever be re-armed, never act early.
   *
   * The keys ride in the PAYLOAD. That is what makes a later row deletion
   * (retention, purge) reclaim the content instead of orphaning it — see
   * `attachment-reclaim.ts`.
   */
  private async scheduleAttachmentReclaim(rowId: string, keys: string[] | undefined): Promise<void> {
    if (!keys || keys.length === 0) return;
    const queue = this.options.queueDelivery?.resolve();
    if (!queue) {
      this.options.logger?.error?.(
        `EmailService: ${keys.length} attachment storage object(s) for sys_email row '${rowId}' cannot be `
        + 'scheduled for reclamation — no durable queue service is available now, although one was when the '
        + 'content was stored. Those bytes will stay in the file-storage backend until they are deleted by '
        + 'hand. Fix: keep @objectstack/service-queue (over an ObjectQL engine) mounted for the life of the '
        + 'process, then delete leftovers under the sys_email/attachments/ prefix.',
      );
      return;
    }
    try {
      await queue.publish<EmailAttachmentReclaimPayload>(
        EMAIL_ATTACHMENT_RECLAIM_QUEUE,
        { rowId, keys },
        {
          delay: EMAIL_ATTACHMENT_RECLAIM_GRACE_MS,
          // One row, one reclaim job: every retry of a message finalizes the
          // row again, and each of those would otherwise arm its own copy.
          idempotencyKey: `sys_email_attachments:${rowId}`,
          // A reclaim that cannot run is a byte leak, not a lost message, so
          // it gets a real budget and then the DLQ, where it is visible.
          maxAttempts: 5,
          retries: 4,
          backoff: { type: 'exponential', delayMs: 60_000, maxDelayMs: 60 * 60_000 },
          metadata: { object: 'sys_email', rowId },
        },
      );
    } catch (err: any) {
      this.options.logger?.error?.(
        `EmailService: could not publish the attachment-reclaim job for sys_email row '${rowId}' `
        + `(${String(err?.message ?? err)}). Its ${keys.length} storage object(s) will stay in the backend `
        + 'until deleted by hand. Fix: check the durable queue service, then delete leftovers under the '
        + 'sys_email/attachments/ prefix.',
      );
    }
  }

  /**
   * Deliver an ALREADY-PERSISTED `sys_email` row (the outbox-drain path).
   *
   * An app (e.g. a sandboxed action that can only `api.write`, never reach
   * the email service) inserts a `sys_email` row as `status:'queued'`; the
   * plugin's afterInsert hook calls this to actually transmit it. Unlike
   * `send()`, this does NOT insert a new row — it reconstructs the message
   * from the row columns and finalizes that same row in place.
   *
   * Also the queue worker's entry point (#5160): it passes
   * `{ maxAttempts: 1, priorAttempts }` so the queue owns retrying and
   * `attempt_count` accumulates on the one row across redeliveries.
   */
  async deliverPersistedRow(
    row: Record<string, any>,
    opts?: DeliverAttemptOptions,
  ): Promise<SendEmailResult> {
    const rowId = String(row?.id ?? '');
    if (!rowId) throw new Error('deliverPersistedRow: row.id is required');
    // Keys read from the ROW, so a row delivered by the queue worker (which
    // never saw the send) still schedules its own content's reclamation.
    const reclaimKeys = storageKeysInColumn(row.attachments_json);
    let normalized: NormalizedEmailMessage;
    try {
      // Async because a row's attachments may live in the file-storage
      // capability (#5172). A fetch that fails — outage, deleted object, no
      // capability mounted at all — throws and lands the row at `failed` with
      // the reason, which is the whole point: an unfetchable attachment must
      // never become a message delivered without it.
      normalized = await rowToNormalizedAsync(row, { fetchContent: this.attachmentFetcher() });
    } catch (err: any) {
      const errMessage = String(err?.message ?? err ?? 'invalid row').slice(0, 1000);
      await this.updateRow(rowId, {
        status: 'failed',
        error: errMessage,
        attempt_count: Math.max(0, opts?.priorAttempts ?? 0),
      });
      return { id: rowId, status: 'failed', error: errMessage };
    }
    return this.deliverNormalized(rowId, normalized, opts, reclaimKeys);
  }

  /**
   * A fetcher for out-of-row attachment content, or `undefined` when no
   * storage capability is mounted.
   *
   * `undefined` is NOT a permission to skip the attachment: the decoder turns
   * it into a refusal naming the key it could not read.
   */
  private attachmentFetcher(): ((storageKey: string) => Promise<Buffer>) | undefined {
    const storage = this.options.attachmentStorage?.resolve();
    if (!storage) return undefined;
    return (storageKey: string) => fetchAttachmentContent(storage, storageKey);
  }

  private async updateRow(id: string, patch: Record<string, any>): Promise<void> {
    if (!this.options.persistence?.update) return;
    try {
      await this.options.persistence.update(id, patch);
    } catch (err: any) {
      this.options.logger?.warn('EmailService: sys_email update failed (non-fatal)', { id, error: err?.message });
    }
  }

  /**
   * Render a named template from sys_email_template and deliver via
   * send(). Looks up `(name, locale)` then falls back to
   * `(name, {@link DEFAULT_TEMPLATE_LOCALE})`.
   */
  async sendTemplate(input: SendTemplateInput): Promise<SendEmailResult> {
    if (!input?.template) {
      throw new Error('VALIDATION_FAILED: template name is required');
    }
    const loader = this.options.templateLoader;
    if (!loader) {
      throw new Error('TEMPLATE_NOT_FOUND: no templateLoader configured on EmailService');
    }
    // Locale ladder (#7731). The old first rung passed `undefined` to the
    // loader whenever the caller named no locale, which is not a request for
    // en-US — it is a request for *any* row, and that is exactly what came
    // back (zh-CN, out of an en-US + zh-CN bundle, on two fresh boots). No
    // locale means the DOCUMENTED default, so ask for it by name.
    const preferred = input.locale && String(input.locale).trim();
    const wanted = preferred || DEFAULT_TEMPLATE_LOCALE;
    let row = await loader.load(input.template, wanted);
    if (!row && wanted !== DEFAULT_TEMPLATE_LOCALE) {
      row = await loader.load(input.template, DEFAULT_TEMPLATE_LOCALE);
    }
    if (!row && !preferred) {
      // A bundle with no en-US row at all. A caller that never named a locale
      // did get *some* row here before (a zh-CN-only tenant is the realistic
      // case) and hard-failing it now would swap one bug for an outage — so
      // fall through to the loader's own no-locale answer, which is
      // deterministic by contract rather than driver row order.
      row = await loader.load(input.template, undefined);
    }
    if (!row) {
      throw new Error(`TEMPLATE_NOT_FOUND: ${input.template} (locale=${wanted})`);
    }
    if (row.active === false) {
      throw new Error(`TEMPLATE_INACTIVE: ${input.template}`);
    }

    // Validate required variables (declared in variables_json).
    const data: Record<string, any> = {
      ...(this.options.defaultTemplateContext || {}),
      ...(input.data || {}),
    };
    if (row.variables_json) {
      try {
        const decl: Array<{ name: string; required?: boolean }> = JSON.parse(String(row.variables_json));
        const required = decl.filter((v) => v?.required).map((v) => v.name);
        if (required.length) requireVars(data, required);
      } catch (err: any) {
        if (String(err?.message).startsWith('MISSING_VARIABLES')) throw err;
        this.options.logger?.warn('EmailService: variables_json parse failed (ignored)', { template: input.template });
      }
    }

    // Render holes with the RESOLVED ROW's locale + reference timezone so
    // `{{ ts | datetime }}` shows the right wall-clock (ADR-0053 Phase 2).
    //
    // The row is the single locale authority (#7801). Leaving this unset when
    // the caller named no locale handed the format filters to `formatValue`'s
    // own `?? 'en-US'` default, so a no-locale send landing on a non-en-US row
    // — a bundle with no en-US row at all, the ladder's last rung above — put
    // en-US dates and numbers inside zh-CN body text. One artefact, one locale.
    // (The card reported the mirror image, "filters follow the RUNTIME locale";
    // they never did — `formatValue` hard-defaults to en-US — which is why the
    // split was invisible whenever the row itself happened to be en-US.)
    //
    // An explicit `input.locale` still WINS: the row is the authority only when
    // the caller named nobody, so `locale: 'fr-FR'` falling back to the en-US
    // row still formats fr-FR. `preferred`, not `input.locale`, because it is
    // the trimmed spelling the ladder actually resolved on — a padded
    // `' zh-CN '` must not reach `Intl`, which throws a RangeError on it and
    // took the whole send down.
    const locale = preferred || row.locale;
    const renderOpts = {
      ...(locale ? { locale } : {}),
      ...(input.timezone ? { timeZone: input.timezone } : {}),
    };
    const subject = renderTemplate(row.subject, data, renderOpts);
    const html = renderTemplate(row.body_html, data, renderOpts);
    const text = row.body_text
      ? renderTemplate(row.body_text, data, renderOpts)
      : htmlToText(html);

    const from: EmailAddress | undefined = input.from
      ?? (row.from_address
        ? { address: row.from_address, ...(row.from_name ? { name: row.from_name } : {}) }
        : undefined);

    const sendInput: SendEmailInput = {
      to: input.to,
      subject,
      html,
      text,
      ...(from ? { from } : {}),
      ...(input.cc ? { cc: input.cc } : {}),
      ...(input.bcc ? { bcc: input.bcc } : {}),
      ...(input.replyTo ?? row.reply_to
        ? { replyTo: input.replyTo ?? (row.reply_to as string) }
        : {}),
      ...(input.attachments ? { attachments: input.attachments } : {}),
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.relatedObject ? { relatedObject: input.relatedObject } : {}),
      ...(input.relatedId ? { relatedId: input.relatedId } : {}),
      ...(input.sentBy ? { sentBy: input.sentBy } : {}),
    };
    return this.send(sendInput);
  }
}
