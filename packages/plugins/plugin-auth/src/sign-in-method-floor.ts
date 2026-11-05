// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The auth settings save keeps a way to sign in.
 *
 * Measured at `main` `b7075d9908`: Setup → Settings → Authentication, "Enable
 * email/password login" off, save — "Settings saved", while `socialProviders`
 * was empty and SSO off. From then on `POST /sign-in/email` answers 400
 * `EMAIL_PASSWORD_DISABLED` and the login page offers nothing that works, so
 * the next sign-out locks everyone out, the administrator included.
 *
 * `bindAuthSettings` applies a value AFTER it is stored, so a refusal there
 * leaves the console showing a saved value the runtime ignores. The refusal is
 * made at the save door instead: the settings service's write predicate
 * (`registerWritePredicate`), asked before any row is written. It refuses the
 * whole batch with `SETTINGS_VALIDATION` and an `invalid_value` field error at
 * the key, whose message says what to set up first.
 *
 * ## What counts as another way in
 *
 * What the login page still offers with email and password off — the facts its
 * "no sign-in method is available" state reads — plus the one path the host
 * states:
 *
 *   - a social or OIDC provider in force (`getPublicConfig().socialProviders`);
 *   - enterprise SSO switched on AND at least one `sys_sso_provider` row. The
 *     switch alone signs nobody in, and a store that cannot be read proves no
 *     row, so neither counts ({@link probeSsoProvidersPresence});
 *   - phone-number sign-in (`features.phoneNumber`): better-auth serves phone
 *     plus password with email and password off, and the code sign-in when SMS
 *     can deliver;
 *   - a host sign-in handoff the host declared (`hostSignInHandoff`).
 *
 * Not counted: `ssoOnlyMode` alone (it says an identity provider is in front;
 * that provider is one of the above or nothing), and magic link and passkeys,
 * which no login page offers (`PUBLIC_AUTH_FEATURES_NOT_ADVERTISED`).
 *
 * ## The changes refused
 *
 *   - `email_password_enabled` off while nothing else is in force;
 *   - while email and password is already off, the Google change that removes
 *     the last provider: `google_enabled` off, or clearing a client credential
 *     that no environment variable and no stack config backs.
 *
 * Each is judged on its own key against the RUNNING configuration (a predicate
 * sees one key), so a provider saved in the same batch does not count yet: the
 * message says to save it first.
 *
 * A deployment that stored the dead-end state before this check existed gets
 * back in with `OS_AUTH_EMAIL_PASSWORD_ENABLED=true`, the settings environment
 * override, which wins over the stored value, and a restart.
 */

import { resolveLocale } from '@objectstack/core';
import { probeSsoProvidersPresence, type BootProbeEngine } from './boot-sign-in-reachability.js';

/** A way in other than email and password, as {@link otherSignInMethods} names it. */
export type OtherSignInMethod = 'social_provider' | 'enterprise_sso' | 'phone_number' | 'host_handoff';

/** The subset of `AuthManager.getPublicConfig()` read here. */
export interface SignInMethodConfigView {
  emailPassword?: { enabled?: boolean };
  socialProviders?: Array<{ id?: string; type?: string; enabled?: boolean }>;
  features?: { sso?: boolean; phoneNumber?: boolean };
}

/** Live readers, asked at save time, never recorded at boot. */
export interface SignInMethodFloorDeps {
  publicConfig(): SignInMethodConfigView;
  /** The data engine `sys_sso_provider` is read from; `undefined` proves no row. */
  engine(): BootProbeEngine | undefined;
  hostSignInHandoff: boolean;
  /**
   * Whether Google was declared at boot (stack config, or both `GOOGLE_CLIENT_*`
   * variables), so no settings credential is what keeps it.
   */
  stackConfiguredGoogle(): boolean;
  env(): Record<string, string | undefined>;
}

/**
 * The ways in besides email and password that are in force now. `withoutGoogle`
 * leaves the settings-managed Google provider out, to judge a change that
 * removes it.
 */
export async function otherSignInMethods(
  deps: SignInMethodFloorDeps,
  options: { withoutGoogle?: boolean } = {},
): Promise<OtherSignInMethod[]> {
  const config = deps.publicConfig();
  const methods: OtherSignInMethod[] = [];
  const providers = (config.socialProviders ?? []).filter(
    (p) => p?.enabled !== false && !(options.withoutGoogle && p?.id === 'google' && p?.type !== 'oidc'),
  );
  if (providers.length > 0) methods.push('social_provider');
  if (config.features?.phoneNumber === true) methods.push('phone_number');
  if (deps.hostSignInHandoff) methods.push('host_handoff');
  if (config.features?.sso === true && (await probeSsoProvidersPresence(deps.engine())) === 'present') {
    methods.push('enterprise_sso');
  }
  return methods;
}

// ── Copy ─────────────────────────────────────────────────────────────────

interface SignInFloorCopy {
  emailPassword: string;
  google: string;
}

/** One entry per locale the settings bundle ships, as the currency lock's copy. */
export const SIGN_IN_FLOOR_COPY: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', SignInFloorCopy> = {
  en: {
    emailPassword:
      'Email and password is the only way to sign in here, so turning it off would lock everyone out, ' +
      'administrators included. First set up and save another sign-in method: Google sign-in on this page ' +
      '(client ID and secret), another social or OIDC provider, an enterprise SSO identity provider, or ' +
      'phone-number sign-in. Then turn this off.',
    google:
      'With email and password off, Google is the only way to sign in here, so this change would lock ' +
      'everyone out, administrators included. First turn email and password sign-in back on, or set up ' +
      'another sign-in method.',
  },
  'zh-CN': {
    emailPassword:
      '邮箱/密码是目前唯一的登录方式，关闭后所有人（包括管理员）都将无法登录。请先配置并保存另一种登录方式：' +
      '本页的 Google 登录（客户端 ID 和密钥）、其他社交或 OIDC 登录、企业 SSO 身份提供方，或手机号登录，然后再关闭此项。',
    google:
      '邮箱/密码登录已关闭，Google 是目前唯一的登录方式，这项修改会让所有人（包括管理员）都无法登录。' +
      '请先重新开启邮箱/密码登录，或配置另一种登录方式。',
  },
  'ja-JP': {
    emailPassword:
      'メール/パスワードは現在唯一のログイン方法のため、オフにすると管理者を含む全員がログインできなくなります。' +
      '先に別のログイン方法を設定して保存してください（このページの Google ログイン（クライアント ID とシークレット）、' +
      '他のソーシャルまたは OIDC プロバイダー、エンタープライズ SSO の ID プロバイダー、または電話番号ログイン）。' +
      'その後でオフにしてください。',
    google:
      'メール/パスワードログインがオフのため、Google が唯一のログイン方法です。この変更を行うと管理者を含む全員が' +
      'ログインできなくなります。先にメール/パスワードログインをオンに戻すか、別のログイン方法を設定してください。',
  },
  'es-ES': {
    emailPassword:
      'El correo y la contraseña son la única forma de iniciar sesión aquí, así que desactivarlos dejaría fuera ' +
      'a todo el mundo, incluidos los administradores. Configure y guarde primero otro método de inicio de sesión: ' +
      'el inicio de sesión con Google de esta página (ID y secreto de cliente), otro proveedor social u OIDC, un ' +
      'proveedor de identidad de SSO empresarial o el inicio de sesión con número de teléfono. Después, desactive ' +
      'esta opción.',
    google:
      'Con el correo y la contraseña desactivados, Google es la única forma de iniciar sesión aquí, así que este ' +
      'cambio dejaría fuera a todo el mundo, incluidos los administradores. Vuelva a activar primero el inicio de ' +
      'sesión con correo y contraseña o configure otro método.',
  },
};

const COPY_LOCALES = Object.keys(SIGN_IN_FLOOR_COPY);

/** The copy for a caller's locale: exact, then by language, else English. */
export function signInFloorCopy(locale: string | undefined): SignInFloorCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return SIGN_IN_FLOOR_COPY[(picked ?? 'en') as keyof typeof SIGN_IN_FLOOR_COPY];
}

// ── The predicates ───────────────────────────────────────────────────────

/** What the settings service asks a write predicate (the fields read here). */
export interface SignInFloorWriteInput {
  key: string;
  next: unknown;
  locale?: string;
}

/** A refusal, in the settings service's `SettingsWriteRefusal` shape. */
export interface SignInFloorRefusal {
  message: string;
  constraint: { lastSignInMethod: 'email_password' | 'google' };
}

/** The same reading `bindAuthSettings` gives a stored toggle. */
function readToggle(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** The keys guarded, each with the env variable `bindAuthSettings` falls back to. */
const GOOGLE_CREDENTIAL_ENV: Record<string, string> = {
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
};

export const SIGN_IN_FLOOR_KEYS = ['email_password_enabled', 'google_enabled', ...Object.keys(GOOGLE_CREDENTIAL_ENV)];

/**
 * Would this write remove the settings-managed Google provider? `google_enabled`
 * off removes it whatever declared it; a cleared credential removes it unless
 * the stack config declares Google or the env variable supplies the credential.
 */
function removesGoogle(deps: SignInMethodFloorDeps, key: string, next: unknown): boolean {
  if (key === 'google_enabled') return !readToggle(next, true);
  if (!isBlank(next) || deps.stackConfiguredGoogle()) return false;
  return isBlank(deps.env()[GOOGLE_CREDENTIAL_ENV[key]!]);
}

/** The write predicate shared by {@link SIGN_IN_FLOOR_KEYS}. */
export function signInMethodFloorPredicate(deps: SignInMethodFloorDeps) {
  return async ({ key, next, locale }: SignInFloorWriteInput): Promise<SignInFloorRefusal | undefined> => {
    if (key === 'email_password_enabled') {
      if (readToggle(next, true)) return undefined;
      if ((await otherSignInMethods(deps)).length > 0) return undefined;
      return { message: signInFloorCopy(locale).emailPassword, constraint: { lastSignInMethod: 'email_password' } };
    }
    const config = deps.publicConfig();
    if (config.emailPassword?.enabled !== false) return undefined;
    const googleInForce = (config.socialProviders ?? []).some((p) => p?.id === 'google' && p?.type !== 'oidc');
    if (!googleInForce || !removesGoogle(deps, key, next)) return undefined;
    if ((await otherSignInMethods(deps, { withoutGoogle: true })).length > 0) return undefined;
    return { message: signInFloorCopy(locale).google, constraint: { lastSignInMethod: 'google' } };
  };
}

/** The settings service surface this registers on (structural: no package edge). */
interface WritePredicateHost {
  registerWritePredicate(
    namespace: string,
    key: string,
    predicate: (input: SignInFloorWriteInput) => Promise<SignInFloorRefusal | undefined>,
  ): void;
}

/**
 * Register the floor on the `settings` service. A service without write
 * predicates cannot refuse the save, which is said at `warn`; a key the service
 * does not carry cannot be saved, so there is nothing to guard and nothing said.
 */
export function registerSignInMethodFloor(
  settings: unknown,
  deps: SignInMethodFloorDeps,
  logger: { warn(message: string): void },
): void {
  const host = settings as Partial<WritePredicateHost> | undefined;
  if (typeof host?.registerWritePredicate !== 'function') {
    logger.warn(
      '[auth] the settings service takes no write predicates, so saving the auth settings cannot refuse turning ' +
        'off the last sign-in method (auth.email_password_enabled, auth.google_*). Check another sign-in method ' +
        'is in force before turning email and password off.',
    );
    return;
  }
  const predicate = signInMethodFloorPredicate(deps);
  for (const key of SIGN_IN_FLOOR_KEYS) {
    try {
      host.registerWritePredicate('auth', key, predicate);
    } catch {
      // No `auth` namespace or no such key on this service: nothing saves it.
    }
  }
}
