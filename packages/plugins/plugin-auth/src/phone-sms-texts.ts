// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Localised auth SMS texts (#2815).
 *
 * The phone OTP / invitation SMS bodies were hard-coded English (#2780).
 * They resolve one locale rung at a time — see
 * {@link resolvePhoneSmsTemplateBody}:
 *
 *  1. **A tenant template row** — a `sys_notification_template` row for
 *     `(topic, channel:'sms', locale)`, the same object the messaging `sms`
 *     channel renders. Operators author them in Setup; a row at a rung
 *     decides that rung.
 *  2. **The built-in text at that rung** — the bundled texts here (en + zh),
 *     when no row exists at that locale.
 *
 * The built-in texts used to be SEEDED into `sys_notification_template` as
 * rows on every boot with phone sign-in on (insert-if-missing). That seed is
 * retired (ADR-0131: a row exists only when an organization authored it; a
 * notification template has no metadata type, so its seed retires and no type
 * is added). The per-rung walk renders byte for byte what the seeded store
 * rendered — the seeder's rows were the built-in texts at the built-in
 * locales — and a row an operator already has keeps winning.
 *
 * The recipient locale reaching this module is resolved by the caller
 * (`AuthManager.renderPhoneSmsBody`), and commit 35e94c96b gave the OTP send a rung
 * above the deployment default: the recipient's own `sys_user.locale`
 * (#13881, ruling 2026-09-01 — the same column the messaging channels read
 * per recipient), then the DEPLOYMENT default (`localization.locale`
 * setting). There is no request rung on this surface: better-auth hands the
 * send-OTP callbacks `{ phoneNumber, code }` and nothing else, so the ruled
 * chain (#14788 option D, 2026-09-03) collapses to stored → deployment here.
 *
 * #14641 gave the SMS **invite** path the same two rungs, matched on
 * `phone_number`. A number that resolves no row — or a row naming no language
 * — keeps the deployment default. ⚠️ That is what the one in-repo caller gets
 * today: the identity import endpoint creates the account before sending, so a
 * ROW is always there, but it never writes `locale` and the column has no
 * default, so that flow still resolves to the deployment rung. The rung is
 * wired for an out-of-repo caller, or a future import that populates it.
 *
 * Whatever arrives, {@link phoneSmsLocaleChain}'s terminal `en` remains the
 * floor: this module never returns nothing, and an OTP never fails to render.
 *
 * Red line unchanged: the OTP code appears only in the rendered body handed
 * to the SMS service — never in logs or error messages.
 */

/** Topics the auth phone SMS templates live under. */
export const PHONE_SMS_TOPICS = {
  otp: 'auth.phone_otp',
  invite: 'auth.phone_invite',
} as const;

/** Shape of the `sys_notification_template` columns this module touches. */
export interface PhoneSmsTemplateRow {
  topic: string;
  channel: string;
  locale: string;
  subject?: string;
  body: string;
  format: string;
  is_active: boolean;
}

/**
 * Built-in texts — the text a rung renders when no template row exists at its
 * locale. Holes use the same `{{ path }}` syntax as the messaging
 * template renderer (service-messaging/template-renderer.ts).
 *
 * The OTP text is deliberately purpose-neutral (no "sign-in" vs "reset"
 * wording): one registered provider template covers both flows, and the
 * SMS reveals nothing about what the code unlocks.
 */
export const BUILTIN_PHONE_SMS_TEMPLATES: readonly PhoneSmsTemplateRow[] = [
  {
    topic: PHONE_SMS_TOPICS.otp,
    channel: 'sms',
    locale: 'en',
    subject: 'Verification code',
    body: '{{code}} is your {{appName}} verification code. It expires in {{minutes}} minutes.',
    format: 'text',
    is_active: true,
  },
  {
    topic: PHONE_SMS_TOPICS.otp,
    channel: 'sms',
    locale: 'zh',
    subject: '验证码',
    body: '您的 {{appName}} 验证码为 {{code}}，{{minutes}} 分钟内有效，请勿泄露给他人。',
    format: 'text',
    is_active: true,
  },
  {
    topic: PHONE_SMS_TOPICS.invite,
    channel: 'sms',
    locale: 'en',
    subject: 'Account invitation',
    body: 'Your {{appName}} account is ready. Sign in with this phone number using a verification code at {{loginUrl}}, then set your password.',
    format: 'text',
    is_active: true,
  },
  {
    topic: PHONE_SMS_TOPICS.invite,
    channel: 'sms',
    locale: 'zh',
    subject: '账号邀请',
    body: '您的 {{appName}} 账号已开通。请访问 {{loginUrl}}，使用本手机号通过验证码登录，然后设置您的密码。',
    format: 'text',
    is_active: true,
  },
];

/**
 * Locale resolution chain: `zh-CN` → `['zh-CN', 'zh', 'en']`. English is
 * always the terminal fallback — the built-in table is guaranteed to carry
 * an `en` row for every topic.
 */
export function phoneSmsLocaleChain(locale: string | undefined): string[] {
  const out: string[] = [];
  const push = (l?: string) => {
    const v = l?.trim();
    if (v && !out.includes(v)) out.push(v);
  };
  push(locale);
  if (locale && locale.includes('-')) push(locale.split('-')[0]);
  push('en');
  return out;
}

const TOKEN = /\{\{\s*([\w.$]+)\s*\}\}/g;

/**
 * `{{ hole }}` interpolation — same single-pass, logic-free semantics as
 * the messaging renderer's `interpolate` (kept local: plugin-auth takes no
 * dependency on service-messaging). Unknown holes render to ''.
 */
export function interpolatePhoneSms(template: string, data: Record<string, unknown>): string {
  if (!template) return '';
  return template.replace(TOKEN, (_m, path: string) => {
    const v = data[path];
    return v == null ? '' : String(v);
  });
}

/** Pick the built-in text for `(topic, locale chain)` — `en` always hits. */
export function builtinPhoneSmsBody(topic: string, locale: string | undefined): string {
  for (const loc of phoneSmsLocaleChain(locale)) {
    const row = BUILTIN_PHONE_SMS_TEMPLATES.find(
      (t) => t.topic === topic && t.locale === loc,
    );
    if (row) return row.body;
  }
  return '';
}

/** Minimal engine surface the template read needs. */
export interface PhoneSmsTemplateEngine {
  find(objectName: string, query?: unknown): Promise<Array<Record<string, unknown>>>;
}

const TEMPLATE_OBJECT = 'sys_notification_template';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/** The first stored row matching `where`, or `undefined`. */
async function firstTemplateRow(
  engine: PhoneSmsTemplateEngine,
  where: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const result = await engine.find(TEMPLATE_OBJECT, { where, limit: 1, context: SYSTEM_CTX });
  return result[0];
}

/**
 * The template body to send for `(topic, locale)` — never empty for a built-in
 * topic, and never blocked by a template outage.
 *
 * Walks {@link phoneSmsLocaleChain} one rung at a time:
 *
 *  1. an ACTIVE row at that locale with a non-blank body → its body;
 *  2. NO row at all at that locale → the built-in text at that locale, when
 *     one exists;
 *  3. otherwise (a deactivated or blank row there, or no built-in text for that
 *     locale) → the next rung.
 *
 * If no rung answers, the built-in walk ({@link builtinPhoneSmsBody}) is the
 * floor, as it is when the template read fails (missing table, no engine).
 *
 * This is exactly what the retired boot seed rendered. That seed inserted the
 * built-in text at every built-in `(topic, locale)` that held NO row, active or
 * not, and the read then took the first active, non-blank row along the chain,
 * with the built-in walk as its floor. So "no row at this locale" read the
 * built-in text there, a deactivated or blank row passed the rung on, and a row
 * an operator wrote wins at its rung. `phone-sms-seed-retired.test.ts` holds
 * the two equal against the seeded store, for every built-in text and locale.
 *
 * Best-effort: a failed template read yields the built-in text — a template
 * outage must never block an OTP send.
 */
export async function resolvePhoneSmsTemplateBody(
  engine: PhoneSmsTemplateEngine | undefined,
  topic: string,
  locale: string | undefined,
): Promise<string> {
  if (!engine) return builtinPhoneSmsBody(topic, locale);
  try {
    for (const loc of phoneSmsLocaleChain(locale)) {
      const where = { topic, channel: 'sms', locale: loc };
      const active = await firstTemplateRow(engine, { ...where, is_active: true });
      const body = active?.body;
      if (typeof body === 'string' && body.trim()) return body;
      const builtin = BUILTIN_PHONE_SMS_TEMPLATES.find((t) => t.topic === topic && t.locale === loc);
      if (builtin && !(await firstTemplateRow(engine, where))) return builtin.body;
    }
  } catch {
    // best-effort — fall back to the built-in text
  }
  return builtinPhoneSmsBody(topic, locale);
}
