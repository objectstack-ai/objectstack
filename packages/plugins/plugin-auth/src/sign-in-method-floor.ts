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
 *   - a social or OIDC provider in force (`getPublicConfig().socialProviders`)
 *     whose credential pair resolves: a non-blank `clientId` AND `clientSecret`
 *     in the configuration it came from. A provider listed without them draws a
 *     button that signs nobody in, so it does not count;
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
 *   - `email_password_enabled` off when nothing else is in force after the save;
 *   - with email and password off after the save, the Google change that
 *     removes a Google provider in force and leaves nothing else:
 *     `google_enabled` off, or clearing a client credential that no environment
 *     variable and no stack config backs.
 *
 * Each is judged on the state AFTER the whole save (`batch`, every key the save
 * sets), not on one key against the rest as they stand: asked one key at a
 * time, `{ email_password_enabled: false, google_enabled: false }` on a
 * deployment with email and password plus Google passes both keys, since each
 * sees the other way in still standing, and writes both. So that batch is
 * refused, at both keys, and Google filled in together with email and password
 * turned off is accepted. A key the save does not set is read as it stands
 * (the running configuration, or for the `google_*` keys their resolved
 * settings); a key the save sets is read from the batch unless an environment
 * override is in force for it, which wins over what is saved; a cleared key
 * reads as its default (on, for both toggles), as the settings service's own
 * save-time view does.
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
   * Whether Google was declared at boot (stack config, both `GOOGLE_CLIENT_*`
   * variables, or an `auth:configure` handler), so no settings credential is
   * what keeps it.
   */
  stackConfiguredGoogle(): boolean;
  /**
   * Whether a provider in force holds a credential pair: a non-blank `clientId`
   * AND `clientSecret` in the configuration it came from. Google added from the
   * settings has one by construction (the apply adds it only with both).
   */
  providerHasCredentials(provider: { id: string; type: 'social' | 'oidc' }): boolean;
  env(): Record<string, string | undefined>;
}

const hasCredentialPair = (entry: unknown): boolean => {
  const { clientId, clientSecret } = (entry ?? {}) as { clientId?: unknown; clientSecret?: unknown };
  return typeof clientId === 'string' && clientId.trim() !== ''
    && typeof clientSecret === 'string' && clientSecret.trim() !== '';
};

/**
 * Whether each provider declared at boot (stack config, the env fallback, an
 * `auth:configure` handler) holds a credential pair, keyed `social:<id>` and
 * `oidc:<providerId>`: what {@link SignInMethodFloorDeps.providerHasCredentials}
 * answers from.
 */
export function providerCredentialIndex(socialProviders: unknown, oidcProviders: unknown): Map<string, boolean> {
  const index = new Map<string, boolean>();
  if (socialProviders && typeof socialProviders === 'object') {
    for (const [id, entry] of Object.entries(socialProviders as Record<string, unknown>)) {
      index.set(`social:${id}`, hasCredentialPair(entry));
    }
  }
  if (Array.isArray(oidcProviders)) {
    for (const entry of oidcProviders) {
      const id = (entry as { providerId?: unknown } | null)?.providerId;
      if (typeof id === 'string') index.set(`oidc:${id}`, hasCredentialPair(entry));
    }
  }
  return index;
}

const isSettingsGoogle = (p: { id?: string; type?: string } | undefined): boolean =>
  p?.id === 'google' && p?.type !== 'oidc';

/** A provider listed in force that can sign anyone in (see {@link SignInMethodFloorDeps.providerHasCredentials}). */
function providerCounts(
  deps: SignInMethodFloorDeps,
  p: { id?: string; type?: string; enabled?: boolean } | undefined,
): boolean {
  if (!p || p.enabled === false || typeof p.id !== 'string') return false;
  return deps.providerHasCredentials({ id: p.id, type: p.type === 'oidc' ? 'oidc' : 'social' });
}

/**
 * The ways in besides email and password that are in force now. `withoutGoogle`
 * leaves the settings-managed Google provider out, to judge a save that may
 * remove or add it.
 */
export async function otherSignInMethods(
  deps: SignInMethodFloorDeps,
  options: { withoutGoogle?: boolean } = {},
): Promise<OtherSignInMethod[]> {
  const config = deps.publicConfig();
  const methods: OtherSignInMethod[] = [];
  const providers = (config.socialProviders ?? []).filter(
    (p) => providerCounts(deps, p) && !(options.withoutGoogle && isSettingsGoogle(p)),
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
      'Turning email and password off would leave no way to sign in, so everyone would be locked out, ' +
      'administrators included. Keep or set up another sign-in method, before or in this save: Google sign-in on ' +
      'this page (client ID and secret), another social or OIDC provider, an enterprise SSO identity provider, or ' +
      'phone-number sign-in.',
    google:
      'With email and password off, this change to Google would leave no way to sign in, so everyone would be ' +
      'locked out, administrators included. Keep email and password sign-in on, or set up another sign-in method, ' +
      'before or in this save.',
  },
  'zh-CN': {
    emailPassword:
      '关闭邮箱/密码后将没有任何登录方式，所有人（包括管理员）都将无法登录。请在本次保存之前或同时保留或配置另一种登录方式：' +
      '本页的 Google 登录（客户端 ID 和密钥）、其他社交或 OIDC 登录、企业 SSO 身份提供方，或手机号登录。',
    google:
      '邮箱/密码登录关闭时，这项 Google 修改会导致没有任何登录方式，所有人（包括管理员）都将无法登录。' +
      '请保持邮箱/密码登录开启，或在本次保存之前或同时配置另一种登录方式。',
  },
  'ja-JP': {
    emailPassword:
      'メール/パスワードをオフにするとログイン方法がなくなり、管理者を含む全員がログインできなくなります。' +
      'この保存の前か同じ保存で、別のログイン方法を残すか設定してください（このページの Google ログイン' +
      '（クライアント ID とシークレット）、他のソーシャルまたは OIDC プロバイダー、エンタープライズ SSO の ID ' +
      'プロバイダー、または電話番号ログイン）。',
    google:
      'メール/パスワードログインがオフの状態でこの Google の変更を行うとログイン方法がなくなり、管理者を含む全員が' +
      'ログインできなくなります。メール/パスワードログインをオンのままにするか、この保存の前か同じ保存で別のログイン' +
      '方法を設定してください。',
  },
  'es-ES': {
    emailPassword:
      'Desactivar el correo y la contraseña dejaría sin ninguna forma de iniciar sesión, así que todo el mundo ' +
      'quedaría fuera, incluidos los administradores. Mantenga o configure otro método de inicio de sesión, antes ' +
      'o en este mismo guardado: el inicio de sesión con Google de esta página (ID y secreto de cliente), otro ' +
      'proveedor social u OIDC, un proveedor de identidad de SSO empresarial o el inicio de sesión con número de ' +
      'teléfono.',
    google:
      'Con el correo y la contraseña desactivados, este cambio en Google dejaría sin ninguna forma de iniciar ' +
      'sesión, así que todo el mundo quedaría fuera, incluidos los administradores. Mantenga activado el inicio de ' +
      'sesión con correo y contraseña o configure otro método, antes o en este mismo guardado.',
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
  /** Every key the save sets (`SettingsWritePredicateInput.batch`); absent, this key alone. */
  batch?: Readonly<Record<string, unknown>>;
  /** The caller's settings context, handed back to {@link AuthSettingReader}. */
  ctx?: unknown;
}

/** A refusal, in the settings service's `SettingsWriteRefusal` shape. */
export interface SignInFloorRefusal {
  message: string;
  constraint: { lastSignInMethod: 'email_password' | 'google' };
}

/** Reads one resolved `auth` setting as it stands (`SettingsService.get`). */
export type AuthSettingReader = (
  key: string,
  ctx: unknown,
) => Promise<{ value?: unknown; source?: string } | undefined>;

/** The same reading `bindAuthSettings` gives a stored toggle. */
function readToggle(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  if (typeof value === 'number') return value !== 0;
  return fallback;
}

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === 'string' && value.trim() === '');

/** The credential keys, each with the env variable `bindAuthSettings` falls back to. */
const GOOGLE_CREDENTIAL_ENV: Record<string, string> = {
  google_client_id: 'GOOGLE_CLIENT_ID',
  google_client_secret: 'GOOGLE_CLIENT_SECRET',
};

const GOOGLE_KEYS = ['google_enabled', ...Object.keys(GOOGLE_CREDENTIAL_ENV)];

export const SIGN_IN_FLOOR_KEYS = ['email_password_enabled', ...GOOGLE_KEYS];

/**
 * A key's value once the save is written: an environment override in force
 * wins; else the batch's value (`null` = cleared); else the value as it stands.
 */
async function valueAfter(
  read: AuthSettingReader,
  input: SignInFloorWriteInput,
  batch: Readonly<Record<string, unknown>>,
  key: string,
): Promise<unknown> {
  const now = await read(key, input.ctx);
  if (now?.source === 'env') return now.value;
  if (Object.prototype.hasOwnProperty.call(batch, key)) return batch[key] ?? null;
  return now?.value;
}

/**
 * Whether the settings-managed Google provider is in force once the save is
 * written, by the rule `bindAuthSettings` applies: off when `google_enabled`
 * is off; else kept when declared at boot; else in force with a client ID and
 * secret, each from the setting or its `GOOGLE_CLIENT_*` variable. A save that
 * sets no `google_*` key leaves it as it stands.
 */
async function googleAfter(
  deps: SignInMethodFloorDeps,
  read: AuthSettingReader,
  input: SignInFloorWriteInput,
  batch: Readonly<Record<string, unknown>>,
  googleNow: boolean,
): Promise<boolean> {
  if (!GOOGLE_KEYS.some((k) => Object.prototype.hasOwnProperty.call(batch, k))) return googleNow;
  if (!readToggle(await valueAfter(read, input, batch, 'google_enabled'), true)) return false;
  if (deps.stackConfiguredGoogle()) return deps.providerHasCredentials({ id: 'google', type: 'social' });
  const env = deps.env();
  for (const [key, envName] of Object.entries(GOOGLE_CREDENTIAL_ENV)) {
    const value = await valueAfter(read, input, batch, key);
    if (isBlank(value) && isBlank(env[envName])) return false;
  }
  return true;
}

/**
 * The write predicate shared by {@link SIGN_IN_FLOOR_KEYS}. It refuses when the
 * state after the whole save leaves email and password off and no other way in:
 * at `email_password_enabled` when the save turns it off, and at a `google_*`
 * key when the save removes a Google provider that was in force.
 */
export function signInMethodFloorPredicate(deps: SignInMethodFloorDeps, read: AuthSettingReader) {
  return async (input: SignInFloorWriteInput): Promise<SignInFloorRefusal | undefined> => {
    const { key, next, locale } = input;
    const batch = input.batch ?? { [key]: next };
    const config = deps.publicConfig();
    const emailPasswordAfter = Object.prototype.hasOwnProperty.call(batch, 'email_password_enabled')
      ? readToggle(await valueAfter(read, input, batch, 'email_password_enabled'), true)
      : config.emailPassword?.enabled !== false;
    if (emailPasswordAfter) return undefined;
    const googleNow = (config.socialProviders ?? []).some((p) => isSettingsGoogle(p) && providerCounts(deps, p));
    if (key !== 'email_password_enabled' && !googleNow) return undefined;
    if ((await otherSignInMethods(deps, { withoutGoogle: true })).length > 0) return undefined;
    if (await googleAfter(deps, read, input, batch, googleNow)) return undefined;
    return key === 'email_password_enabled'
      ? { message: signInFloorCopy(locale).emailPassword, constraint: { lastSignInMethod: 'email_password' } }
      : { message: signInFloorCopy(locale).google, constraint: { lastSignInMethod: 'google' } };
  };
}

/** The settings service surface this registers on (structural: no package edge). */
interface WritePredicateHost {
  registerWritePredicate(
    namespace: string,
    key: string,
    predicate: (input: SignInFloorWriteInput) => Promise<SignInFloorRefusal | undefined>,
  ): void;
  get(namespace: string, key: string, ctx?: unknown): Promise<{ value?: unknown; source?: string }>;
}

/**
 * Register the floor on the `settings` service. A service without write
 * predicates (or without `get`, which reads the keys a save leaves as they
 * stand) cannot refuse the save, which is said at `warn`; a key the service
 * does not carry cannot be saved, so there is nothing to guard and nothing said.
 */
export function registerSignInMethodFloor(
  settings: unknown,
  deps: SignInMethodFloorDeps,
  logger: { warn(message: string): void },
): void {
  const host = settings as Partial<WritePredicateHost> | undefined;
  if (typeof host?.registerWritePredicate !== 'function' || typeof host.get !== 'function') {
    logger.warn(
      '[auth] the settings service takes no write predicates, so saving the auth settings cannot refuse turning ' +
        'off the last sign-in method (auth.email_password_enabled, auth.google_*). Check another sign-in method ' +
        'is in force before turning email and password off.',
    );
    return;
  }
  const get = host.get.bind(host);
  const predicate = signInMethodFloorPredicate(deps, (key, ctx) => get('auth', key, ctx as never));
  for (const key of SIGN_IN_FLOOR_KEYS) {
    try {
      host.registerWritePredicate('auth', key, predicate);
    } catch {
      // No `auth` namespace or no such key on this service: nothing saves it.
    }
  }
}
