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
 * with core's `resolveLocale` — exact, then by language (`zh` reaches
 * `zh-CN`), else English. A write with no caller locale (a system write, a
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
import type { SettingsCopyLocale } from './settings-copy-locale.js';
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

/**
 * The locales the copy below carries: every language on the platform locale
 * table ({@link SettingsCopyLocale}); English is the fallback.
 */
type CopyLocale = SettingsCopyLocale;

/** `n` whole days in Arabic: its six plural forms, the dual and the singular spelled out. */
function arabicDays(n: number): string {
  const rest = n % 100;
  if (n === 1) return 'يوم واحد';
  if (n === 2) return 'يومان';
  if (rest >= 3 && rest <= 10) return `${n} أيام`;
  if (rest >= 11 && rest <= 99) return `${n} يومًا`;
  return `${n} يوم`;
}

/** `n` whole days in Russian: день / дня / дней by the last one or two digits. */
function russianDays(n: number): string {
  const rest10 = n % 10;
  const rest100 = n % 100;
  if (rest10 === 1 && rest100 !== 11) return `${n} день`;
  if (rest10 >= 2 && rest10 <= 4 && (rest100 < 12 || rest100 > 14)) return `${n} дня`;
  return `${n} дней`;
}

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
  'zh-Hant': (days) =>
    days === 0
      ? '本組織現已強制多因素驗證。尚未綁定驗證器應用程式的成員下次使用應用程式時即無法存取資料，直到完成綁定：' +
        'MFA 寬限期為 0 天。已使用驗證器應用程式的成員不受影響。MFA 寬限期可在「設定 → 驗證」中修改。'
      : `本組織現已強制多因素驗證。尚未綁定驗證器應用程式的成員有 ${days} 天時間完成綁定，` +
        '從要求生效後他們第一次使用應用程式時起算；期滿後，未綁定的成員將無法存取資料，直到完成綁定。' +
        '已使用驗證器應用程式的成員不受影響。MFA 寬限期可在「設定 → 驗證」中修改。',
  ar: (days) =>
    days === 0
      ? 'أصبحت المصادقة متعددة العوامل إلزامية لهذه المؤسسة. كل عضو لم يُعدّ تطبيق مصادقة يُحظر من الوصول إلى ' +
        'البيانات في المرة التالية التي يستخدم فيها التطبيق، إلى أن يسجّل تطبيقًا: مدة فترة السماح للمصادقة متعددة ' +
        'العوامل 0 يوم. لا يتأثر الأعضاء الذين يستخدمون تطبيق مصادقة بالفعل. تُضبط فترة السماح في الإعداد ← المصادقة.'
      : `أصبحت المصادقة متعددة العوامل إلزامية لهذه المؤسسة. أمام كل عضو لم يُعدّ تطبيق مصادقة مهلة ${arabicDays(days)} ` +
        'لتسجيله، تُحسب من أول مرة يستخدم فيها التطبيق ما دام هذا الشرط قائمًا؛ وبعدها يُحظر من الوصول إلى البيانات ' +
        'إلى أن يسجّله. لا يتأثر الأعضاء الذين يستخدمون تطبيق مصادقة بالفعل. تُضبط فترة السماح في الإعداد ← المصادقة.',
  fr: (days) =>
    days === 0
      ? 'L’authentification multifacteur est désormais obligatoire pour cette organisation. Chaque membre qui n’a ' +
        'pas configuré d’application d’authentification perd l’accès aux données dès sa prochaine utilisation de ' +
        'l’application, jusqu’à ce qu’il en enregistre une : le délai de grâce MFA est de 0 jour. Les membres qui ' +
        'utilisent déjà une application d’authentification ne sont pas concernés. Le délai de grâce MFA se règle ' +
        'dans Configuration → Authentification.'
      : 'L’authentification multifacteur est désormais obligatoire pour cette organisation. Chaque membre qui n’a ' +
        `pas configuré d’application d’authentification dispose de ${days === 1 ? '1 jour' : `${days} jours`} pour ` +
        'en enregistrer une, à compter de sa première utilisation de l’application depuis que l’exigence est ' +
        'active ; passé ce délai, il perd l’accès aux données jusqu’à ce qu’il le fasse. Les membres qui utilisent ' +
        'déjà une application d’authentification ne sont pas concernés. Le délai de grâce MFA se règle dans ' +
        'Configuration → Authentification.',
  'pt-BR': (days) =>
    days === 0
      ? 'A autenticação multifator agora é obrigatória nesta organização. Cada membro que não configurou um ' +
        'aplicativo autenticador perde o acesso aos dados na próxima vez que usar o aplicativo, até cadastrar um: o ' +
        'período de carência de MFA é de 0 dias. Os membros que já usam um aplicativo autenticador não são ' +
        'afetados. O período de carência de MFA é definido em Configuração → Autenticação.'
      : 'A autenticação multifator agora é obrigatória nesta organização. Cada membro que não configurou um ' +
        `aplicativo autenticador tem ${days === 1 ? '1 dia' : `${days} dias`} para cadastrar um, contados a partir ` +
        'da primeira vez que usar o aplicativo enquanto a exigência estiver ativa; depois disso, perde o acesso aos ' +
        'dados até cadastrar. Os membros que já usam um aplicativo autenticador não são afetados. O período de ' +
        'carência de MFA é definido em Configuração → Autenticação.',
  ru: (days) =>
    days === 0
      ? 'Теперь в этой организации обязательна многофакторная аутентификация. Каждый участник, не настроивший ' +
        'приложение-аутентификатор, теряет доступ к данным при следующем использовании приложения, пока не ' +
        'подключит его: льготный период MFA — 0 дней. Участников, которые уже используют приложение-аутентификатор, ' +
        'это не затрагивает. Льготный период MFA задаётся в разделе «Настройка → Аутентификация».'
      : 'Теперь в этой организации обязательна многофакторная аутентификация. У каждого участника, не настроившего ' +
        `приложение-аутентификатор, есть ${russianDays(days)}, чтобы подключить его, считая с первого использования ` +
        'приложения после введения требования; после этого он теряет доступ к данным, пока не подключит приложение. ' +
        'Участников, которые уже используют приложение-аутентификатор, это не затрагивает. Льготный период MFA ' +
        'задаётся в разделе «Настройка → Аутентификация».',
  de: (days) =>
    days === 0
      ? 'Die Multi-Faktor-Authentifizierung ist für diese Organisation jetzt Pflicht. Jedes Mitglied, das noch keine ' +
        'Authenticator-App eingerichtet hat, ist ab der nächsten Nutzung der App vom Zugriff auf Daten gesperrt, bis ' +
        'es eine einrichtet: Die MFA-Schonfrist beträgt 0 Tage. Mitglieder, die bereits eine Authenticator-App ' +
        'nutzen, sind nicht betroffen. Die MFA-Schonfrist wird unter Einrichtung → Authentifizierung festgelegt.'
      : 'Die Multi-Faktor-Authentifizierung ist für diese Organisation jetzt Pflicht. Jedes Mitglied, das noch keine ' +
        `Authenticator-App eingerichtet hat, hat ${days === 1 ? '1 Tag' : `${days} Tage`} Zeit, eine einzurichten, ` +
        'gerechnet ab der ersten Nutzung der App, seit sie Pflicht ist; danach ist es vom Zugriff auf Daten ' +
        'gesperrt, bis es das tut. Mitglieder, die bereits eine Authenticator-App nutzen, sind nicht betroffen. Die ' +
        'MFA-Schonfrist wird unter Einrichtung → Authentifizierung festgelegt.',
  ko: (days) =>
    days === 0
      ? '이제 이 조직에서는 다단계 인증이 필수입니다. 인증 앱을 설정하지 않은 구성원은 다음에 앱을 사용할 때부터 ' +
        '인증 앱을 등록할 때까지 데이터에 접근할 수 없습니다(MFA 유예 기간 0일). 이미 인증 앱을 사용하는 구성원은 ' +
        '영향을 받지 않습니다. MFA 유예 기간은 설정 → 인증에서 변경할 수 있습니다.'
      : '이제 이 조직에서는 다단계 인증이 필수입니다. 인증 앱을 설정하지 않은 구성원은 필수가 된 뒤 앱을 처음 ' +
        `사용한 때부터 ${days}일 안에 인증 앱을 등록해야 하며, 그 이후에는 등록할 때까지 데이터에 접근할 수 ` +
        '없습니다. 이미 인증 앱을 사용하는 구성원은 영향을 받지 않습니다. MFA 유예 기간은 설정 → 인증에서 변경할 수 ' +
        '있습니다.',
};

const COPY_LOCALES = Object.keys(ORGANIZATION_MFA_REFUSAL_COPY);

/** The copy language for a caller's locale: exact, then by language, else English. */
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
