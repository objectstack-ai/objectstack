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
        delivery: { title: '配信方法', description: '送信メールをプロバイダーに渡す方法。' },
      },
      keys: {
        provider: {
          label: 'プロバイダー',
          help: 'このサーバーが実際に配信できるプロバイダーのみを表示しています。'
            + 'SendGrid と Amazon SES は SMTP として設定します。',
          options: {
            smtp: 'SMTP',
            resend: 'Resend',
            postmark: 'Postmark',
            log: '送信しない(ログのみ — 実際には配信されません)',
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
        queue_delivery: {
          label: '永続キュー配信',
          help: '各メッセージをインライン送信ではなくジョブキューに渡します。配信に失敗してもワーカーが'
            + 'バックオフ付きで再試行し、再起動後も失われません。永続アダプターを備えたキュー機能が必要です。'
            + '「テストメール送信」は常にインラインで送信します。',
        },
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

    auth: {
      title: '認証',
      description: 'サインイン、登録、組み込み認証機能の制御。',
      groups: {
        email_password: {
          title: 'メールとパスワード',
          description: 'ローカルのメール/パスワードサインインとセルフサービス登録を制御します。',
        },
        membership: {
          title: 'メンバーシップ',
          description: '新しく作成されたユーザーが所属する先。上のセルフサービス登録と対になる設定です。',
        },
        audience: {
          title: '登録対象',
          description: 'この環境のアプリのユーザーになれる対象。「招待のみ」以外のポスチャではメール確認が強制されます。招待、管理者による作成、SCIM プロビジョニング、エンタープライズ SSO はどのポスチャでも許可されます。',
        },
        password_policy: {
          title: 'パスワードポリシー',
          description: 'サインアップおよびパスワードリセット時に認証プロバイダーが強制する長さ制限。',
        },
        anti_abuse: {
          title: '不正利用対策',
          description: 'ブルートフォース対策:ID ごとのアカウントロックと、認証エンドポイントへの IP ごとのレート制限。',
        },
        multi_factor: {
          title: '多要素',
          description: 'メンバーに認証アプリ(TOTP)でのアカウント保護を必須にします。',
        },
        sessions: {
          title: 'セッション',
          description: 'サインイン済みセッションの有効期間。',
        },
        network: {
          title: 'ネットワーク',
          description: 'ユーザーがどこから認証できるかを制限します。',
        },
        social: {
          title: 'ソーシャルサインイン',
          description:
            '組み込みの Google サインインプロバイダーを設定します。デプロイの環境変数が優先されます。',
        },
      },
      keys: {
        email_password_enabled: { label: 'メール/パスワードログインを有効化' },
        signup_enabled: { label: 'セルフサービス登録を許可' },
        require_email_verification: { label: 'メール確認を必須にする' },
        membership_policy: {
          label: '新規ユーザーのメンバーシップ',
          help: '「自動」はすべての新規ユーザーをこのデプロイの既定組織に紐付けます。「招待のみ」では、ワークスペースの作成、招待の承諾、管理者による追加、SSO のジャストインタイムプロビジョニングといった明示的な行為によってのみメンバーシップが付与されます。',
          options: {
            auto: '既定の組織に自動的に参加',
            'invite-only': '招待のみ — 自動では参加しない',
          },
        },
        audience_posture: {
          label: 'セルフ登録の対象',
          help: '「招待のみ」はセルフ登録を閉じます。ユーザーは運用側の行為(招待、管理者による作成/インポート、SCIM、エンタープライズ SSO)によってのみ作成されます。「メールドメイン」は下の許可リストのドメインにのみ開放し、「オープン」は誰でも登録できます。「招待のみ」以外ではメール確認が強制され、下のセルフ登録権限セットの指定が必要です。',
          options: {
            invite_only: '招待のみ — セルフ登録なし(既定)',
            email_domain: '許可リストのメールドメインのみ',
            open: 'オープン — 誰でもセルフ登録可能',
          },
        },
        audience_allowed_email_domains: {
          label: '許可するメールドメイン',
          help: '裸のドメイン名を 1 行に 1 つ、またはカンマ区切りで指定します(例: acme.com)。完全一致・大文字小文字は区別しません。サブドメインは個別に指定が必要で、ワイルドカードは使えません。',
        },
        audience_self_registration_permission_set: {
          label: 'セルフ登録の権限セット',
          help: '各セルフ登録ユーザーに付与される sys_permission_set 名(member_default の明示宣言は可。admin_full_access は拒否されます)。',
        },
        password_min_length: { label: 'パスワードの最小文字数' },
        password_max_length: { label: 'パスワードの最大文字数', help: '非常に長いパスワードのハッシュ化によるサービス拒否を防ぎます。' },
        password_reject_breached: {
          label: '漏洩済みパスワードを拒否',
          help: 'Have I Been Pwned(k-匿名レンジチェック。パスワード全体は送信しません)により、公開漏洩コーパスに含まれるパスワードをブロックします。',
        },
        password_require_complexity: {
          label: '複雑なパスワードを要求',
          help: 'サインアップおよびパスワード変更/リセット時に、複数の文字種(大文字・小文字・数字・記号)の組み合わせを要求します。',
        },
        password_min_classes: {
          label: '最小文字種数',
          help: 'パスワードに含める必要がある文字種(大文字/小文字/数字/記号の4種)の数。',
        },
        password_history_count: {
          label: 'パスワード履歴(再利用禁止)',
          help: '変更/リセット時に、直近この数のパスワードの再利用を禁止します。0 で無効。',
        },
        password_expiry_days: {
          label: 'パスワード有効期限(日)',
          help: 'この日数を過ぎるとパスワード変更を強制します。0 で無効。期限切れの間、ユーザーはパスワードを変更するまでデータにアクセスできません。',
        },
        lockout_threshold: {
          label: 'アカウントロックのしきい値',
          help: '連続してこの回数サインインに失敗するとアカウントをロックします(パスワードの誤りと二要素コードの誤りの両方を数えます)。ロック中は正しい資格情報でもサインインを拒否します。0 でパスワード段階のロックを無効化しますが、二要素認証はセッション発行前の最後の確認であるため、組み込みの上限(15 分間に 10 回)を保ちます。',
        },
        lockout_duration_minutes: {
          label: 'ロック時間(分)',
          help: 'しきい値を超えた後、アカウントがロックされ続ける時間。どちらのサインイン段階でも同じです。',
        },
        rate_limit_max: {
          label: '認証レート制限:最大リクエスト数',
          help: 'サインイン / サインアップ / パスワードリセットの各エンドポイントに対する、IP ごと・時間枠ごとの最大リクエスト数。',
        },
        rate_limit_window_seconds: {
          label: '認証レート制限:時間枠(秒)',
          help: '上記のリクエスト上限を数える移動時間枠。',
        },
        mfa_required: {
          label: '多要素認証を必須にする',
          help: '認証アプリを登録していないユーザーは、猶予期間の終了後にデータへのアクセスをブロックされます。これを有効にすると、ユーザーが登録できるよう二要素機能もオンになります。',
        },
        mfa_grace_period_days: {
          label: 'MFA 猶予期間(日)',
          help: 'ハードブロックまでに登録を延期できる期間。0 で即時ブロック。',
        },
        session_expiry_days: { label: 'セッション有効期間(日)', help: 'サインインからこの日数でセッションが失効します。' },
        session_refresh_days: { label: '更新しきい値(日)', help: 'アクティブなセッションがこの期間を超えると延長されます。' },
        session_idle_timeout_minutes: {
          label: 'アイドルタイムアウト(分)',
          help: 'この分数、無操作が続くとユーザーをサインアウトします。0 で無効。',
        },
        session_absolute_max_hours: {
          label: 'セッションの絶対有効期間(時間)',
          help: 'アクティビティに関係なく、サインインからこの時間で再認証を強制します。0 で無効。',
        },
        max_concurrent_sessions_per_user: {
          label: 'ユーザーあたりの最大同時セッション数',
          help: 'ユーザーごとの同時サインインセッション数を制限します。上限を超えると古いものからサインアウトされます。0 で無制限。',
        },
        allowed_ip_ranges: {
          label: '許可 IP レンジ',
          help: 'CIDR レンジまたは正確な IP(1行に1つ、またはカンマ区切り)。例:203.0.113.0/24。設定すると、この範囲外からのサインインを拒否します。空欄で制限なし。X-Forwarded-For を設定する信頼できるプロキシが必要です。',
        },
        google_enabled: {
          label: 'Google ログインを有効化',
          help: 'Google Cloud Console の Google OAuth クライアント ID とシークレットが必要です。',
        },
        google_client_id: {
          label: 'Google クライアント ID',
          help: 'Google Cloud Console の OAuth クライアント ID。サーバー側で GOOGLE_CLIENT_ID を設定することもできます。',
        },
        google_client_secret: {
          label: 'Google クライアントシークレット',
          help: '保存時に暗号化されます。サーバー側で GOOGLE_CLIENT_SECRET を設定することもできます。',
        },
      },
    },

    sms: {
      title: 'SMS 配信',
      description: 'OTP サインイン、招待、通知に使う SMS プロバイダー設定。',
      groups: {
        provider: { title: 'プロバイダー', description: 'このワークスペースが送信 SMS をどう送るかを選択します。' },
        aliyun: { title: 'Aliyun SMS' },
        twilio: { title: 'Twilio' },
        limits: { title: '送信上限', description: 'この配備の送信 SMS 量を制限します。SMS は有料チャネルで、1 通ごとに実費が発生します。' },
      },
      keys: {
        provider: {
          label: 'プロバイダー',
          options: { log: 'なし（ログのみ — 実送信しない）', aliyun: 'Aliyun SMS', twilio: 'Twilio' },
        },
        aliyun_access_key_id: { label: 'AccessKey ID' },
        aliyun_access_key_secret: { label: 'AccessKey Secret' },
        aliyun_sign_name: { label: '署名（短信签名）' },
        aliyun_template_code: {
          label: '既定テンプレートコード',
          help: '送信時にテンプレートが指定されない場合に使用します。単一の ${content} 変数を持つ汎用テンプレートで、一般的な通知 SMS を送信できます。',
        },
        twilio_account_sid: { label: 'Account SID' },
        twilio_auth_token: { label: 'Auth トークン' },
        twilio_from_number: {
          label: '送信元番号',
          help: 'E.164 形式の送信者。例:+15005550006。これか Messaging Service SID のいずれかが必要です。',
        },
        twilio_messaging_service_sid: { label: 'Messaging Service SID' },
        daily_quota: {
          label: '1 日の送信上限',
          help: 'この配備が UTC の 1 日あたりに送信できる SMS の上限数（OTP サインイン・招待・通知を含む）。0 は無制限。上限を超える送信は 00:00 UTC まで拒否されます。',
        },
      },
      actions: { test: { label: 'テスト SMS を送信' } },
    },

    company: {
      title: '会社',
      description: '法人としてのアイデンティティ — 登記名、住所、税務 ID、主担当者。',
      groups: {
        identity: { title: 'アイデンティティ' },
        address: { title: '登記住所' },
        contact: { title: '連絡先' },
      },
      keys: {
        legal_name: { label: '登記名', help: '組織の登記上の正式名称（ワークスペース名と異なる場合があります）。' },
        registration_number: { label: '登記番号', help: '会社の登記 / 設立番号（例:EIN、会社番号）。' },
        tax_id: { label: '税務 / VAT ID', help: '請求書に表示される税務識別番号(例:VAT、GST、ABN)。' },
        address_line1: { label: '住所 1' },
        address_line2: { label: '住所 2' },
        city: { label: '市区町村' },
        state: { label: '都道府県 / 州' },
        postal_code: { label: '郵便番号' },
        country: { label: '国', help: 'ISO 3166-1 alpha-2 コード（例:US、GB、CN）。' },
        phone: { label: '電話', help: '主要な業務用電話（E.164 推奨。例:+1 415 555 0100）。' },
        website: { label: 'ウェブサイト', help: '例:https://example.com' },
        primary_contact_name: { label: '主担当者名' },
        primary_contact_email: { label: '主担当者メール', help: '例:ops@example.com' },
      },
    },

    localization: {
      title: 'ローカリゼーション',
      description: '既定のタイムゾーン、言語、通貨、日付/数値フォーマット。',
      groups: {
        region: { title: '地域' },
        formats: { title: 'フォーマット' },
        finance: { title: '財務' },
      },
      keys: {
        timezone: { label: '既定のタイムゾーン', help: 'today()/daysFromNow の解決、分析の日付バケット、日時レンダリングに使う IANA タイムゾーン。' },
        locale: { label: '既定の言語', help: 'メッセージカタログと数値/日付フォーマットに使う BCP-47 ロケール。' },
        default_country: { label: '既定の国', help: 'ISO 3166-1 alpha-2 コード（例:US、GB、CN）。住所と電話の既定に使用します。' },
        date_format: { label: '日付フォーマット' },
        time_format: { label: '時刻フォーマット' },
        number_format: { label: '数値フォーマット', help: '表示する数値の桁区切りと小数点の記号。' },
        first_day_of_week: { label: '週の開始日', help: '週次分析のバケットとカレンダーグリッドの基準になります。' },
        currency: { label: '既定の通貨', help: '通貨フィールドが独自の通貨を指定しない場合に適用される ISO 4217 コード。' },
        fiscal_year_start: { label: '会計年度の開始月', help: '会計年度の最初の月 — レポートの「今四半期 / 会計年度」を決定します。' },
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
          help: '共有ホストバケット。プロジェクト毎のファイルは projects/<environmentId>/ プレフィックスで分離されます。' },
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

    ai: {
      title: 'AI と Embedder',
      description:
        'プラットフォームの AI およびナレッジサービスが使用する LLM プロバイダー、モデル、認証情報、Embedder 設定。',
      groups: {
        provider: { title: 'プロバイダー',
          description: 'LLM バックエンドを選択します。Memory モードは入力をそのまま返します。テスト用であり、本番では使用しないでください。' },
        gateway: { title: 'Vercel AI Gateway',
          description: 'マルチプロバイダールーター。モデル指定は `provider/model` 形式に従います（例: `openai/gpt-4o`）。' },
        openai: { title: 'OpenAI' },
        anthropic: { title: 'Anthropic' },
        google: { title: 'Google' },
        deepseek: { title: 'DeepSeek', description: 'https://api.deepseek.com の OpenAI 互換 API。Base URL は自動入力されます。' },
        dashscope: { title: '阿里通义 DashScope', description: 'dashscope.aliyuncs.com/compatible-mode/v1 の OpenAI 互換エンドポイント。Base URL は自動入力されます。' },
        cloudflare: { title: 'Cloudflare AI Gateway', description: 'Cloudflare AI Gateway 経由で OpenAI 互換モデルをプロキシします。' },
        siliconflow: { title: '硅基流动 SiliconFlow', description: 'api.siliconflow.cn/v1 の OpenAI 互換エンドポイント。Base URL は自動入力されます。' },
        openrouter: { title: 'OpenRouter', description: 'openrouter.ai/api/v1 のマルチプロバイダールーター。Base URL は自動入力されます。' },
        titles: { title: '会話タイトル', description: '新しい会話に短い要約タイトルを自動生成します。' },
        defaults: { title: '生成のデフォルト値',
          description: 'エージェントまたはチャットリクエストが独自の値を指定しない場合に適用されます。' },
        observability: { title: '可観測性' },
        embedder: { title: 'Embedder',
          description:
            'ナレッジソースと RAG が使用するテキスト → ベクトルプロバイダー。' +
            '上記のチャットプロバイダーとは独立しています。' },
      },
      keys: {
        provider: {
          label: 'プロバイダー',
          options: {
            memory: 'Memory（エコー — テスト専用）',
            gateway: 'Vercel AI Gateway',
            openai: 'OpenAI',
            anthropic: 'Anthropic',
            google: 'Google Generative AI',
            deepseek: 'DeepSeek（OpenAI 互換）',
            dashscope: '阿里通义 DashScope（OpenAI 互換）',
            cloudflare: 'Cloudflare AI Gateway（OpenAI 互換）',
            siliconflow: '硅基流动 SiliconFlow（OpenAI 互換）',
            openrouter: 'OpenRouter（OpenAI 互換）',
          },
        },
        gateway_model: { label: 'Gateway モデル',
          help: 'AI_GATEWAY_MODEL として転送されます。例: openai/gpt-4o' },
        gateway_api_key: { label: 'Gateway API キー',
          help: '任意 — Gateway が認証を要求する場合のみ必要です。' },
        openai_api_key: { label: 'OpenAI API キー',
          help: 'OPENAI_API_KEY として転送されます。保存時に暗号化されます。' },
        openai_model: { label: 'モデル',
          help: 'デフォルトのモデル ID。エージェント単位の上書きが優先されます。' },
        openai_base_url: { label: 'Base URL',
          help: 'Azure OpenAI や自己ホスト型ゲートウェイ用の上書き。api.openai.com の場合は空欄にします。' },
        anthropic_api_key: { label: 'Anthropic API キー',
          help: 'ANTHROPIC_API_KEY として転送されます。保存時に暗号化されます。' },
        anthropic_model: { label: 'モデル' },
        google_api_key: { label: 'Google API キー',
          help: 'GOOGLE_GENERATIVE_AI_API_KEY として転送されます。保存時に暗号化されます。' },
        google_model: { label: 'モデル' },
        deepseek_api_key: { label: 'DeepSeek API キー', help: 'sk-…。platform.deepseek.com で発行。' },
        deepseek_model: { label: 'モデル', help: '例:deepseek-chat（V3）、deepseek-reasoner（R1 推論）。' },
        dashscope_api_key: { label: 'DashScope API キー', help: 'sk-…。dashscope.console.aliyun.com で発行。' },
        dashscope_model: { label: 'モデル' },
        cloudflare_account_id: { label: 'Cloudflare アカウント ID', help: 'Cloudflare ダッシュボード URL に含まれる 32 桁の 16 進数 ID。' },
        cloudflare_gateway_id: { label: 'Gateway ID', help: 'Cloudflare → AI Gateway で設定したゲートウェイ名。既定は `default`。' },
        cloudflare_api_key: { label: 'Cloudflare AI Gateway トークン', help: 'AI Gateway →「API tokens」タブで発行（cfut_… または sk_…）。' },
        cloudflare_model: { label: 'モデル' },
        siliconflow_api_key: { label: 'SiliconFlow API キー' },
        siliconflow_model: { label: 'モデル', help: '例:Qwen/Qwen2.5-72B-Instruct、deepseek-ai/DeepSeek-V3、meta-llama/Meta-Llama-3.1-8B-Instruct。' },
        openrouter_api_key: { label: 'OpenRouter API キー', help: 'sk-or-…' },
        openrouter_model: { label: 'モデル', help: '形式:provider/model（例:anthropic/claude-3.5-sonnet、deepseek/deepseek-chat）。' },
        title_generation_enabled: { label: '会話タイトルを自動要約' },
        title_max_length: { label: 'タイトルの最大長（文字）', help: '生成タイトルの上限。超過分はサーバー側で切り詰められます。' },
        temperature: { label: 'Temperature',
          help: '0 = 決定的、2 = 非常に創造的。' },
        max_tokens: { label: '最大出力トークン数',
          help: 'レスポンスごとに生成されるトークンの上限。' },
        request_timeout_ms: { label: 'リクエストタイムアウト (ms)' },
        trace_enabled: { label: 'トレースを記録',
          help: 'デバッグと再生のため prompt/response トレースを sys_ai_trace に保存します。' },
        log_prompts: { label: '完全なプロンプトを記録',
          help: 'メタデータだけでなくレンダリングされたプロンプトをトレース行に含めます。⚠ PII が漏えいする可能性があります。規制環境では無効にしてください。' },
        embedder_provider: {
          label: 'プロバイダー',
          options: {
            none: '無効（埋め込みなし）',
            openai: 'OpenAI',
            azure: 'Azure OpenAI',
            dashscope: '阿里通义 DashScope',
            zhipu: '智谱 BigModel',
            siliconflow: '硅基流动 SiliconFlow',
            doubao: '火山引擎 Doubao',
            minimax: 'MiniMax',
            ollama: 'Ollama（ローカル）',
            custom: 'カスタム（OpenAI 互換）',
          },
        },
        embedder_api_key: { label: 'Embedder API キー',
          help: 'Authorization ヘッダーとして送信される Bearer トークン。Ollama では空でない任意の値で動作します。' },
        embedder_model: { label: 'モデル',
          help: '例 — OpenAI: text-embedding-3-small · 阿里通义: text-embedding-v3 · 智谱: embedding-3 · 硅基流动: BAAI/bge-m3 · Ollama: bge-m3' },
        embedder_base_url: { label: 'Base URL',
          help: 'エンドポイントのルート（/embeddings を含まない）。プリセットから自動入力されます。プロキシや自己ホスト型ゲートウェイ用に上書きできます。' },
        embedder_dimensions: { label: '次元数',
          help: '出力次元数を上書きします（Matryoshka モデルのみ）。空欄の場合はモデルのデフォルトを使用します。' },
        embedder_batch_size: { label: 'バッチサイズ',
          help: 'embed() 呼び出しごとのチャンク数。プロバイダーのレート/サイズ制限に達する場合は減らします。' },
      },
      actions: {
        test: { label: '接続テスト' },
        test_embedder: { label: 'Embedder をテスト' },
      },
    },

    knowledge: {
      title: 'ナレッジ',
      description:
        'RAG / ナレッジソース用のベクトルストアバックエンド。' +
        '⚠ アダプターを切替えても既存のインデックスは移行されません。',
      groups: {
        adapter: { title: 'バックエンド',
          description: 'ドキュメントチャンクとそのベクトルの保存先を選択します。' },
        turso: { title: 'Turso / libSQL',
          description: 'マネージド Turso、ローカルファイル、インメモリのいずれでも動作します。' },
        ragflow: { title: 'RAGFlow',
          description: '外部 RAGFlow デプロイ。セルフホストの手順は https://ragflow.io を参照してください。' },
        indexing: { title: 'インデックスのデフォルト値',
          description: 'KnowledgeSource.adapterConfig のソース単位の値が優先されます。' },
        permissions: { title: '権限' },
      },
      keys: {
        adapter: {
          label: 'アダプター',
          options: {
            memory: 'インメモリ（開発/テスト専用）',
            turso: 'Turso / libSQL（クラウドまたはローカル）',
            ragflow: 'RAGFlow（外部）',
          },
        },
        turso_url: { label: '接続 URL',
          help: '例: libsql://your-tenant.turso.io · file:./.objectstack/knowledge.db · :memory:' },
        turso_auth_token: { label: '認証トークン',
          help: 'マネージド Turso URL の場合のみ必要です。' },
        ragflow_base_url: { label: 'Base URL', help: '例: http://localhost:9380' },
        ragflow_api_key: { label: 'API キー' },
        ragflow_default_dataset: { label: 'デフォルトデータセット ID',
          help: 'KnowledgeSource が独自の RAGFlow データセットを指定しない場合に使用されます。' },
        chunk_target: { label: '目標チャンクサイズ（文字数）',
          help: 'トークン単位の分割が行われる前のチャンクサイズのソフト上限。' },
        chunk_overlap: { label: 'チャンクの重なり（文字数）',
          help: '境界を越えてコンテキストを維持するため、前のチャンクから保持する文字数。' },
        over_fetch: { label: 'オーバーフェッチ倍率',
          help: 'JS 側のメタデータフィルタリングでも行が残るよう、内部で topK × overFetch 件の候補を取得します。' },
        enforce_rls: { label: '検索時に RLS を強制',
          help: '各ヒットを呼び出し元のレコードレベル権限に対して再確認します。⚠ 無効化するとプラットフォーム固有のセーフガードがスキップされます。' },
      },
      actions: {
        test: { label: '接続テスト' },
      },
    },
  },
};
