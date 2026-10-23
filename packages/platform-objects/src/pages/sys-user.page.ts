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
 * sys_user — Record Detail Page (slotted, default for ALL sys_user records)
 *
 * **Audience**: admins browsing user records from Setup.
 *
 * The Account App's "Profile" entry no longer routes here — it points at
 * the `account:profile_card` Console component for a settings-form-style
 * personal profile. This page therefore optimizes for the admin
 * use case: scanning a user's signals (email/verification/role),
 * reviewing related sessions/orgs/oauth/api-keys, and triggering
 * admin actions (ban / impersonate).
 *
 * Strategy
 * --------
 *  - `kind: 'slotted'` + `isDefault: true`: overrides `alerts`,
 *    `highlights`, `tabs` and `discussion`. Header / actions fall through
 *    to the synthesizer so the object's declared actions
 *    (`update_my_profile / change_my_password / resend_verification_email
 *    / ban_user / impersonate_user / …`) still appear
 *    in the header overflow menu automatically.
 *  - `highlights` promotes the signals worth scanning at the top:
 *    email, phone, verification state, platform role. Highlight fields
 *    are auto-dropped from the details grid below. 2FA state is not one
 *    of them: it is drawn only in the Security tab, behind the
 *    deployment's `twoFactor` gate (see {@link TWO_FACTOR_OFFERED}).
 *  - The FIRST `tabs` item is the details grid: a `record:details` that
 *    re-groups remaining fields into sections and hides admin-internal
 *    audit columns. Banned / ban metadata is still editable from the
 *    header actions — we just don't show it in every user's body. It is
 *    a tab item and not a `details` slot because the `tabs` slot replaces
 *    the whole tab strip the Details tab lives in: a `details` slot beside
 *    `tabs` never rendered, and `PageSchema` refuses the pair.
 *  - The other `tabs` items are **explicitly curated** to the related lists
 *    that matter on a user profile (Positions / Permission Sets / Business
 *    Units / Sessions / Linked Accounts / Organizations / OAuth Apps / API
 *    Keys / Preferences) plus a Security tab. Without this override, the
 *    synthesizer auto-generates a tab per object that has a FK to sys_user
 *    (sys_position.created_by, sys_email.updated_by,
 *    sys_email_template.created_by, …) producing dozens of noisy
 *    "查看全部" cards on every profile.
 *  - Linked Accounts (`sys_account`) and Preferences (`sys_user_preference`)
 *    are where an administrator reaches those two per-user stores: Setup
 *    has no menu entry listing them across users (#23803).
 *  - `discussion: []` removes the Chatter feed — it has no business
 *    on a personal profile.
 */
export const SysUserDetailPage: Page = {
  name: 'sys_user_detail',
  label: 'User',
  type: 'record',
  object: 'sys_user',
  template: 'default',
  kind: 'slotted',
  isDefault: true,

  regions: [],

  slots: {
    // ── Alert banners ─────────────────────────────────────────────
    // Conditional notices rendered between the page header and the
    // highlight strip. The unverified-email banner only shows for the
    // current user viewing their own profile (admins looking at other
    // users see nothing — they can use Setup actions instead).
    alerts: [
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
          },
          body: {
            en: 'Verify your email to receive password resets and important system notifications.',
            'zh-CN': '验证你的邮箱以接收密码重置和重要的系统通知。',
            'ja-JP': 'パスワードリセットや重要なシステム通知を受け取るには、メールアドレスを認証してください。',
            'es-ES': 'Verifica tu correo para recibir restablecimientos de contraseña y notificaciones importantes del sistema.',
          },
          dismissible: false,
          action: {
            actionName: 'resend_verification_email',
            label: {
              en: 'Resend verification email',
              'zh-CN': '重新发送验证邮件',
              'ja-JP': '認証メールを再送信',
              'es-ES': 'Reenviar correo de verificación',
            },
          },
        },
      },
    ],

    // ── Highlight chips above the fold ────────────────────────────
    highlights: {
      type: 'record:highlights',
      properties: {
        // No `two_factor_enabled` (#25287): a highlight field has no
        // per-field gate, and on a deployment with 2FA off the chip read a
        // dead "No". The state is drawn in the Security tab instead.
        fields: ['email', 'phone_number', 'email_verified', 'role'],
      },
    },

    // ── Tabs: the details grid, then curated related lists ────────
    // Only the lists that are semantically about THIS user account.
    // Everything else (sys_position created_by, sys_email_template
    // updated_by, …) is incidental authorship metadata and would only
    // create noise.
    //
    // There is no `details` slot: the `tabs` slot replaces the whole tab
    // strip the synthesized Details tab lives in, so a `details` slot beside
    // it never rendered and `PageSchema` refuses the pair (#22568). The
    // details grid is therefore the FIRST tab's body here.
    tabs: {
      type: 'page:tabs',
      properties: {
        // `tabStyle`, not `type` (#6776) — see sys-organization.page.ts.
        tabStyle: 'line',
        position: 'top',
        items: [
          {
            // ── Body / details grid ───────────────────────────────
            // Re-groups the remaining fields into sections and hides
            // admin-internal columns. Banned / ban metadata is still
            // editable from the header actions — it is just not shown in
            // every user's body.
            label: { en: 'Details', 'zh-CN': '详情', 'ja-JP': '詳細', 'es-ES': 'Detalles' },
            icon: 'file-text',
            children: [
              {
                type: 'record:details',
                properties: {
                  hideFields: [
                    'id',
                    'banned',
                    'ban_reason',
                    'ban_expires',
                    // already promoted to highlights:
                    'email',
                    'phone_number',
                    'email_verified',
                    'two_factor_enabled', // not a highlight: drawn in the Security tab, behind the 2FA gate
                    'role',
                  ],
                  sections: [
                    {
                      label: { en: 'Identity', 'zh-CN': '身份', 'ja-JP': 'アイデンティティ', 'es-ES': 'Identidad' },
                      fields: ['name', 'image'],
                    },
                    {
                      label: { en: 'Audit', 'zh-CN': '审计', 'ja-JP': '監査', 'es-ES': 'Auditoría' },
                      fields: ['created_at', 'updated_at'],
                    },
                  ],
                },
              },
            ],
          },
          {
            label: { en: 'Positions', 'zh-CN': '岗位', 'ja-JP': 'ポジション', 'es-ES': 'Puestos' },
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
                  title: { en: 'Positions', 'zh-CN': '岗位', 'ja-JP': 'ポジション', 'es-ES': 'Puestos' },
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
            label: { en: 'Permission Sets', 'zh-CN': '权限集', 'ja-JP': '権限セット', 'es-ES': 'Conjuntos de permisos' },
            icon: 'lock',
            children: [
              {
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_user_permission_set',
                  relationshipField: 'user_id',
                  columns: ['permission_set', 'organization_id', 'valid_from', 'valid_until', 'granted_by', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: { en: 'Permission Sets', 'zh-CN': '权限集', 'ja-JP': '権限セット', 'es-ES': 'Conjuntos de permisos' },
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
            label: { en: 'Business Units', 'zh-CN': '业务单元', 'ja-JP': 'ビジネスユニット', 'es-ES': 'Unidades de negocio' },
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
                  title: { en: 'Business Units', 'zh-CN': '业务单元', 'ja-JP': 'ビジネスユニット', 'es-ES': 'Unidades de negocio' },
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
                    },
                  },
                },
              },
            ],
          },
          {
            label: { en: 'Sessions', 'zh-CN': '会话', 'ja-JP': 'セッション', 'es-ES': 'Sesiones' },
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
                  title: { en: 'Sessions', 'zh-CN': '会话', 'ja-JP': 'セッション', 'es-ES': 'Sesiones' },
                },
              },
            ],
          },
          {
            label: { en: 'Linked Accounts', 'zh-CN': '关联账号', 'ja-JP': '連携アカウント', 'es-ES': 'Cuentas vinculadas' },
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
                  title: { en: 'Linked Accounts', 'zh-CN': '关联账号', 'ja-JP': '連携アカウント', 'es-ES': 'Cuentas vinculadas' },
                },
              },
            ],
          },
          {
            label: { en: 'Organizations', 'zh-CN': '组织', 'ja-JP': '組織', 'es-ES': 'Organizaciones' },
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
                  title: { en: 'Organizations', 'zh-CN': '组织', 'ja-JP': '組織', 'es-ES': 'Organizaciones' },
                },
              },
            ],
          },
          {
            label: { en: 'OAuth Apps', 'zh-CN': 'OAuth 应用', 'ja-JP': 'OAuth アプリ', 'es-ES': 'Aplicaciones OAuth' },
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
                  title: { en: 'OAuth Apps', 'zh-CN': 'OAuth 应用', 'ja-JP': 'OAuth アプリ', 'es-ES': 'Aplicaciones OAuth' },
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
            label: { en: 'Security', 'zh-CN': '安全', 'ja-JP': 'セキュリティ', 'es-ES': 'Seguridad' },
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
            label: { en: 'API Keys', 'zh-CN': 'API 密钥', 'ja-JP': 'API キー', 'es-ES': 'Claves de API' },
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
                  title: { en: 'API Keys', 'zh-CN': 'API 密钥', 'ja-JP': 'API キー', 'es-ES': 'Claves de API' },
                },
              },
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
            label: { en: 'Preferences', 'zh-CN': '偏好设置', 'ja-JP': '設定', 'es-ES': 'Preferencias' },
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
                  title: { en: 'Preferences', 'zh-CN': '偏好设置', 'ja-JP': '設定', 'es-ES': 'Preferencias' },
                },
              },
            ],
          },
        ],
      },
    },

    // ── Suppress the Discussion / Chatter thread ──────────────────
    discussion: [],
  },
};
