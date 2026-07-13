// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Localised auth SMS texts (#2815).
 *
 * The phone OTP / invitation SMS bodies were hard-coded English (#2780).
 * They now resolve in two layers:
 *
 *  1. **Tenant-customisable templates** — a `sys_notification_template` row
 *     for `(topic, channel:'sms', locale)`, the same object the messaging
 *     `sms` channel renders. Operators edit them in Setup; the built-in
 *     rows below are seeded once and never overwrite an existing row.
 *  2. **Built-in fallback** — the bundled texts here (en + zh), used when
 *     no template row resolves (fresh env, missing table, exotic locale).
 *
 * The recipient locale is the DEPLOYMENT default (`localization.locale`
 * setting) — `sys_user` carries no per-user locale yet; when it grows one,
 * resolution should prefer it (tracked in #2815).
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
 * Built-in texts, seeded as template rows and used directly as the render
 * fallback. Holes use the same `{{ path }}` syntax as the messaging
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

/** Minimal engine surface the loader/seeder needs. */
export interface PhoneSmsTemplateEngine {
  find(objectName: string, query?: unknown): Promise<unknown>;
  insert(objectName: string, data: unknown, options?: unknown): Promise<unknown>;
}

const TEMPLATE_OBJECT = 'sys_notification_template';
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const data = (result as { data?: unknown } | null)?.data;
  return Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
}

/**
 * Load the tenant's template body for `(topic, 'sms', locale chain)`.
 * Best-effort: any lookup error (missing table, no engine) yields `null`
 * so the caller falls back to the built-in text — a template outage must
 * never block an OTP send.
 */
export async function loadPhoneSmsTemplateBody(
  engine: PhoneSmsTemplateEngine | undefined,
  topic: string,
  locale: string | undefined,
): Promise<string | null> {
  if (!engine) return null;
  for (const loc of phoneSmsLocaleChain(locale)) {
    try {
      const result = await engine.find(TEMPLATE_OBJECT, {
        where: { topic, channel: 'sms', locale: loc, is_active: true },
        limit: 1,
        context: SYSTEM_CTX,
      });
      const row = rowsOf(result)[0];
      const body = row?.body;
      if (typeof body === 'string' && body.trim()) return body;
    } catch {
      return null; // best-effort — fall back to the built-in text
    }
  }
  return null;
}

/**
 * Seed the built-in rows into `sys_notification_template`, one per
 * `(topic, 'sms', locale)`, **only when absent** — a tenant-customised (or
 * deactivated) row is never overwritten. Per-row failures are isolated;
 * the table may not exist yet on a fresh env (messaging provisions it at
 * kernel:ready), so callers log-and-continue.
 */
export async function seedPhoneSmsTemplates(
  engine: PhoneSmsTemplateEngine,
  logger?: { warn(msg: string): void },
): Promise<void> {
  for (const tpl of BUILTIN_PHONE_SMS_TEMPLATES) {
    try {
      const existing = await engine.find(TEMPLATE_OBJECT, {
        where: { topic: tpl.topic, channel: tpl.channel, locale: tpl.locale },
        limit: 1,
        context: SYSTEM_CTX,
      });
      if (rowsOf(existing).length > 0) continue;
      await engine.insert(TEMPLATE_OBJECT, { ...tpl }, { context: SYSTEM_CTX });
    } catch (err) {
      logger?.warn(
        `[AuthPlugin] phone SMS template seed failed for ${tpl.topic}/${tpl.locale}: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
