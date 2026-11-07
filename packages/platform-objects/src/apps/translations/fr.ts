// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { frObjects } from './fr.objects.generated.js';

/**
 * Français (fr) — Setup App Translations
 */
export const fr: TranslationData = {
  objects: frObjects,
  apps: {
    account: {
      label: 'Compte',
      description: 'Paramètres personnels de sécurité et d’identité',
      navigation: {
        grp_account_inbox: { label: 'Boîte de réception' },
        grp_account_security: { label: 'Sécurité' },
        grp_account_developer: { label: 'Développeur' },
        grp_account_ai_assistant: { label: 'Assistant IA' },
        nav_account_profile: { label: 'Profil' },
        nav_account_notifications: { label: 'Notifications' },
        nav_account_approvals: { label: 'Mes approbations en attente' },
        nav_account_memberships: { label: 'Mes organisations' },
        nav_account_linked: { label: 'Comptes liés' },
        nav_account_sessions: { label: 'Sessions actives' },
        nav_account_api_keys: { label: 'Clés API' },
        nav_account_oauth_apps: { label: 'Applications OAuth' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: 'Connecter un assistant IA' },
      },
    },
    setup: {
      label: 'Configuration',
      description: 'Paramètres et administration de la plateforme',
      navigation: {
        group_overview: { label: 'Aperçu' },
        group_apps: { label: 'Applications' },
        nav_packaged_actions: { label: 'Actions fournies par les packages' },
        nav_marketplace_browse: { label: 'Parcourir la Marketplace' },
        nav_marketplace_installed: { label: 'Applications installées' },
        nav_cloud_connection: { label: 'Connexion au cloud' },
        group_people_org: { label: 'Personnes et organisation' },
        group_access_control: { label: 'Contrôle d’accès' },
        group_approvals: { label: 'Approbations' },
        group_configuration: { label: 'Configuration' },
        group_integrations: { label: 'Intégrations' },
        group_diagnostics: { label: 'Diagnostics' },
        group_advanced: { label: 'Avancé' },

        nav_system_overview: { label: 'Aperçu du système' },
        nav_connect_agent: { label: 'Connecter un assistant IA' },

        nav_users: { label: 'Utilisateurs' },
        nav_organization: { label: 'Organisation' },
        nav_business_units: { label: 'Unités commerciales' },
        nav_teams: { label: 'Équipes' },
        nav_organizations: { label: 'Organisations' },
        nav_invitations: { label: 'Invitations' },
        nav_position_holders: { label: 'Titulaires de postes' },
        nav_permission_set_assignment: { label: 'Attribution des ensembles d’autorisations' },

        nav_sharing_rules: { label: 'Règles de partage' },
        nav_record_shares: { label: 'Partages d’enregistrements' },
        nav_queues: { label: 'Files d’attente' },
        nav_queue_members: { label: 'Membres de file d’attente' },
        nav_assignment_rules: { label: 'Règles d’attribution' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'Fournisseurs SSO' },
        nav_api_keys: { label: 'Clés API' },

        // Centre d’approbations = the Approvals Inbox component (#7234) — the
        // surface with decision actions. The three below are the engine's raw
        // tables; the first and last read as plugin-approvals' fr object plural
        // labels.
        nav_approvals_inbox: { label: 'Centre d’approbations' },
        nav_approval_requests: { label: 'Demandes d’approbation' },
        nav_approval_actions: { label: 'Historique des actions' },
        // `Délégations d’approbation` matches sys_approval_delegation's object
        // plural label; `(absence)` renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: 'Délégations d’approbation (absence)' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' fr bundle (`setup-nav-hub-parity.test.ts`), so the
        // two delivery pages say Envoi here while the HTTP log below says
        // Livraisons, as sys_http_delivery's fr object label does.
        nav_settings_hub: { label: 'Tous les paramètres' },
        nav_settings_localization: { label: 'Localisation' },
        nav_exchange_rates: { label: 'Taux de change' },
        nav_settings_company: { label: 'Entreprise' },
        nav_settings_mail: { label: 'Envoi des e-mails' },
        nav_settings_sms: { label: 'Envoi des SMS' },
        nav_settings_branding: { label: 'Image de marque' },
        nav_settings_auth: { label: 'Authentification' },
        nav_settings_access_policy: { label: 'Politique d’accès' },
        nav_settings_storage: { label: 'Stockage des fichiers' },
        nav_settings_ai: { label: 'IA et Embedder' },
        nav_settings_knowledge: { label: 'Connaissances' },
        nav_settings_lifecycle: { label: 'Cycle de vie des données' },
        nav_notification_preferences: { label: 'Préférences de notification' },
        nav_notification_templates: { label: 'Modèles de notification' },

        nav_sessions: { label: 'Sessions' },
        nav_audit_logs: { label: 'Journal d’audit' },
        nav_notifications: { label: 'Notifications' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `Webhooks` is sys_webhook's own fr object plural label, and this
        // bundle is where that choice is RECORDED rather than reached by falling
        // back (#5750).
        nav_webhooks: { label: 'Webhooks' },
        nav_http_deliveries: { label: 'Livraisons HTTP' },
        nav_datasources: { label: 'Sources de données' },
        nav_connector_credentials: { label: 'Identifiants des connecteurs' },
        nav_connector_connections: { label: 'Connexions des connecteurs' },

        nav_oauth_apps: { label: 'Applications OAuth' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Atelier de métadonnées pour les développeurs, les analystes et les intégrateurs',
      navigation: {
        group_overview: { label: 'Aperçu' },
        nav_app_builder: { label: 'Créateur d’applications' },
        nav_metadata_directory: { label: 'Tous les types de métadonnées' },
        nav_packages: { label: 'Packages' },
        group_data_model: { label: 'Modèle de données' },
        nav_objects: { label: 'Objets' },
        group_ux: { label: 'Expérience utilisateur' },
        nav_apps: { label: 'Applications' },
        nav_views: { label: 'Vues' },
        nav_pages: { label: 'Pages' },
        nav_dashboards: { label: 'Tableaux de bord' },
        nav_reports: { label: 'Rapports' },
        nav_datasets: { label: 'Jeux de données' },
        group_logic: { label: 'Logique' },
        nav_actions: { label: 'Actions' },
        nav_hooks: { label: 'Hooks' },
        group_automation: { label: 'Automatisation' },
        nav_flows: { label: 'Flux' },
        group_ai: { label: 'IA' },
        nav_agents: { label: 'Agents' },
        nav_tools: { label: 'Outils' },
        nav_skills: { label: 'Compétences' },
        group_developer: { label: 'Développeur' },
        nav_api_console: { label: 'Console API' },
        nav_flow_runs: { label: 'Exécutions de flux' },
        nav_public_forms: { label: 'Formulaires publics' },
        nav_integrations: { label: 'Intégrations et API' },
        group_integration: { label: 'Intégration' },
        nav_email_templates: { label: 'Modèles d’e-mail' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'Aperçu du système',
      description: 'État de la plateforme, activité de sécurité et événements d’audit récents',
      widgets: {
        widget_total_users: { title: 'Total des utilisateurs', description: 'Nombre total d’utilisateurs inscrits dans le système' },
        widget_organizations: { title: 'Organisations', description: 'Nombre total d’organisations sur la plateforme' },
        widget_active_sessions: { title: 'Sessions actives', description: 'Nombre de sessions utilisateur actuellement actives' },
        widget_packages_installed: { title: 'Packages installés', description: 'Installations de packages actives dans les projets' },
        widget_login_events: { title: 'Événements de connexion', description: 'Événements d’authentification enregistrés par le journal d’audit' },
        widget_config_changes: { title: 'Modifications de configuration', description: 'Modifications de la configuration du système' },
        widget_events_by_type: { title: 'Événements d’audit par action', description: 'Répartition des événements d’audit par type d’action' },
        widget_events_by_user: { title: 'Événements par utilisateur', description: 'Répartition de l’activité entre les utilisateurs' },
        widget_recent_events: { title: 'Volume d’événements par action', description: 'Volume d’événements regroupé par action (login, logout, config, …)' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: 'Période' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: 'Nombre d’utilisateurs' } } },
    sys_organization_metrics: { measures: { org_count: { label: 'Nombre d’organisations' } } },
    sys_session_metrics: { measures: { session_count: { label: 'Nombre de sessions' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: 'Nombre d’installations' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: 'Type d’action' }, user_id: { label: 'Utilisateur' } },
      measures: { event_count: { label: 'Nombre d’événements' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: 'Connexion au cloud',
      subtitle: 'Connectez ce runtime à un plan de contrôle ObjectStack pour parcourir les packages privés de votre organisation et les installer ici.',
    },
    connect_agent: {
      label: 'Connecter un assistant IA',
      subtitle: 'Donnez à tout client IA compatible MCP un accès encadré à ce système : chaque appel s’exécute avec les autorisations et la sécurité au niveau des lignes de l’appelant.',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: 'Utilisateur' },
    sys_organization_detail: { label: 'Organisation' },
  },
};
