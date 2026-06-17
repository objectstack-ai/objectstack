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
} from '@objectstack/spec/contracts';
import { renderTemplate, requireVars, htmlToText } from './template-engine.js';

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
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
}

/**
 * Concrete IEmailService implementation.
 *
 * Flow:
 *   1. Validate + normalize input (throws on bad input).
 *   2. Persist queued row to sys_email (best-effort; failures logged).
 *   3. Call transport.send(); on success, update row to sent +
 *      timestamp + messageId. On failure, mark failed + error.
 *   4. Return SendEmailResult with the persisted row id (or a fresh
 *      id when persistence is disabled).
 */
export class EmailService implements IEmailService {
  constructor(public options: EmailServiceOptions) {
    if (!options.transport) throw new Error('EmailService: transport is required');
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

  async send(input: SendEmailInput): Promise<SendEmailResult> {
    let normalized: NormalizedEmailMessage;
    try {
      normalized = normalizeMessage(input, this.options.defaultFrom);
    } catch (err: any) {
      // Validation failures must surface to the caller.
      throw err;
    }

    const id = newId();
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
      ...(input.relatedObject ? { related_object: input.relatedObject } : {}),
      ...(input.relatedId ? { related_id: input.relatedId } : {}),
      ...(input.sentBy ? { sent_by: input.sentBy } : {}),
      status: 'queued',
      attempt_count: 0,
    };

    let persistedId: string | undefined;
    if (this.options.persistence) {
      try {
        const res = await this.options.persistence.insert(baseRow);
        persistedId = typeof res === 'string' ? res : res?.id ?? id;
      } catch (err: any) {
        this.options.logger?.warn('EmailService: sys_email persist failed (non-fatal)', { error: err?.message });
      }
    }
    const rowId = persistedId ?? id;

    const maxAttempts = (this.options.retries ?? 0) + 1;
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
          attempt_count: attempt,
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
      attempt_count: maxAttempts,
    });
    return { id: rowId, status: 'failed', error: errMessage };
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
