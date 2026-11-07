// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { zhHantObjects } from './zh-Hant.objects.generated.js';

/**
 * 繁體中文 (zh-Hant) — Setup App Translations
 */
export const zhHant: TranslationData = {
  objects: zhHantObjects,
  apps: {
    account: {
      label: '帳戶',
      description: '個人安全與身分設定',
      navigation: {
        grp_account_inbox: { label: '收件匣' },
        grp_account_security: { label: '安全' },
        grp_account_developer: { label: '開發者' },
        grp_account_ai_assistant: { label: 'AI 助理' },
        nav_account_profile: { label: '個人資料' },
        nav_account_notifications: { label: '通知' },
        nav_account_approvals: { label: '待我核准' },
        nav_account_memberships: { label: '我的組織' },
        nav_account_linked: { label: '已關聯帳戶' },
        nav_account_sessions: { label: '使用中的工作階段' },
        nav_account_api_keys: { label: 'API 金鑰' },
        nav_account_oauth_apps: { label: 'OAuth 應用程式' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: '連接 AI 助理' },
      },
    },
    setup: {
      label: '系統設定',
      description: '平台設定與管理',
      navigation: {
        group_overview: { label: '總覽' },
        group_apps: { label: '應用程式' },
        nav_packaged_actions: { label: '打包動作' },
        nav_marketplace_browse: { label: '瀏覽應用程式市場' },
        nav_marketplace_installed: { label: '已安裝應用程式' },
        nav_cloud_connection: { label: '雲端連線' },
        group_people_org: { label: '人員與組織' },
        group_access_control: { label: '存取控制' },
        group_approvals: { label: '核准' },
        group_configuration: { label: '設定' },
        group_integrations: { label: '整合' },
        group_diagnostics: { label: '診斷' },
        group_advanced: { label: '進階' },

        nav_system_overview: { label: '系統概覽' },
        nav_connect_agent: { label: '連接 AI 助理' },

        nav_users: { label: '使用者' },
        nav_organization: { label: '目前組織' },
        nav_business_units: { label: '業務單位' },
        nav_teams: { label: '團隊' },
        nav_organizations: { label: '所有組織' },
        nav_invitations: { label: '邀請' },
        nav_position_holders: { label: '職位持有人' },
        nav_permission_set_assignment: { label: '權限集指派' },

        nav_sharing_rules: { label: '共用規則' },
        nav_record_shares: { label: '記錄共用' },
        nav_queues: { label: '佇列' },
        nav_queue_members: { label: '佇列成員' },
        nav_assignment_rules: { label: '指派規則' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'SSO 提供方' },
        // Conditionally contributed by plugin-auth (only while SCIM is wired),
        // the same case as the entry above; see `en.ts` (#31123).
        nav_scim_credentials: { label: 'SCIM 憑證' },
        nav_api_keys: { label: 'API 金鑰' },

        // 核准中心 = the Approvals Inbox component (#7234) — the surface with
        // decision actions. The three below are the engine's raw tables; the
        // first and last read as plugin-approvals' zh-Hant object labels.
        nav_approvals_inbox: { label: '核准中心' },
        nav_approval_requests: { label: '核准請求' },
        nav_approval_actions: { label: '核准歷史' },
        // `核准委派` matches sys_approval_delegation's object label; `（外出）`
        // renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: '核准委派（外出）' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' zh-Hant bundle (`setup-nav-hub-parity.test.ts`), so
        // the two delivery pages say 投遞 here while the HTTP log below says 傳送,
        // as sys_http_delivery's zh-Hant object label does.
        nav_settings_hub: { label: '全部設定' },
        nav_settings_localization: { label: '在地化' },
        nav_exchange_rates: { label: '匯率' },
        nav_settings_company: { label: '公司' },
        nav_settings_mail: { label: '郵件投遞' },
        nav_settings_sms: { label: '簡訊投遞' },
        nav_settings_branding: { label: '品牌' },
        nav_settings_auth: { label: '驗證' },
        nav_settings_access_policy: { label: '存取原則' },
        nav_settings_storage: { label: '檔案儲存' },
        nav_settings_ai: { label: 'AI 與 Embedder' },
        nav_settings_knowledge: { label: '知識庫' },
        nav_settings_lifecycle: { label: '資料生命週期' },
        nav_notification_preferences: { label: '通知偏好設定' },
        nav_notification_templates: { label: '通知範本' },

        nav_sessions: { label: '工作階段' },
        nav_audit_logs: { label: '稽核日誌' },
        nav_notifications: { label: '通知' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `Webhooks` stays the loanword deliberately, as in zh-CN: sys_webhook's
        // own zh-Hant object label is `Webhook` too, and this bundle is where
        // that choice is RECORDED rather than reached by falling back (#5750).
        nav_webhooks: { label: 'Webhooks' },
        nav_http_deliveries: { label: 'HTTP 傳送' },
        nav_datasources: { label: '資料來源' },
        nav_connector_credentials: { label: '連接器憑證' },
        nav_connector_connections: { label: '連接器連線' },

        nav_oauth_apps: { label: 'OAuth 應用程式' },
      },
    },
    studio: {
      label: 'Studio',
      description: '供開發者、分析師與導入人員使用的中繼資料工作台',
      navigation: {
        group_overview: { label: '總覽' },
        nav_app_builder: { label: '應用程式建構器' },
        nav_metadata_directory: { label: '全部中繼資料類型' },
        nav_packages: { label: '套件' },
        group_data_model: { label: '資料模型' },
        nav_objects: { label: '物件' },
        group_ux: { label: '使用者體驗' },
        nav_apps: { label: '應用程式' },
        nav_views: { label: '檢視' },
        nav_pages: { label: '頁面' },
        nav_dashboards: { label: '儀表板' },
        nav_reports: { label: '報表' },
        nav_datasets: { label: '資料集' },
        group_logic: { label: '邏輯' },
        nav_actions: { label: '動作' },
        nav_hooks: { label: '掛鉤' },
        group_automation: { label: '自動化' },
        nav_flows: { label: '流程' },
        group_ai: { label: 'AI' },
        nav_agents: { label: 'AI 代理' },
        nav_tools: { label: '工具' },
        nav_skills: { label: '技能' },
        group_developer: { label: '開發者' },
        nav_api_console: { label: 'API 控制台' },
        nav_flow_runs: { label: '流程執行記錄' },
        nav_public_forms: { label: '公開表單' },
        nav_integrations: { label: '整合與 API' },
        group_integration: { label: '整合' },
        nav_email_templates: { label: '郵件範本' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: '系統概覽',
      description: '平台健康狀況、安全活動與最近的稽核事件',
      widgets: {
        widget_total_users: { title: '使用者總數', description: '系統中已註冊的使用者總數' },
        widget_organizations: { title: '組織數', description: '平台上的組織總數' },
        widget_active_sessions: { title: '活躍工作階段', description: '目前活躍使用者工作階段數量' },
        widget_packages_installed: { title: '已安裝套件', description: '專案中已啟用的安裝套件數' },
        widget_login_events: { title: '登入事件', description: '稽核日誌中記錄的驗證事件' },
        widget_config_changes: { title: '設定變更', description: '系統設定修改' },
        widget_events_by_type: { title: '依操作分佈的稽核事件', description: '稽核事件依操作類型分佈' },
        widget_events_by_user: { title: '依使用者分佈的事件', description: '使用者活動分佈' },
        widget_recent_events: { title: '依操作統計的事件量', description: '依操作分組的事件量（登入、登出、設定等）' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: '日期範圍' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: '使用者' } } },
    sys_organization_metrics: { measures: { org_count: { label: '組織' } } },
    sys_session_metrics: { measures: { session_count: { label: '工作階段' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: '安裝' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: '操作' }, user_id: { label: '使用者' } },
      measures: { event_count: { label: '事件' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: '雲端連線',
      subtitle: '將此執行階段連接到 ObjectStack 控制平面，即可瀏覽並安裝組織的私有套件。',
    },
    connect_agent: {
      label: '連接 AI 助理',
      subtitle: '讓任何支援 MCP 的 AI 用戶端以受控方式存取本系統——每次呼叫都在呼叫者自身的權限與列級安全範圍內執行。',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: '使用者' },
    sys_organization_detail: { label: '組織' },
  },
};
