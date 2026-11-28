// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { resolveLocale } from '@objectstack/core';
import type { SettingsCopyLocale } from './settings-copy-locale.js';

/**
 * What Setup → Authentication states about email and password sign-in as it
 * RUNS, when that differs from the switch on the page.
 *
 * The switch shows what `auth.email_password_enabled` resolves to. With nothing
 * stored that is the deployment's own declaration (`emailAndPassword.enabled`,
 * `auth-settings-declared-defaults.ts`), which is what runs, so the switch
 * itself says it and nothing is stated. What the value still cannot say is a
 * stored value the runtime does not apply: on a cloud-managed runtime that
 * holds email and password off (`emailPasswordHeldOffByHost`), a value stored
 * on shows the switch on for a sign-in method that is off; and any other
 * disagreement between the switch and what runs. Likewise for
 * self-registration: a `signup_enabled` stored on, where the deployment forces
 * sign-up off (SSO-only, cloud-managed, `OS_DISABLE_SIGNUP`), shows the switch
 * on for a sign-up the runtime does not offer
 * ({@link describeSignUpLiveStatus}). Those head the page as a `warning`.
 *
 * The settings service's live-status seam (`registerLiveStatus`) is how a page
 * says what runs beside what is stored; its `values` serve option-bearing keys
 * only, so a toggle is stated in the banner that heads the page. Read at
 * request time, never recorded at boot.
 *
 * Same shape as service-settings' `SettingsLiveStatus`, restated because this
 * plugin reaches the settings service through a structural surface and takes
 * no package dependency on it.
 */
export interface AuthLiveStatus {
  label: string;
  bannerText: string;
  bannerSeverity: 'info' | 'warning';
}

/** What the statement is judged from, all read on the page request. */
export interface EmailPasswordLiveInput {
  /** Whether email and password sign-in runs: `getPublicConfig().emailPassword.enabled`. */
  running: boolean;
  /** `auth.email_password_enabled` as the page reads it (`SettingsService.get`). */
  shown: { value?: unknown; source?: string } | undefined;
  /** A cloud-managed runtime whose deployment declared it off (`emailPasswordHeldOffByHost`). */
  heldOffByHost: boolean;
  /** The caller's display language; a language with no entry is answered in English. */
  locale?: string;
}

/** The words of the statement, one entry per language on the platform locale table. */
export interface AuthLiveStatusCopy {
  /** Held off by the host on a cloud-managed runtime, over a value stored on. */
  managedOffLabel: string;
  managedOffText: string;
  /** Any other disagreement between the switch and what runs. */
  differsLabel(running: boolean): string;
  differsText: string;
  /** Self-registration forced off by the deployment, over `signup_enabled` stored on. */
  signupForcedOffLabel: string;
  signupForcedOffText: string;
}

export const AUTH_LIVE_STATUS_COPY: Record<SettingsCopyLocale, AuthLiveStatusCopy> = {
  en: {
    managedOffLabel: 'Email and password sign-in is off on this environment',
    managedOffText: 'This environment is cloud-managed and its deployment turns email and password sign-in off: '
      + 'people sign in through the identity provider of the organisation that hosts it, and the sign-in page '
      + 'offers no email and password form. The switch below does not change that, and a value saved on is not '
      + 'applied.',
    differsLabel: (running) => `Email and password sign-in is ${running ? 'on' : 'off'} in the running system`,
    differsText: 'The switch below shows the saved setting, which is not what runs right now.',
    signupForcedOffLabel: 'Self-registration is off on this environment',
    signupForcedOffText: 'This environment\'s deployment turns self-registration off (single sign-on only, a cloud-managed '
      + 'environment, or the server configuration): people join only by invitation or through the identity '
      + 'provider, and the sign-in page offers no sign-up. The switch below does not change that, and a '
      + 'value saved on is not applied.',
  },
  'zh-CN': {
    managedOffLabel: '本环境已关闭邮箱/密码登录',
    managedOffText: '本环境由云端托管，其部署关闭了邮箱/密码登录：用户通过托管本环境的组织的身份提供方登录，'
      + '登录页不提供邮箱/密码表单。下方开关无法改变这一点，保存为开的值不会生效。',
    differsLabel: (running) => `实际运行中邮箱/密码登录为${running ? '开' : '关'}`,
    differsText: '下方开关显示的是已保存的设置，并非当前实际运行的状态。',
    signupForcedOffLabel: '本环境已关闭自助注册',
    signupForcedOffText: '本环境的部署关闭了自助注册（仅单点登录、云端托管环境或服务器配置）：用户只能通过邀请或身份提供方加入，登录页不提供注册入口。下方开关无法改变这一点，保存为开的值不会生效。',
  },
  'zh-Hant': {
    managedOffLabel: '本環境已關閉電子郵件／密碼登入',
    managedOffText: '本環境由雲端代管，其部署關閉了電子郵件／密碼登入：使用者透過代管本環境之組織的身分識別提供者登入，'
      + '登入頁不提供電子郵件／密碼表單。下方開關無法改變這一點，儲存為開的值不會生效。',
    differsLabel: (running) => `實際執行中電子郵件／密碼登入為${running ? '開' : '關'}`,
    differsText: '下方開關顯示的是已儲存的設定，並非目前實際執行的狀態。',
    signupForcedOffLabel: '本環境已關閉自助註冊',
    signupForcedOffText: '本環境的部署關閉了自助註冊（僅單一登入、雲端代管環境或伺服器設定）：使用者只能透過邀請或身分識別提供者加入，登入頁不提供註冊入口。下方開關無法改變這一點，儲存為開的值不會生效。',
  },
  'ja-JP': {
    managedOffLabel: 'この環境ではメール/パスワードによるサインインはオフです',
    managedOffText: 'この環境はクラウドで管理されており、そのデプロイでメール/パスワードによるサインインがオフになっています。'
      + 'ユーザーはこの環境をホストする組織の ID プロバイダーでサインインし、サインインページにメール/パスワードのフォームは'
      + '表示されません。下のスイッチではこれを変更できず、オンで保存された値は適用されません。',
    differsLabel: (running) => `実行中のシステムではメール/パスワードによるサインインは${running ? 'オン' : 'オフ'}です`,
    differsText: '下のスイッチは保存済みの設定を表示しており、現在の実際の動作とは異なります。',
    signupForcedOffLabel: 'この環境ではセルフ登録はオフです',
    signupForcedOffText: 'この環境のデプロイでセルフ登録がオフになっています（シングルサインオンのみ、クラウド管理環境、または'
      + 'サーバー構成）。ユーザーは招待または ID プロバイダー経由でのみ参加でき、サインインページに登録の'
      + '入口は表示されません。下のスイッチではこれを変更できず、オンで保存された値は適用されません。',
  },
  'es-ES': {
    managedOffLabel: 'El inicio de sesión con correo y contraseña está desactivado en este entorno',
    managedOffText: 'Este entorno está gestionado en la nube y su implementación desactiva el inicio de sesión con '
      + 'correo y contraseña: las personas inician sesión mediante el proveedor de identidad de la organización que lo '
      + 'aloja, y la página de inicio de sesión no ofrece formulario de correo y contraseña. El interruptor de abajo no '
      + 'cambia eso, y un valor guardado como activado no se aplica.',
    differsLabel: (running) =>
      `El inicio de sesión con correo y contraseña está ${running ? 'activado' : 'desactivado'} en el sistema en ejecución`,
    differsText: 'El interruptor de abajo muestra el ajuste guardado, que no es lo que se ejecuta ahora mismo.',
    signupForcedOffLabel: 'El autorregistro está desactivado en este entorno',
    signupForcedOffText: 'La implementación de este entorno desactiva el autorregistro (solo inicio de sesión único, un '
      + 'entorno gestionado en la nube o la configuración del servidor): las personas se unen solo por '
      + 'invitación o mediante el proveedor de identidad, y la página de inicio de sesión no ofrece '
      + 'registro. El interruptor de abajo no cambia eso, y un valor guardado como activado no se aplica.',
  },
  ar: {
    managedOffLabel: 'تسجيل الدخول بالبريد الإلكتروني وكلمة المرور متوقف في هذه البيئة',
    managedOffText: 'هذه البيئة مُدارة سحابيًا ويُوقف نشرها تسجيل الدخول بالبريد الإلكتروني وكلمة المرور: يسجّل الأشخاص '
      + 'الدخول عبر موفّر الهوية للمؤسسة التي تستضيفها، ولا تعرض صفحة تسجيل الدخول نموذج البريد الإلكتروني وكلمة المرور. '
      + 'لا يغيّر المفتاح أدناه ذلك، ولا تُطبَّق القيمة المحفوظة مُفعّلة.',
    differsLabel: (running) =>
      `تسجيل الدخول بالبريد الإلكتروني وكلمة المرور ${running ? 'مُفعّل' : 'متوقف'} في النظام قيد التشغيل`,
    differsText: 'يعرض المفتاح أدناه الإعداد المحفوظ، وهو ليس ما يعمل الآن.',
    signupForcedOffLabel: 'التسجيل الذاتي متوقف في هذه البيئة',
    signupForcedOffText: 'يُوقف نشر هذه البيئة التسجيل الذاتي (تسجيل الدخول الموحّد فقط، أو بيئة مُدارة سحابيًا، أو إعدادات '
      + 'الخادم): ينضم الأشخاص بدعوة فقط أو عبر موفّر الهوية، ولا تعرض صفحة تسجيل الدخول خيار التسجيل. لا '
      + 'يغيّر المفتاح أدناه ذلك، ولا تُطبَّق القيمة المحفوظة مُفعّلة.',
  },
  fr: {
    managedOffLabel: 'La connexion par e-mail et mot de passe est désactivée sur cet environnement',
    managedOffText: 'Cet environnement est géré dans le cloud et son déploiement désactive la connexion par e-mail et '
      + 'mot de passe : on se connecte via le fournisseur d\'identité de l\'organisation qui l\'héberge, et la page de '
      + 'connexion ne propose aucun formulaire e-mail et mot de passe. L\'interrupteur ci-dessous n\'y change rien, et '
      + 'une valeur enregistrée activée n\'est pas appliquée.',
    differsLabel: (running) =>
      `La connexion par e-mail et mot de passe est ${running ? 'activée' : 'désactivée'} dans le système en cours d'exécution`,
    differsText: 'L\'interrupteur ci-dessous affiche le paramètre enregistré, qui n\'est pas ce qui s\'exécute en ce moment.',
    signupForcedOffLabel: 'L\'inscription libre est désactivée sur cet environnement',
    signupForcedOffText: 'Le déploiement de cet environnement désactive l\'inscription libre (authentification unique seule, '
      + 'environnement géré dans le cloud ou configuration du serveur) : on ne rejoint que sur invitation ou '
      + 'via le fournisseur d\'identité, et la page de connexion ne propose pas d\'inscription. '
      + 'L\'interrupteur ci-dessous n\'y change rien, et une valeur enregistrée activée n\'est pas appliquée.',
  },
  'pt-BR': {
    managedOffLabel: 'O login com e-mail e senha está desativado neste ambiente',
    managedOffText: 'Este ambiente é gerenciado na nuvem e sua implantação desativa o login com e-mail e senha: as '
      + 'pessoas entram pelo provedor de identidade da organização que o hospeda, e a página de login não oferece '
      + 'formulário de e-mail e senha. O interruptor abaixo não muda isso, e um valor salvo como ativado não é aplicado.',
    differsLabel: (running) => `O login com e-mail e senha está ${running ? 'ativado' : 'desativado'} no sistema em execução`,
    differsText: 'O interruptor abaixo mostra a configuração salva, que não é o que está em execução agora.',
    signupForcedOffLabel: 'O autocadastro está desativado neste ambiente',
    signupForcedOffText: 'A implantação deste ambiente desativa o autocadastro (somente login único, um ambiente gerenciado '
      + 'na nuvem ou a configuração do servidor): as pessoas entram apenas por convite ou pelo provedor de '
      + 'identidade, e a página de login não oferece cadastro. O interruptor abaixo não muda isso, e um '
      + 'valor salvo como ativado não é aplicado.',
  },
  ru: {
    managedOffLabel: 'Вход по электронной почте и паролю отключён в этой среде',
    managedOffText: 'Эта среда управляется в облаке, и её развёртывание отключает вход по электронной почте и паролю: '
      + 'пользователи входят через поставщика удостоверений организации, которая её размещает, а страница входа не '
      + 'предлагает форму электронной почты и пароля. Переключатель ниже этого не меняет, а сохранённое значение '
      + '«включено» не применяется.',
    differsLabel: (running) => `В работающей системе вход по электронной почте и паролю ${running ? 'включён' : 'отключён'}`,
    differsText: 'Переключатель ниже показывает сохранённую настройку, а не то, что работает сейчас.',
    signupForcedOffLabel: 'Самостоятельная регистрация отключена в этой среде',
    signupForcedOffText: 'Развёртывание этой среды отключает самостоятельную регистрацию (только единый вход, облачная '
      + 'управляемая среда или конфигурация сервера): пользователи присоединяются только по приглашению или '
      + 'через поставщика удостоверений, а страница входа не предлагает регистрацию. Переключатель ниже '
      + 'этого не меняет, а сохранённое значение «включено» не применяется.',
  },
  de: {
    managedOffLabel: 'Die Anmeldung mit E-Mail und Passwort ist in dieser Umgebung aus',
    managedOffText: 'Diese Umgebung wird in der Cloud verwaltet, und ihre Bereitstellung schaltet die Anmeldung mit '
      + 'E-Mail und Passwort aus: Man meldet sich über den Identitätsanbieter der Organisation an, die sie hostet, und '
      + 'die Anmeldeseite bietet kein Formular für E-Mail und Passwort. Der Schalter unten ändert daran nichts, und ein '
      + 'auf an gespeicherter Wert wird nicht angewendet.',
    differsLabel: (running) => `Die Anmeldung mit E-Mail und Passwort ist im laufenden System ${running ? 'an' : 'aus'}`,
    differsText: 'Der Schalter unten zeigt die gespeicherte Einstellung, nicht das, was gerade läuft.',
    signupForcedOffLabel: 'Die Selbstregistrierung ist in dieser Umgebung aus',
    signupForcedOffText: 'Die Bereitstellung dieser Umgebung schaltet die Selbstregistrierung aus (nur Single Sign-on, eine '
      + 'in der Cloud verwaltete Umgebung oder die Serverkonfiguration): Man tritt nur auf Einladung oder '
      + 'über den Identitätsanbieter bei, und die Anmeldeseite bietet keine Registrierung. Der Schalter '
      + 'unten ändert daran nichts, und ein auf an gespeicherter Wert wird nicht angewendet.',
  },
  ko: {
    managedOffLabel: '이 환경에서는 이메일/비밀번호 로그인이 꺼져 있습니다',
    managedOffText: '이 환경은 클라우드에서 관리되며, 배포에서 이메일/비밀번호 로그인이 꺼져 있습니다. 사용자는 이 환경을 '
      + '호스팅하는 조직의 ID 공급자를 통해 로그인하며, 로그인 페이지에는 이메일/비밀번호 양식이 표시되지 않습니다. 아래 '
      + '스위치로는 이를 바꿀 수 없으며, 켜짐으로 저장된 값은 적용되지 않습니다.',
    differsLabel: (running) => `실행 중인 시스템에서 이메일/비밀번호 로그인이 ${running ? '켜져' : '꺼져'} 있습니다`,
    differsText: '아래 스위치는 저장된 설정을 표시하며, 현재 실제로 동작하는 상태와 다릅니다.',
    signupForcedOffLabel: '이 환경에서는 자체 가입이 꺼져 있습니다',
    signupForcedOffText: '이 환경의 배포에서 자체 가입이 꺼져 있습니다(싱글 사인온 전용, 클라우드 관리 환경 또는'
      + ' 서버 구성). 사용자는 초대 또는 ID 공급자를 통해서만 참여할 수 있으며, 로그인 페이'
      + '지에는 가입 입구가 표시되지 않습니다. 아래 스위치로는 이를 바꿀 수 없으며, 켜짐으로 저'
      + '장된 값은 적용되지 않습니다.',
  },
};

const COPY_LOCALES = Object.keys(AUTH_LIVE_STATUS_COPY);

/** The copy for a caller's locale: exact, then by language, else English. */
export function authLiveStatusCopy(locale: string | undefined): AuthLiveStatusCopy {
  const picked = locale ? resolveLocale(locale, COPY_LOCALES) : undefined;
  return AUTH_LIVE_STATUS_COPY[(picked ?? 'en') as SettingsCopyLocale];
}

/** The reading `bindAuthSettings` gives a resolved toggle: absent or unreadable reads on, the manifest default. */
function shownToggle(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() !== 'false';
  if (typeof value === 'number') return value !== 0;
  return true;
}

/**
 * The statement, or `undefined` when the switch and the running value agree
 * (nothing to state: the page already says what runs).
 */
export function describeEmailPasswordLiveStatus(input: EmailPasswordLiveInput): AuthLiveStatus | undefined {
  const shown = shownToggle(input.shown?.value);
  if (shown === input.running) return undefined;
  const copy = authLiveStatusCopy(input.locale);
  if (!input.running && input.heldOffByHost) {
    // A value stored on that is not applied is the operator's to clear.
    return { label: copy.managedOffLabel, bannerText: copy.managedOffText, bannerSeverity: 'warning' };
  }
  return { label: copy.differsLabel(input.running), bannerText: copy.differsText, bannerSeverity: 'warning' };
}

/** What the self-registration statement is judged from, all read on the page request. */
export interface SignUpLiveInput {
  /** Whether self-registration runs: `!getPublicConfig().emailPassword.disableSignUp`. */
  running: boolean;
  /** `auth.signup_enabled` as the page reads it (`SettingsService.get`). */
  shown: { value?: unknown; source?: string } | undefined;
  /**
   * Whether the deployment turns self-registration off whatever is saved
   * (`AuthManager.resolveDisableSignUp(false)`: SSO-only, cloud-managed, or
   * `OS_DISABLE_SIGNUP`).
   */
  forcedOff: boolean;
  /** `auth.email_password_enabled` as the page reads it: the switch is shown only while it is not off. */
  emailPasswordShown: { value?: unknown } | undefined;
  /** The caller's display language; a language with no entry is answered in English. */
  locale?: string;
}

/**
 * The self-registration statement, or `undefined` when there is nothing the
 * switch does not already say. With nothing stored the switch reads the
 * declaration, which already folds in a forced off
 * (`auth-settings-declared-defaults.ts`); what it cannot say is a value
 * stored on that the deployment overrides: the settings pass applies it and
 * the runtime still forces sign-up off. Stated only while the switch is on
 * the page (it is hidden while email and password is off).
 */
export function describeSignUpLiveStatus(input: SignUpLiveInput): AuthLiveStatus | undefined {
  if (shownToggle(input.emailPasswordShown?.value) === false) return undefined;
  if (!input.forcedOff || input.running || !shownToggle(input.shown?.value)) return undefined;
  const copy = authLiveStatusCopy(input.locale);
  return { label: copy.signupForcedOffLabel, bannerText: copy.signupForcedOffText, bannerSeverity: 'warning' };
}

/**
 * One banner heads the page (the settings service takes one statement per
 * namespace): the first statement's title, every statement's body in order.
 * `undefined` when there is nothing to state.
 */
export function combineAuthLiveStatus(
  statements: ReadonlyArray<AuthLiveStatus | undefined>,
): AuthLiveStatus | undefined {
  const present = statements.filter((statement): statement is AuthLiveStatus => statement !== undefined);
  if (present.length <= 1) return present[0];
  return {
    label: present[0].label,
    bannerText: present.map((statement) => `**${statement.label}.** ${statement.bannerText}`).join('\n\n'),
    bannerSeverity: present.some((statement) => statement.bannerSeverity === 'warning') ? 'warning' : 'info',
  };
}
