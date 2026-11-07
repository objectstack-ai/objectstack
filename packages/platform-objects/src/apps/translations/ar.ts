// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { arObjects } from './ar.objects.generated.js';

/**
 * العربية (ar) — Setup App Translations
 */
export const ar: TranslationData = {
  objects: arObjects,
  apps: {
    account: {
      label: 'الحساب',
      description: 'إعدادات الأمان والهوية الشخصية',
      navigation: {
        grp_account_inbox: { label: 'صندوق الوارد' },
        grp_account_security: { label: 'الأمان' },
        grp_account_developer: { label: 'المطوّر' },
        grp_account_ai_assistant: { label: 'مساعد الذكاء الاصطناعي' },
        nav_account_profile: { label: 'الملف الشخصي' },
        nav_account_notifications: { label: 'الإشعارات' },
        nav_account_approvals: { label: 'بانتظار موافقتي' },
        nav_account_memberships: { label: 'مؤسساتي' },
        nav_account_linked: { label: 'الحسابات المرتبطة' },
        nav_account_sessions: { label: 'الجلسات النشطة' },
        nav_account_api_keys: { label: 'مفاتيح API' },
        nav_account_oauth_apps: { label: 'تطبيقات OAuth' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: 'ربط مساعد ذكاء اصطناعي' },
      },
    },
    setup: {
      label: 'الإعداد',
      description: 'إعدادات المنصة وإدارتها',
      navigation: {
        group_overview: { label: 'نظرة عامة' },
        group_apps: { label: 'التطبيقات' },
        nav_packaged_actions: { label: 'الإجراءات المضمَّنة في الحزم' },
        nav_marketplace_browse: { label: 'تصفح السوق' },
        nav_marketplace_installed: { label: 'التطبيقات المثبّتة' },
        nav_cloud_connection: { label: 'الاتصال السحابي' },
        group_people_org: { label: 'الأشخاص والمؤسسة' },
        group_access_control: { label: 'التحكم في الوصول' },
        group_approvals: { label: 'الموافقات' },
        group_configuration: { label: 'التهيئة' },
        group_integrations: { label: 'عمليات التكامل' },
        group_diagnostics: { label: 'التشخيص' },
        group_advanced: { label: 'متقدم' },

        nav_system_overview: { label: 'نظرة عامة على النظام' },
        nav_connect_agent: { label: 'ربط مساعد ذكاء اصطناعي' },

        nav_users: { label: 'المستخدمون' },
        nav_organization: { label: 'المؤسسة' },
        nav_business_units: { label: 'وحدات الأعمال' },
        nav_teams: { label: 'الفرق' },
        nav_organizations: { label: 'المؤسسات' },
        nav_invitations: { label: 'الدعوات' },
        nav_position_holders: { label: 'شاغلو المناصب' },
        nav_permission_set_assignment: { label: 'إسناد مجموعات الأذونات' },

        nav_sharing_rules: { label: 'قواعد المشاركة' },
        nav_record_shares: { label: 'مشاركات السجلات' },
        nav_queues: { label: 'قوائم الانتظار' },
        nav_queue_members: { label: 'أعضاء قائمة الانتظار' },
        nav_assignment_rules: { label: 'قواعد الإسناد' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'مزوّدو SSO' },
        nav_api_keys: { label: 'مفاتيح API' },

        // صندوق الموافقات = the Approvals Inbox component (#7234) — the surface
        // with decision actions. The three below are the engine's raw tables; the
        // first and last read as plugin-approvals' ar object plural labels.
        nav_approvals_inbox: { label: 'صندوق الموافقات' },
        nav_approval_requests: { label: 'طلبات الموافقة' },
        nav_approval_actions: { label: 'سجل الموافقات' },
        // `تفويضات الموافقة` matches sys_approval_delegation's object plural
        // label; `(خارج المكتب)` renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: 'تفويضات الموافقة (خارج المكتب)' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' ar bundle (`setup-nav-hub-parity.test.ts`), so the
        // two delivery pages say إرسال here while the HTTP log below says تسليم,
        // as sys_http_delivery's ar object label does.
        nav_settings_hub: { label: 'جميع الإعدادات' },
        nav_settings_localization: { label: 'الترجمة والإعدادات المحلية' },
        nav_exchange_rates: { label: 'أسعار الصرف' },
        nav_settings_company: { label: 'الشركة' },
        nav_settings_mail: { label: 'إرسال البريد' },
        nav_settings_sms: { label: 'إرسال الرسائل النصية' },
        nav_settings_branding: { label: 'العلامة التجارية' },
        nav_settings_auth: { label: 'المصادقة' },
        nav_settings_storage: { label: 'تخزين الملفات' },
        nav_settings_ai: { label: 'الذكاء الاصطناعي والتضمين (Embedder)' },
        nav_settings_knowledge: { label: 'المعرفة' },
        nav_settings_lifecycle: { label: 'دورة حياة البيانات' },
        nav_notification_preferences: { label: 'تفضيلات الإشعارات' },
        nav_notification_templates: { label: 'قوالب الإشعارات' },

        nav_sessions: { label: 'الجلسات' },
        nav_audit_logs: { label: 'سجل التدقيق' },
        nav_notifications: { label: 'الإشعارات' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `خطافات الويب` is sys_webhook's own ar object plural label, and this
        // bundle is where that choice is RECORDED rather than reached by falling
        // back (#5750).
        nav_webhooks: { label: 'خطافات الويب' },
        nav_http_deliveries: { label: 'عمليات تسليم HTTP' },
        nav_datasources: { label: 'مصادر البيانات' },
        nav_connector_credentials: { label: 'بيانات اعتماد الموصلات' },
        nav_connector_connections: { label: 'اتصالات الموصلات' },

        nav_oauth_apps: { label: 'تطبيقات OAuth' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'منضدة عمل البيانات الوصفية للمطوّرين والمحللين والمنفّذين',
      navigation: {
        group_overview: { label: 'نظرة عامة' },
        nav_app_builder: { label: 'منشئ التطبيقات' },
        nav_metadata_directory: { label: 'كل أنواع البيانات الوصفية' },
        nav_packages: { label: 'الحزم' },
        group_data_model: { label: 'نموذج البيانات' },
        nav_objects: { label: 'الكائنات' },
        group_ux: { label: 'تجربة المستخدم' },
        nav_apps: { label: 'التطبيقات' },
        nav_views: { label: 'طرق العرض' },
        nav_pages: { label: 'الصفحات' },
        nav_dashboards: { label: 'لوحات المعلومات' },
        nav_reports: { label: 'التقارير' },
        nav_datasets: { label: 'مجموعات البيانات' },
        group_logic: { label: 'المنطق' },
        nav_actions: { label: 'الإجراءات' },
        nav_hooks: { label: 'الخطافات' },
        group_automation: { label: 'الأتمتة' },
        nav_flows: { label: 'التدفقات' },
        group_ai: { label: 'الذكاء الاصطناعي' },
        nav_agents: { label: 'الوكلاء' },
        nav_tools: { label: 'الأدوات' },
        nav_skills: { label: 'المهارات' },
        group_developer: { label: 'المطوّر' },
        nav_api_console: { label: 'وحدة تحكم API' },
        nav_flow_runs: { label: 'عمليات تشغيل التدفقات' },
        nav_public_forms: { label: 'النماذج العامة' },
        nav_integrations: { label: 'عمليات التكامل وواجهات API' },
        group_integration: { label: 'التكامل' },
        nav_email_templates: { label: 'قوالب البريد الإلكتروني' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'نظرة عامة على النظام',
      description: 'صحة المنصة، ونشاط الأمان، وأحداث التدقيق الأخيرة',
      widgets: {
        widget_total_users: { title: 'إجمالي المستخدمين', description: 'إجمالي المستخدمين المسجّلين في النظام' },
        widget_organizations: { title: 'المؤسسات', description: 'إجمالي المؤسسات على المنصة' },
        widget_active_sessions: { title: 'الجلسات النشطة', description: 'عدد جلسات المستخدمين النشطة حاليًا' },
        widget_packages_installed: { title: 'الحزم المثبّتة', description: 'عمليات تثبيت الحزم النشطة عبر المشاريع' },
        widget_login_events: { title: 'أحداث تسجيل الدخول', description: 'أحداث المصادقة التي يسجّلها سجل التدقيق' },
        widget_config_changes: { title: 'تغييرات التهيئة', description: 'تعديلات تهيئة النظام' },
        widget_events_by_type: { title: 'أحداث التدقيق حسب الإجراء', description: 'توزيع أحداث التدقيق حسب نوع الإجراء' },
        widget_events_by_user: { title: 'الأحداث حسب المستخدم', description: 'توزيع النشاط بين المستخدمين' },
        widget_recent_events: { title: 'حجم الأحداث حسب الإجراء', description: 'حجم الأحداث مجمَّعًا حسب الإجراء (login، logout، config، …)' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: 'النطاق الزمني' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: 'المستخدمون' } } },
    sys_organization_metrics: { measures: { org_count: { label: 'المؤسسات' } } },
    sys_session_metrics: { measures: { session_count: { label: 'الجلسات' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: 'عمليات التثبيت' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: 'الإجراء' }, user_id: { label: 'المستخدم' } },
      measures: { event_count: { label: 'الأحداث' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: 'الاتصال السحابي',
      subtitle: 'اربط وقت التشغيل هذا بمستوى تحكم ObjectStack لتصفح الحزم الخاصة بمؤسستك وتثبيتها هنا.',
    },
    connect_agent: {
      label: 'ربط مساعد ذكاء اصطناعي',
      subtitle: 'امنح أي عميل ذكاء اصطناعي يدعم MCP وصولًا محكومًا إلى هذا النظام — كل استدعاء يُنفَّذ بأذونات المستدعي نفسه وأمانه على مستوى الصف.',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: 'المستخدم' },
    sys_organization_detail: { label: 'المؤسسة' },
  },
};
