// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IEmailService — Outbound Email Service Contract
 *
 * Sends transactional or marketing email through a pluggable transport
 * (SMTP, SendGrid, Resend, SES, etc.). Concrete implementations live in
 * `@objectstack/plugin-email`; integrations (nodemailer, third-party
 * SDKs) plug in as an `IEmailTransport`.
 *
 * Aligned with CoreServiceName 'email' in core-services.zod.ts.
 *
 * Follows Dependency Inversion Principle - plugins depend on this
 * interface, not on concrete email service implementations.
 */

/**
 * A single recipient address. Either a bare address (`alice@example.com`)
 * or a display-name + address pair (`"Alice" <alice@example.com>`).
 */
export type EmailAddress =
  | string
  | { name?: string; address: string };

/**
 * Inline attachment supplied with a send.
 *
 * - `content` may be a UTF-8 string or a Buffer for binary payloads.
 * - `contentType` defaults to `application/octet-stream` when omitted.
 */
export interface EmailAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
  /** Optional Content-ID for inline HTML referencing (`cid:<id>`). */
  cid?: string;
}

/**
 * Input for IEmailService.send().
 */
export interface SendEmailInput {
  /** Envelope recipients. */
  to: EmailAddress | EmailAddress[];
  /** Envelope sender. When omitted, the service's configured default-from is used. */
  from?: EmailAddress;
  /** Carbon-copy recipients. */
  cc?: EmailAddress | EmailAddress[];
  /** Blind-carbon-copy recipients. */
  bcc?: EmailAddress | EmailAddress[];
  /** Address used for Reply-To header. */
  replyTo?: EmailAddress;
  /** Subject line. */
  subject: string;
  /** Plain-text body (recommended for accessibility / spam scoring). */
  text?: string;
  /** HTML body. At least one of `text` or `html` must be supplied. */
  html?: string;
  /** Inline / attached files. */
  attachments?: EmailAttachment[];
  /** Extra headers to merge onto the outgoing message. */
  headers?: Record<string, string>;
  /** Optional related record for activity-stream linkage. */
  relatedObject?: string;
  relatedId?: string;
  /** User id for `sent_by` audit linkage. */
  sentBy?: string;
}

/**
 * Normalized message handed to an IEmailTransport. Service performs
 * input validation + default-from application before invoking transport.
 */
export interface NormalizedEmailMessage {
  to: string[];
  from: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: EmailAttachment[];
  headers?: Record<string, string>;
}

/**
 * Transport-level result. Plugins typically convert this into the
 * service-level SendEmailResult by enriching with logId / status.
 */
export interface TransportSendResult {
  messageId: string;
  /** Optional raw response from the underlying provider. */
  response?: string;
}

/**
 * Pluggable email transport. Plugin-email ships a `LogTransport` for
 * development; production deployments inject a concrete transport
 * (e.g. nodemailer / SendGrid SDK / Resend) implementing this shape.
 *
 * Transports MUST NOT mutate the message. They MAY enrich response
 * metadata (deliverability ids, provider response strings).
 */
export interface IEmailTransport {
  send(message: NormalizedEmailMessage): Promise<TransportSendResult>;
}

/**
 * Lifecycle status surfaced to callers.
 */
export type EmailDeliveryStatus = 'queued' | 'sent' | 'failed';

/**
 * Outcome of IEmailService.send().
 */
export interface SendEmailResult {
  /** Always set; matches sys_email.id when persistence is enabled. */
  id: string;
  status: EmailDeliveryStatus;
  /** Set when status='sent'. */
  messageId?: string;
  /** Set when status='failed'. */
  error?: string;
}

/**
 * Input for IEmailService.sendTemplate(). Resolves a named template
 * row from `sys_email_template`, renders it against `data`, and
 * forwards through the same transport pipeline as `send()`.
 */
export interface SendTemplateInput {
  /**
   * Template identifier (matches `sys_email_template.name`), e.g.
   * `'auth.password_reset'`. The service picks the best-matching
   * locale row (falls back to `en-US`).
   */
  template: string;
  /** Envelope recipients. */
  to: EmailAddress | EmailAddress[];
  /** Render context — placeholders in subject/body are resolved against this object. */
  data?: Record<string, unknown>;
  /** Preferred BCP-47 locale (e.g. user's locale). Falls back to `'en-US'`. */
  locale?: string;
  /**
   * Reference timezone (IANA name, e.g. `America/New_York`) for rendering
   * `datetime` holes — `{{ ts | datetime }}` (ADR-0053 Phase 2). The caller
   * supplies the recipient's / tenant's zone (typically from the resolved
   * `ExecutionContext.timezone`). Unset → the runtime zone (pre-Phase-2
   * behavior). Calendar-day `date` holes are unaffected (tz-naive).
   */
  timezone?: string;
  /** Tenant id for org-overlay resolution (when supported). */
  org?: string;
  /** Envelope sender override (otherwise template.fromOverride → service default). */
  from?: EmailAddress;
  /** Carbon-copy recipients. */
  cc?: EmailAddress | EmailAddress[];
  /** Blind-carbon-copy recipients. */
  bcc?: EmailAddress | EmailAddress[];
  /** Reply-To header override (otherwise template.replyTo). */
  replyTo?: EmailAddress;
  /** Inline / attached files. */
  attachments?: EmailAttachment[];
  /** Extra headers to merge onto the outgoing message. */
  headers?: Record<string, string>;
  /** Optional related record for activity-stream linkage. */
  relatedObject?: string;
  relatedId?: string;
  /** User id for `sent_by` audit linkage. */
  sentBy?: string;
}

/**
 * Email service contract.
 */
export interface IEmailService {
  /**
   * Send (or attempt to send) an email through the configured transport.
   * Implementations SHOULD persist a sys_email row when an ObjectQL
   * engine is wired, but MUST NOT throw if persistence fails — delivery
   * outcome takes precedence.
   */
  send(input: SendEmailInput): Promise<SendEmailResult>;

  /**
   * Resolve a named template from `sys_email_template`, render its
   * subject/body against `input.data`, then deliver via `send()`.
   *
   * Errors:
   * - `TEMPLATE_NOT_FOUND` — no row matches `(name, locale|en-US)`.
   * - `TEMPLATE_INACTIVE`  — row exists but `active=false`.
   * - `MISSING_VARIABLES`  — declared `required` variables absent from `data`.
   */
  sendTemplate(input: SendTemplateInput): Promise<SendEmailResult>;
}
