// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30201] An organization cannot require multi-factor authentication while
 * nobody can enroll a second factor (ADR-0069 D3).
 *
 * ## The dead end this closes
 *
 * An organization's multi-factor level is its `access_policy.mfa_required`
 * setting (scope `tenant`, `organization-access-policy.ts`; it was the
 * `sys_organization.require_mfa` column before the requirement had levels).
 * The per-user MFA gate holds every unenrolled member the level names once
 * their grace period ends (`resolveUserAuthGates`, `MFA_REQUIRED`). The only
 * way to enroll is better-auth's `twoFactor` plugin (`/two-factor/*`), which
 * is off by default; on such a deployment a held member is sent to enroll and
 * the enrollment endpoint answers 404, and nobody can undo it from inside the
 * product, because Setup sits behind the same gate.
 *
 * The deployment's switch never had this hole: the `auth.mfa_required`
 * setting applies the requirement and the plugin as ONE piece (`auth-plugin.ts`,
 * the settings binding). An organization's setting has no such pairing, and
 * cannot have one: the plugin's switch is process configuration, re-applied at
 * every boot from the `auth` settings and `OS_AUTH_TWO_FACTOR`, and nothing
 * that builds the plugin list reads an organization's settings. So the save is
 * refused, and says why and what to do.
 *
 * ## The rule
 *
 * The settings service asks a write predicate only about a CHANGE to the key
 * (`refuseByWritePredicates`). While
 * {@link organizationMfaEnrollmentPredicate}'s `isTwoFactorEnabled` answers
 * false, a change to a level other than `off` is refused — `SETTINGS_VALIDATION`
 * with an `invalid_value` field error at `mfa_required`, in the caller's
 * language. Clearing the key, choosing `off`, re-saving the level in force and
 * every save while two-factor is on pass untouched.
 *
 * A level stored before this check is not touched: the gate does not enforce
 * a requirement nobody can comply with (`resolveUserAuthGates`), so such a row
 * locks no one out; it starts holding members, with a fresh grace window, once
 * two-factor is turned on.
 */

import { resolveLocale } from '@objectstack/core';
import type { SettingsCopyLocale } from './settings-copy-locale.js';
import { isMfaRequirementLevel } from './organization-access-policy.js';

/**
 * The locales the copy below carries: every language on the platform locale
 * table ({@link SettingsCopyLocale}); English is the fallback.
 */
type CopyLocale = SettingsCopyLocale;

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
  'zh-Hant':
    '本組織暫時無法強制多因素驗證：本部署未開啟雙重驗證的綁定，寬限期結束後所有成員（包括擁有者）都會被攔截，' +
    '且無法綁定驗證器應用程式。請先開啟雙重驗證，再在這裡開啟此項：在部署上設定 OS_AUTH_TWO_FACTOR=true。' +
    '只要部署上沒有把 OS_AUTH_TWO_FACTOR 設為 false（它的優先順序高於設定），開啟 auth.mfa_required 設定也可以：' +
    '它會對所有組織強制多因素驗證，並同時開啟綁定。',
  ar:
    'لا تستطيع هذه المؤسسة فرض المصادقة متعددة العوامل بعد: تسجيل المصادقة الثنائية متوقف على هذا النشر، لذا ' +
    'عند انتهاء فترة السماح سيُحظر كل عضو، بمن فيهم المالك، دون أي طريقة لتسجيل تطبيق مصادقة. فعّل المصادقة ' +
    'الثنائية أولًا ثم اشترطها هنا: اضبط OS_AUTH_TWO_FACTOR=true على النشر. وما لم يكن OS_AUTH_TWO_FACTOR ' +
    'مضبوطًا على false هناك (فهو يتقدّم على الإعدادات)، فإن تفعيل الإعداد auth.mfa_required يفي بالغرض أيضًا: ' +
    'فهو يفرض المصادقة متعددة العوامل على كل المؤسسات ويفعّل التسجيل معه.',
  fr:
    'Cette organisation ne peut pas encore exiger l’authentification multifacteur : l’enregistrement à deux ' +
    'facteurs est désactivé sur ce déploiement, si bien qu’à la fin du délai de grâce tous les membres, ' +
    'propriétaire compris, seraient bloqués sans moyen d’enregistrer une application d’authentification. Activez ' +
    'd’abord les deux facteurs, puis exigez-les ici : définissez OS_AUTH_TWO_FACTOR=true sur le déploiement. Sauf ' +
    'si OS_AUTH_TWO_FACTOR y est défini sur false (il prévaut sur les paramètres), activer le paramètre ' +
    'auth.mfa_required fonctionne aussi : il exige l’authentification multifacteur pour toutes les organisations ' +
    'et active l’enregistrement en même temps.',
  'pt-BR':
    'Esta organização ainda não pode exigir a autenticação multifator: o cadastro de dois fatores está desativado ' +
    'nesta implantação, então, ao fim do período de carência, todos os membros, inclusive o proprietário, ficariam ' +
    'bloqueados sem como cadastrar um aplicativo autenticador. Ative primeiro os dois fatores e depois exija-os ' +
    'aqui: defina OS_AUTH_TWO_FACTOR=true na implantação. A menos que OS_AUTH_TWO_FACTOR esteja definido como false ' +
    'lá (ele prevalece sobre as configurações), ativar a configuração auth.mfa_required também funciona: ela exige ' +
    'a autenticação multifator em todas as organizações e ativa o cadastro junto.',
  ru:
    'Эта организация пока не может требовать многофакторную аутентификацию: подключение двухфакторной ' +
    'аутентификации в этом развёртывании выключено, поэтому по окончании льготного периода все участники, включая ' +
    'владельца, были бы заблокированы без возможности подключить приложение-аутентификатор. Сначала включите ' +
    'двухфакторную аутентификацию, затем требуйте её здесь: установите OS_AUTH_TWO_FACTOR=true в развёртывании. ' +
    'Если там OS_AUTH_TWO_FACTOR не установлен в false (он имеет приоритет над настройками), подойдёт и включение ' +
    'настройки auth.mfa_required: она требует многофакторную аутентификацию во всех организациях и вместе с этим ' +
    'включает подключение.',
  de:
    'Diese Organisation kann die Multi-Faktor-Authentifizierung noch nicht verlangen: Die Einrichtung der ' +
    'Zwei-Faktor-Authentifizierung ist in dieser Bereitstellung ausgeschaltet. Nach Ablauf der Schonfrist wäre daher ' +
    'jedes Mitglied, der Eigentümer eingeschlossen, gesperrt, ohne eine Authenticator-App einrichten zu können. ' +
    'Schalten Sie zuerst die Zwei-Faktor-Authentifizierung ein und verlangen Sie sie dann hier: Setzen Sie ' +
    'OS_AUTH_TWO_FACTOR=true in der Bereitstellung. Sofern OS_AUTH_TWO_FACTOR dort nicht auf false gesetzt ist (es ' +
    'hat Vorrang vor den Einstellungen), genügt auch das Einschalten der Einstellung auth.mfa_required: Sie verlangt ' +
    'die Multi-Faktor-Authentifizierung für alle Organisationen und schaltet die Einrichtung gleich mit ein.',
  ko:
    '이 조직은 아직 다단계 인증을 필수로 설정할 수 없습니다. 이 배포에서는 2단계 인증 등록이 꺼져 있으므로, 유예 ' +
    '기간이 끝나면 소유자를 포함한 모든 구성원이 인증 앱을 등록할 방법 없이 차단됩니다. 먼저 2단계 인증을 켠 다음 ' +
    '여기에서 필수로 설정하세요. 배포에서 OS_AUTH_TWO_FACTOR=true로 설정하면 됩니다. 배포에서 OS_AUTH_TWO_FACTOR ' +
    '값이 false로 설정되어 있지 않다면(이 값은 설정보다 우선합니다) auth.mfa_required 설정을 켜는 방법도 있습니다. 이 ' +
    '설정은 모든 조직에 다단계 인증을 요구하고 등록도 함께 켭니다.',
};

const COPY_LOCALES = Object.keys(ORGANIZATION_MFA_REFUSAL_COPY);

/** The refusal in the caller's language: `resolveLocale` over the platform locale table, else English. */
export function organizationMfaRefusalCopy(locale: string | undefined): string {
  const picked = typeof locale === 'string' && locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return ORGANIZATION_MFA_REFUSAL_COPY[(picked ?? 'en') as CopyLocale];
}

/** True when `value`, saved as an organization's `access_policy.mfa_required`, names a requirement. */
export function namesMfaRequirement(value: unknown): boolean {
  return isMfaRequirementLevel(value) && value !== 'off';
}

/**
 * `access_policy.mfa_required`'s enrollment check, as a settings write
 * predicate. `isTwoFactorEnabled` is read per write (`AuthManager.isTwoFactorEnabled`,
 * the answer the plugin list and `features.twoFactor` give), so a settings
 * pass that turns the plugin on admits the next save.
 */
export function organizationMfaEnrollmentPredicate(
  isTwoFactorEnabled: () => boolean,
): (input: unknown) => { message: string; constraint: { twoFactorEnabled: false } } | undefined {
  return (input) => {
    const { next, locale } = (input ?? {}) as { next?: unknown; locale?: string };
    if (!namesMfaRequirement(next)) return undefined;
    if (isTwoFactorEnabled()) return undefined;
    return { message: organizationMfaRefusalCopy(locale), constraint: { twoFactorEnabled: false } };
  };
}
