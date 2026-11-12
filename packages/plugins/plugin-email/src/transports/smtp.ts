// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Socket } from 'node:net';
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
  /**
   * SMTP port. Default 587 (submission). 465 selects implicit TLS.
   *
   * ⚠️ An **integer** in `1-65535`, refused at construction otherwise —
   * `number` cannot say that in the type, and a fractional port is not a
   * near miss but an address `net.connect` will never accept (commit 33fbd3566).
   */
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
   * routinely needed belongs on this interface. `disableFileAccess` and
   * `disableUrlAccess` are always `true`; a value given here does not change them.
   */
  transportOptions?: Record<string, unknown>;
  /**
   * The host's connect policy ({@link SmtpConnectPolicy}). Applied after
   * `transportOptions`, which may then carry none of
   * {@link SMTP_CONNECT_POLICY_REFUSED_TRANSPORT_OPTIONS}, an OAuth2 `auth`
   * nor a `tls.socket`. Absent: the transport connects exactly as it does without one.
   */
  connect?: SmtpConnectPolicy;
  /** Diagnostic logger. */
  logger?: { info: (msg: string, meta?: any) => void; warn?: (msg: string, meta?: any) => void };
}

/**
 * The connection nodemailer is about to open, as handed to
 * {@link SmtpConnectPolicy.getSocket}: the configured `host` and `port`, plus
 * the rest of the resolved transport options.
 */
export interface SmtpConnectRequest {
  host?: string;
  port?: number;
  [key: string]: unknown;
}

/**
 * Where a host lets an SMTP transport connect.
 *
 * `getSocket` is nodemailer's own transport hook, called for every connection
 * the transport opens. It admits a connection by opening the socket itself
 * and handing it back as `{ connection }` (TLS, STARTTLS and SNI then still
 * run against the configured host name), and refuses one by calling back with
 * an error, whose message is what the failed send reports. An answer without
 * a socket fails the connection.
 */
export interface SmtpConnectPolicy {
  getSocket(request: SmtpConnectRequest, callback: SmtpConnectCallback): void;
}

/** How {@link SmtpConnectPolicy.getSocket} answers: an error, or the socket it opened. */
export type SmtpConnectCallback = (err: Error | null, socket?: { connection: Socket }) => void;

/** What nodemailer's own `getSocket` callback accepts. */
type NodemailerSocketCallback = (err: Error | null, socket?: { connection: Socket } | false) => void;

/** The error a connection fails with when the policy admits it without handing back a socket. */
export const SMTP_CONNECT_POLICY_NO_SOCKET =
  'SmtpTransport: the connect policy admitted a connection without handing back a socket';

/**
 * `transportOptions` keys an {@link SmtpTransport} refuses while a connect
 * policy is set: each one chooses the socket or the transport kind itself,
 * or opens a connection of its own. An OAuth2 `auth` and a `tls` block
 * naming a `socket` are refused too.
 */
export const SMTP_CONNECT_POLICY_REFUSED_TRANSPORT_OPTIONS = [
  'send',
  'proxy',
  'url',
  'sendmail',
  'streamTransport',
  'jsonTransport',
  'SES',
  'connection',
  'socket',
] as const;

/** An `auth` block nodemailer reads as OAuth2. */
function isOAuth2Auth(auth: unknown): boolean {
  if (!auth || typeof auth !== 'object') return false;
  return String((auth as { type?: unknown }).type ?? '').trim().toUpperCase() === 'OAUTH2';
}

/** Refuse, naming the key, a connect policy the transport could not keep. */
function assertConnectPolicyHolds(
  connect: SmtpConnectPolicy,
  transportOptions: Record<string, unknown> | undefined,
): void {
  if (typeof connect?.getSocket !== 'function') {
    throw new Error('SmtpTransport: the connect policy has no getSocket function');
  }
  const extra = transportOptions ?? {};
  for (const key of SMTP_CONNECT_POLICY_REFUSED_TRANSPORT_OPTIONS) {
    if (Object.prototype.hasOwnProperty.call(extra, key) && extra[key] !== undefined) {
      throw new Error(
        `SmtpTransport: transportOptions.${key} cannot be used while a connect policy is set`,
      );
    }
  }
  // Present at all is enough here: the TLS options are copied over the admitted socket.
  if (extra.tls !== null && typeof extra.tls === 'object' && 'socket' in extra.tls) {
    throw new Error(
      'SmtpTransport: transportOptions.tls.socket cannot be used while a connect policy is set',
    );
  }
  if (isOAuth2Auth(extra.auth)) {
    throw new Error(
      'SmtpTransport: transportOptions.auth of type OAuth2 cannot be used while a connect policy is set',
    );
  }
}

/**
 * Ask the policy, passing its refusal on; an answer that carries no socket
 * fails the connection rather than letting nodemailer open one itself.
 */
function admitOnlyWithSocket(
  connect: SmtpConnectPolicy,
  request: SmtpConnectRequest,
  callback: NodemailerSocketCallback,
): void {
  connect.getSocket(request, (err, socket) => {
    if (err) return callback(err);
    if (!socket || !(socket as { connection?: unknown }).connection) {
      return callback(new Error(SMTP_CONNECT_POLICY_NO_SOCKET));
    }
    return callback(null, socket);
  });
}

/** Minimal structural view of the nodemailer surface this transport uses. */
interface NodemailerLike {
  createTransport(options: Record<string, unknown>): NodemailerTransporterLike;
}
interface NodemailerTransporterLike {
  sendMail(mail: Record<string, unknown>): Promise<{ messageId?: string; response?: string; rejected?: unknown[] }>;
  close?(): void;
}

/**
 * A message's text, html and attachment content reach this transport only as
 * a string or as bytes, so the transport never reads a server file or fetches
 * a URL on a message's behalf. Set on every transport this class builds and
 * on every message it hands over, after `transportOptions`, and not
 * configurable.
 */
const SMTP_CONTENT_ACCESS_CLOSED = Object.freeze({
  disableFileAccess: true,
  disableUrlAccess: true,
});

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
    // The rule is declared ONCE, in `smtp-port-contract.ts`, and the sentence
    // below is GENERATED from it. A hand-written `(expected 1-65535)` on this
    // line is exactly the drift #12993 removed: it sat next to the check it
    // described, so the two could disagree and nothing would fail — which is
    // not hypothetical. They DID disagree until commit 33fbd3566: the check admitted
    // `587.5` and the sentence said `1-65535`, a range `587.5` satisfies. The
    // guard tests integrality now and the generated sentence says so, so the
    // two still cannot drift apart without one of them being rewritten.
    if (!isValidSmtpPort(port)) {
      throw new Error(formatInvalidSmtpPortNotice(opts.port));
    }
    this.port = port;
    // A connect policy the transport cannot keep is refused here, not at send.
    if (opts.connect !== undefined) this.buildSmtpOptions();
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
    const connect = this.opts.connect;
    if (connect !== undefined) assertConnectPolicyHolds(connect, this.opts.transportOptions);
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
      // After `transportOptions`, so the escape hatch cannot reopen them.
      ...SMTP_CONTENT_ACCESS_CLOSED,
      // Last, so nothing above can replace the host's connect policy.
      ...(connect !== undefined
        ? { getSocket: (request: SmtpConnectRequest, callback: NodemailerSocketCallback) => admitOnlyWithSocket(connect, request, callback) }
        : {}),
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
      // On the message as well as on the transport, so the rule holds
      // whichever transport `transportOptions` selects.
      ...SMTP_CONTENT_ACCESS_CLOSED,
    };
    if (message.text !== undefined) mail.text = message.text;
    if (message.html !== undefined) mail.html = message.html;
    if (message.cc?.length) mail.cc = message.cc;
    if (message.bcc?.length) mail.bcc = message.bcc;
    if (message.replyTo) mail.replyTo = message.replyTo;
    // Custom headers go to nodemailer as an explicit list of name/value
    // entries, one per key of the contract's `Record<string, string>`, so
    // every key is read as exactly one header name: the list is the one
    // `headers` form nodemailer reads without interpreting the container.
    if (message.headers && Object.keys(message.headers).length > 0) {
      mail.headers = Object.entries(message.headers).map(([key, value]) => ({ key, value }));
    }
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
 *
 * ## `absent` and `present but unreadable` are not the same thing
 *
 * Only an ABSENT `smtp_port` — and the empty string, deliberately — omits
 * `port` and lets {@link SmtpTransport} apply its built-in 587. A port that
 * is PRESENT and does not coerce to a finite number is passed through as the
 * number it coerced to, so the transport's own guard refuses it by name
 * (`isValidSmtpPort` / `formatInvalidSmtpPortNotice`).
 *
 * This function used to drop the key in BOTH cases, which converted a loud
 * refusal into a silent default one layer above the guard that exists to be
 * loud: `smtp_port: 'abc'` became a working-looking connection to 587, and
 * `describe()` reported 587 as though it had been chosen. Both doors that
 * feed this function really do admit such a value — MEASURED, not argued:
 * the `OS_MAIL_SMTP_PORT` env override resolves as the string `'abc'`
 * (`source: 'env'`, `locked: true`), because a non-numeric value is not
 * *outside* a numeric window and the settings service's declared
 * `min: 1, max: 65535` therefore does not reject it; and the ordinary save
 * path stores the same value for the same reason. So the refusal has to
 * happen at or below this line — and below is where it already lives.
 * ⛔ Do not add a second, parallel refusal here.
 *
 * `smtp_port: ''` stays in the absent bucket on purpose: an empty field is
 * how a settings form spells "not set", and refusing it would convert a
 * working configuration into a boot-time refusal.
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
    // `undefined` is the ONLY bucket that may fall back to the transport's
    // 587: it means the key was absent (or empty). A present-but-unreadable
    // port keeps its coerced value — `NaN`, `Infinity` — so `SmtpTransport`
    // refuses it, instead of this line silently deleting the setting.
    ...(port !== undefined ? { port } : {}),
    ...(secure != null ? { secure } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
  };
}
