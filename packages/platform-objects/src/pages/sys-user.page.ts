// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { P } from '@objectstack/spec/shared';
import type { Page } from '@objectstack/spec/ui';

/**
 * The gate on every node that shows 2FA state or 2FA controls (#25287).
 *
 * 2FA is either offered or not shown: `plugin-auth` resolves `twoFactor` to
 * `false` unless a deployment turns it on, and `/api/v1/auth/config` then
 * serves `features.twoFactor: false`. Without this gate a deployment with
 * 2FA off shows a "Two-Factor Enabled: No" chip and a Security heading over
 * an empty action bar — a state with no way to act on it.
 *
 * The right half is `featureGatePredicate('twoFactor')`, the conjunct the
 * object's 2FA actions carry through `requiresFeature`; page components have
 * no `requiresFeature`, so it is written out here. The `has()` guard keeps
 * the gate CLOSED rather than faulting while the auth config has not loaded
 * yet (the console binds `features` to `{}` until then, and on CEL a missing
 * map key is a fault). Same `P` envelope as the alert below, for the same
 * reason: this raw `Page` literal reaches the wire verbatim.
 */
const TWO_FACTOR_OFFERED = P`has(features.twoFactor) && features.twoFactor == true`;

/**
 * sys_user — Record Detail Page (`kind: 'full'`, default for ALL sys_user records)
 *
 * **Audience**: admins browsing user records from Setup.
 *
 * The Account App's "Profile" entry no longer routes here — it points at
 * the `account:profile_card` Console component for a settings-form-style
 * personal profile. This page therefore optimizes for the admin
 * use case: scanning a user's signals (email/verification),
 * reviewing related sessions/orgs/oauth/api-keys, and triggering
 * admin actions (ban / impersonate).
 *
 * Strategy
 * --------
 *  - `kind: 'full'` + `isDefault: true`: the page owns its curated tab strip,
 *    so it is drawn as authored at every width. It was a `kind: 'slotted'`
 *    page overriding `alerts`, `highlights`, `tabs` and `discussion` until the
 *    `tabs` slot retired (#27053); the rebuild renders the same nodes in the
 *    same order. The header the synthesizer used to supply is a `page:header`
 *    with `placedActions: true` (#29951): it draws every `sys_user` action
 *    placed at `record_header` / `record_more`, read live, so the platform's
 *    own (`ban_user / impersonate_user / … / update_my_profile /
 *    change_my_password / …`) and any an installed package places on
 *    `sys_user` appear in the header and its overflow menu, as they did on
 *    the synthesized header.
 *  - `record:highlights` promotes the signals worth scanning at the top:
 *    email, phone, verification state. Highlight fields are auto-dropped
 *    from the details grid below. 2FA state is not one of them: it is
 *    drawn only in the Security tab, behind the deployment's `twoFactor`
 *    gate (see {@link TWO_FACTOR_OFFERED}). Nor is better-auth's legacy
 *    `role` scalar (#28105): it is not the platform role, and the page
 *    does not draw it anywhere.
 *  - The FIRST tab is the details grid: a `record:details` that
 *    re-groups remaining fields into sections (locale on Identity, the ban
 *    state and reason in Account Status) and hides admin-internal columns.
 *  - The other tabs are **explicitly curated** to the related lists
 *    that matter on a user profile (Positions / Permission Sets / Business
 *    Units / Sessions / Linked Accounts / Organizations / OAuth Apps / API
 *    Keys / Preferences) plus a Security tab and, for platform
 *    administrators only, an AI Assistants tab. The synthesized strip would
 *    carry a tab per object that has a FK to sys_user
 *    (sys_position.created_by, sys_email.updated_by,
 *    sys_email_template.created_by, …), dozens of noisy "查看全部" cards
 *    on every profile, and it has no Security tab of controls.
 *  - Linked Accounts (`sys_account`) and Preferences (`sys_user_preference`)
 *    are where an administrator reaches those two per-user stores: Setup
 *    has no menu entry listing them across users (#23803).
 *  - No `record:discussion` node: the Chatter feed has no business on a
 *    personal profile.
 */
export const SysUserDetailPage: Page = {
  name: 'sys_user_detail',
  label: 'User',
  type: 'record',
  object: 'sys_user',
  template: 'default',
  kind: 'full',
  isDefault: true,

  regions: [
    {
      name: 'main',
      width: 'full',
      components: [
        // ── The record header ─────────────────────────────────────────
        // The synthesized header's action set, read live: every action placed
        // on `sys_user` at `record_header` or `record_more`, in declaration
        // order (admin actions, then the self-service ones), then any action
        // another package places there. A frozen id list dropped those
        // (#29951). The host appends its own system actions after these.
        {
          type: 'page:header',
          properties: {
            placedActions: true,
          },
        },
        // ── Alert banners ─────────────────────────────────────────────
        // Conditional notices rendered between the page header and the
        // highlight strip. The unverified-email banner only shows for the
        // current user viewing their own profile (admins looking at other
        // users see nothing — they can use Setup actions instead).
        // The gate is the ADR-0089 canonical, component-NODE `visibleWhen` — a
        // sibling of `properties`, never a key inside it. `record:alert` also
        // DECLARES `properties.visible`, but `PageComponentSchema.properties` is
        // an opaque record served verbatim, so a predicate there never reaches
        // `ExpressionInputSchema` and is evaluated by the console's LEGACY JS
        // evaluator, which has no `has()`.
        //
        // ⚠️ The envelope is load-bearing, and `P` is not decoration. This page is
        // authored as a RAW `Page` object literal, so — unlike a page built with
        // `definePage()` — nothing runs `ExpressionInputSchema`'s transform over
        // it and whatever is written here reaches the wire verbatim. Measured in
        // the real console at the pinned objectui SHA: a BARE string in
        // `visibleWhen` also stays on that legacy evaluator ("bare strings and
        // `${…}` templates stay on the legacy path … only an explicit
        // `{ dialect: 'cel' }` envelope is rerouted"), so `has()` throws, the
        // surface is fail-soft, and the banner shows on EVERY user — including
        // other people's profiles. `P` emits the `{ dialect: 'cel', source }`
        // envelope that routes to CEL, where `has()` is a real function.
        //
        // On CEL an absent key is a FAULT and that face is fail-soft too, hence
        // the `has()` guards (the same shape the sibling
        // `resend_verification_email` action predicate already carries). And
        // hence no `visible` beside it: a node `visibleWhen` and
        // `properties.visible` compose as AND, so leaving both would keep the
        // legacy predicate load-bearing.
        {
          type: 'record:alert',
          visibleWhen: P`has(record.id) && has(record.email_verified) && record.id == ctx.user.id && record.email_verified == false`,
          properties: {
            severity: 'warning',
            icon: 'mail',
            // Inline-i18n object labels: the renderer resolves them with
            // pickLocalized (exact → base → default → en → first).
            title: {
              en: 'Email not verified',
              'zh-CN': '邮箱未验证',
              'ja-JP': 'メールが未認証です',
              'es-ES': 'Correo no verificado',
              'zh-Hant': '電子郵件尚未驗證',
              ar: 'البريد الإلكتروني غير موثَّق',
              fr: 'E-mail non vérifié',
              'pt-BR': 'E-mail não verificado',
            },
            body: {
              en: 'Verify your email to receive password resets and important system notifications.',
              'zh-CN': '验证你的邮箱以接收密码重置和重要的系统通知。',
              'ja-JP': 'パスワードリセットや重要なシステム通知を受け取るには、メールアドレスを認証してください。',
              'es-ES': 'Verifica tu correo para recibir restablecimientos de contraseña y notificaciones importantes del sistema.',
              'zh-Hant': '驗證你的電子郵件，以接收密碼重設和重要的系統通知。',
              ar: 'وثّق بريدك الإلكتروني لتتلقى رسائل إعادة تعيين كلمة المرور وإشعارات النظام المهمة.',
              fr: 'Vérifiez votre e-mail pour recevoir les réinitialisations de mot de passe et les notifications système importantes.',
              'pt-BR': 'Verifique seu e-mail para receber redefinições de senha e notificações importantes do sistema.',
            },
            dismissible: false,
            action: {
              actionName: 'resend_verification_email',
              label: {
                en: 'Resend verification email',
                'zh-CN': '重新发送验证邮件',
                'ja-JP': '認証メールを再送信',
                'es-ES': 'Reenviar correo de verificación',
                'zh-Hant': '重新寄送驗證郵件',
                ar: 'إعادة إرسال رسالة التوثيق',
                fr: 'Renvoyer l’e-mail de vérification',
                'pt-BR': 'Reenviar e-mail de verificação',
              },
            },
          },
        },

        // ── Highlight chips above the fold ────────────────────────────
        {
          type: 'record:highlights',
          properties: {
            // No `two_factor_enabled` (#25287): a highlight field has no
            // per-field gate, and on a deployment with 2FA off the chip read a
            // dead "No". The state is drawn in the Security tab instead.
            // No `role` (#28105): better-auth's legacy scalar read as the
            // "Platform Role" chip, but ObjectStack never writes it and with
            // the admin plugin on it reads `user` for a platform admin too.
            fields: ['email', 'phone_number', 'email_verified'],
          },
        },

        // ── Tabs: the details grid, then curated related lists ────────
        // Only the lists that are semantically about THIS user account.
        // Everything else (sys_position created_by, sys_email_template
        // updated_by, …) is incidental authorship metadata and would only
        // create noise.
        //
        // The details grid is the FIRST tab's body: this page owns its whole
        // strip (`kind: 'full'`), so there is no synthesized Details tab for a
        // `details` slot to fill.
        {
          type: 'page:tabs',
          properties: {
            // `tabStyle`, not `type` (#6776) — see sys-organization.page.ts.
            tabStyle: 'line',
            position: 'top',
            items: [
              {
                // ── Body / details grid ───────────────────────────────
                // Re-groups the remaining fields into sections and hides
                // admin-internal columns. The renderer draws only the
                // authored sections, so a field none of them names is not on
                // the page: `locale` rides Identity, and the ban state has its
                // own section, so a banned user does not read as active.
                label: { en: 'Details', 'zh-CN': '详情', 'ja-JP': '詳細', 'es-ES': 'Detalles', 'zh-Hant': '詳細資料', ar: 'التفاصيل', fr: 'Détails', 'pt-BR': 'Detalhes' },
                icon: 'file-text',
                children: [
                  {
                    type: 'record:details',
                    properties: {
                      hideFields: [
                        'id',
                        // already promoted to highlights:
                        'email',
                        'phone_number',
                        'email_verified',
                        'two_factor_enabled', // not a highlight: drawn in the Security tab, behind the 2FA gate
                        'role', // not a highlight either: the legacy better-auth scalar, not the platform role (#28105)
                      ],
                      sections: [
                        {
                          label: { en: 'Identity', 'zh-CN': '身份', 'ja-JP': 'アイデンティティ', 'es-ES': 'Identidad', 'zh-Hant': '身分', ar: 'الهوية', fr: 'Identité', 'pt-BR': 'Identidade' },
                          fields: ['name', 'image', 'locale'],
                        },
                        {
                          label: { en: 'Account Status', 'zh-CN': '账号状态', 'ja-JP': 'アカウントの状態', 'es-ES': 'Estado de la cuenta', 'zh-Hant': '帳號狀態', ar: 'حالة الحساب', fr: 'État du compte', 'pt-BR': 'Status da conta' },
                          fields: ['banned', 'ban_reason', 'ban_expires'],
                        },
                        {
                          label: { en: 'Audit', 'zh-CN': '审计', 'ja-JP': '監査', 'es-ES': 'Auditoría', 'zh-Hant': '稽核', ar: 'التدقيق', fr: 'Audit', 'pt-BR': 'Auditoria' },
                          fields: ['created_at', 'updated_at'],
                        },
                      ],
                    },
                  },
                ],
              },
              {
                label: { en: 'Positions', 'zh-CN': '岗位', 'ja-JP': 'ポジション', 'es-ES': 'Puestos', 'zh-Hant': '職位', ar: 'المناصب', fr: 'Postes', 'pt-BR': 'Cargos' },
                icon: 'shield-check',
                children: [
                  {
                    // [ADR-0090 D3] Position assignments (岗位分派) — pure SDUI.
                    // [ADR-0131 D4, #15204 B2] No `add` picker: it could list
                    // `sys_position` ROWS only, and positions live in the security
                    // catalog. "New" opens the assignment form, whose `position`
                    // field picks a catalog position by name (`widget:
                    // 'position-ref'` on the object); Remove is the host's row
                    // delete. Every server-side rule (the D12 delegated-admin gate,
                    // audience-anchor rejection) surfaces its error in the form.
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_user_position',
                      relationshipField: 'user_id',
                      columns: ['position', 'business_unit_id', 'granted_by', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Positions', 'zh-CN': '岗位', 'ja-JP': 'ポジション', 'es-ES': 'Puestos', 'zh-Hant': '職位', ar: 'المناصب', fr: 'Postes', 'pt-BR': 'Cargos' },
                    },
                  },
                ],
              },
              {
                // [ADR-0091 D1] Direct permission-set grants (直接授权) — pure SDUI.
                // The list keys on `relationshipField: 'user_id'` (a lookup keyed by
                // record id, no relationshipValueField). [ADR-0131 D4, #15204 B2] A
                // grant names its set BY NAME, and the set lives in the security
                // catalog, not in a `sys_permission_set` row, so there is no `add`
                // picker (it could list object rows only). "New" opens the grant
                // form, whose `permission_set` field picks a catalog set by name
                // (`widget: 'permission-ref'` on the object); Remove is the host's
                // row delete. Server-side gates (the catalog name refusal,
                // delegated-admin D12) surface their reason in the form.
                //
                // [ADR-0091 D1/D2] `valid_from` / `valid_until` are listed because
                // they decide whether the grant confers anything: the resolver drops
                // an assignment outside its half-open window at every evaluation, so
                // a row showing only the set would read as a live grant when it is
                // not. The same form sets the window, and the object refuses a
                // window whose end is not after its start.
                label: { en: 'Permission Sets', 'zh-CN': '权限集', 'ja-JP': '権限セット', 'es-ES': 'Conjuntos de permisos', 'zh-Hant': '權限集', ar: 'مجموعات الأذونات', fr: 'Ensembles d’autorisations', 'pt-BR': 'Conjuntos de permissões' },
                icon: 'lock',
                children: [
                  // Effective sets with their origins (default / position / direct / derived), read from the server; the stored grant rows stay below.
                  { type: 'security:effective-access', properties: {} },
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_user_permission_set',
                      relationshipField: 'user_id',
                      columns: ['permission_set', 'organization_id', 'valid_from', 'valid_until', 'granted_by', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Permission Sets', 'zh-CN': '权限集', 'ja-JP': '権限セット', 'es-ES': 'Conjuntos de permisos', 'zh-Hant': '權限集', ar: 'مجموعات الأذونات', fr: 'Ensembles d’autorisations', 'pt-BR': 'Conjuntos de permissões' },
                    },
                  },
                ],
              },
              {
                // Business-unit membership (业务单元归属) — pure SDUI.
                // sys_business_unit_member is an id-keyed junction: user_id /
                // business_unit_id are lookups keyed by record id, so the list keys
                // on `relationshipField: 'user_id'` (no relationshipValueField).
                // The Add picker binds a BU by its id (linkField: 'business_unit_id');
                // sys_business_unit has no `label` field so the picker labels rows by
                // its display field `name`.
                label: { en: 'Business Units', 'zh-CN': '业务单元', 'ja-JP': 'ビジネスユニット', 'es-ES': 'Unidades de negocio', 'zh-Hant': '業務單位', ar: 'وحدات الأعمال', fr: 'Unités commerciales', 'pt-BR': 'Unidades de negócios' },
                icon: 'network',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_business_unit_member',
                      relationshipField: 'user_id',
                      columns: ['business_unit_id', 'function_in_business_unit', 'is_primary', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Business Units', 'zh-CN': '业务单元', 'ja-JP': 'ビジネスユニット', 'es-ES': 'Unidades de negocio', 'zh-Hant': '業務單位', ar: 'وحدات الأعمال', fr: 'Unités commerciales', 'pt-BR': 'Unidades de negócios' },
                      add: {
                        picker: {
                          object: 'sys_business_unit',
                          labelField: 'name',
                        },
                        linkField: 'business_unit_id',
                        label: {
                          en: 'Add to business unit',
                          'zh-CN': '加入业务单元',
                          'ja-JP': 'ビジネスユニットに追加',
                          'es-ES': 'Añadir a unidad de negocio',
                          'zh-Hant': '加入業務單位',
                          ar: 'إضافة إلى وحدة أعمال',
                          fr: 'Ajouter à une unité commerciale',
                          'pt-BR': 'Adicionar a uma unidade de negócios',
                        },
                      },
                    },
                  },
                ],
              },
              {
                label: { en: 'Sessions', 'zh-CN': '会话', 'ja-JP': 'セッション', 'es-ES': 'Sesiones', 'zh-Hant': '工作階段', ar: 'الجلسات', fr: 'Sessions', 'pt-BR': 'Sessões' },
                icon: 'monitor',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_session',
                      relationshipField: 'user_id',
                      columns: ['user_agent', 'ip_address', 'created_at', 'expires_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Sessions', 'zh-CN': '会话', 'ja-JP': 'セッション', 'es-ES': 'Sesiones', 'zh-Hant': '工作階段', ar: 'الجلسات', fr: 'Sessions', 'pt-BR': 'Sessões' },
                    },
                  },
                ],
              },
              {
                label: { en: 'Linked Accounts', 'zh-CN': '关联账号', 'ja-JP': '連携アカウント', 'es-ES': 'Cuentas vinculadas', 'zh-Hant': '已關聯帳戶', ar: 'الحسابات المرتبطة', fr: 'Comptes liés', 'pt-BR': 'Contas vinculadas' },
                icon: 'link',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_account',
                      relationshipField: 'user_id',
                      columns: ['provider_id', 'account_id', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Linked Accounts', 'zh-CN': '关联账号', 'ja-JP': '連携アカウント', 'es-ES': 'Cuentas vinculadas', 'zh-Hant': '已關聯帳戶', ar: 'الحسابات المرتبطة', fr: 'Comptes liés', 'pt-BR': 'Contas vinculadas' },
                    },
                  },
                ],
              },
              {
                label: { en: 'Organizations', 'zh-CN': '组织', 'ja-JP': '組織', 'es-ES': 'Organizaciones', 'zh-Hant': '組織', ar: 'المؤسسات', fr: 'Organisations', 'pt-BR': 'Organizações' },
                icon: 'building-2',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_member',
                      relationshipField: 'user_id',
                      columns: ['organization_id', 'role', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Organizations', 'zh-CN': '组织', 'ja-JP': '組織', 'es-ES': 'Organizaciones', 'zh-Hant': '組織', ar: 'المؤسسات', fr: 'Organisations', 'pt-BR': 'Organizações' },
                    },
                  },
                ],
              },
              {
                label: { en: 'OAuth Apps', 'zh-CN': 'OAuth 应用', 'ja-JP': 'OAuth アプリ', 'es-ES': 'Aplicaciones OAuth', 'zh-Hant': 'OAuth 應用程式', ar: 'تطبيقات OAuth', fr: 'Applications OAuth', 'pt-BR': 'Aplicativos OAuth' },
                icon: 'key-square',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_oauth_application',
                      relationshipField: 'user_id',
                      columns: ['name', 'client_id', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'OAuth Apps', 'zh-CN': 'OAuth 应用', 'ja-JP': 'OAuth アプリ', 'es-ES': 'Aplicaciones OAuth', 'zh-Hant': 'OAuth 應用程式', ar: 'تطبيقات OAuth', fr: 'Applications OAuth', 'pt-BR': 'Aplicativos OAuth' },
                    },
                  },
                ],
              },
              // ── Security ──────────────────────────────────────────────
              // Grouped self-service security controls. Each `record:quick_actions`
              // pulls its actions by name from the sys_user object metadata
              // (DRY — definitions stay on the object) and filters by
              // `location: 'record_section'` so they only render here, not
              // in the global header row.
              //
              // The whole tab is self-service, so the whole tab carries the
              // own-record gate. Every action it names is gated to the viewer's
              // own record on the object (`record.id == ctx.user.id`), so on
              // another user's record each `record:quick_actions` draws nothing
              // and only the "your account" headings would remain — speaking to
              // an administrator about an account that is not theirs. An
              // item-level `visibleWhen` omits the tab header AND panel (the
              // renderer falls back to the first visible tab); a per-node gate
              // would leave an empty Security tab behind. Same `P` envelope and
              // `has()` guard as the unverified-email alert above, for the same
              // reasons: this raw `Page` literal reaches the wire verbatim, and
              // only the `{ dialect: 'cel' }` envelope routes to CEL.
              {
                label: { en: 'Security', 'zh-CN': '安全', 'ja-JP': 'セキュリティ', 'es-ES': 'Seguridad', 'zh-Hant': '安全', ar: 'الأمان', fr: 'Sécurité', 'pt-BR': 'Segurança' },
                icon: 'shield',
                visibleWhen: P`has(record.id) && record.id == ctx.user.id`,
                children: [
                  {
                    type: 'element:text',
                    properties: {
                      variant: 'h3',
                      content: {
                        en: 'Password & Sign-in',
                        'zh-CN': '密码与登录',
                        'ja-JP': 'パスワードとサインイン',
                        'es-ES': 'Contraseña e inicio de sesión',
                        'zh-Hant': '密碼與登入',
                        ar: 'كلمة المرور وتسجيل الدخول',
                        fr: 'Mot de passe et connexion',
                        'pt-BR': 'Senha e login',
                      },
                    },
                  },
                  {
                    type: 'element:text',
                    properties: {
                      variant: 'caption',
                      content: {
                        en: 'Change your password or the email address associated with this account.',
                        'zh-CN': '修改密码或此账号绑定的邮箱地址。',
                        'ja-JP': 'パスワード、またはこのアカウントに関連付けられたメールアドレスを変更します。',
                        'es-ES': 'Cambia tu contraseña o la dirección de correo asociada a esta cuenta.',
                        'zh-Hant': '變更密碼或此帳號繫結的電子郵件地址。',
                        ar: 'غيّر كلمة المرور أو عنوان البريد الإلكتروني المرتبط بهذا الحساب.',
                        fr: 'Modifiez votre mot de passe ou l’adresse e-mail associée à ce compte.',
                        'pt-BR': 'Altere sua senha ou o endereço de e-mail associado a esta conta.',
                      },
                    },
                  },
                  {
                    type: 'record:quick_actions',
                    properties: {
                      location: 'record_section',
                      align: 'start',
                      actionNames: ['change_my_password', 'change_my_email'],
                    },
                  },
                  { type: 'element:divider' },
                  // ── Two-factor block: every node carries TWO_FACTOR_OFFERED
                  // (#25287), so with 2FA off the block and its trailing divider
                  // are gone and Password flows straight into Email Verification.
                  // Per node rather than one wrapper, so the tab keeps its flat
                  // layout; a node gate that faults is withheld, not drawn.
                  {
                    type: 'element:text',
                    visibleWhen: TWO_FACTOR_OFFERED,
                    properties: {
                      variant: 'h3',
                      content: {
                        en: 'Two-Factor Authentication',
                        'zh-CN': '两步验证',
                        'ja-JP': '二要素認証',
                        'es-ES': 'Autenticación de dos factores',
                        'zh-Hant': '兩步驟驗證',
                        ar: 'المصادقة الثنائية',
                        fr: 'Authentification à deux facteurs',
                        'pt-BR': 'Autenticação de dois fatores',
                      },
                    },
                  },
                  {
                    type: 'element:text',
                    visibleWhen: TWO_FACTOR_OFFERED,
                    properties: {
                      variant: 'caption',
                      content: {
                        en: 'Add a second layer of security using a TOTP authenticator app. Backup codes let you sign in if you lose your device.',
                        'zh-CN': '使用 TOTP 验证器应用添加第二层安全防护。备用验证码可在设备丢失时用于登录。',
                        'ja-JP': 'TOTP 認証アプリでセキュリティをもう一段強化します。バックアップコードがあれば、デバイスを紛失してもサインインできます。',
                        'es-ES': 'Añade una segunda capa de seguridad con una app de autenticación TOTP. Los códigos de respaldo te permiten iniciar sesión si pierdes tu dispositivo.',
                        'zh-Hant': '使用 TOTP 驗證器應用程式新增第二層安全防護。裝置遺失時，可使用備用驗證碼登入。',
                        ar: 'أضف طبقة أمان ثانية باستخدام تطبيق مصادقة TOTP. تتيح لك الرموز الاحتياطية تسجيل الدخول إذا فقدت جهازك.',
                        fr: 'Ajoutez une seconde couche de sécurité avec une application d’authentification TOTP. Les codes de secours vous permettent de vous connecter si vous perdez votre appareil.',
                        'pt-BR': 'Adicione uma segunda camada de segurança com um aplicativo autenticador TOTP. Os códigos de backup permitem que você entre se perder o dispositivo.',
                      },
                    },
                  },
                  {
                    // The 2FA state, moved here from the highlights strip: shown
                    // only where it can be acted on.
                    type: 'record:highlights',
                    visibleWhen: TWO_FACTOR_OFFERED,
                    properties: {
                      fields: ['two_factor_enabled'],
                    },
                  },
                  {
                    type: 'record:quick_actions',
                    visibleWhen: TWO_FACTOR_OFFERED,
                    properties: {
                      location: 'record_section',
                      align: 'start',
                      actionNames: ['enable_two_factor', 'disable_two_factor', 'generate_backup_codes'],
                    },
                  },
                  { type: 'element:divider', visibleWhen: TWO_FACTOR_OFFERED },
                  {
                    type: 'element:text',
                    properties: {
                      variant: 'h3',
                      content: {
                        en: 'Email Verification',
                        'zh-CN': '邮箱验证',
                        'ja-JP': 'メール認証',
                        'es-ES': 'Verificación de correo',
                        'zh-Hant': '電子郵件驗證',
                        ar: 'توثيق البريد الإلكتروني',
                        fr: 'Vérification de l’e-mail',
                        'pt-BR': 'Verificação de e-mail',
                      },
                    },
                  },
                  {
                    type: 'element:text',
                    properties: {
                      variant: 'caption',
                      content: {
                        en: 'Verify your email so password resets and notifications reach you. The button appears only while verification is pending.',
                        'zh-CN': '验证你的邮箱,以便接收密码重置和系统通知。按钮仅在邮箱待验证时显示。',
                        'ja-JP': 'パスワードリセットや通知を受け取れるよう、メールアドレスを認証してください。ボタンは未認証の間のみ表示されます。',
                        'es-ES': 'Verifica tu correo para recibir restablecimientos de contraseña y notificaciones. El botón solo aparece mientras la verificación está pendiente.',
                        'zh-Hant': '驗證你的電子郵件，以便接收密碼重設和系統通知。此按鈕僅在電子郵件待驗證時顯示。',
                        ar: 'وثّق بريدك الإلكتروني لتصلك رسائل إعادة تعيين كلمة المرور والإشعارات. لا يظهر الزر إلا ما دام التوثيق معلّقًا.',
                        fr: 'Vérifiez votre e-mail pour recevoir les réinitialisations de mot de passe et les notifications. Le bouton n’apparaît que tant que la vérification est en attente.',
                        'pt-BR': 'Verifique seu e-mail para receber redefinições de senha e notificações. O botão só aparece enquanto a verificação estiver pendente.',
                      },
                    },
                  },
                  {
                    type: 'record:quick_actions',
                    properties: {
                      location: 'record_section',
                      align: 'start',
                      actionNames: ['resend_verification_email'],
                    },
                  },
                  { type: 'element:divider' },
                  {
                    type: 'element:text',
                    properties: {
                      variant: 'h3',
                      content: {
                        en: 'Danger Zone',
                        'zh-CN': '危险操作',
                        'ja-JP': '危険な操作',
                        'es-ES': 'Zona de peligro',
                        'zh-Hant': '危險操作',
                        ar: 'منطقة الخطر',
                        fr: 'Zone de danger',
                        'pt-BR': 'Zona de perigo',
                      },
                    },
                    className: 'text-destructive',
                  },
                  {
                    type: 'element:text',
                    properties: {
                      variant: 'caption',
                      content: {
                        en: 'Permanent. Once deleted, your account cannot be recovered.',
                        'zh-CN': '此操作不可逆,账号一经删除将无法恢复。',
                        'ja-JP': 'この操作は取り消せません。削除されたアカウントは復元できません。',
                        'es-ES': 'Permanente. Una vez eliminada, tu cuenta no se puede recuperar.',
                        'zh-Hant': '此動作無法復原，帳號一經刪除即無法恢復。',
                        ar: 'إجراء نهائي. بمجرد حذف حسابك، لا يمكن استعادته.',
                        fr: 'Action définitive. Une fois supprimé, votre compte ne peut pas être récupéré.',
                        'pt-BR': 'Ação definitiva. Depois de excluída, sua conta não pode ser recuperada.',
                      },
                    },
                  },
                  {
                    type: 'record:quick_actions',
                    properties: {
                      location: 'record_section',
                      align: 'start',
                      actionNames: ['delete_my_account'],
                    },
                  },
                ],
              },
              // ── API Keys ──────────────────────────────────────────────
              // Programmatic credentials issued for this user. Filtered by
              // user_id FK; the sys_api_key object's own list-item actions
              // (revoke / restore) handle row operations.
              {
                label: { en: 'API Keys', 'zh-CN': 'API 密钥', 'ja-JP': 'API キー', 'es-ES': 'Claves de API', 'zh-Hant': 'API 金鑰', ar: 'مفاتيح API', fr: 'Clés API', 'pt-BR': 'Chaves de API' },
                icon: 'key-round',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_api_key',
                      relationshipField: 'user_id',
                      columns: ['name', 'prefix', 'expires_at', 'revoked', 'created_at'],
                      sort: [{ field: 'created_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'API Keys', 'zh-CN': 'API 密钥', 'ja-JP': 'API キー', 'es-ES': 'Claves de API', 'zh-Hant': 'API 金鑰', ar: 'مفاتيح API', fr: 'Clés API', 'pt-BR': 'Chaves de API' },
                    },
                  },
                ],
              },
              // ── AI Assistants ─────────────────────────────────────────
              // The AI assistants (OAuth clients such as Claude Desktop) this
              // person authorized, each with a confirm-first Revoke: where an
              // administrator ends what acts as someone who cannot sign in to
              // withdraw it themselves (a lost laptop, a departure). Beside API
              // Keys, the other credential that acts as this user.
              //
              // The body is the console widget `mcp:authorized-assistants`
              // (`@object-ui/app-shell`). It takes no props and reads the page's
              // bound `sys_user` record; its list and its Revoke call
              // `/api/v1/auth/admin/authorized-clients`, which refuses every
              // caller below platform admin (the ADR-0068 platform-admin gate).
              //
              // So the tab item carries the ADR-0095 D3 PLATFORM_ADMIN rung, the
              // standing that door admits, spelled as the object's platform-admin
              // actions spell it: shown to anyone else, the tab could only draw
              // the server's 403. An item-level `visibleWhen` omits the tab
              // header AND panel, the mechanism the Security tab uses. ⛔ Never
              // `'platform_admin' in current_user.positions`: standing is read
              // from the key, and a tenant can write a position by that name.
              // The gate widens and narrows nothing on the server, which refuses
              // anyone else either way. Same `P` envelope as the Security tab:
              // this raw `Page` literal reaches the wire verbatim.
              {
                label: { en: 'AI Assistants', 'zh-CN': 'AI 助手', 'ja-JP': 'AI アシスタント', 'es-ES': 'Asistentes de IA', 'zh-Hant': 'AI 助理', ar: 'مساعدو الذكاء الاصطناعي', fr: 'Assistants IA', 'pt-BR': 'Assistentes de IA' },
                icon: 'bot',
                visibleWhen: P`current_user.isPlatformAdmin == true`,
                children: [
                  { type: 'mcp:authorized-assistants', properties: {} },
                ],
              },
              // ── Preferences ───────────────────────────────────────────
              // [#23803] This user's `sys_user_preference` rows — the console's
              // per-user UI state (`ui.recent`, `ui.favorites`, `ui.list.<object>`
              // …). Setup's "User Preferences" menu entry, which listed every
              // user's rows, left the menu; this tab is where an administrator
              // reaches them now, from the user they belong to.
              //
              // The columns are the object's `all_preferences` view (the grid that
              // entry opened) minus `user_id`, which is the page's own record.
              // Nothing is shown here that view did not show. No `add` and no
              // `actions`: New / Edit / Delete are the host's, decided by the
              // object's `managedBy: 'system-data'` and the caller's grant, the
              // same verdict the grid's buttons read.
              {
                label: { en: 'Preferences', 'zh-CN': '偏好设置', 'ja-JP': '設定', 'es-ES': 'Preferencias', 'zh-Hant': '偏好設定', ar: 'التفضيلات', fr: 'Préférences', 'pt-BR': 'Preferências' },
                icon: 'sliders',
                children: [
                  {
                    type: 'record:related_list',
                    properties: {
                      objectName: 'sys_user_preference',
                      relationshipField: 'user_id',
                      columns: ['key', 'created_at', 'updated_at'],
                      sort: [{ field: 'updated_at', order: 'desc' }],
                      limit: 25,
                      showViewAll: true,
                      title: { en: 'Preferences', 'zh-CN': '偏好设置', 'ja-JP': '設定', 'es-ES': 'Preferencias', 'zh-Hant': '偏好設定', ar: 'التفضيلات', fr: 'Préférences', 'pt-BR': 'Preferências' },
                    },
                  },
                ],
              },
            ],
          },
        },
        // No discussion node: the Chatter feed has no business on a personal
        // profile (the slotted page's `discussion: []`).
      ],
    },
  ],
};
