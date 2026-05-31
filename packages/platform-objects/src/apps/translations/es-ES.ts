// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { esESObjects } from './es-ES.objects.generated.js';

/**
 * Español (es-ES) — Setup App Translations
 */
export const esES: TranslationData = {
  objects: esESObjects,
  apps: {
    account: {
      label: 'Cuenta',
      description: 'Configuración personal de seguridad e identidad',
      navigation: {
        grp_account_inbox: { label: 'Bandeja de entrada' },
        grp_account_security: { label: 'Seguridad' },
        grp_account_developer: { label: 'Desarrollador' },
        nav_account_profile: { label: 'Perfil' },
        nav_account_notifications: { label: 'Notificaciones' },
        nav_account_approvals: { label: 'Aprobaciones pendientes' },
        nav_account_memberships: { label: 'Mis organizaciones' },
        nav_account_two_factor: { label: 'Autenticación de dos factores' },
        nav_account_linked: { label: 'Cuentas vinculadas' },
        nav_account_sessions: { label: 'Sesiones activas' },
        nav_account_api_keys: { label: 'Claves API' },
        nav_account_oauth_apps: { label: 'Aplicaciones OAuth' },
      },
    },
    setup: {
      label: 'Configuración',
      description: 'Configuración y administración de la plataforma',
      navigation: {
        group_overview: { label: 'Resumen' },
        group_apps: { label: 'Aplicaciones' },
        nav_marketplace_browse: { label: 'Explorar Marketplace' },
        nav_marketplace_installed: { label: 'Aplicaciones instaladas' },
        group_people_org: { label: 'Personas y Organización' },
        group_access_control: { label: 'Control de Acceso' },
        group_approvals: { label: 'Aprobaciones' },
        group_configuration: { label: 'Configuración' },
        group_diagnostics: { label: 'Diagnóstico' },
        group_advanced: { label: 'Avanzado' },

        nav_system_overview: { label: 'Resumen del Sistema' },

        nav_users: { label: 'Usuarios' },
        nav_departments: { label: 'Departamentos' },
        nav_teams: { label: 'Equipos' },
        nav_organizations: { label: 'Organizaciones' },
        nav_invitations: { label: 'Invitaciones' },

        nav_roles: { label: 'Roles' },
        nav_permission_sets: { label: 'Conjuntos de Permisos' },
        nav_sharing_rules: { label: 'Reglas de Compartición' },
        nav_record_shares: { label: 'Registros Compartidos' },
        nav_api_keys: { label: 'Claves API' },

        nav_approval_processes: { label: 'Procesos' },
        nav_approval_requests: { label: 'Solicitudes' },
        nav_approval_actions: { label: 'Historial de Acciones' },

        nav_settings_hub: { label: 'Todos los Ajustes' },
        nav_settings_mail: { label: 'Correo' },
        nav_settings_branding: { label: 'Marca' },
        nav_settings_feature_flags: { label: 'Indicadores de Funcionalidad' },

        nav_sessions: { label: 'Sesiones' },
        nav_audit_logs: { label: 'Registros de Auditoría' },
        nav_notifications: { label: 'Notificaciones' },

        nav_oauth_apps: { label: 'Aplicaciones OAuth' },
        nav_jwks: { label: 'Claves de Firma (JWKS)' },
        nav_verifications: { label: 'Verificaciones' },
        nav_two_factor: { label: 'Doble Factor' },
        nav_device_codes: { label: 'Códigos de Dispositivo' },
        nav_accounts: { label: 'Enlaces de Identidad' },
        nav_user_preferences: { label: 'Preferencias de Usuario' },
        nav_metadata: { label: 'Todos los Metadatos' },
      },
    },
    studio: {
      label: 'Studio',
      description: 'Banco de trabajo de metadatos para desarrolladores, analistas e implementadores',
      navigation: {
        group_overview: { label: 'Resumen' },
        nav_metadata_directory: { label: 'Todos los tipos de metadatos' },
        group_data_model: { label: 'Modelo de datos' },
        nav_objects: { label: 'Objetos' },
        nav_validations: { label: 'Validaciones' },
        group_ux: { label: 'Experiencia de usuario' },
        nav_apps: { label: 'Aplicaciones' },
        nav_views: { label: 'Vistas' },
        nav_pages: { label: 'Páginas' },
        nav_dashboards: { label: 'Paneles' },
        nav_reports: { label: 'Informes' },
        group_logic: { label: 'Lógica' },
        nav_actions: { label: 'Acciones' },
        nav_hooks: { label: 'Hooks' },
        group_automation: { label: 'Automatización' },
        nav_flows: { label: 'Flujos' },
        nav_workflows: { label: 'Reglas de flujo de trabajo' },
        group_ai: { label: 'IA' },
        nav_agents: { label: 'Agentes' },
        nav_tools: { label: 'Herramientas' },
        nav_skills: { label: 'Habilidades' },
        group_developer: { label: 'Desarrollador' },
        nav_api_console: { label: 'Consola de API' },
        nav_flow_runs: { label: 'Ejecuciones de flujo' },
        nav_public_forms: { label: 'Formularios públicos' },
        group_integration: { label: 'Integración' },
        nav_email_templates: { label: 'Plantillas de correo' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'Resumen del Sistema',
      description: 'Estado de la plataforma, actividad de seguridad y eventos de auditoría recientes',
      widgets: {
        widget_total_users: { title: 'Usuarios Totales', description: 'Total de usuarios registrados en el sistema' },
        widget_organizations: { title: 'Organizaciones', description: 'Total de organizaciones en la plataforma' },
        widget_active_sessions: { title: 'Sesiones Activas', description: 'Número de sesiones de usuario activas en este momento' },
        widget_packages_installed: { title: 'Paquetes Instalados', description: 'Instalaciones de paquetes activas en los proyectos' },
        widget_login_events: { title: 'Eventos de Inicio de Sesión', description: 'Eventos de autenticación registrados por el log de auditoría' },
        widget_permission_changes: { title: 'Cambios de Permisos', description: 'Modificaciones recientes de permisos y roles' },
        widget_config_changes: { title: 'Cambios de Configuración', description: 'Modificaciones de configuración del sistema' },
        widget_events_by_type: { title: 'Eventos de Auditoría por Acción', description: 'Distribución de eventos de auditoría por tipo de acción' },
        widget_events_by_user: { title: 'Eventos por Usuario', description: 'Distribución de actividad entre usuarios' },
        widget_recent_events: { title: 'Eventos de Auditoría Recientes', description: 'Últimos eventos de la plataforma (inicio de sesión, permisos, configuración, …)' },
      },
    },
  },
};
