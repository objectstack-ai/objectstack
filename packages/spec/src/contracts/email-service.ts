// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * IEmailService — Outbound Email Service Contract
 *
 * Sends transactional or marketing email through a pluggable transport
 * (SMTP, SendGrid, Resend, SES, etc.). Concrete implementations live in
 * `@objectstack/plugin-email`; integrations (nodemailer, third-party
 * SDKs) plug in as an `IEmailTransport`.
 *
 * Registered as runtime service slot 'email' by `@objectstack/plugin-email`
 * (`ctx.registerService('email', ...)`). Not a `CoreServiceName` member
 * itself — email delivery is subsumed under the 'notification' core service.
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
  /**
   * Organization (tenant) id stamped verbatim onto the persisted
   * `sys_email.organization_id` (commit b706af987, Decision 2 of #11303).
   *
   * Pass-through only: the email service's writer runs under a constant
   * system context and MUST NOT resolve or fabricate an organization — a
   * wrong `organization_id` is silently authoritative to every report,
   * export and cleanup script that filters by organization, which is worse
   * than a null. Producers that already hold one (e.g. the messaging email
   * channel's `delivery.notification.organizationId`) thread it here; omit
   * it when the caller genuinely has none — absent stays legal, and the
   * engine then stamps the one organization it can derive for the row or
   * refuses the insert where it can derive none (ADR-0131 D9); the row stays
   * unstamped only in a composition that registers no organization object.
   * Mail about a person rather than an organization
   * (auth verification, password reset) is {@link identityMail} instead. Forward-stamping only; pre-existing org-less rows are not
   * backfilled.
   */
  organizationId?: string;
  /**
   * Identity mail: a message about a PERSON rather than an organization —
   * verification, password reset, magic link, email-change notice, an
   * account invitation to someone who belongs to no organization yet.
   *
   * `true` routes the persisted row to `sys_identity_email`, the
   * deployment-level sibling of `sys_email` with the same row shape and no
   * organization column (ADR-0131 D7, ruling of record 6257510973, letter
   * Q2 A), delivered by the same outbox, status and attachment pipeline.
   * Absent or `false` keeps the row in `sys_email`, the tenant mail log.
   *
   * Identity mail has no organization to carry, so `organizationId` alongside
   * `identityMail: true` is refused as a validation failure — never one of the
   * two silently dropped.
   */
  identityMail?: boolean;
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
 * Input for IEmailService.sendTemplate(). Resolves a named `email_template`
 * from the metadata registry — the environment's item over each code
 * package's declaration, the built-in auth templates included — renders it
 * against `data`, and forwards through the same transport pipeline as
 * `send()`.
 */
export interface SendTemplateInput {
  /**
   * Template identifier (the `email_template` item's `name`), e.g.
   * `'auth.password_reset'`. There is no "best match" and no language-subtag
   * folding: the locale member is resolved by the exact ladder documented on
   * `locale` below.
   */
  template: string;
  /** Envelope recipients. */
  to: EmailAddress | EmailAddress[];
  /** Render context — placeholders in subject/body are resolved against this object. */
  data?: Record<string, unknown>;
  /**
   * Preferred BCP-47 locale (e.g. user's locale). Falls back to `'en-US'`.
   *
   * Resolution is exact, then default, then deterministic — never "whichever
   * row the store yields first" (#7731):
   *
   *  1. this locale, matched exactly (no language-only prefix matching: `zh`
   *     does not resolve `zh-CN`);
   *  2. `'en-US'` — which is also where a call that omits `locale` STARTS, so
   *     "no locale" means the default rather than an arbitrary member;
   *  3. only for a call that named no locale, and only when the bundle has no
   *     `en-US` member at all: its lowest locale tag, so a single-locale
   *     bundle keeps rendering and does so identically on every boot.
   */
  locale?: string;
  /**
   * Reference timezone (IANA name, e.g. `America/New_York`) for rendering
   * `datetime` holes — `{{ ts | datetime }}` (ADR-0053 Phase 2). The caller
   * supplies the recipient's / tenant's zone (typically from the resolved
   * `ExecutionContext.timezone`). Unset → the runtime zone (pre-Phase-2
   * behavior). Calendar-day `date` holes are unaffected (tz-naive).
   */
  timezone?: string;
  // `org` ("Tenant id for org-overlay resolution (when supported)") was REMOVED
  // 2026-08-25 (#11832, ADR-0049 enforce-or-remove). No implementation ever read
  // it — template resolution keys on `(name, locale)` only — so the key was
  // silently inert from the day it was declared; the "(when supported)" hedge
  // was the declaration admitting it. `organizationId` below is NOT a
  // replacement: it is the delivery row's tenant stamp (pass-through to
  // `sys_email.organization_id`, commit b706af987) and does not opt into any overlay
  // resolution. If org-overlay template rows ever become a measured business
  // need, that is a new capability with its own ruling — not this key revived.
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
  /**
   * Organization (tenant) id forwarded into the {@link SendEmailInput} this
   * template send performs, and stamped from there onto
   * `sys_email.organization_id` (commit b706af987). Same contract as
   * {@link SendEmailInput.organizationId}: pass-through only, optional,
   * absent stays legal. Distinct from the retired `org` member (removed
   * 2026-08-25, #11832), which declared template org-overlay *resolution*
   * and was never read — this member stamps the delivery row's tenant and
   * opts into no overlay resolution.
   */
  organizationId?: string;
  /**
   * Identity mail, forwarded into the {@link SendEmailInput} this template
   * send performs. Same contract as {@link SendEmailInput.identityMail}: the
   * row goes to `sys_identity_email`, and `organizationId` beside it is refused.
   */
  identityMail?: boolean;
}

/**
 * Input for IEmailService.renderTemplate() — the render-only subset of
 * {@link SendTemplateInput}: everything template resolution + rendering
 * needs, nothing the delivery pipeline reads.
 */
export interface RenderTemplateInput {
  /**
   * Template identifier (the `email_template` item's `name`), e.g.
   * `'auth.password_reset'`.
   */
  template: string;
  /** Render context — placeholders in subject/body are resolved against this object. */
  data?: Record<string, unknown>;
  /**
   * Preferred BCP-47 locale. Resolution is the SAME ladder as
   * {@link SendTemplateInput.locale} — exact match, then `'en-US'`, then
   * (no-locale calls only) the bundle's deterministic single-locale answer.
   */
  locale?: string;
  /**
   * Reference timezone (IANA name) for rendering `datetime` holes —
   * `{{ ts | datetime }}` (ADR-0053 Phase 2). Same semantics as
   * {@link SendTemplateInput.timezone}.
   */
  timezone?: string;
}

/**
 * Outcome of IEmailService.renderTemplate() — the rendered content of the
 * resolved `email_template`, mirroring what the template itself carries:
 * a subject, an HTML body, and a plain-text body (the template's `bodyText`
 * when present, otherwise derived from the rendered HTML). Consumers pick
 * the face they need — an email composer uses `html`/`text`, an in-app
 * inbox row uses `subject`/`text`.
 */
export interface RenderTemplateResult {
  /** Rendered subject line. */
  subject: string;
  /** Rendered HTML body (the template's `bodyHtml`). */
  html: string;
  /**
   * Rendered plain-text body — the template's `bodyText` when declared,
   * otherwise derived from the rendered HTML.
   */
  text: string;
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
   * Resolve a named `email_template` from the metadata registry, render its
   * subject/body against `input.data`, then deliver via `send()`.
   *
   * Locale resolution is the ladder on {@link SendTemplateInput.locale}.
   *
   * Errors:
   * - `TEMPLATE_NOT_FOUND` — no template matches `(name, locale|en-US)`, and
   *   (for a call that named no locale) the name carries no members at all.
   * - `TEMPLATE_INACTIVE`  — the template exists but `active=false`.
   * - `MISSING_VARIABLES`  — declared `required` variables absent from `data`.
   * - `TEMPLATE_INVALID`   — the stored template has a hole the authoring rules
   *   refuse (rule `email-template-hole-grammar`: a second formatter, a
   *   formatter the whitelist does not name, or a `currency` argument that is
   *   neither a literal ISO 4217 code nor a marked `@path`). It is refused
   *   at render, as `TEMPLATE_INVALID: email template <name> (locale=<l>):
   *   <hole and rule>`, so nothing is delivered. Permanent: retrying cannot
   *   succeed until the template is re-published without that hole.
   */
  sendTemplate(input: SendTemplateInput): Promise<SendEmailResult>;

  /**
   * Resolve a named `email_template` from the metadata registry and render its
   * subject/body against `input.data` — WITHOUT sending anything. Strictly
   * render-only: no delivery, no queueing, no `sys_email` row. One resolver,
   * many channels (#9225): the same locale ladder + `{{var}}` renderer
   * (ADR-0053 format filters included) that `sendTemplate` delivers through,
   * exposed so non-email consumers (e.g. the messaging inbox channel) render
   * localized template content instead of duplicating the resolver.
   *
   * Locale resolution is the ladder on {@link SendTemplateInput.locale}.
   *
   * Errors (same vocabulary as `sendTemplate`, since resolution is shared):
   * - `TEMPLATE_NOT_FOUND` — no template matches `(name, locale|en-US)`, and
   *   (for a call that named no locale) the name carries no members at all.
   * - `TEMPLATE_INACTIVE`  — the template exists but `active=false`.
   * - `MISSING_VARIABLES`  — declared `required` variables absent from `data`.
   * - `TEMPLATE_INVALID`   — the stored template has a hole the authoring rules
   *   refuse (rule `email-template-hole-grammar`: a second formatter, a
   *   formatter the whitelist does not name, or a `currency` argument that is
   *   neither a literal ISO 4217 code nor a marked `@path`). It is refused
   *   at render, as `TEMPLATE_INVALID: email template <name> (locale=<l>):
   *   <hole and rule>`, so nothing is rendered. Permanent: retrying cannot
   *   succeed until the template is re-published without that hole.
   */
  renderTemplate(input: RenderTemplateInput): Promise<RenderTemplateResult>;

  /**
   * Whether mail sent through this service is actually delivered — the
   * deliverability fact, answered by the one package that owns the transport.
   * Same name and shape as `ISmsService.isConfigured()` (`./sms-service`).
   *
   * - `true` — the active transport hands messages to a real delivery
   *   provider (SMTP, an API provider, an injected transport). It says the
   *   transport is live, not that any one send will succeed: a send can still
   *   resolve `status: 'failed'`.
   * - `false` — no delivery transport is active: `send()` / `sendTemplate()`
   *   still resolve and still record their audit row, but no mail leaves the
   *   process. A `log` transport (plugin-email's development default) is
   *   NEVER delivering, in any environment — it always answers `false`.
   *
   * The answer is read at call time and follows runtime transport swaps (for
   * example a transport rebuilt from the `mail` settings namespace), so
   * consumers call it when they decide, never cache it at boot.
   *
   * Optional so existing implementations stay valid. A consumer MUST treat an
   * absent member as UNKNOWN, never as `true`: a flow whose success depends on
   * mail reaching someone (a sign-up answered as a success on the promise of a
   * mail, a verification or reset link) reads absent the same as `false` and
   * keeps its explicit refusal — reading "a service is wired" as delivery
   * reopens the #15587 black hole (a fake success with no mail).
   */
  isConfigured?(): boolean;
}
