// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';
import { jaJPObjects } from './ja-JP.objects.generated.js';

/**
 * 日本語 (ja-JP) — Setup App Translations
 */
export const jaJP: TranslationData = {
  objects: jaJPObjects,
  apps: {
    account: {
      label: 'アカウント',
      description: '個人のセキュリティとアイデンティティ設定',
      navigation: {
        grp_account_inbox: { label: '受信箱' },
        grp_account_security: { label: 'セキュリティ' },
        grp_account_developer: { label: '開発者' },
        nav_account_profile: { label: 'プロフィール' },
        nav_account_notifications: { label: '通知' },
        nav_account_approvals: { label: '承認待ち' },
        nav_account_memberships: { label: '所属組織' },
        nav_account_linked: { label: '連携アカウント' },
        nav_account_sessions: { label: 'アクティブセッション' },
        nav_account_api_keys: { label: 'API キー' },
        nav_account_oauth_apps: { label: 'OAuth アプリケーション' },
      },
    },
    setup: {
      label: 'セットアップ',
      description: 'プラットフォーム設定と管理',
      navigation: {
        group_overview: { label: '概要' },
        group_apps: { label: 'アプリ' },
        nav_marketplace_browse: { label: 'マーケットプレイスを閲覧' },
        nav_marketplace_installed: { label: 'インストール済みアプリ' },
        group_people_org: { label: 'ユーザーと組織' },
        group_access_control: { label: 'アクセス制御' },
        group_approvals: { label: '承認' },
        group_configuration: { label: '構成' },
        group_integrations: { label: '統合' },
        group_diagnostics: { label: '診断' },
        group_advanced: { label: '詳細' },

        nav_system_overview: { label: 'システム概要' },

        nav_users: { label: 'ユーザー' },
        nav_organization: { label: '組織' },
        nav_business_units: { label: 'ビジネスユニット' },
        nav_teams: { label: 'チーム' },
        nav_organizations: { label: '組織' },
        nav_invitations: { label: '招待' },

        nav_positions: { label: 'ポジション' },
        nav_permission_sets: { label: '権限セット' },
        nav_sharing_rules: { label: '共有ルール' },
        nav_record_shares: { label: 'レコード共有' },
        nav_api_keys: { label: 'API キー' },

        nav_approval_processes: { label: 'プロセス' },
        nav_approval_requests: { label: 'リクエスト' },
        nav_approval_actions: { label: 'アクション履歴' },

        nav_settings_hub: { label: 'すべての設定' },
        nav_settings_mail: { label: 'メール' },
        nav_settings_branding: { label: 'ブランディング' },
        nav_settings_auth: { label: '認証' },
        nav_settings_storage: { label: 'ファイルストレージ' },
        nav_settings_ai: { label: 'AI と Embedder' },
        nav_settings_knowledge: { label: 'ナレッジ' },
        nav_settings_feature_flags: { label: '機能フラグ' },
        nav_notification_preferences: { label: '通知設定' },
        nav_notification_subscriptions: { label: '通知購読' },
        nav_notification_templates: { label: '通知テンプレート' },

        nav_sessions: { label: 'セッション' },
        nav_audit_logs: { label: '監査ログ' },
        nav_notifications: { label: '通知' },

        nav_oauth_apps: { label: 'OAuth アプリケーション' },
        nav_jwks: { label: '署名キー (JWKS)' },
        nav_verifications: { label: '検証' },
        nav_device_codes: { label: 'デバイスコード' },
        nav_accounts: { label: 'ID 連携' },
        nav_user_preferences: { label: 'ユーザー設定' },
        nav_metadata: { label: 'すべてのメタデータ' },
      },
    },
    studio: {
      label: 'Studio',
      description: '開発者・アナリスト・実装担当者向けのメタデータワークベンチ',
      navigation: {
        group_overview: { label: '概要' },
        nav_metadata_directory: { label: 'すべてのメタデータタイプ' },
        nav_packages: { label: 'パッケージ' },
        group_data_model: { label: 'データモデル' },
        nav_objects: { label: 'オブジェクト' },
        nav_validations: { label: 'バリデーション' },
        group_ux: { label: 'ユーザー体験' },
        nav_apps: { label: 'アプリ' },
        nav_views: { label: 'ビュー' },
        nav_pages: { label: 'ページ' },
        nav_dashboards: { label: 'ダッシュボード' },
        nav_reports: { label: 'レポート' },
        nav_datasets: { label: 'データセット' },
        group_logic: { label: 'ロジック' },
        nav_actions: { label: 'アクション' },
        nav_hooks: { label: 'フック' },
        group_automation: { label: '自動化' },
        nav_flows: { label: 'フロー' },
        nav_workflows: { label: 'ワークフロールール' },
        group_ai: { label: 'AI' },
        nav_agents: { label: 'エージェント' },
        nav_tools: { label: 'ツール' },
        nav_skills: { label: 'スキル' },
        group_developer: { label: '開発者' },
        nav_api_console: { label: 'API コンソール' },
        nav_flow_runs: { label: 'フロー実行履歴' },
        nav_public_forms: { label: '公開フォーム' },
        group_integration: { label: '連携' },
        nav_email_templates: { label: 'メールテンプレート' },
      },
    },
  },

  dashboards: {
    system_overview: {
      label: 'システム概要',
      description: 'プラットフォームの健全性、セキュリティ活動、最近の監査イベント',
      widgets: {
        widget_total_users: { title: 'ユーザー総数', description: 'システムに登録されたユーザーの総数' },
        widget_organizations: { title: '組織', description: 'プラットフォーム上の組織総数' },
        widget_active_sessions: { title: 'アクティブセッション', description: '現在アクティブなユーザーセッション数' },
        widget_packages_installed: { title: 'インストール済みパッケージ', description: 'プロジェクトでアクティブなパッケージインストール数' },
        widget_login_events: { title: 'ログインイベント', description: '監査ログに記録された認証イベント' },
        widget_permission_changes: { title: '権限変更', description: '最近の権限とロールの変更' },
        widget_config_changes: { title: '構成変更', description: 'システム構成の変更' },
        widget_events_by_type: { title: 'アクション別監査イベント', description: 'アクションタイプ別の監査イベント分布' },
        widget_events_by_user: { title: 'ユーザー別イベント', description: 'ユーザー別アクティビティ分布' },
        widget_recent_events: { title: '最近の監査イベント', description: '最新のプラットフォームイベント（ログイン、権限、構成など）' },
      },
    },
  },
};
