// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { deObjects } from './de.objects.generated.js';

/**
 * Deutsch (de) — Setup App Translations
 */
export const de: TranslationData = {
  objects: deObjects,
  apps: {
    account: {
      label: 'Konto',
      description: 'Persönliche Sicherheits- und Identitätseinstellungen',
      navigation: {
        grp_account_inbox: { label: 'Posteingang' },
        grp_account_security: { label: 'Sicherheit' },
        grp_account_developer: { label: 'Entwickler' },
        grp_account_ai_assistant: { label: 'KI-Assistent' },
        nav_account_profile: { label: 'Profil' },
        nav_account_notifications: { label: 'Benachrichtigungen' },
        nav_account_approvals: { label: 'Meine ausstehenden Genehmigungen' },
        nav_account_memberships: { label: 'Meine Organisationen' },
        nav_account_linked: { label: 'Verknüpfte Konten' },
        nav_account_sessions: { label: 'Aktive Sitzungen' },
        nav_account_api_keys: { label: 'API-Schlüssel' },
        nav_account_oauth_apps: { label: 'OAuth-Anwendungen' },
        // Contributed at runtime by `@objectstack/mcp` into
        // `grp_account_ai_assistant`; the Setup twin's key does not answer for the
        // Account app (one `apps.<app>.navigation` namespace per app).
        nav_connect_agent: { label: 'KI-Assistenten verbinden' },
      },
    },
    setup: {
      label: 'Setup',
      description: 'Plattformeinstellungen und Administration',
      navigation: {
        group_overview: { label: 'Übersicht' },
        group_apps: { label: 'Apps' },
        nav_packaged_actions: { label: 'Aktionen aus Paketen' },
        nav_marketplace_browse: { label: 'Marketplace durchsuchen' },
        nav_marketplace_installed: { label: 'Installierte Apps' },
        nav_cloud_connection: { label: 'Cloud-Verbindung' },
        group_people_org: { label: 'Personen und Organisation' },
        group_access_control: { label: 'Zugriffssteuerung' },
        group_approvals: { label: 'Genehmigungen' },
        group_configuration: { label: 'Konfiguration' },
        group_integrations: { label: 'Integrationen' },
        group_diagnostics: { label: 'Diagnose' },
        group_advanced: { label: 'Erweitert' },

        nav_system_overview: { label: 'Systemübersicht' },
        nav_connect_agent: { label: 'KI-Assistenten verbinden' },

        nav_users: { label: 'Benutzer' },
        nav_organization: { label: 'Organisation' },
        nav_business_units: { label: 'Geschäftseinheiten' },
        nav_teams: { label: 'Teams' },
        nav_organizations: { label: 'Organisationen' },
        nav_invitations: { label: 'Einladungen' },
        nav_position_holders: { label: 'Positionsinhaber' },
        nav_permission_set_assignment: { label: 'Zuweisung von Berechtigungssätzen' },

        nav_sharing_rules: { label: 'Freigaberegeln' },
        nav_record_shares: { label: 'Datensatzfreigaben' },
        nav_queues: { label: 'Warteschlangen' },
        nav_queue_members: { label: 'Warteschlangenmitglieder' },
        nav_assignment_rules: { label: 'Zuweisungsregeln' },
        // Conditionally contributed by `@objectstack/plugin-auth` (only when an
        // external IdP is wired), so `check:app-nav-i18n` cannot see it — see
        // the rationale in `en.ts` (#6659). Wording matches this locale's
        // `sys_sso_provider.pluralLabel`.
        nav_sso_providers: { label: 'SSO-Anbieter' },
        // Conditionally contributed by plugin-auth (only while SCIM is wired),
        // the same case as the entry above; see `en.ts` (#31123). The short form
        // of `sys_scim_connection_credential.pluralLabel`.
        nav_scim_credentials: { label: 'SCIM-Anmeldedaten' },
        nav_api_keys: { label: 'API-Schlüssel' },

        // Genehmigungseingang = the Approvals Inbox component (#7234) — the
        // surface with decision actions. The three below are the engine's raw
        // tables; the first and last read as plugin-approvals' de object plural
        // labels.
        nav_approvals_inbox: { label: 'Genehmigungseingang' },
        nav_approval_requests: { label: 'Genehmigungsanfragen' },
        nav_approval_actions: { label: 'Aktionsverlauf' },
        // `Genehmigungsvertretungen` matches sys_approval_delegation's object
        // plural label; `(Abwesenheit)` renders the entry's own "(OOO)" qualifier.
        nav_approval_delegations: { label: 'Genehmigungsvertretungen (Abwesenheit)' },

        // Each nav_settings_* entry reads as its hub card's title in
        // service-settings' de bundle (`setup-nav-hub-parity.test.ts`), so the
        // two delivery pages say Versand here, while the HTTP log below reads
        // as sys_http_delivery's de object label.
        nav_settings_hub: { label: 'Alle Einstellungen' },
        nav_settings_localization: { label: 'Lokalisierung' },
        nav_exchange_rates: { label: 'Wechselkurse' },
        nav_settings_company: { label: 'Unternehmen' },
        nav_settings_mail: { label: 'E-Mail-Versand' },
        nav_settings_sms: { label: 'SMS-Versand' },
        nav_settings_branding: { label: 'Branding' },
        nav_settings_auth: { label: 'Authentifizierung' },
        nav_settings_access_policy: { label: 'Zugriffsrichtlinie' },
        nav_settings_storage: { label: 'Dateispeicher' },
        nav_settings_ai: { label: 'KI und Embedder' },
        nav_settings_knowledge: { label: 'Wissen' },
        nav_settings_lifecycle: { label: 'Datenlebenszyklus' },
        nav_recycle_bin: { label: 'Papierkorb' },
        nav_notification_preferences: { label: 'Benachrichtigungseinstellungen' },
        nav_notification_templates: { label: 'Benachrichtigungsvorlagen' },

        nav_sessions: { label: 'Sitzungen' },
        nav_audit_logs: { label: 'Audit-Protokoll' },
        nav_notifications: { label: 'Benachrichtigungen' },

        // Integrations — contributed at RUNTIME by the owning capability
        // plugins (ADR-0029 K2), so no static walk of SETUP_APP can see them.
        // `Webhooks` is sys_webhook's own de object plural label, and this
        // bundle is where that choice is RECORDED rather than reached by falling
        // back (#5750).
        nav_webhooks: { label: 'Webhooks' },
        nav_http_deliveries: { label: 'HTTP-Zustellungen' },
        nav_datasources: { label: 'Datenquellen' },
        nav_connector_credentials: { label: 'Konnektor-Anmeldedaten' },
        nav_connector_connections: { label: 'Konnektor-Verbindungen' },

        nav_oauth_apps: { label: 'OAuth-Anwendungen' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Metadaten-Werkbank für Entwickler, Analysten und Implementierer',
      navigation: {
        group_overview: { label: 'Übersicht' },
        nav_app_builder: { label: 'App-Builder' },
        nav_metadata_directory: { label: 'Alle Metadatentypen' },
        nav_packages: { label: 'Pakete' },
        group_data_model: { label: 'Datenmodell' },
        nav_objects: { label: 'Objekte' },
        group_ux: { label: 'Benutzererlebnis' },
        nav_apps: { label: 'Apps' },
        nav_views: { label: 'Ansichten' },
        nav_pages: { label: 'Seiten' },
        nav_dashboards: { label: 'Dashboards' },
        nav_reports: { label: 'Berichte' },
        nav_datasets: { label: 'Datasets' },
        group_logic: { label: 'Logik' },
        nav_actions: { label: 'Aktionen' },
        nav_hooks: { label: 'Hooks' },
        group_automation: { label: 'Automatisierung' },
        nav_flows: { label: 'Flows' },
        group_ai: { label: 'KI' },
        nav_agents: { label: 'Agenten' },
        nav_tools: { label: 'Werkzeuge' },
        nav_skills: { label: 'Fähigkeiten' },
        group_developer: { label: 'Entwickler' },
        nav_api_console: { label: 'API-Konsole' },
        nav_flow_runs: { label: 'Flow-Ausführungen' },
        nav_public_forms: { label: 'Öffentliche Formulare' },
        nav_integrations: { label: 'Integrationen und APIs' },
        group_integration: { label: 'Integration' },
        nav_email_templates: { label: 'E-Mail-Vorlagen' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'Systemübersicht',
      description: 'Zustand der Plattform, Sicherheitsaktivität und aktuelle Audit-Ereignisse',
      widgets: {
        widget_total_users: { title: 'Benutzer gesamt', description: 'Gesamtzahl der im System registrierten Benutzer' },
        widget_organizations: { title: 'Organisationen', description: 'Gesamtzahl der Organisationen auf der Plattform' },
        widget_active_sessions: { title: 'Aktive Sitzungen', description: 'Anzahl der derzeit aktiven Benutzersitzungen' },
        widget_packages_installed: { title: 'Installierte Pakete', description: 'Aktive Paketinstallationen über alle Projekte' },
        widget_login_events: { title: 'Anmeldeereignisse', description: 'Vom Audit-Protokoll erfasste Authentifizierungsereignisse' },
        widget_config_changes: { title: 'Konfigurationsänderungen', description: 'Änderungen an der Systemkonfiguration' },
        widget_events_by_type: { title: 'Audit-Ereignisse nach Aktion', description: 'Verteilung der Audit-Ereignisse nach Aktionstyp' },
        widget_events_by_user: { title: 'Ereignisse nach Benutzer', description: 'Verteilung der Aktivität auf die Benutzer' },
        widget_recent_events: { title: 'Ereignisvolumen nach Aktion', description: 'Ereignisvolumen nach Aktion gruppiert (Anmeldung, Abmeldung, Konfiguration, …)' },
      },
      // The date-range bar above the widgets — addressable since
      // `dashboards.<name>.globalFilters` (#16772), keyed by the filter's
      // `field` because it authors no `name`.
      globalFilters: {
        created_at: { label: 'Zeitraum' },
      },
    },
  },

  datasets: {
    sys_user_metrics: { measures: { user_count: { label: 'Benutzer' } } },
    sys_organization_metrics: { measures: { org_count: { label: 'Organisationen' } } },
    sys_session_metrics: { measures: { session_count: { label: 'Sitzungen' } } },
    sys_package_installation_metrics: { measures: { package_count: { label: 'Installationen' } } },
    sys_audit_log_metrics: {
      dimensions: { action: { label: 'Aktion' }, user_id: { label: 'Benutzer' } },
      measures: { event_count: { label: 'Ereignisse' } },
    },
  },

  pages: {
    cloud_connection_settings: {
      label: 'Cloud-Verbindung',
      subtitle: 'Verbinden Sie diese Laufzeit mit einer ObjectStack-Steuerungsebene, um die privaten Pakete Ihrer Organisation zu durchsuchen und hier zu installieren.',
    },
    connect_agent: {
      label: 'KI-Assistenten verbinden',
      subtitle:
        'Arbeiten Sie in diesem System über Claude, Doubao und andere KI-Assistenten. '
        + 'Jeder handelt als Sie: Er sieht und ändert nur, was Ihre eigenen Berechtigungen erlauben.',
    },

    // Platform record pages (#15743) -- see `en.ts` for the key set.
    sys_user_detail: { label: 'Benutzer' },
    sys_organization_detail: { label: 'Organisation' },
  },
};
