// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Page } from '@objectstack/spec/ui';

/**
 * sys_user — Record Detail Page (slotted, default for ALL sys_user records)
 *
 * **Audience**: admins browsing user records from Setup.
 *
 * The Account App's "Profile" entry no longer routes here — it points at
 * the `account:profile_card` Console component for a settings-form-style
 * personal profile. This page therefore optimizes for the admin
 * use case: scanning a user's signals (email/verification/2FA/role),
 * reviewing related sessions/orgs/oauth/api-keys, and triggering
 * admin actions (ban / impersonate / set_role).
 *
 * Strategy
 * --------
 *  - `kind: 'slotted'` + `isDefault: true`: overrides `highlights`,
 *    `details`, `tabs` and `discussion`. Header / actions fall through
 *    to the synthesizer so the object's declared actions
 *    (`update_my_profile / change_my_password / resend_verification_email
 *    / ban_user / set_user_role / impersonate_user / …`) still appear
 *    in the header overflow menu automatically.
 *  - `highlights` promotes the four signals worth scanning at the top:
 *    email, verification state, 2FA, platform role. Highlight fields
 *    are auto-dropped from the details grid below.
 *  - `details` re-groups remaining fields into sections and hides
 *    admin-internal audit columns. Banned / ban metadata is still
 *    editable from the header actions — we just don't show it in
 *    every user's body.
 *  - `tabs` is **explicitly curated** to the 5 related lists that matter
 *    on a user profile (Positions / Sessions / Linked Accounts / Organizations /
 *    Personal OAuth Apps). Without this override, the synthesizer
 *    auto-generates a tab per object that has a FK to sys_user
 *    (sys_position.created_by, sys_email.updated_by, sys_user_preference,
 *    sys_email_template.created_by, …) producing dozens of noisy
 *    "查看全部" cards on every profile.
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
      {
        type: 'record:alert',
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
          visible: 'record.id == ctx.user.id && record.email_verified == false',
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
        fields: ['email', 'email_verified', 'two_factor_enabled', 'role'],
      },
    },

    // ── Body / details grid ───────────────────────────────────────
    details: {
      type: 'record:details',
      properties: {
        hideFields: [
          'id',
          'banned',
          'ban_reason',
          'ban_expires',
          // already promoted to highlights:
          'email',
          'email_verified',
          'two_factor_enabled',
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

    // ── Tabs: curated related lists ───────────────────────────────
    // Only the 4 lists that are semantically about THIS user account.
    // Everything else (sys_position created_by, sys_email_template
    // updated_by, …) is incidental authorship metadata and would only
    // create noise.
    tabs: {
      type: 'page:tabs',
      properties: {
        type: 'line',
        position: 'top',
        items: [
          {
            label: { en: 'Positions', 'zh-CN': '岗位', 'ja-JP': 'ポジション', 'es-ES': 'Puestos' },
            icon: 'shield-check',
            children: [
              {
                // [ADR-0090 D3] Position assignments (岗位分派) — pure SDUI:
                // the Add picker creates sys_user_position rows storing the
                // position's MACHINE NAME (valueField: 'name'), and every
                // server-side rule (the D12 delegated-admin gate, audience-
                // anchor rejection) surfaces its error in the dialog.
                type: 'record:related_list',
                properties: {
                  objectName: 'sys_user_position',
                  relationshipField: 'user_id',
                  columns: ['position', 'business_unit_id', 'granted_by', 'created_at'],
                  sort: [{ field: 'created_at', order: 'desc' }],
                  limit: 25,
                  showViewAll: true,
                  title: { en: 'Positions', 'zh-CN': '岗位', 'ja-JP': 'ポジション', 'es-ES': 'Puestos' },
                  add: {
                    picker: {
                      object: 'sys_position',
                      valueField: 'name',
                      labelField: 'label',
                    },
                    linkField: 'position',
                    label: {
                      en: 'Assign position',
                      'zh-CN': '分配岗位',
                      'ja-JP': 'ポジションを割り当て',
                      'es-ES': 'Asignar puesto',
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
          {
            label: { en: 'Security', 'zh-CN': '安全', 'ja-JP': 'セキュリティ', 'es-ES': 'Seguridad' },
            icon: 'shield',
            children: [
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
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
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
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
                type: 'record:quick_actions',
                properties: {
                  location: 'record_section',
                  align: 'start',
                  actionNames: ['enable_two_factor', 'disable_two_factor', 'generate_backup_codes'],
                },
              },
              { type: 'element:divider' },
              {
                type: 'element:text',
                properties: {
                  variant: 'subheading',
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
                  variant: 'subheading',
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
        ],
      },
    },

    // ── Suppress the Discussion / Chatter thread ──────────────────
    discussion: [],
  },
};
