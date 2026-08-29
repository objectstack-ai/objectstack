// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type {
  IEmailTransport,
  NormalizedEmailMessage,
  TransportSendResult,
} from '@objectstack/spec/contracts';
import {
  isValidSmtpPort,
  formatInvalidSmtpPortNotice,
} from './smtp-port-contract.js';

/**
 * SmtpTransport — self-hosted / provider SMTP delivery via nodemailer.
 *
 * ADR-0012 ("Email transport sub-system"): SMTP ships **in core** and is
 * non-negotiable for on-prem, air-gapped and China-region deployments —
 * Resend / Postmark are HTTPS SaaS and are neither reachable nor reliable
 * for QQ / 163 / enterprise mailboxes. That decision also names the
 * implementation: `nodemailer`, not a hand-rolled client. A partial SMTP
 * client works against permissive servers and fails *silently* against the
 * strict ones (STARTTLS negotiation, AUTH LOGIN/PLAIN/CRAM-MD5, RFC 2047
 * header encoding, dot-stuffing), which would push this transport's own
 * bug one layer down instead of fixing it. Do not replace it with a
 * bespoke implementation without a superseding ADR.
 *
 * `nodemailer` is a hard dependency of this package but is imported
 * **lazily**, on the first `send()`. A deployment that never selects SMTP
 * (and any non-Node runtime — Workers / edge) therefore never loads
 * `node:net` / `node:tls`.
 *
 * TLS mapping — one toggle (`secure`, the settings page's "Use TLS"), the
 * wire behaviour derived from the port, the way every mail provider
 * documents it:
 *
 * | `secure` | port    | connection                                        |
 * |:---------|:--------|:--------------------------------------------------|
 * | `true`   | `465`   | implicit TLS (SMTPS) from the first byte           |
 * | `true`   | other   | plain connect + **required** STARTTLS upgrade      |
 * | `false`  | any     | plain connect, opportunistic STARTTLS when offered |
 *
 * "Required" means loud: a server that will not upgrade makes the send
 * fail rather than leaking credentials over a cleartext socket.
 *
 * @example
 * ```ts
 * new EmailServicePlugin({
 *   provider: 'smtp',
 *   providerOptions: {
 *     host: 'smtp.exmail.qq.com',
 *     port: 465,
 *     secure: true,
 *     user: 'no-reply@acme.cn',
 *     password: process.env.SMTP_PASSWORD,
 *   },
 *   defaultFrom: { name: 'Acme', address: 'no-reply@acme.cn' },
 * });
 * ```
 */
export interface SmtpTransportOptions {
  /** SMTP server hostname, e.g. `smtp.exmail.qq.com`. Required. */
  host: string;
  /** SMTP port. Default 587 (submission). 465 selects implicit TLS. */
  port?: number;
  /**
   * Require TLS. Default `true`. Implicit TLS on port 465, otherwise a
   * REQUIRED STARTTLS upgrade. `false` connects in the clear and upgrades
   * only when the server offers STARTTLS.
   */
  secure?: boolean;
  /** SMTP AUTH username. Omit for servers that accept unauthenticated relay. */
  user?: string;
  /** SMTP AUTH password. Ignored when `user` is empty. */
  password?: string;
  /** Socket / greeting / connection timeout in ms. Default 20000. */
  timeout?: number;
  /**
   * Escape hatch: raw nodemailer SMTP options merged **last** (e.g.
   * `{ pool: true }`, `{ tls: { rejectUnauthorized: false } }`, or forcing
   * `{ secure: true }` on a non-standard port). Use sparingly — anything
   * routinely needed belongs on this interface.
   */
  transportOptions?: Record<string, unknown>;
  /** Diagnostic logger. */
  logger?: { info: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void };
}

/** Minimal structural view of the nodemailer surface this transport uses. */
interface NodemailerLike {
  createTransport(options: Record<string, unknown>): NodemailerTransporterLike;
}
interface NodemailerTransporterLike {
  sendMail(mail: Record<string, unknown>): Promise<{ messageId?: string; response?: string; rejected?: unknown[] }>;
  close?(): void;
}

const DEFAULT_PORT = 587;
const IMPLICIT_TLS_PORT = 465;
const DEFAULT_TIMEOUT_MS = 20_000;

export class SmtpTransport implements IEmailTransport {
  private readonly opts: SmtpTransportOptions;
  private readonly port: number;
  private transporter?: Promise<NodemailerTransporterLike>;

  constructor(opts: SmtpTransportOptions) {
    if (!opts?.host || !String(opts.host).trim()) {
      // Loud at construction: a "configured" SMTP provider with no host is
      // exactly the declared-but-not-delivered state this transport exists
      // to end (#5087). Never degrade to a transport that pretends to send.
      throw new Error(
        'SmtpTransport: host is required (Settings → Mail → Host, or OS_EMAIL_SMTP_HOST)',
      );
    }
    this.opts = opts;
    const port = Number(opts.port ?? DEFAULT_PORT);
    // The range is declared ONCE, in `smtp-port-contract.ts`, and the sentence
    // below is GENERATED from it. A hand-written `(expected 1-65535)` on this
    // line is exactly the drift #12993 removed: it sat next to the check it
    // described, so the two could disagree and nothing would fail.
    if (!isValidSmtpPort(port)) {
      throw new Error(formatInvalidSmtpPortNotice(opts.port));
    }
    this.port = port;
  }

  /**
   * The nodemailer SMTP options this transport connects with. Exposed for
   * diagnostics and tests — the password is never included.
   */
  describe(): Record<string, unknown> {
    const { auth, ...rest } = this.buildSmtpOptions();
    return { ...rest, auth: auth ? { user: (auth as any).user } : undefined };
  }

  private buildSmtpOptions(): Record<string, unknown> {
    const secure = this.opts.secure !== false;
    const implicitTls = secure && this.port === IMPLICIT_TLS_PORT;
    const timeout = this.opts.timeout ?? DEFAULT_TIMEOUT_MS;
    const user = this.opts.user?.trim();
    return {
      host: String(this.opts.host).trim(),
      port: this.port,
      secure: implicitTls,
      // STARTTLS is REQUIRED (not merely offered) whenever TLS is on and the
      // port is not the implicit-TLS one — a server that refuses to upgrade
      // must fail the send, not silently downgrade to cleartext AUTH.
      requireTLS: secure && !implicitTls,
      connectionTimeout: timeout,
      greetingTimeout: timeout,
      socketTimeout: timeout,
      ...(user ? { auth: { user, pass: this.opts.password ?? '' } } : {}),
      ...(this.opts.transportOptions ?? {}),
    };
  }

  private async loadNodemailer(): Promise<NodemailerLike> {
    let mod: any;
    try {
      mod = await import('nodemailer');
    } catch (err: any) {
      throw new Error(
        'SmtpTransport: failed to load `nodemailer` — SMTP delivery is unavailable. '
        + 'It is a dependency of @objectstack/plugin-email; reinstall it (`pnpm add nodemailer`) '
        + 'or select a non-SMTP provider. Cause: '
        + (err?.message ?? String(err)),
      );
    }
    // nodemailer is CommonJS: under ESM the named export may arrive on the
    // namespace or only on `default` depending on the loader. This is a
    // module-format interop boundary with a third-party package, not a
    // tolerated dialect of our own contract.
    const createTransport = mod?.createTransport ?? mod?.default?.createTransport;
    if (typeof createTransport !== 'function') {
      throw new Error('SmtpTransport: `nodemailer` loaded but exposes no createTransport()');
    }
    return { createTransport } as NodemailerLike;
  }

  private async getTransporter(): Promise<NodemailerTransporterLike> {
    if (!this.transporter) {
      this.transporter = (async () => {
        const nodemailer = await this.loadNodemailer();
        const smtpOptions = this.buildSmtpOptions();
        this.opts.logger?.info?.(
          `SmtpTransport: connecting to ${smtpOptions.host}:${smtpOptions.port} `
          + `(implicitTls=${smtpOptions.secure}, requireStartTls=${smtpOptions.requireTLS}, `
          + `auth=${smtpOptions.auth ? 'yes' : 'no'})`,
        );
        return nodemailer.createTransport(smtpOptions);
      })().catch((err) => {
        // Do not cache a failed construction — a settings fix should be
        // retried on the next send rather than sticking to the first error.
        this.transporter = undefined;
        throw err;
      });
    }
    return this.transporter;
  }

  async send(message: NormalizedEmailMessage): Promise<TransportSendResult> {
    const transporter = await this.getTransporter();
    // nodemailer owns MIME construction: RFC 2047 header encoding (so a
    // Chinese subject survives), quoted-printable / base64 bodies, multipart
    // alternative for text+html, and dot-stuffing.
    const mail: Record<string, unknown> = {
      from: message.from,
      to: message.to,
      subject: message.subject,
    };
    if (message.text !== undefined) mail.text = message.text;
    if (message.html !== undefined) mail.html = message.html;
    if (message.cc?.length) mail.cc = message.cc;
    if (message.bcc?.length) mail.bcc = message.bcc;
    if (message.replyTo) mail.replyTo = message.replyTo;
    if (message.headers && Object.keys(message.headers).length > 0) mail.headers = message.headers;
    if (message.attachments?.length) {
      mail.attachments = message.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        ...(a.contentType ? { contentType: a.contentType } : {}),
        ...(a.cid ? { cid: a.cid } : {}),
      }));
    }

    const info = await transporter.sendMail(mail);
    const messageId = String(info?.messageId ?? '');
    if (!messageId) {
      throw new Error('SMTP: server accepted the message but returned no Message-ID');
    }
    return {
      messageId,
      response: info?.response ? String(info.response) : 'smtp:ok',
    };
  }

  /** Release the underlying transporter (pooled connections). Best effort. */
  async close(): Promise<void> {
    const pending = this.transporter;
    this.transporter = undefined;
    if (!pending) return;
    try {
      const transporter = await pending;
      transporter.close?.();
    } catch {
      /* already failed to build — nothing to close */
    }
  }
}

/**
 * Translate a `mail` settings-namespace snapshot into {@link SmtpTransportOptions}.
 *
 * The settings manifest owns its key names (`smtp_host` / `smtp_port` /
 * `smtp_secure` / `smtp_user` / `smtp_password`); this transport owns its
 * own (`host` / `port` / `secure` / …). Exactly ONE conversion between the
 * two lives here, and every settings door goes through it — the hot-swap on
 * `settings:changed` and the `mail/test` action — so the two cannot drift
 * into different readings of "Use TLS". The transport itself never learns
 * the `smtp_*` vocabulary.
 *
 * Values arrive typed from the resolver but may be strings when supplied via
 * `OS_MAIL_SMTP_*` env — coerced here, at that boundary, and nowhere else.
 * `host` comes back `''` when unset; the caller decides how loud that is.
 */
export function smtpOptionsFromMailSettings(values: Record<string, unknown>): SmtpTransportOptions {
  const str = (v: unknown): string | undefined => {
    if (v == null) return undefined;
    const t = String(v).trim();
    return t === '' ? undefined : t;
  };
  const port = values.smtp_port == null || values.smtp_port === ''
    ? undefined
    : Number(values.smtp_port);
  const rawSecure = values.smtp_secure;
  const secure = rawSecure == null
    ? undefined
    : typeof rawSecure === 'string'
      ? !(rawSecure.trim().toLowerCase() === 'false' || rawSecure.trim() === '0')
      : Boolean(rawSecure);
  const user = str(values.smtp_user);
  const password = str(values.smtp_password);
  return {
    host: str(values.smtp_host) ?? '',
    ...(port != null && Number.isFinite(port) ? { port } : {}),
    ...(secure != null ? { secure } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}
