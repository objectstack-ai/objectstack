// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25224 cut 5] The email and SMS delivery of `AuthManager` — the notice to
 * the address a change-email request moves an account away from, the
 * per-number phone OTP send guard and its admission check, the phone OTP and
 * SMS invitation sends with their quota wall, the read of a recipient's own
 * stored `sys_user.locale`, and the auth SMS body render — moved out of
 * `auth-manager.ts` whole, with the four module-level declarations that only
 * these bodies read: the SMS service's quota refusal code and its matcher, the
 * 429 the quota wall answers with, and the one ADR-0112 code both phone OTP
 * send walls carry.
 *
 * A MOVE, not a redesign. Each function below is the body of the
 * `AuthManager` method of the same name as it stood, re-indented one level
 * and otherwise unedited, and each module-level declaration is its text as it
 * stood in `auth-manager.ts`: the same sends, the same locale ladder, the same
 * refusals and codes, failing open and closed exactly where they did.
 *
 * ## How the moved bodies reach the class
 *
 * The shape #23050 set for `rest-server.ts` (its `data-action-routes.ts`
 * header carries the full reasoning), which `auth-manager-actor-guards.ts`,
 * `auth-manager-sign-in-lockout.ts`, `auth-manager-password-session-policy.ts`
 * and `auth-manager-database-hooks.ts` follow, applied per method. The class
 * keeps all seven methods — the published `dist/*.d.ts` lists each one's
 * name, docblock and position — and each body is one literal of exactly the
 * {@link EmailSmsDeliveryHost} members that method reads, plus a `.call`. The
 * six `async` methods are no longer `async`: each returns the moved function's
 * own promise, so a caller awaits the same promise the body settles, with no
 * extra wrapper.
 *
 * A method goes as a closure that calls it on the manager at call time, so a
 * test double or spy set on the manager is still the one a body reaches —
 * `storedRecipientLocale`, `renderPhoneSmsBody` and `getOtpSendGuard`
 * included, which the bodies here ask through the manager rather than calling
 * the functions here directly. `config` and `smsLocale` go as GETTERS: the
 * class reassigns both after construction (`setRuntimeBaseUrl` and
 * `applyConfigPatch`; `setDefaultSmsLocale`), so each is read off the manager
 * when the body reads it, as before. `_otpSendGuard` goes as a get/set pair,
 * because `getOtpSendGuard` creates the guard once and stores it on the
 * manager: the guard, and the per-number budget it counts, stays the one the
 * manager holds.
 *
 * The four module-level declarations move with the bodies rather than being
 * imported back: `index.ts` re-exports `auth-manager.ts` whole, so exporting
 * them from there would add them to the published surface, and a value import
 * of that file from here would be a cycle. Nothing re-exports this module, so
 * the published surface does not move.
 */

import type { StandardErrorCode } from '@objectstack/spec/api';
import type { AuthManager } from './auth-manager.js';
import { OtpSendGuard } from './otp-send-guard.js';
import {
  PHONE_SMS_TOPICS,
  interpolatePhoneSms,
  resolvePhoneSmsTemplateBody,
} from './phone-sms-texts.js';
// commit 35e94c96b — the stored rung of the ruled locale ladder reuses the messaging
// seam's normalizer rather than growing a second one. `normalizeRecipientLocale`
// is the platform's ONE reader of a value at rest in `sys_user.locale`, and its
// refusal of the stringified-nothing literals (`"undefined"`, `"null"`) is part
// of its contract — hotcrm measured that literal dead-lettering every delivery
// for every user without a preference row. A private copy here would be a
// second place for that refusal to rot.
import {
  RECIPIENT_LOCALE_FIELD,
  normalizeRecipientLocale,
} from '@objectstack/service-messaging';

/**
 * #6039 / #2814 — the error code an SMS service reports a QUOTA refusal with.
 *
 * `SmsService.send()` cannot throw an HTTP-shaped error: it is a kernel service
 * with no idea who is calling. It reports the deployment's daily cost ceiling
 * being hit as a normal failed result whose `error` carries the service's
 * `CODE: message` envelope — here `TOO_MANY_REQUESTS: daily SMS quota
 * exhausted`. Turning that back into an HTTP answer is the auth endpoint's job,
 * which is why the mapping lives here (see {@link isSmsQuotaRefusal}).
 *
 * **Source of truth**: `SMS_QUOTA_EXCEEDED_CODE` in
 * `packages/services/service-sms/src/sms-daily-quota.ts` (exported alongside
 * `SMS_QUOTA_EXCEEDED_ERROR`).
 *
 * **Why it is restated instead of imported**: `@objectstack/service-sms` already
 * depends on THIS package — its day counter imports `InProcessCounterStore` /
 * `incrementFixedWindow` from `@objectstack/plugin-auth` — so importing the
 * constant back would close a dependency cycle. This is the same call, in the
 * other direction, that `normalizeSmsRecipient` makes in
 * `packages/services/service-sms/src/sms-service.ts` ("Same shape rule as
 * plugin-auth's `normalizePhoneNumber` … kept local: the two packages must not
 * depend on each other").
 *
 * Only the envelope's CODE token crosses the boundary, never its prose: the
 * message half is service-owned and may be reworded without touching this
 * file. That token is the service's own spelling, which is better-call's
 * status NAME for 429; it is not an ADR-0112 error code (`ErrorCode` refuses
 * it as a reason-phrase alias of `RATE_LIMIT_EXCEEDED`). So it is only ever
 * MATCHED here, never put in a body: the code the 429 carries to the caller
 * is {@link PHONE_OTP_SEND_REFUSAL_CODE}.
 */
const SMS_QUOTA_EXCEEDED_CODE = 'TOO_MANY_REQUESTS';

/**
 * #6039 — is this `SendSmsResult.error` the quota wall's refusal?
 *
 * Matched as a PREFIX of the service's `CODE: message` envelope, never as a
 * substring: a transport failure puts the provider's raw text in `error`
 * (`SmsService` truncates it and reports it verbatim), and one that happens to
 * mention the code mid-sentence is still a transport failure — 500, not 429.
 */
function isSmsQuotaRefusal(error: string | undefined): boolean {
  return typeof error === 'string' && error.startsWith(`${SMS_QUOTA_EXCEEDED_CODE}:`);
}

/**
 * #6039 — the 429 an SMS quota refusal must reach the caller as.
 *
 * better-call (better-auth's router) maps ONLY `APIError` to a real HTTP status:
 * `isAPIError(err) = err instanceof APIError || err?.name === 'APIError'`
 * (better-call@1.4.0 `dist/utils.mjs:55-56`), consumed at `dist/router.mjs:92`,
 * where everything else takes the `console.error` + `500 / null body` branch
 * (`:93-97`; re-measured 2026-08-23 against the installed copy).
 * A plain `Error` therefore buried `TOO_MANY_REQUESTS` in a server log while the
 * per-number wall on the same endpoint ({@link AuthManager.assertPhoneOtpSendAllowed})
 * answered 429 — one endpoint, two voices.
 *
 * The message follows the per-number wall's shape and carries NO budget detail:
 * no ceiling, no remaining count, no reset clock. #2814's requirement is that
 * the two walls be indistinguishable from outside — an attacker must not learn
 * which budget they hit, and a legitimate caller needs no more than "not now".
 * (The per-number wall names its own retry window because it can compute one;
 * this wall states no time it cannot honestly promise.)
 *
 * The status is spelled out as better-call's name for 429 rather than read off
 * {@link SMS_QUOTA_EXCEEDED_CODE}: that constant is the service envelope's
 * token, matched on the way in, and the HTTP status is this endpoint's own.
 */
async function smsQuotaExceededApiError(message: string): Promise<Error> {
  const { APIError } = await import('better-auth/api');
  return new APIError('TOO_MANY_REQUESTS', { message, code: PHONE_OTP_SEND_REFUSAL_CODE });
}

/**
 * [#24243, ADR-0112] The ONE code both phone-OTP send walls answer with: the
 * deployment's daily SMS quota ({@link smsQuotaExceededApiError}) and the
 * per-number cooldown and hourly cap
 * ({@link AuthManager.assertPhoneOtpSendAllowed}). One code, not one per wall:
 * #2814 requires the two walls to be indistinguishable from outside, so a
 * caller learns "not now" and never which budget it hit. The standard
 * catalog's member for request pacing; `QUOTA_EXCEEDED` would name the first
 * wall alone, and so would tell them apart.
 */
const PHONE_OTP_SEND_REFUSAL_CODE: StandardErrorCode = 'RATE_LIMIT_EXCEEDED';

/**
 * The `AuthManager` members the functions below read — every one of them, and
 * no other; each function's `this` is the `Pick` of the members IT reads. Each
 * is typed AS the class member (an indexed access on the class), so a change
 * to a member's signature on the class is a change here too, and naming a
 * member the class does not have is a compile error. See the module header for
 * why `config` and `smsLocale` are getters and `_otpSendGuard` an accessor.
 */
export interface EmailSmsDeliveryHost {
  readonly config: AuthManager['config'];
  readonly smsLocale: AuthManager['smsLocale'];
  _otpSendGuard: AuthManager['_otpSendGuard'];
  emailLocaleArg: AuthManager['emailLocaleArg'];
  getAppName: AuthManager['getAppName'];
  getCanonicalOrigin: AuthManager['getCanonicalOrigin'];
  getConsolePageUrl: AuthManager['getConsolePageUrl'];
  getDataEngine: AuthManager['getDataEngine'];
  getEmailService: AuthManager['getEmailService'];
  getOtpSendGuard: AuthManager['getOtpSendGuard'];
  getSmsService: AuthManager['getSmsService'];
  isPhoneOtpDeliverable: AuthManager['isPhoneOtpDeliverable'];
  renderPhoneSmsBody: AuthManager['renderPhoneSmsBody'];
  storedRecipientLocale: AuthManager['storedRecipientLocale'];
}

/** The body of `AuthManager#sendChangeEmailNotice`; the method's docblock there is its contract. */
export async function sendChangeEmailNotice(
  this: Pick<EmailSmsDeliveryHost, 'config' | 'emailLocaleArg' | 'getAppName' | 'getEmailService' | 'storedRecipientLocale'>,
  from: { email: string; name?: string; id?: string },
  newEmail: string,
  requestSource?: unknown,
): Promise<void> {
  try {
    const email = this.getEmailService();
    if (!email) return;
    // The endpoint lower-cases `newEmail` before it does anything with it
    // (`update-user.mjs`: `ctx.body.newEmail.toLowerCase()`), so the raw body
    // spelling is not what would become the account identity. Report the
    // address that would actually land.
    const target = newEmail.trim().toLowerCase();
    if (!target) return;
    // commit 35e94c96b — the stored rung on top of the #14319 ladder. The recipient is
    // the account holder, so their own column outranks the header the
    // request happened to carry.
    const storedLocale = from.id ? await this.storedRecipientLocale({ id: from.id }) : undefined;
    await email.sendTemplate({
      template: 'auth.email_change_notice',
      to: { address: from.email, ...(from.name ? { name: from.name } : {}) },
      ...this.emailLocaleArg(requestSource, storedLocale),
      data: {
        user: { name: from.name || from.email, email: from.email, ...(from.id ? { id: from.id } : {}) },
        newEmail: target,
        appName: this.getAppName(),
      },
      relatedObject: 'sys_user',
      ...(from.id ? { relatedId: from.id } : {}),
      // [ADR-0131 D7, Q2 A] A notice to the account holder: identity mail.
      identityMail: true,
    });
  } catch (err) {
    // Best-effort by design — see the ⛔ above. Logged so an operator can see
    // a notice was lost; never rethrown, so the change-email flow cannot be
    // taken down by its own security notification.
    this.config.logger?.warn?.('AuthManager: change-email notice to the previous address failed', {
      error: (err as Error)?.message,
    });
  }
}

/** The body of `AuthManager#getOtpSendGuard`; the method's docblock there is its contract. */
export function getOtpSendGuard(this: Pick<EmailSmsDeliveryHost, '_otpSendGuard' | 'config'>): OtpSendGuard {
  if (!this._otpSendGuard) {
    const otpCfg = this.config.phoneOtp ?? {};
    // WHERE the budget is counted decides whether it is a budget at all
    // (#4790): counted per process, a declared "5 per hour" is 5×N across N
    // nodes. Precedence, most deliberate first:
    //  1. a host-supplied `secondaryStorage` — an explicit cross-node KV;
    //  2. `sharedCounterStore` — AuthPlugin's lazily-resolved kernel `cache`,
    //     which also announces the degraded (no cache) case loudly;
    //  3. neither → the guard's own bounded per-process store.
    const storeOption = this.config.secondaryStorage
      ? { storage: this.config.secondaryStorage }
      : this.config.sharedCounterStore
        ? { resolveStore: this.config.sharedCounterStore }
        : {};
    this._otpSendGuard = new OtpSendGuard({
      ...(otpCfg.cooldownSeconds != null ? { cooldownSeconds: otpCfg.cooldownSeconds } : {}),
      ...(otpCfg.maxPerHour != null ? { maxPerHour: otpCfg.maxPerHour } : {}),
      ...storeOption,
    });
  }
  return this._otpSendGuard;
}

/** The body of `AuthManager#assertPhoneOtpSendAllowed`; the method's docblock there is its contract. */
export async function assertPhoneOtpSendAllowed(this: Pick<EmailSmsDeliveryHost, 'getOtpSendGuard' | 'isPhoneOtpDeliverable'>, phone: string): Promise<void> {
  if (!phone || !this.isPhoneOtpDeliverable()) return;
  const decision = await this.getOtpSendGuard().checkAndRecord(phone);
  if (!decision.ok) {
    const { APIError } = await import('better-auth/api');
    throw new APIError('TOO_MANY_REQUESTS', {
      message: `Too many verification codes requested for this phone number. Retry in ${decision.retryAfterSeconds ?? 60}s.`,
      // The quota wall's code too (#2814): see PHONE_OTP_SEND_REFUSAL_CODE.
      code: PHONE_OTP_SEND_REFUSAL_CODE,
    });
  }
}

/** The body of `AuthManager#deliverPhoneOtp`; the method's docblock there is its contract. */
export async function deliverPhoneOtp(this: Pick<EmailSmsDeliveryHost, 'config' | 'getAppName' | 'getSmsService' | 'isPhoneOtpDeliverable' | 'renderPhoneSmsBody' | 'storedRecipientLocale'>, phone: string, code: string): Promise<void> {
  const sms = this.getSmsService();
  if (!sms || !this.isPhoneOtpDeliverable()) {
    // Absent service, or a log-only transport in production (the code
    // would vanish into a log no user can read) — refuse loudly, as a real
    // `APIError` like the quota branch below: better-call maps ONLY an
    // `APIError` to a status, and a plain `Error` reached the caller as a
    // 500 with a null body, leaving the login page nothing to branch on.
    // 400 + `SMS_SERVICE_REQUIRED` mirrors the email sibling
    // (`EMAIL_SERVICE_REQUIRED`, also 400): a delivery service this request
    // needs is not configured on this deployment. The code is registered
    // for this package in the ADR-0112 error-code ledger. The message names
    // the capability and the fix, and never the OTP code.
    const { APIError } = await import('better-auth/api');
    throw new APIError('BAD_REQUEST', {
      message:
        'Phone verification codes are unavailable: this deployment has no configured SMS ' +
        'delivery service. An administrator can configure one under Setup → Settings → SMS ' +
        'Delivery; until then, sign in with your phone number and password.',
      code: 'SMS_SERVICE_REQUIRED',
    });
  }
  const otpCfg = this.config.phoneOtp ?? {};
  const minutes = Math.max(1, Math.round((otpCfg.expiresIn ?? 300) / 60));
  // #2815 — localised, tenant-customisable body: a sys_notification_template
  // row for (auth.phone_otp, sms, resolved locale) wins; the built-in
  // bilingual text is the fallback. Purpose-neutral wording on purpose —
  // one provider template covers sign-in and reset, and the SMS reveals
  // nothing about what the code unlocks.
  //
  // commit 35e94c96b — the recipient of an OTP IS the user, so the locale is theirs to
  // name: `sys_user.locale` first, the deployment default underneath.
  //
  // ⚠️ The row is looked up here rather than taken from the callback: the
  // card's suggested shape assumed `sendPhoneOtp` already held one, and it
  // does not — better-auth's phone-number plugin calls both `sendOTP` and
  // `sendPasswordResetOTP` with `{ phoneNumber, code }` and no user
  // (measured in the installed 1.7.x `routes.mjs`; `request-password-reset`
  // resolves the user for its own gate and does not pass it on). One
  // projected read on the unique `phone_number` index is the cost, paid only
  // once the send is going to happen, and swallowed on any failure.
  //
  // ⚠️ Matched EXACTLY, as better-auth matches it for its own user lookup on
  // the same route — a caller that posts a differently formatted spelling of
  // a stored number resolves no row and lands on the deployment default,
  // which is the documented floor rather than a failure.
  const storedLocale = await this.storedRecipientLocale({ phone_number: phone });
  const body = await this.renderPhoneSmsBody(
    PHONE_SMS_TOPICS.otp,
    {
      code,
      appName: this.getAppName(),
      minutes,
    },
    storedLocale,
  );
  const result = await sms.send({
    to: phone,
    body,
    // Template-only providers (Aliyun) substitute into a registered OTP
    // template; `code` is the conventional variable name.
    templateParams: { code },
  });
  if (result.status === 'failed') {
    // #6039 — the deployment's daily SMS quota refused this send. Answer it
    // the way the per-number wall on this same endpoint answers: a real
    // `APIError`, hence 429 TOO_MANY_REQUESTS instead of a 500 with a null
    // body. Everything else stays a plain Error — a transport outage IS a
    // server-side failure and 500 is the honest answer for it.
    if (isSmsQuotaRefusal(result.error)) {
      throw await smsQuotaExceededApiError(
        'Too many verification codes requested. Please try again later.',
      );
    }
    // `result.error` is transport detail (never the code) — safe to surface.
    throw new Error(`Phone OTP could not be sent: ${result.error ?? 'SMS delivery failed'}`);
  }
}

/** The body of `AuthManager#sendPhoneInviteSms`; the method's docblock there is its contract. */
export async function sendPhoneInviteSms(this: Pick<EmailSmsDeliveryHost, 'getAppName' | 'getCanonicalOrigin' | 'getConsolePageUrl' | 'getSmsService' | 'renderPhoneSmsBody' | 'storedRecipientLocale'>, phone: string): Promise<void> {
  const sms = this.getSmsService();
  if (!sms) {
    throw new Error('SMS_SERVICE_REQUIRED: no SMS service is configured for this deployment.');
  }
  // #2815 — localised, tenant-customisable body (see deliverPhoneOtp).
  // `loginUrl` points at the actual Console sign-in page; `baseUrl` (bare
  // origin) is kept for backward-compatibility with tenant-overridden
  // templates that still interpolate `{{baseUrl}}`.
  //
  // #14641 — the invitee's OWN stored language, on the same two branches the
  // invitation EMAIL takes. A number that resolves no row, or a row naming no
  // language, keeps the deployment default. Matched exactly on
  // `phone_number`, the same predicate {@link deliverPhoneOtp} matches on.
  //
  // ⚠️ What this yields TODAY, so the next reader does not over-read it: the
  // one in-repo caller (the identity import endpoint's `invite` policy)
  // CREATES the account before sending, so a ROW is always there — but
  // `admin-import-users.ts` never writes `locale` and the column declares no
  // default, so the value is empty at send time and this path still resolves
  // to the deployment default, exactly as it did before #14641. The rung is
  // wired, not yet exercised in-repo: it answers for an out-of-repo caller,
  // or for a future import that populates the column. ⛔ Do not read this
  // site as a behaviour change users see today — that one is on the
  // invitation EMAIL, whose invitee may already hold a locale-bearing row.
  const storedLocale = await this.storedRecipientLocale({ phone_number: phone });
  const body = await this.renderPhoneSmsBody(
    PHONE_SMS_TOPICS.invite,
    {
      appName: this.getAppName(),
      baseUrl: this.getCanonicalOrigin(),
      loginUrl: this.getConsolePageUrl('/login'),
    },
    storedLocale,
  );
  const result = await sms.send({ to: phone, body, templateParams: { content: body } });
  if (result.status === 'failed') {
    // #6039 — same quota wall, same outward shape as the OTP path above.
    // (The one in-repo caller, admin import-users, catches this per row and
    // records INVITE_SMS_FAILED rather than failing the request — so what
    // changes there is that the row's message no longer carries the raw
    // service envelope. The 429 matters for any caller that surfaces this
    // rejection directly, which is what a public AuthManager method must be
    // correct for.)
    if (isSmsQuotaRefusal(result.error)) {
      throw await smsQuotaExceededApiError(
        'Too many SMS messages requested. Please try again later.',
      );
    }
    throw new Error(`Invitation SMS failed: ${result.error ?? 'SMS delivery failed'}`);
  }
}

/** The body of `AuthManager#storedRecipientLocale`; the method's docblock there is its contract. */
export async function storedRecipientLocale(this: Pick<EmailSmsDeliveryHost, 'getDataEngine'>, where: Record<string, unknown>): Promise<string | undefined> {
  const engine = this.getDataEngine();
  if (!engine || typeof engine.findOne !== 'function') return undefined;
  try {
    const row = await engine.findOne('sys_user', {
      where,
      fields: [RECIPIENT_LOCALE_FIELD],
      context: { isSystem: true, positions: [], permissions: [] },
    } as never);
    return normalizeRecipientLocale((row as Record<string, unknown> | null | undefined)?.[RECIPIENT_LOCALE_FIELD]);
  } catch {
    // A `sys_user` shape without the column, a datasource outage, an engine
    // that rejects the projection — all mean "no stored language", never
    // "no mail".
    return undefined;
  }
}

/** The body of `AuthManager#renderPhoneSmsBody`; the method's docblock there is its contract. */
export async function renderPhoneSmsBody(
  this: Pick<EmailSmsDeliveryHost, 'config' | 'getDataEngine' | 'smsLocale'>,
  topic: string,
  data: Record<string, unknown>,
  storedLocale?: string,
): Promise<string> {
  const locale = storedLocale ?? this.smsLocale;
  let organizationId: string | null = null;
  try {
    organizationId = (await this.config.getTenancy?.()?.defaultOrgId()) ?? null;
  } catch {
    organizationId = null;
  }
  const template = await resolvePhoneSmsTemplateBody(this.getDataEngine(), topic, locale, organizationId);
  return interpolatePhoneSms(template, data);
}
