// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationData } from '@objectstack/spec/system';

/**
 * 日本語 (ja-JP) — built-in settings manifest translations.
 */
export const jaJP: TranslationData = {
  settingsCommon: {
    sourceLabels: {
      env: '環境変数',
      global: 'グローバル',
      tenant: 'テナント',
      user: 'ユーザー',
      default: 'デフォルト',
    },
  },
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

    storage: {
      title: 'ファイルストレージ',
      description:
        '添付ファイル・エクスポート・ユーザーアップロードに使用するバックエンド。' +
        '⚠ アダプターを切替えても既存ファイルは移行されません。以前のアダプターでアップロードされたファイルは新しいアダプターからアクセスできなくなります。',
      groups: {
        adapter: { title: 'バックエンド', description: 'アップロードファイルの保存先を選択します。' },
        local: { title: 'ローカル' },
        s3: { title: 'S3' },
        limits: { title: '制限' },
      },
      keys: {
        adapter: {
          label: 'アダプター',
          options: { local: 'ローカルファイルシステム', s3: 'S3 / S3 互換' },
        },
        local_root: { label: 'ルートディレクトリ',
          help: 'ファイルを保存するファイルシステムパス。相対パスはサーバーの CWD から解決されます。' },
        s3_bucket: { label: 'バケット',
          help: '共有ホストバケット。プロジェクト毎のファイルは projects/<projectId>/ プレフィックスで分離されます。' },
        s3_region: { label: 'リージョン', help: '例: us-east-1' },
        s3_endpoint: { label: 'エンドポイント',
          help: 'S3 互換プロバイダ (R2, MinIO, Wasabi) のカスタムエンドポイント。AWS S3 の場合は空欄。' },
        s3_access_key_id: { label: 'アクセスキー ID' },
        s3_secret_access_key: { label: 'シークレットアクセスキー' },
        s3_force_path_style: { label: 'パススタイル URL を強制',
          help: 'MinIO や多くの S3 互換プロバイダで有効化。AWS S3 では無効化。' },
        presigned_ttl: { label: '署名付き URL の有効期間 (秒)' },
        session_ttl: { label: 'アップロードセッション TTL (秒)',
          help: 'チャンクアップロードの再開可能期間。' },
        max_upload_mb: { label: '最大アップロードサイズ (MB)' },
      },
      actions: {
        test: { label: '接続テスト' },
      },
    },
  },
};
