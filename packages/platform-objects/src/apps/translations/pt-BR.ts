// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { ptBRObjects } from './pt-BR.objects.generated.js';

/**
 * Português do Brasil (pt-BR) — Setup App Translations
 */
export const ptBR: TranslationData = {
  objects: ptBRObjects,
  apps: {
    account: {
      label: 'Conta',
      description: 'Configurações pessoais de segurança e identidade',
      navigation: {
        grp_account_inbox: { label: 'Caixa de entrada' },
        grp_account_security: { label: 'Segurança' },
        grp_account_developer: { label: 'Desenvolvedor' },
        grp_account_ai_assistant: { label: 'Assistente de IA' },
        nav_account_profile: { label: 'Perfil' },
        nav_account_notifications: { label: 'Notificações' },
        nav_account_approvals: { label: 'Minhas aprovações pendentes' },
        nav_account_memberships: { label: 'Minhas organizações' },
        nav_account_linked: { label: 'Contas vinculadas' },
        nav_account_sessions: { label: 'Sessões ativas' },
        nav_account_api_keys: { label: 'Chaves de API' },
        nav_account_oauth_apps: { label: 'Aplicativos OAuth' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: 'Conectar um assistente de IA' },
      },
    },
    setup: {
      label: 'Configuração',
      description: 'Configurações e administração da plataforma',
      navigation: {
        group_overview: { label: 'Visão geral' },
        group_apps: { label: 'Aplicativos' },
        nav_packaged_actions: { label: 'Ações fornecidas por pacotes' },
        nav_marketplace_browse: { label: 'Explorar o Marketplace' },
        nav_marketplace_installed: { label: 'Aplicativos instalados' },
        nav_cloud_connection: { label: 'Conexão com a nuvem' },
        group_people_org: { label: 'Pessoas e organização' },
        group_access_control: { label: 'Controle de acesso' },
        group_approvals: { label: 'Aprovações' },
        group_configuration: { label: 'Configuração' },
        group_integrations: { label: 'Integrações' },
        group_diagnostics: { label: 'Diagnóstico' },
        group_advanced: { label: 'Avançado' },

        nav_system_overview: { label: 'Visão geral do sistema' },
        nav_connect_agent: { label: 'Conectar um assistente de IA' },

        nav_users: { label: 'Usuários' },
        nav_organization: { label: 'Organização' },
        nav_business_units: { label: 'Unidades de negócios' },
        nav_teams: { label: 'Equipes' },
        nav_organizations: { label: 'Organizações' },
        nav_invitations: { label: 'Convites' },
        nav_position_holders: { label: 'Ocupantes de cargos' },
        nav_permission_set_assignment: { label: 'Atribuição de conjuntos de permissões' },

        nav_sharing_rules: { label: 'Regras de compartilhamento' },
        nav_record_shares: { label: 'Compartilhamentos de registros' },
        nav_queues: { label: 'Filas' },
        nav_queue_members: { label: 'Membros da fila' },
        nav_assignment_rules: { label: 'Regras de atribuição' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'Provedores de SSO' },
        // Conditionally contributed by plugin-auth (only while SCIM is wired),
        // the same case as the entry above; see `en.ts` (#31123). The short form
        // of `sys_scim_connection_credential.pluralLabel`.
        nav_scim_credentials: { label: 'Credenciais SCIM' },
        nav_api_keys: { label: 'Chaves de API' },

        // Central de aprovações = the Approvals Inbox component (#7234) — the
        // surface with decision actions. The three below are the engine's raw
        // tables; the first and last read as plugin-approvals' pt-BR object
        // plural labels.
        nav_approvals_inbox: { label: 'Central de aprovações' },
        nav_approval_requests: { label: 'Solicitações de aprovação' },
        nav_approval_actions: { label: 'Histórico de ações' },
        // `Delegações de aprovação` matches sys_approval_delegation's object
        // plural label; `(ausência)` renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: 'Delegações de aprovação (ausência)' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' pt-BR bundle (`setup-nav-hub-parity.test.ts`), so the
        // two delivery pages say Envio here while the HTTP log below says
        // Entregas, as sys_http_delivery's pt-BR object label does.
        nav_settings_hub: { label: 'Todas as configurações' },
        nav_settings_localization: { label: 'Localização' },
        nav_exchange_rates: { label: 'Taxas de câmbio' },
        nav_settings_company: { label: 'Empresa' },
        nav_settings_mail: { label: 'Envio de e-mail' },
        nav_settings_sms: { label: 'Envio de SMS' },
        nav_settings_branding: { label: 'Identidade visual' },
        nav_settings_auth: { label: 'Autenticação' },
        nav_settings_access_policy: { label: 'Política de acesso' },
        nav_settings_storage: { label: 'Armazenamento de arquivos' },
        nav_settings_ai: { label: 'IA e Embedder' },
        nav_settings_knowledge: { label: 'Conhecimento' },
        nav_settings_lifecycle: { label: 'Ciclo de vida dos dados' },
        nav_notification_preferences: { label: 'Preferências de notificação' },
        nav_notification_templates: { label: 'Modelos de notificação' },

        nav_sessions: { label: 'Sessões' },
        nav_audit_logs: { label: 'Log de auditoria' },
        nav_notifications: { label: 'Notificações' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `Webhooks` is sys_webhook's own pt-BR object plural label, and this
        // bundle is where that choice is RECORDED rather than reached by falling
        // back (#5750).
        nav_webhooks: { label: 'Webhooks' },
        nav_http_deliveries: { label: 'Entregas HTTP' },
        nav_datasources: { label: 'Fontes de dados' },
        nav_connector_credentials: { label: 'Credenciais dos conectores' },
        nav_connector_connections: { label: 'Conexões dos conectores' },

        nav_oauth_apps: { label: 'Aplicativos OAuth' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Ateliê de metadados para desenvolvedores, analistas e integradores',
      navigation: {
        group_overview: { label: 'Visão geral' },
        nav_app_builder: { label: 'Criador de aplicativos' },
        nav_metadata_directory: { label: 'Todos os tipos de metadados' },
        nav_packages: { label: 'Pacotes' },
        group_data_model: { label: 'Modelo de dados' },
        nav_objects: { label: 'Objetos' },
        group_ux: { label: 'Experiência do usuário' },
        nav_apps: { label: 'Aplicativos' },
        nav_views: { label: 'Visualizações' },
        nav_pages: { label: 'Páginas' },
        nav_dashboards: { label: 'Painéis' },
        nav_reports: { label: 'Relatórios' },
        nav_datasets: { label: 'Conjuntos de dados' },
        group_logic: { label: 'Lógica' },
        nav_actions: { label: 'Ações' },
        nav_hooks: { label: 'Hooks' },
        group_automation: { label: 'Automação' },
        nav_flows: { label: 'Fluxos' },
        group_ai: { label: 'IA' },
        nav_agents: { label: 'Agentes' },
        nav_tools: { label: 'Ferramentas' },
        nav_skills: { label: 'Habilidades' },
        group_developer: { label: 'Desenvolvedor' },
        nav_api_console: { label: 'Console da API' },
        nav_flow_runs: { label: 'Execuções de fluxos' },
        nav_public_forms: { label: 'Formulários públicos' },
        nav_integrations: { label: 'Integrações e API' },
        group_integration: { label: 'Integração' },
        nav_email_templates: { label: 'Modelos de e-mail' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'Visão geral do sistema',
      description: 'Integridade da plataforma, atividade de segurança e eventos de auditoria recentes',
      widgets: {
        widget_total_users: { title: 'Total de usuários', description: 'Número total de usuários cadastrados no sistema' },
        widget_organizations: { title: 'Organizações', description: 'Número total de organizações na plataforma' },
        widget_active_sessions: { title: 'Sessões ativas', description: 'Número de sessões de usuário ativas no momento' },
        widget_packages_installed: { title: 'Pacotes instalados', description: 'Instalações de pacotes ativas nos projetos' },
        widget_login_events: { title: 'Eventos de login', description: 'Eventos de autenticação registrados pelo log de auditoria' },
        widget_config_changes: { title: 'Alterações de configuração', description: 'Alterações na configuração do sistema' },
        widget_events_by_type: { title: 'Eventos de auditoria por ação', description: 'Distribuição dos eventos de auditoria por tipo de ação' },
        widget_events_by_user: { title: 'Eventos por usuário', description: 'Distribuição da atividade entre os usuários' },
        widget_recent_events: { title: 'Volume de eventos por ação', description: 'Volume de eventos agrupado por ação (login, logout, config, …)' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: 'Período' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: 'Número de usuários' } } },
    sys_organization_metrics: { measures: { org_count: { label: 'Número de organizações' } } },
    sys_session_metrics: { measures: { session_count: { label: 'Número de sessões' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: 'Número de instalações' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: 'Tipo de ação' }, user_id: { label: 'Usuário' } },
      measures: { event_count: { label: 'Número de eventos' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: 'Conexão com a nuvem',
      subtitle: 'Conecte este runtime a um plano de controle do ObjectStack para explorar os pacotes privados da sua organização e instalá-los aqui.',
    },
    connect_agent: {
      label: 'Conectar um assistente de IA',
      subtitle:
        'Trabalhe neste sistema a partir do Claude, do Doubao e de outros assistentes de IA. '
        + 'Cada um age como você: ele só vê e altera o que as suas próprias permissões permitem.',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: 'Usuário' },
    sys_organization_detail: { label: 'Organização' },
  },
};
