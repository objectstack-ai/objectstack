// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * 日本語 (ja-JP) — built-in settings manifest translations.
 */
export const jaJP: TranslationData = {
  settings: {
    mail: {
      title: 'メール配信',
      description: 'SMTP およびトランザクションメールプロバイダー設定。',
      groups: {
        provider: { title: 'プロバイダー', description: 'このワークスペースの送信方法を選択します。' },
        smtp: { title: 'SMTP' },
        api_key: { title: 'API キー' },
        from_address: { title: '差出人アドレス' },
      },
      keys: {
        provider: {
          label: 'プロバイダー',
          options: {
            smtp: 'SMTP',
            sendgrid: 'SendGrid',
            ses: 'Amazon SES',
            postmark: 'Postmark',
          },
        },
        smtp_host: { label: 'ホスト', help: '例: smtp.example.com' },
        smtp_port: { label: 'ポート' },
        smtp_secure: { label: 'TLS を使用' },
        smtp_user: { label: 'ユーザー名' },
        smtp_password: { label: 'パスワード' },
        api_key: { label: 'API キー' },
        from_email: { label: '差出人アドレス', help: '例: no-reply@example.com' },
        from_name: { label: '差出人名' },
      },
      actions: {
        test: { label: 'テストメール送信' },
      },
    },

    branding: {
      title: 'ブランディング',
      description: 'ワークスペース名・ロゴ・アクセントカラー。',
      groups: {
        identity: { title: 'アイデンティティ' },
        appearance: { title: '外観' },
      },
      keys: {
        workspace_name: { label: 'ワークスペース名' },
        support_email: { label: 'サポートメール', help: '例: support@example.com' },
        theme_mode: {
          label: 'デフォルトテーマ',
          options: { light: 'ライト', dark: 'ダーク', system: 'システムに従う' },
        },
        accent_color: { label: 'アクセントカラー' },
        logo_url: { label: 'ロゴ URL', help: '例: https://…/logo.svg' },
      },
    },

    feature_flags: {
      title: '機能フラグ',
      description: 'このワークスペースで実験的・ベータ機能を切替えます。',
      groups: {
        productivity: { title: '生産性' },
        collaboration: { title: 'コラボレーション' },
      },
      keys: {
        ai_enabled: {
          label: 'AI アシスタント',
          help: 'アプリ内 AI アシスタントパネルを有効化します。',
        },
        kanban_swimlanes: { label: 'カンバンのスイムレーン' },
        realtime_cursors: { label: 'リアルタイムカーソル' },
        inline_comments: { label: 'インラインコメント' },
      },
    },
  },
};
