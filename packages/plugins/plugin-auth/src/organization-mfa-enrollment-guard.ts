// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30201] An organization cannot require multi-factor authentication while
 * nobody can enroll a second factor (ADR-0069 D3).
 *
 * ## The dead end this closes
 *
 * `sys_organization.require_mfa` is a generically editable extension column
 * (`MANAGED_EXTENSION_EDITABLE_FIELDS`): an administrator ticks it on the
 * organization's edit form and it saves. The per-user MFA gate then holds every
 * unenrolled member once their grace period ends (`resolveUserAuthGates`,
 * `MFA_REQUIRED`). The only way to enroll is better-auth's `twoFactor` plugin
 * (`/two-factor/*`), which is off by default; on such a deployment the held
 * member was sent to enroll and the enrollment endpoint answered 404. Every
 * member, the owner included, was locked out, and nobody could undo it from
 * inside the product, because Setup sits behind the same gate.
 *
 * The global switch never had this hole: the `auth.mfa_required` setting
 * applies the requirement and the plugin as ONE piece (`auth-plugin.ts`, the
 * settings binding), so the requirement is never in force without its
 * enrollment path. The organization column had no such pairing.
 *
 * ## Why the write is refused rather than paired
 *
 * The plugin's switch is process configuration — the settings pass and the
 * `OS_AUTH_TWO_FACTOR` env var, re-applied at every boot — and an organization
 * row is data. Turning the plugin on from an organization write would hold in
 * the process that took the write only: it would not survive a restart or
 * reach another node, because nothing that builds the plugin list reads
 * organization rows. And turning it off again when the last organization
 * clears the column would silently drop the second factor of every member who
 * enrolled. So the card's own fallback is taken: the save is refused, and says
 * why and what to do.
 *
 * ## The rule
 *
 * While {@link OrganizationMfaEnrollmentGuardOptions.isTwoFactorEnabled}
 * answers false, a write that TURNS the requirement on is refused —
 * `400 VALIDATION_FAILED` with one `fields[]` entry, `require_mfa` /
 * `invalid_value` (the closed ADR-0114 catalog), built by `validationFailure`:
 *
 *  - an insert whose payload sets `require_mfa` to anything but an explicit
 *    off value;
 *  - an update whose payload does so for a row whose stored value is off.
 *
 * Clearing the column, writing other columns, re-sending `require_mfa: true`
 * for a row that already stores it (a whole-row SDK or MCP update, an import
 * re-run, a save with no change), and every write while two-factor is on pass
 * untouched. Refusing the unchanged value would block every other edit of
 * that row through a door that sends the whole record, for a value the gate
 * already does not enforce (below).
 *
 * The stored value is the update context's `previous`, which the engine binds
 * before `beforeUpdate` on BOTH update paths: the by-id write binds the row it
 * read, and a multi-row update fans out one context per matched row, each
 * with that row's `previous` and the one shared payload, before anything is
 * written. So a multi-row update is judged row by row, and one row turning
 * the requirement on refuses the whole write, rows that already stored it
 * included, with nothing written. An update context WITHOUT a `previous` is
 * judged as a change (refused): no engine path produces one, and an unproven
 * prior state is not evidence the value was already on.
 *
 * Judged for EVERY write context, the system's included, like the last-admin
 * guard: the lockout does not depend on who wrote the row.
 *
 * Rows stored before this guard are not touched. The gate itself does not
 * enforce a requirement nobody can comply with (`resolveUserAuthGates`), so
 * such a row locks no one out; it starts holding members, with a fresh grace
 * window, once two-factor is turned on.
 *
 * ## What the saver is told (#30411)
 *
 * Both answers are in the caller's language: the locale the request asked for
 * (`Accept-Language`, carried as `ExecutionContext.locale` and handed to every
 * hook as `ctx.session.locale`), matched against the four the copy carries
 * with core's `resolveLocale`, which is `resolveLocaleAmong`'s five steps
 * (exact, case-insensitive, platform locale table language, so `zh` reaches
 * `zh-CN`; base language; first registered variant), else English. The
 * table step only adds answers for the table's aliases: the copy carries no
 * `zh-Hant`, so `zh-TW` still reads `zh-CN`. A write with no caller
 * locale (a system write, a
 * seed) reads English. This is the same path the global switch's refusal takes
 * (`mfa-required-enrollment-predicate.ts`).
 *
 *  - The refusal above, with the field-level shape unchanged: the top-level
 *    `message` and the `require_mfa` entry's `message` are the same sentence.
 *  - A save the rule ADMITS that turns the requirement on (two-factor on, the
 *    stored value off, or an insert) answers a save notice
 *    (`ctx.notice(message)`, answered as the create / update answer's
 *    `notice`): who must now enroll, and the grace period in force, in days,
 *    read per write from
 *    {@link OrganizationMfaEnrollmentGuardOptions.mfaGracePeriodDays} — the
 *    number the gate's clock holds to. That is the one place an organization
 *    administrator reads the configured grace period: the `auth` settings it
 *    lives in are readable only with `manage_platform_settings`, which an
 *    organization administrator does not hold. A write that turns nothing on
 *    (a re-save of a stored `true`, a clear, another column) says nothing; a
 *    write no person waits on passes no listener, and the call sets nothing.
 */

import { resolveLocale } from '@objectstack/core';
import { SystemObjectName } from '@objectstack/spec/system';
import { validationFailure } from '@objectstack/types';

/** After the ADR-0092 D2 identity write guard (10), before default-priority hooks (100). */
export const ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY = 15;

export const REQUIRE_MFA_FIELD = 'require_mfa';

export interface OrganizationMfaEnrollmentGuardOptions {
  packageId: string;
  /**
   * Can a user enroll a second factor right now — is the twoFactor plugin
   * wired? Read per write (`AuthManager.isTwoFactorEnabled`, the same answer
   * the plugin list and `features.twoFactor` give), so a settings pass that
   * turns the plugin on admits the next write.
   */
  isTwoFactorEnabled: () => boolean;
  /**
   * The MFA grace period in force, in whole days — read per admitted write
   * that turns the requirement on, for its save notice
   * (`AuthManager.getMfaGracePeriodDays`, the same number the gate's clock
   * reads), so a settings change is told at once.
   */
  mfaGracePeriodDays: () => number;
}

/** The engine surface this guard uses. */
export interface OrganizationMfaEnrollmentGuardEngine {
  registerHook(
    event: string,
    handler: (ctx: any) => Promise<void>,
    options?: { object?: string; priority?: number; packageId?: string },
  ): void;
}

/**
 * The values that leave the requirement off. Anything else a payload carries
 * for the column — `true`, `1`, `'true'`, or a value the engine would refuse
 * later anyway — is judged as turning it on, so the guard never admits a value
 * the gate could read as a requirement.
 */
const OFF_VALUES: ReadonlySet<unknown> = new Set([false, 0, '0', 'false', null, undefined]);

/** True when `value`, written to `require_mfa`, turns the requirement on. */
export function turnsMfaRequirementOn(value: unknown): boolean {
  if (typeof value === 'string') return !OFF_VALUES.has(value.trim().toLowerCase());
  return !OFF_VALUES.has(value);
}

/** The locales the copy below carries; English is the fallback. */
type CopyLocale = 'en' | 'zh-CN' | 'ja-JP' | 'es-ES';

/**
 * The refusal, per language: what was refused, why, who it would have locked
 * out, and the ways forward. The second way is conditional because it is: the
 * `OS_AUTH_TWO_FACTOR` env var outranks the settings (`resolveTwoFactorEnabled`),
 * so under an `OS_AUTH_TWO_FACTOR=false` pin turning `auth.mfa_required` on
 * does not turn enrollment on. The env var and the setting key are named
 * verbatim in every language: they are what an operator types.
 */
export const ORGANIZATION_MFA_REFUSAL_COPY: Readonly<Record<CopyLocale, string>> = {
  en:
    'This organization cannot require multi-factor authentication yet: two-factor enrollment is off on this ' +
    'deployment, so once the grace period ended every member, the owner included, would be blocked with no way ' +
    'to enroll an authenticator app. Turn two-factor on first, then require it here: set OS_AUTH_TWO_FACTOR=true ' +
    'on the deployment. Unless OS_AUTH_TWO_FACTOR is set to false there (it overrides the settings), turning on ' +
    'the auth.mfa_required setting also works: it requires multi-factor authentication for every organization ' +
    'and turns enrollment on with it.',
  'zh-CN':
    '本组织暂时无法强制多因素认证：本部署未开启双重验证的绑定，宽限期结束后所有成员（包括所有者）都会被拦截，' +
    '且无法绑定身份验证器应用。请先开启双重验证，再在这里开启此项：在部署上设置 OS_AUTH_TWO_FACTOR=true。' +
    '只要部署上没有把 OS_AUTH_TWO_FACTOR 设为 false（它的优先级高于设置），开启 auth.mfa_required 设置也可以：' +
    '它会对所有组织强制多因素认证，并同时开启绑定。',
  'ja-JP':
    'この組織ではまだ多要素認証を必須にできません。このデプロイでは二要素認証の登録がオフになっているため、' +
    '猶予期間が終わると所有者を含むすべてのメンバーがブロックされ、認証アプリを登録する手段もありません。' +
    '先に二要素認証をオンにしてから、ここで必須にしてください：デプロイで OS_AUTH_TWO_FACTOR=true を設定します。' +
    'デプロイで OS_AUTH_TWO_FACTOR が false に設定されていない限り（これは設定より優先されます）、' +
    'auth.mfa_required 設定をオンにする方法もあります：すべての組織で多要素認証が必須になり、同時に登録もオンになります。',
  'es-ES':
    'Esta organización todavía no puede exigir la autenticación multifactor: el registro de dos factores está ' +
    'desactivado en esta implementación, así que al terminar el periodo de gracia todos los miembros, incluido el ' +
    'propietario, quedarían bloqueados sin forma de registrar una app de autenticación. Activa primero los dos ' +
    'factores y después exígelo aquí: define OS_AUTH_TWO_FACTOR=true en la implementación. Salvo que ' +
    'OS_AUTH_TWO_FACTOR esté definido como false allí (prevalece sobre los ajustes), también sirve activar el ' +
    'ajuste auth.mfa_required: exige la autenticación multifactor en todas las organizaciones y activa el ' +
    'registro con él.',
};

/**
 * The save notice, per language, for a grace period of `days` whole days:
 * who must now enroll, from when, and until when. `0` has its own sentence
 * (the block starts at the member's next use), as do the plurals.
 */
export const ORGANIZATION_MFA_REQUIRED_NOTICE_COPY: Readonly<Record<CopyLocale, (days: number) => string>> = {
  en: (days) =>
    days === 0
      ? 'Multi-factor authentication is now required for this organization. Every member who has not set up an ' +
        'authenticator app is blocked from data the next time they use the app, until they enroll one: the MFA ' +
        'grace period is 0 days. Members who already use an authenticator app are not affected. The MFA grace ' +
        'period is set in Setup → Authentication.'
      : 'Multi-factor authentication is now required for this organization. Every member who has not set up an ' +
        `authenticator app has ${days === 1 ? '1 day' : `${days} days`} to enroll one, counted from the first ` +
        'time they use the app while it is required; after that they are blocked from data until they do. Members ' +
        'who already use an authenticator app are not affected. The MFA grace period is set in Setup → ' +
        'Authentication.',
  'zh-CN': (days) =>
    days === 0
      ? '本组织现已强制多因素认证。尚未绑定身份验证器应用的成员下次使用应用时即无法访问数据，直到完成绑定：' +
        'MFA 宽限期为 0 天。已使用身份验证器应用的成员不受影响。MFA 宽限期可在“设置 → 认证”中修改。'
      : `本组织现已强制多因素认证。尚未绑定身份验证器应用的成员有 ${days} 天时间完成绑定，` +
        '从要求生效后他们第一次使用应用时起算；期满后，未绑定的成员将无法访问数据，直到完成绑定。' +
        '已使用身份验证器应用的成员不受影响。MFA 宽限期可在“设置 → 认证”中修改。',
  'ja-JP': (days) =>
    days === 0
      ? 'この組織では多要素認証が必須になりました。認証アプリをまだ登録していないメンバーは、次にアプリを' +
        '利用した時点から登録するまでデータにアクセスできなくなります（MFA 猶予期間は 0 日です）。' +
        'すでに認証アプリを使っているメンバーには影響しません。MFA 猶予期間は「設定 → 認証」で変更できます。'
      : 'この組織では多要素認証が必須になりました。認証アプリをまだ登録していないメンバーは、必須になってから' +
        `初めてアプリを利用した時点から ${days} 日以内に登録する必要があり、期限を過ぎると登録するまで` +
        'データにアクセスできなくなります。すでに認証アプリを使っているメンバーには影響しません。' +
        'MFA 猶予期間は「設定 → 認証」で変更できます。',
  'es-ES': (days) =>
    days === 0
      ? 'La autenticación multifactor ahora es obligatoria en esta organización. A cada miembro que no haya ' +
        'configurado una app de autenticación se le bloquea el acceso a los datos la próxima vez que use la app, ' +
        'hasta que la registre: el periodo de gracia de MFA es de 0 días. Los miembros que ya usan un ' +
        'autenticador no se ven afectados. El periodo de gracia de MFA se configura en Configuración → ' +
        'Autenticación.'
      : 'La autenticación multifactor ahora es obligatoria en esta organización. Cada miembro que no haya ' +
        `configurado una app de autenticación tiene ${days === 1 ? '1 día' : `${days} días`} para registrarla, ` +
        'a contar desde la primera vez que usa la app mientras sea obligatoria; después se le bloquea el acceso ' +
        'a los datos hasta que lo haga. Los miembros que ya usan un autenticador no se ven afectados. El periodo ' +
        'de gracia de MFA se configura en Configuración → Autenticación.',
};

const COPY_LOCALES = Object.keys(ORGANIZATION_MFA_REFUSAL_COPY);

/** The copy language for a caller's locale: `resolveLocaleAmong`'s five steps, else English. */
function copyLocaleFor(locale: string | undefined): CopyLocale {
  const picked = typeof locale === 'string' && locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return (picked ?? 'en') as CopyLocale;
}

/**
 * The refusal in the caller's language (`locale`, a BCP-47 tag as the request
 * asked for it; English when absent or unmatched). The field-level shape is
 * the same in every language: `VALIDATION_FAILED`, one `require_mfa` /
 * `invalid_value` entry whose `message` is the top-level one.
 */
export function organizationMfaWithoutEnrollmentRefusal(locale?: string): Error {
  const message = ORGANIZATION_MFA_REFUSAL_COPY[copyLocaleFor(locale)];
  return validationFailure(message, [{ field: REQUIRE_MFA_FIELD, code: 'invalid_value', message }]);
}

/** The save notice for an admitted write that turned the requirement on, in the caller's language. */
export function organizationMfaRequiredNotice(graceDays: number, locale?: string): string {
  return ORGANIZATION_MFA_REQUIRED_NOTICE_COPY[copyLocaleFor(locale)](graceDays);
}

/** The caller's locale as the engine hands it to a hook (`HookContext.session.locale`). */
function callerLocale(ctx: any): string | undefined {
  const locale = ctx?.session?.locale;
  return typeof locale === 'string' && locale.length > 0 ? locale : undefined;
}

/** True when an update context proves the row already stores the requirement on. */
function alreadyRequiresMfa(ctx: any): boolean {
  const previous = ctx?.previous as Record<string, unknown> | undefined;
  return !!previous && typeof previous === 'object' && turnsMfaRequirementOn(previous[REQUIRE_MFA_FIELD]);
}

/** Register the guard's insert and update hooks on `sys_organization`. */
export function registerOrganizationMfaEnrollmentGuard(
  engine: OrganizationMfaEnrollmentGuardEngine,
  opts: OrganizationMfaEnrollmentGuardOptions,
): void {
  const judge = (isUpdate: boolean) => async (ctx: any): Promise<void> => {
    const data = ctx?.input?.data as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object' || !(REQUIRE_MFA_FIELD in data)) return;
    if (!turnsMfaRequirementOn(data[REQUIRE_MFA_FIELD])) return;
    // Unchanged: the row already stores it on, so this write turns nothing on.
    if (isUpdate && alreadyRequiresMfa(ctx)) return;
    if (!opts.isTwoFactorEnabled()) throw organizationMfaWithoutEnrollmentRefusal(callerLocale(ctx));
    // Admitted, and it turns the requirement on: tell the saver who must
    // enroll and the grace period in force. `ctx.notice` is bound on every
    // insert / update dispatch and sets nothing when no one listens.
    const graceDays = opts.mfaGracePeriodDays();
    if (typeof ctx?.notice === 'function' && Number.isFinite(graceDays)) {
      ctx.notice(organizationMfaRequiredNotice(graceDays, callerLocale(ctx)));
    }
  };
  const options = {
    object: SystemObjectName.ORGANIZATION,
    priority: ORGANIZATION_MFA_ENROLLMENT_GUARD_PRIORITY,
    packageId: opts.packageId,
  };
  engine.registerHook('beforeInsert', judge(false), options);
  engine.registerHook('beforeUpdate', judge(true), options);
}
