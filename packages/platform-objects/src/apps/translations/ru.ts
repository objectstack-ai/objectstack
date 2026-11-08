// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { ruObjects } from './ru.objects.generated.js';

/**
 * Русский (ru) — Setup App Translations
 */
export const ru: TranslationData = {
  objects: ruObjects,
  apps: {
    account: {
      label: 'Учётная запись',
      description: 'Личные настройки безопасности и удостоверения',
      navigation: {
        grp_account_inbox: { label: 'Входящие' },
        grp_account_security: { label: 'Безопасность' },
        grp_account_developer: { label: 'Разработчик' },
        grp_account_ai_assistant: { label: 'ИИ-ассистент' },
        nav_account_profile: { label: 'Профиль' },
        nav_account_notifications: { label: 'Уведомления' },
        nav_account_approvals: { label: 'Ждут моего решения' },
        nav_account_memberships: { label: 'Мои организации' },
        nav_account_linked: { label: 'Связанные учётные записи' },
        nav_account_sessions: { label: 'Активные сеансы' },
        nav_account_api_keys: { label: 'API-ключи' },
        nav_account_oauth_apps: { label: 'Приложения OAuth' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: 'Подключить ИИ-ассистента' },
      },
    },
    setup: {
      label: 'Настройка',
      description: 'Настройки и администрирование платформы',
      navigation: {
        group_overview: { label: 'Обзор' },
        group_apps: { label: 'Приложения' },
        nav_packaged_actions: { label: 'Действия из пакетов' },
        nav_marketplace_browse: { label: 'Обзор Marketplace' },
        nav_marketplace_installed: { label: 'Установленные приложения' },
        nav_cloud_connection: { label: 'Подключение к облаку' },
        group_people_org: { label: 'Люди и организация' },
        group_access_control: { label: 'Управление доступом' },
        group_approvals: { label: 'Согласования' },
        group_configuration: { label: 'Конфигурация' },
        group_integrations: { label: 'Интеграции' },
        group_diagnostics: { label: 'Диагностика' },
        group_advanced: { label: 'Дополнительно' },

        nav_system_overview: { label: 'Обзор системы' },
        nav_connect_agent: { label: 'Подключить ИИ-ассистента' },

        nav_users: { label: 'Пользователи' },
        nav_organization: { label: 'Организация' },
        nav_business_units: { label: 'Бизнес-подразделения' },
        nav_teams: { label: 'Команды' },
        nav_organizations: { label: 'Организации' },
        nav_invitations: { label: 'Приглашения' },
        nav_position_holders: { label: 'Занимающие должности' },
        nav_permission_set_assignment: { label: 'Назначение наборов разрешений' },

        nav_sharing_rules: { label: 'Правила общего доступа' },
        nav_record_shares: { label: 'Общий доступ к записям' },
        nav_queues: { label: 'Очереди' },
        nav_queue_members: { label: 'Участники очереди' },
        nav_assignment_rules: { label: 'Правила назначения' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'Поставщики SSO' },
        // Conditionally contributed by plugin-auth (only while SCIM is wired),
        // the same case as the entry above; see `en.ts` (#31123). The short form
        // of `sys_scim_connection_credential.pluralLabel`.
        nav_scim_credentials: { label: 'Учётные данные SCIM' },
        nav_api_keys: { label: 'API-ключи' },

        // Центр согласований = the Approvals Inbox component (#7234) — the
        // surface with decision actions. The three below are the engine's raw
        // tables; the first and last read as plugin-approvals' ru object plural
        // labels.
        nav_approvals_inbox: { label: 'Центр согласований' },
        nav_approval_requests: { label: 'Запросы на согласование' },
        nav_approval_actions: { label: 'История действий' },
        // `Делегирования согласований` matches sys_approval_delegation's object
        // plural label; `(отсутствие)` renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: 'Делегирования согласований (отсутствие)' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' ru bundle (`setup-nav-hub-parity.test.ts`), so the
        // two delivery pages say Доставка here, as the HTTP log below does after
        // sys_http_delivery's ru object label.
        nav_settings_hub: { label: 'Все настройки' },
        nav_settings_localization: { label: 'Локализация' },
        nav_exchange_rates: { label: 'Курсы валют' },
        nav_settings_company: { label: 'Компания' },
        nav_settings_mail: { label: 'Доставка почты' },
        nav_settings_sms: { label: 'Доставка SMS' },
        nav_settings_branding: { label: 'Брендинг' },
        nav_settings_auth: { label: 'Аутентификация' },
        nav_settings_access_policy: { label: 'Политика доступа' },
        nav_settings_storage: { label: 'Хранилище файлов' },
        nav_settings_ai: { label: 'ИИ и Embedder' },
        nav_settings_knowledge: { label: 'Знания' },
        nav_settings_lifecycle: { label: 'Жизненный цикл данных' },
        nav_notification_preferences: { label: 'Настройки уведомлений' },
        nav_notification_templates: { label: 'Шаблоны уведомлений' },

        nav_sessions: { label: 'Сеансы' },
        nav_audit_logs: { label: 'Журнал аудита' },
        nav_notifications: { label: 'Уведомления' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `Веб-хуки` is sys_webhook's own ru object plural label, and this
        // bundle is where that choice is RECORDED rather than reached by falling
        // back (#5750).
        nav_webhooks: { label: 'Веб-хуки' },
        nav_http_deliveries: { label: 'HTTP-доставки' },
        nav_datasources: { label: 'Источники данных' },
        nav_connector_credentials: { label: 'Учётные данные коннекторов' },
        nav_connector_connections: { label: 'Подключения коннекторов' },

        nav_oauth_apps: { label: 'Приложения OAuth' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Мастерская метаданных для разработчиков, аналитиков и интеграторов',
      navigation: {
        group_overview: { label: 'Обзор' },
        nav_app_builder: { label: 'Конструктор приложений' },
        nav_metadata_directory: { label: 'Все типы метаданных' },
        nav_packages: { label: 'Пакеты' },
        group_data_model: { label: 'Модель данных' },
        nav_objects: { label: 'Объекты' },
        group_ux: { label: 'Пользовательский интерфейс' },
        nav_apps: { label: 'Приложения' },
        nav_views: { label: 'Представления' },
        nav_pages: { label: 'Страницы' },
        nav_dashboards: { label: 'Дашборды' },
        nav_reports: { label: 'Отчёты' },
        nav_datasets: { label: 'Наборы данных' },
        group_logic: { label: 'Логика' },
        nav_actions: { label: 'Действия' },
        nav_hooks: { label: 'Хуки' },
        group_automation: { label: 'Автоматизация' },
        nav_flows: { label: 'Потоки' },
        group_ai: { label: 'ИИ' },
        nav_agents: { label: 'Агенты' },
        nav_tools: { label: 'Инструменты' },
        nav_skills: { label: 'Навыки' },
        group_developer: { label: 'Разработчик' },
        nav_api_console: { label: 'Консоль API' },
        nav_flow_runs: { label: 'Запуски потоков' },
        nav_public_forms: { label: 'Публичные формы' },
        nav_integrations: { label: 'Интеграции и API' },
        group_integration: { label: 'Интеграция' },
        nav_email_templates: { label: 'Шаблоны писем' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'Обзор системы',
      description: 'Состояние платформы, активность безопасности и последние события аудита',
      widgets: {
        widget_total_users: { title: 'Всего пользователей', description: 'Общее число пользователей, зарегистрированных в системе' },
        widget_organizations: { title: 'Организации', description: 'Общее число организаций на платформе' },
        widget_active_sessions: { title: 'Активные сеансы', description: 'Число активных сейчас сеансов пользователей' },
        widget_packages_installed: { title: 'Установленные пакеты', description: 'Активные установки пакетов в проектах' },
        widget_login_events: { title: 'События входа', description: 'События аутентификации, записанные журналом аудита' },
        widget_config_changes: { title: 'Изменения конфигурации', description: 'Изменения конфигурации системы' },
        widget_events_by_type: { title: 'События аудита по действиям', description: 'Распределение событий аудита по типу действия' },
        widget_events_by_user: { title: 'События по пользователям', description: 'Распределение активности между пользователями' },
        widget_recent_events: { title: 'Объём событий по действиям', description: 'Объём событий, сгруппированный по действию (вход, выход, конфигурация, …)' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: 'Период' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: 'Число пользователей' } } },
    sys_organization_metrics: { measures: { org_count: { label: 'Число организаций' } } },
    sys_session_metrics: { measures: { session_count: { label: 'Число сеансов' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: 'Число установок' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: 'Тип действия' }, user_id: { label: 'Пользователь' } },
      measures: { event_count: { label: 'Число событий' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: 'Подключение к облаку',
      subtitle: 'Подключите эту среду выполнения к плоскости управления ObjectStack, чтобы просматривать частные пакеты вашей организации и устанавливать их здесь.',
    },
    connect_agent: {
      label: 'Подключить ИИ-ассистента',
      subtitle:
        'Работайте с этой системой из Claude, Doubao и других ИИ-ассистентов. '
        + 'Каждый действует от вашего имени: он видит и изменяет только то, что разрешают ваши собственные разрешения.',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: 'Пользователь' },
    sys_organization_detail: { label: 'Организация' },
  },
};
