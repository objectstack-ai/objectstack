// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Recorded source hashes for `es-ES` (#8765, Option B).
 *
 * Each entry is the digest of the `en.ts` SOURCE STRING that the `es-ES`
 * translation at that path was made from. `setup.translation.ts` compares them
 * against the current source when it assembles the served bundle: a mismatch
 * marks that leaf stale and serves the source string in its place
 * (`withSourceFallback`), which is the same degradation an untranslated key
 * already produces.
 *
 * ## Maintaining this file
 *
 * **Re-translated a string?** Update the value in `es-ES.ts` AND the digest
 * here — that pair is what "record the source hash at translation time" means,
 * and it is what makes this locale recover on its own while the others keep
 * falling back. The new digest is
 * `collectSourceHashes(en)['<path>']` (exported from `source-hash.ts`).
 *
 * **Added a brand-new translation?** No entry is needed. A path with no
 * recorded hash is LEGACY-TRUSTED and served verbatim — the ruling's explicit
 * rule, so that translations predating this mechanism did not all degrade the
 * day it landed. An entry recorded now is strictly better (it will catch the
 * NEXT source edit), but its absence never marks anything stale.
 *
 * ⚠️ Do not "fix" a mismatch by refreshing the digest alone. That records that
 * the current translation was made from the current source, which is exactly
 * the false claim this mechanism exists to detect — the served text would go
 * back to being silently wrong.
 *
 * Backfilled once from the then-current source, per the ruling's
 * legacy-trusted note: every translation that existed when this landed is
 * trusted, not marked stale.
 */
export const esESSourceHashes: Readonly<Record<string, string>> = {
  'apps.account.label': 'ae88af048bfd5d64',
  'apps.account.description': 'd5fa9893662325fd',
  'apps.account.navigation.grp_account_inbox.label': '34dc7a0b58ada93b',
  'apps.account.navigation.grp_account_security.label': '0c463f40cccfdf86',
  'apps.account.navigation.grp_account_developer.label': '59668ec5af5afb55',
  'apps.account.navigation.nav_account_profile.label': '2c92f019ece4d044',
  'apps.account.navigation.nav_account_notifications.label': 'e0fdb90b1d31078d',
  'apps.account.navigation.nav_account_approvals.label': '318a820df22a684b',
  'apps.account.navigation.nav_account_memberships.label': '86164fcd38e0378d',
  'apps.account.navigation.nav_account_linked.label': '58ca623b89e9ff5c',
  'apps.account.navigation.nav_account_sessions.label': '05a759e3a230615e',
  'apps.account.navigation.nav_account_api_keys.label': '8cda9851248b0490',
  'apps.account.navigation.nav_account_oauth_apps.label': '1b26cce61a4c10eb',
  'apps.setup.label': 'e4bb0d8bcd47c273',
  'apps.setup.description': 'deacdfc679232a4a',
  'apps.setup.navigation.group_overview.label': 'eebdbe1cc7b59cdf',
  'apps.setup.navigation.group_apps.label': '699b367291abcbe6',
  'apps.setup.navigation.nav_packages.label': '8cd8f29658025f73',
  'apps.setup.navigation.nav_marketplace_browse.label': '2afbe021f5419fdd',
  'apps.setup.navigation.nav_marketplace_installed.label': '93bd5d458e05db60',
  'apps.setup.navigation.nav_cloud_connection.label': '3a7caad0cb98e71d',
  'apps.setup.navigation.group_people_org.label': 'd313f656b6f0ab65',
  'apps.setup.navigation.group_access_control.label': 'a1a4dd47bcbfaf67',
  'apps.setup.navigation.group_approvals.label': '318a820df22a684b',
  'apps.setup.navigation.group_configuration.label': '5e77c0af10f4252c',
  'apps.setup.navigation.group_integrations.label': '1c83392f57463173',
  'apps.setup.navigation.group_diagnostics.label': '62d648cd434b395c',
  'apps.setup.navigation.group_advanced.label': 'bc9e9a0da37ea229',
  'apps.setup.navigation.nav_system_overview.label': '574b2a4b7fb7f979',
  'apps.setup.navigation.nav_users.label': 'eee81f7307a66c40',
  'apps.setup.navigation.nav_organization.label': '3e55836156e1c1de',
  'apps.setup.navigation.nav_business_units.label': '46e0cd2344b40e77',
  'apps.setup.navigation.nav_teams.label': '3fe8519872f65108',
  'apps.setup.navigation.nav_organizations.label': '07488357631b973d',
  'apps.setup.navigation.nav_invitations.label': '4ebb9fd13de7a546',
  'apps.setup.navigation.nav_positions.label': '517a2743f949b5f0',
  'apps.setup.navigation.nav_capabilities.label': '0b59005e10add41f',
  'apps.setup.navigation.nav_permission_sets.label': '4addfe2b8b28b78a',
  'apps.setup.navigation.nav_sharing_rules.label': 'ceaa66fa5f1df4ad',
  'apps.setup.navigation.nav_record_shares.label': 'e261d340ceb25b9a',
  'apps.setup.navigation.nav_sso_providers.label': '7b06b6a6abf53ba4',
  'apps.setup.navigation.nav_api_keys.label': '8cda9851248b0490',
  'apps.setup.navigation.nav_connect_agent.label': 'eeb174613510e87d',
  'apps.setup.navigation.nav_approvals_inbox.label': '0a9269b20d0266c9',
  'apps.setup.navigation.nav_approval_requests.label': 'aafd0f7c6a376f55',
  'apps.setup.navigation.nav_approval_actions.label': 'd2ebad7acfd50978',
  'apps.setup.navigation.nav_approval_delegations.label': 'fc0d41741659c462',
  'apps.setup.navigation.nav_settings_hub.label': 'a3ac65c7c7f461bf',
  'apps.setup.navigation.nav_settings_localization.label': 'beedfaf00452c829',
  'apps.setup.navigation.nav_settings_company.label': '9d7f685e11eaade9',
  'apps.setup.navigation.nav_settings_mail.label': '632647764b8dff5d',
  'apps.setup.navigation.nav_settings_branding.label': 'ec6e391065514b64',
  'apps.setup.navigation.nav_settings_auth.label': '5c6d7dbd850ca37c',
  'apps.setup.navigation.nav_settings_storage.label': 'a2fb526b03c9a9e5',
  'apps.setup.navigation.nav_settings_ai.label': 'a6b41a554173f7ab',
  'apps.setup.navigation.nav_settings_knowledge.label': '140348539a50d9d5',
  'apps.setup.navigation.nav_settings_feature_flags.label': '4e7e9e879ea1bcc3',
  'apps.setup.navigation.nav_notification_preferences.label': '8869f324c1bd545a',
  'apps.setup.navigation.nav_notification_subscriptions.label': '907cb60dda7b39c8',
  'apps.setup.navigation.nav_notification_templates.label': '9e270c87ef2578df',
  'apps.setup.navigation.nav_sessions.label': '673bde6e0c8a3ef9',
  'apps.setup.navigation.nav_audit_logs.label': '700dd03639b82a6a',
  'apps.setup.navigation.nav_notifications.label': 'e0fdb90b1d31078d',
  'apps.setup.navigation.nav_webhooks.label': '8fdd81bc76459a6a',
  'apps.setup.navigation.nav_http_deliveries.label': '340f81dc6ea64987',
  'apps.setup.navigation.nav_datasources.label': '2f0648ce23158e6f',
  'apps.setup.navigation.nav_oauth_apps.label': '1b26cce61a4c10eb',
  'apps.setup.navigation.nav_accounts.label': '0a7369b6e0a9006d',
  'apps.setup.navigation.nav_user_preferences.label': '933760250cddbb1e',
  'apps.studio.label': '5aaaaea2294ee893',
  'apps.studio.description': 'c026a5795933995d',
  'apps.studio.navigation.group_overview.label': 'eebdbe1cc7b59cdf',
  'apps.studio.navigation.nav_app_builder.label': '128446e7650210e7',
  'apps.studio.navigation.nav_metadata_directory.label': '87f99e3de29ec25f',
  'apps.studio.navigation.nav_packages.label': '8cd8f29658025f73',
  'apps.studio.navigation.group_data_model.label': 'f7b1fa6f26b344e5',
  'apps.studio.navigation.nav_objects.label': '361008570f571b11',
  'apps.studio.navigation.group_ux.label': '32d21c81ff9312e2',
  'apps.studio.navigation.nav_apps.label': '699b367291abcbe6',
  'apps.studio.navigation.nav_views.label': 'e9c808e26b6a8d11',
  'apps.studio.navigation.nav_pages.label': 'cda91afda2acc4ab',
  'apps.studio.navigation.nav_dashboards.label': '6102d5e8e4bb4b7a',
  'apps.studio.navigation.nav_reports.label': 'f981f2f6d59fce84',
  'apps.studio.navigation.nav_datasets.label': '8491e1ea908b9b0d',
  'apps.studio.navigation.group_logic.label': '415c519f3ad330d7',
  'apps.studio.navigation.nav_actions.label': '7527654bedc9fdfc',
  'apps.studio.navigation.nav_hooks.label': '6fb7e3b7bc144f67',
  'apps.studio.navigation.group_automation.label': '1d5659130670f5f3',
  'apps.studio.navigation.nav_flows.label': '26f7b054faf636a2',
  'apps.studio.navigation.group_ai.label': '0227934c75e56686',
  'apps.studio.navigation.nav_agents.label': '5300d1df6736e399',
  'apps.studio.navigation.nav_tools.label': 'db86c97f27cd31ce',
  'apps.studio.navigation.nav_skills.label': 'eb2af90cd11bbd34',
  'apps.studio.navigation.group_developer.label': '59668ec5af5afb55',
  'apps.studio.navigation.nav_api_console.label': 'd90e508f1921e8d3',
  'apps.studio.navigation.nav_flow_runs.label': '0bdee1504c505862',
  'apps.studio.navigation.nav_public_forms.label': '4592e97959994e86',
  'apps.studio.navigation.group_integration.label': 'a1f2ddfb5c00c83a',
  'apps.studio.navigation.nav_email_templates.label': '3463bce831c833d5',
  'dashboards.system_overview.label': '574b2a4b7fb7f979',
  'dashboards.system_overview.description': '56dbd944c4b834da',
  'dashboards.system_overview.widgets.widget_total_users.title': 'cee2b388d39f4b4d',
  'dashboards.system_overview.widgets.widget_total_users.description': '54777631b0239fa1',
  'dashboards.system_overview.widgets.widget_organizations.title': '07488357631b973d',
  'dashboards.system_overview.widgets.widget_organizations.description': '4c8ffa2d407f4410',
  'dashboards.system_overview.widgets.widget_active_sessions.title': '05a759e3a230615e',
  'dashboards.system_overview.widgets.widget_active_sessions.description': '72335b16a1f8624e',
  'dashboards.system_overview.widgets.widget_packages_installed.title': 'ca0ce2bb712d83b3',
  'dashboards.system_overview.widgets.widget_packages_installed.description': '67c5558bf10fcb4d',
  'dashboards.system_overview.widgets.widget_login_events.title': 'c6475b3ee5d1efc1',
  'dashboards.system_overview.widgets.widget_login_events.description': '3c41545dbbd34f3c',
  'dashboards.system_overview.widgets.widget_config_changes.title': '4ca2f591d9440211',
  'dashboards.system_overview.widgets.widget_config_changes.description': '6be1d6643282e176',
  'dashboards.system_overview.widgets.widget_events_by_type.title': 'accefd73f7c4187d',
  'dashboards.system_overview.widgets.widget_events_by_type.description': '013308726e1bd2d3',
  'dashboards.system_overview.widgets.widget_events_by_user.title': '04d5cab03abee166',
  'dashboards.system_overview.widgets.widget_events_by_user.description': 'ee9e0d412f66fb4d',
  'dashboards.system_overview.widgets.widget_recent_events.title': '5fb9db734193fe37',
  'dashboards.system_overview.widgets.widget_recent_events.description': '5b9ce7479f6c178c',
  'pages.marketplace_installed.label': '93bd5d458e05db60',
  'pages.marketplace_installed.subtitle': '0743c8f3da7d8a7b',
  'pages.cloud_connection_settings.label': '3a7caad0cb98e71d',
  'pages.cloud_connection_settings.subtitle': 'f5cdd253e8ffef9f',
  'pages.connect_agent.label': 'eeb174613510e87d',
  'pages.connect_agent.subtitle': '2d0f9a000824e78a',
};
