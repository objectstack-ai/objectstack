// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The global `auth.mfa_required` switch cannot be saved on while the
 * deployment pins two-factor enrollment off (ADR-0069 D3).
 *
 * ## The gap this closes
 *
 * The settings pass applies `mfa_required = true` as ONE piece with
 * `plugins.twoFactor: true` (`auth-plugin.ts`, `bindAuthSettings`), so the
 * requirement is never in force without its enrollment path. But whether the
 * twoFactor plugin is wired is decided by {@link resolveTwoFactorEnabled},
 * which reads the `OS_AUTH_TWO_FACTOR` env var FIRST: under
 * `OS_AUTH_TWO_FACTOR=false` the piece's `plugins.twoFactor: true` changes
 * nothing. The switch then saved and read on in Setup while nobody could
 * enroll, and the per-user gate, which holds only a user who can enroll
 * (`resolveUserAuthGates`), enforced nothing. The organization column already
 * refuses this state (`organization-mfa-enrollment-guard.ts`); this is the
 * same refusal at the global switch.
 *
 * ## Where it is refused
 *
 * At the save door: the settings service's write predicate
 * (`registerWritePredicate`), asked before any row is written. The settings
 * pass runs AFTER the value is stored, so a refusal there would leave the
 * console showing a saved value the runtime ignores. A refusal refuses the
 * whole save with `SETTINGS_VALIDATION` and an `invalid_value` field error at
 * `mfa_required`, in the caller's language, naming the env var.
 *
 * ## The rule
 *
 * A save that turns `mfa_required` ON (from a stored or default off) is
 * refused while turning the twoFactor plugin on would still leave enrollment
 * off: {@link resolveTwoFactorEnabled} over `plugins.twoFactor: true`, the
 * config the piece applies, answers false. That is exactly an
 * `OS_AUTH_TWO_FACTOR` value reading as off. Turning the switch off, saving a
 * value already in force (the settings service asks a predicate only about a
 * change), and every save with the env var unset or on pass untouched.
 *
 * The rule depends on the env var alone, not on another `auth` key, so a key
 * judged on its own cannot be let through by a sibling key in the same save.
 *
 * A switch saved on before this check, under the pin, is not touched: the
 * gate does not enforce it, and `GET /api/v1/auth/config` answers
 * `features.twoFactor: false`, the reading a console uses to say so.
 */

import { resolveLocale } from '@objectstack/core';
import { resolveTwoFactorEnabled } from './auth-manager.js';

/** The `auth` settings key this guards. */
export const MFA_REQUIRED_SETTING_KEY = 'mfa_required';

/** The env var that outranks the settings for two-factor enrollment. */
export const TWO_FACTOR_ENV = 'OS_AUTH_TWO_FACTOR';

/** The same reading `bindAuthSettings` gives a stored toggle. */
function readToggle(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  if (typeof value === 'number') return value !== 0;
  return false;
}

/**
 * Whether a user could enroll once the switch's settings piece is applied:
 * the decision point the gate, the plugin list and `features.twoFactor` read,
 * over the plugin config the piece sets.
 */
export function twoFactorEnrollableWithSwitchOn(): boolean {
  return resolveTwoFactorEnabled({ twoFactor: true });
}

/** The refusal, per language. */
export const MFA_REQUIRED_ENROLLMENT_COPY = {
  en:
    'Multi-factor authentication cannot be required on this deployment yet: OS_AUTH_TWO_FACTOR is set to off, ' +
    'and it overrides this setting, so nobody could enroll an authenticator app and the requirement would not be ' +
    'enforced. Set OS_AUTH_TWO_FACTOR=true (or remove it) on the deployment and restart, then turn this on.',
  'zh-CN':
    '本部署暂时无法强制多因素认证：OS_AUTH_TWO_FACTOR 被设为关闭，它的优先级高于本设置，' +
    '因此没有人能绑定身份验证器应用，这项要求也不会生效。请先在部署上设置 OS_AUTH_TWO_FACTOR=true（或删除它）并重启，再开启此项。',
  'ja-JP':
    'このデプロイではまだ多要素認証を必須にできません。OS_AUTH_TWO_FACTOR がオフに設定されており、' +
    'この設定より優先されるため、誰も認証アプリを登録できず、この要件は適用されません。デプロイで ' +
    'OS_AUTH_TWO_FACTOR=true を設定する（または削除する）して再起動してから、これをオンにしてください。',
  'es-ES':
    'Todavía no se puede exigir la autenticación multifactor en esta implementación: OS_AUTH_TWO_FACTOR está ' +
    'desactivado y prevalece sobre este ajuste, así que nadie podría registrar una aplicación de autenticación y ' +
    'el requisito no se aplicaría. Establezca OS_AUTH_TWO_FACTOR=true (o elimínelo) en la implementación, ' +
    'reinicie y después active esta opción.',
} as const;

const COPY_LOCALES = Object.keys(MFA_REQUIRED_ENROLLMENT_COPY);

/** The copy for a caller's locale: exact, then by language, else English. */
export function mfaRequiredEnrollmentCopy(locale: string | undefined): string {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return MFA_REQUIRED_ENROLLMENT_COPY[(picked ?? 'en') as keyof typeof MFA_REQUIRED_ENROLLMENT_COPY];
}

/** What the settings service asks a write predicate (the fields read here). */
export interface MfaRequiredWriteInput {
  next: unknown;
  current: unknown;
  locale?: string;
}

/** A refusal, in the settings service's `SettingsWriteRefusal` shape. */
export interface MfaRequiredWriteRefusal {
  message: string;
  constraint: { twoFactor: false; overriddenBy: typeof TWO_FACTOR_ENV };
}

/** The `auth.mfa_required` write predicate. */
export function mfaRequiredEnrollmentPredicate(
  enrollable: () => boolean = twoFactorEnrollableWithSwitchOn,
): (input: MfaRequiredWriteInput) => MfaRequiredWriteRefusal | undefined {
  return ({ next, current, locale }) => {
    if (!readToggle(next) || readToggle(current)) return undefined;
    if (enrollable()) return undefined;
    return {
      message: mfaRequiredEnrollmentCopy(locale),
      constraint: { twoFactor: false, overriddenBy: TWO_FACTOR_ENV },
    };
  };
}

/** The settings service surface this registers on (structural: no package edge). */
interface WritePredicateHost {
  registerWritePredicate(
    namespace: string,
    key: string,
    predicate: (input: MfaRequiredWriteInput) => MfaRequiredWriteRefusal | undefined,
  ): void;
}

/**
 * Register the predicate on the `settings` service. A service without write
 * predicates cannot refuse the save; that is said at `warn` when it matters,
 * that is while the env var pins enrollment off. A service without the `auth`
 * namespace or the key cannot save it, so there is nothing to guard.
 */
export function registerMfaRequiredEnrollmentPredicate(
  settings: unknown,
  logger: { warn(message: string): void },
): void {
  const host = settings as Partial<WritePredicateHost> | undefined;
  if (typeof host?.registerWritePredicate !== 'function') {
    if (!twoFactorEnrollableWithSwitchOn()) {
      logger.warn(
        `[auth] the settings service takes no write predicates, so saving auth.mfa_required on cannot be refused ` +
          `while ${TWO_FACTOR_ENV} is set to off, which overrides it: such a save reads as on while nobody can ` +
          `enroll and nothing is enforced. Set ${TWO_FACTOR_ENV}=true before requiring multi-factor authentication.`,
      );
    }
    return;
  }
  try {
    host.registerWritePredicate('auth', MFA_REQUIRED_SETTING_KEY, mfaRequiredEnrollmentPredicate());
  } catch {
    // No `auth` namespace or no such key on this service: nothing saves it.
  }
}
