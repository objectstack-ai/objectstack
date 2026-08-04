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
  decodeHeadersFromRow,
  type EncodedAttachments,
} from './sys-email-payload.js';

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
 * Internal persistence shim — typed loosely so the service can run
 * without an ObjectQL engine wired (e.g. unit tests, serverless).
 */
export interface EmailPersistence {
  insert(row: Record<string, any>): Promise<{ id: string } | string>;
  update?(id: string, patch: Record<string, any>): Promise<void>;
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
  // Headers and attachments (#5177). Both decoders return `undefined` for a
  // row that simply has no such column — every row written before #5177 — and
  // THROW for a column that is present but does not describe what it claims
  // to. Throwing here is the point: the caller (`deliverPersistedRow`) turns
  // it into a `failed` row carrying the reason, which is strictly better than
  // handing the transport a message with an attachment quietly missing.
  const headers = decodeHeadersFromRow(row.headers_json);
  if (headers) msg.headers = headers;
  const attachments = decodeAttachmentsFromRow(row.attachments_json);
  if (attachments) msg.attachments = attachments;
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
 * Loader for sys_email_template rows. Injected by EmailServicePlugin
 * on `kernel:ready`. Returns the best-matching row for `(name, locale)`
 * or `null` when none exists / inactive.
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
    const encodedAttachments: EncodedAttachments = this.options.persistence
      ? encodeAttachmentsForRow(normalized.attachments)
      : { kind: 'none' };

    // `undefined` ⇒ every statement below is the pre-#5160 inline path.
    const queue = allowQueue ? this.resolveQueueForSend(encodedAttachments) : undefined;

    const id = newId();
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
      ...(encodedAttachments.kind === 'inline' ? { attachments_json: encodedAttachments.json } : {}),
      ...(input.relatedObject ? { related_object: input.relatedObject } : {}),
      ...(input.relatedId ? { related_id: input.relatedId } : {}),
      ...(input.sentBy ? { sent_by: input.sentBy } : {}),
      status: 'queued',
      attempt_count: 0,
    };

    // Reserve the row id BEFORE persistence.insert so the drain hook
    // (which fires synchronously inside that insert) sees it as managed
    // and skips it — `send()` owns this row's delivery.
    this.managedRowIds.add(id);
    try {
      let persistedId: string | undefined;
      if (this.options.persistence) {
        try {
          const res = await this.options.persistence.insert(baseRow);
          persistedId = typeof res === 'string' ? res : res?.id ?? id;
          if (persistedId !== id) this.managedRowIds.add(persistedId);
        } catch (err: any) {
          this.options.logger?.warn('EmailService: sys_email persist failed (non-fatal)', { error: err?.message });
        }
      }
      const rowId = persistedId ?? id;
      if (queue) {
        // Queue mode delivers the ROW, so a row that never landed leaves the
        // job with nothing to reference. Deliver inline instead of publishing
        // a job that can only fail — the insert failure was already reported
        // above, and dropping the message would be the worse answer.
        if (persistedId === undefined) {
          this.reportQueueDegradation(
            'the sys_email row could not be persisted, so a queued job would have nothing to deliver',
          );
        } else if (await this.publishRow(queue, rowId)) {
          // The row is in the database at `queued` and the job is in the
          // queue's own store: a process death here loses neither.
          return { id: rowId, status: 'queued' };
        }
      }
      return await this.deliverNormalized(rowId, normalized);
    } finally {
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
        + 'queued without them. Out-of-row storage for large attachments is objectstack#5172.',
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
    return { id: rowId, status: 'failed', error: errMessage };
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
    let normalized: NormalizedEmailMessage;
    try {
      normalized = rowToNormalized(row);
    } catch (err: any) {
      const errMessage = String(err?.message ?? err ?? 'invalid row').slice(0, 1000);
      await this.updateRow(rowId, {
        status: 'failed',
        error: errMessage,
        attempt_count: Math.max(0, opts?.priorAttempts ?? 0),
      });
      return { id: rowId, status: 'failed', error: errMessage };
    }
    return this.deliverNormalized(rowId, normalized, opts);
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
   * send(). Looks up `(name, locale)` then falls back to `(name, 'en-US')`.
   */
  async sendTemplate(input: SendTemplateInput): Promise<SendEmailResult> {
    if (!input?.template) {
      throw new Error('VALIDATION_FAILED: template name is required');
    }
    const loader = this.options.templateLoader;
    if (!loader) {
      throw new Error('TEMPLATE_NOT_FOUND: no templateLoader configured on EmailService');
    }
    const preferred = input.locale && String(input.locale).trim();
    let row = await loader.load(input.template, preferred || undefined);
    if (!row && preferred && preferred !== 'en-US') {
      row = await loader.load(input.template, 'en-US');
    }
    if (!row) {
      throw new Error(`TEMPLATE_NOT_FOUND: ${input.template} (locale=${preferred || 'en-US'})`);
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

    // Render holes with the recipient's locale + reference timezone so
    // `{{ ts | datetime }}` shows the right wall-clock (ADR-0053 Phase 2).
    const renderOpts = {
      ...(input.locale ? { locale: input.locale } : {}),
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
